import * as vscode from "vscode";
import { getLocalGraphSuggestions as getCoreLocalGraphSuggestions } from "@ide-agent/core";
import {
  DEFAULT_DIAGRAM_JSON_PATH,
  DiagramInsertionPointSummary,
  DiagramNodeSummary,
  DiagramSegmentSummary,
  DiagramSummary,
  loadDiagramSummary,
} from "../diagram/DiagramSummary";

export interface LocalGraphSuggestionOptions {
  segmentId?: string;
  selectedNodeId?: string;
  selectedInsertionPointId?: string;
  selectedVar?: string;
  selectedNodeType?: string;
  focusQuery?: string;
}

export interface LocalGraphSuggestionRequest {
  diagramPath: string;
  segmentId?: string;
  selectedNodeId?: string;
  selectedInsertionPointId?: string;
}

export interface LocalGraphSuggestionPayload {
  schemaVersion: string;
  action: string;
  source: string;
  segmentId: string;
  anchorNodeId: string;
  anchorNodeVar: string;
  confidence: number;
  recognizedFocus: Record<string, unknown>;
  suggestions: LocalSuggestion[];
}

export interface LocalGraphSuggestionResult {
  diagramPath: string;
  payload: LocalGraphSuggestionPayload;
}

interface FocusContext {
  segment: DiagramSegmentSummary;
  node?: DiagramNodeSummary;
  insertionPoint?: DiagramInsertionPointSummary;
  source: "provided" | "manualInput" | "quickPick" | "fallback";
}

interface SegmentGraphState {
  hasLogicNode: boolean;
  hasOutputNode: boolean;
  isPartialGraph: boolean;
}

type LocalSuggestionPosition =
  | "front"
  | "behind"
  | "outsideFront"
  | "outsideBehind"
  | "parallel"
  | "replace";

type LocalSuggestionSerialOrParallel = "serial" | "parallel" | "replace";

interface OutputCoilPlan {
  startNodes?: string[];
  endNodes?: string[];
  preserveStartNodes?: boolean;
  position?: LocalSuggestionPosition;
  serialOrParallel?: LocalSuggestionSerialOrParallel;
  text: (nodeText: string) => string;
  partialText: (nodeText: string) => string;
}

interface SuggestedVarName {
  name: string;
  value: string;
  type: string;
  scope: string;
}

interface SuggestedPort {
  name: string;
  value: string;
  type: string;
  scope: string;
}

interface SuggestedGraphNode {
  id: string;
  type: string;
  sourceIds?: string[];
  targetIds?: string[];
  varName?: SuggestedVarName;
  childrenNode?: {
    type: string;
    isFunction: boolean;
    varName: SuggestedVarName;
    portInputs: SuggestedPort[];
    portOutputs: SuggestedPort[];
  };
}

interface LocalSuggestion {
  id: string;
  title: string;
  startNodes: string[];
  endNodes: string[];
  position: LocalSuggestionPosition;
  serialOrParallel: LocalSuggestionSerialOrParallel;
  text: string;
  addNode: Record<string, SuggestedGraphNode>;
}

interface LocalSuggestionDraft {
  id: string;
  mode: string;
  confidence: number;
  placement: {
    relationToFocus: string;
    anchorNodeId: string;
    anchorNodeVar: string;
    insertAfterNodeId: string;
    insertBeforeNodeId: string;
    parallelToNodeId: string;
    branchFromNodeId: string;
    branchToNodeId: string;
    portName: string;
    text: string;
  };
  startNodes?: string[];
  endNodes?: string[];
  preserveStartNodes?: boolean;
  preserveEndNodes?: boolean;
  position?: LocalSuggestionPosition;
  serialOrParallel?: LocalSuggestionSerialOrParallel;
  addElement: LocalSuggestionAddElement;
}

interface LocalSuggestionAddElement {
  nodeType: string;
  displayLabel: string;
  variableSource: string;
  variableName: string;
  dataType: string;
  userInputRequired: boolean;
  blockType: string;
  instanceSource: string;
  instanceName: string;
}

const COMMON_FUNCTION_BLOCK_TYPES = [
  "TON",
  "TOF",
  "TP",
  "CTU",
  "CTD",
  "SR",
  "RS",
];

export class LocalGraphSuggestionService {
  constructor(private readonly outputChannel: vscode.OutputChannel) {}

  async suggestFromDiagram(
    request: LocalGraphSuggestionRequest | undefined,
  ): Promise<LocalGraphSuggestionResult | undefined> {
    const diagramPath = request?.diagramPath?.trim();
    if (!diagramPath) {
      this.log("local graph command cancelled: missing diagramPath");
      return undefined;
    }
    const focusOptions: LocalGraphSuggestionOptions = {
      segmentId: request?.segmentId,
      selectedNodeId: request?.selectedNodeId,
      selectedInsertionPointId: request?.selectedInsertionPointId,
    };

    this.log(
      `local graph command requested path=${diagramPath} focus=${formatFocusOptions(focusOptions)}`,
    );

    try {
      const result = await getCoreLocalGraphSuggestions(request);
      if (!result) {
        this.log(
          `local graph command cancelled: focus not found ${formatFocusOptions(focusOptions)}`,
        );
        return undefined;
      }

      this.log(
        `local graph result path=${result.diagramPath} source=${String(result.payload.recognizedFocus.source ?? "")} nodeId=${result.payload.anchorNodeId} insertionPoint=${request?.selectedInsertionPointId ?? ""} suggestions=${result.payload.suggestions.length}`,
      );

      return result;
    } catch (error) {
      this.log(
        `local graph command failed: cannot load diagram json: ${formatUnknownError(error)}`,
      );
      return undefined;
    }
  }

  async suggestFromActiveEditor(
    options: LocalGraphSuggestionOptions = {},
  ): Promise<LocalGraphSuggestionResult | undefined> {
    const editor = vscode.window.activeTextEditor;
    const activeFile =
      editor?.document.fileName || editor?.document.uri.toString() || "(none)";
    const diagramPath = DEFAULT_DIAGRAM_JSON_PATH;

    this.log(
      `local graph suggestions requested activeFile=${activeFile} focus=${formatFocusOptions(options)}`,
    );
    this.log(`loading diagram json path=${diagramPath}`);

    let summary: DiagramSummary;
    try {
      summary = await loadDiagramSummary(diagramPath);
    } catch (error) {
      this.log(
        `local graph suggestions failed: cannot load diagram json: ${formatUnknownError(error)}`,
      );
      void vscode.window.showErrorMessage(
        `Ide Agent: failed to read diagram JSON. ${formatErrorMessage(error)}`,
      );
      return undefined;
    }

    const focus = await resolveFocus(summary, options);
    if (!focus) {
      this.log("local graph suggestions cancelled: no focus selected");
      return undefined;
    }

    const result = this.createResult(diagramPath, summary, focus);

    this.log(
      `local graph focus source=${focus.source} nodeId=${getFocusId(focus)} type=${getFocusType(focus)} var=${getFocusVar(focus) || "(none)"}`,
    );
    const graphState = analyzeSegment(focus.segment);
    this.log(
      `local graph state partial=${graphState.isPartialGraph} hasLogic=${graphState.hasLogicNode} hasOutput=${graphState.hasOutputNode}`,
    );
    this.log(`local graph suggestions count=${result.payload.suggestions.length}`);
    for (const [index, suggestion] of result.payload.suggestions.entries()) {
      this.log(
        `local graph suggestion #${index + 1} title=${suggestion.title} position=${suggestion.position} serialOrParallel=${suggestion.serialOrParallel} start=${suggestion.startNodes.join(",")} end=${suggestion.endNodes.join(",")} add=${suggestedNodeLabel(suggestion)}`,
      );
    }
    const payloadText = JSON.stringify(result.payload, null, 2);
    this.log(`local graph suggestions JSON=${payloadText}`);
    void vscode.env.clipboard.writeText(payloadText);
    void vscode.window.showInformationMessage(
      "Ide Agent: local graph suggestions copied to clipboard.",
    );

    return result;
  }

  private log(message: string): void {
    const line = `[${new Date().toISOString()}] ${message}`;
    this.outputChannel.appendLine(line);
    console.log(`[IdeAgent:LocalGraphSuggestion] ${message}`);
  }

  private createResult(
    diagramPath: string,
    summary: DiagramSummary,
    focus: FocusContext,
  ): LocalGraphSuggestionResult {
    const payload = buildLocalPayload(summary, focus);

    this.log(
      `local graph result path=${diagramPath} source=${focus.source} nodeId=${getFocusId(focus)} insertionPoint=${focus.insertionPoint?.id ?? ""} suggestions=${payload.suggestions.length}`,
    );

    return {
      diagramPath,
      payload,
    };
  }
}

function suggestionTitle(
  suggestion: LocalSuggestion,
  add: string,
): string {
  if (suggestion.serialOrParallel === "parallel") {
    return `并联 ${add}`;
  }

  if (suggestion.position === "replace") {
    return `替换为 ${add}`;
  }

  if (suggestion.position === "front") {
    return `前串联 ${add}`;
  }

  if (suggestion.position === "outsideFront") {
    return `外侧前串联 ${add}`;
  }

  if (suggestion.position === "outsideBehind") {
    return `外侧后串联 ${add}`;
  }

  if (add.includes("线圈")) {
    return `添加 ${add}`;
  }

  if (add.includes("功能块")) {
    return `后插入 ${add}`;
  }

  return `后串联 ${add}`;
}

function suggestedNodeLabel(suggestion: LocalSuggestion): string {
  const node = getSuggestedNode(suggestion);
  if (!node) {
    return "";
  }

  if (node.type === "FBDCompartment") {
    return `${node.childrenNode?.type || "FB"} 功能块`;
  }

  switch (node.type) {
    case "contact":
      return "常开触点";
    case "negatedContact":
      return "常闭触点";
    case "risingContact":
      return "上升沿";
    case "fallingContact":
      return "下降沿";
    case "coil":
      return "线圈";
    case "setCoil":
      return "置位线圈";
    case "resetCoil":
      return "复位线圈";
    default:
      return node.type;
  }
}

function getSuggestedNode(
  suggestion: LocalSuggestion,
): SuggestedGraphNode | undefined {
  for (const value of Object.values(suggestion.addNode)) {
    if (isSuggestedGraphNode(value)) {
      return value;
    }
  }

  return undefined;
}

function isSuggestedGraphNode(value: unknown): value is SuggestedGraphNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "type" in value
  );
}

function buildLocalPayload(
  summary: DiagramSummary,
  focus: FocusContext,
): LocalGraphSuggestionPayload {
  const suggestions = buildSuggestions(focus);

  return {
    schemaVersion: "ide-agent.graph-completion.v1",
    action: suggestions.length ? "suggestGraphCompletions" : "noSuggestion",
    source: "local-rules",
    segmentId: focus.segment.segmentId,
    anchorNodeId: getFocusId(focus),
    anchorNodeVar: getFocusVar(focus),
    confidence: suggestions.length ? 1 : 0,
    recognizedFocus: {
      visualElement: getFocusVisualElement(focus),
      matchedNodeId: getFocusId(focus),
      matchedNodeType: getFocusType(focus),
      matchedVar: getFocusVar(focus),
      confidence: 1,
      source: focus.source,
      pouName: focus.segment.pouName || summary.pouName,
    },
    suggestions,
  };
}

function buildSuggestions(focus: FocusContext): LocalSuggestion[] {
  const suggestions: LocalSuggestionDraft[] = [];
  const graphState = analyzeSegment(focus.segment);

  if (focus.insertionPoint) {
    addInsertionPointSuggestions(suggestions, focus, graphState);
  } else if (focus.node && isContactKind(focus.node.kind)) {
    addContactSuggestions(suggestions, focus, graphState);
  } else if (focus.node?.kind === "FBDCompartment") {
    addFunctionBlockSuggestions(suggestions, focus, graphState);
  } else if (focus.node && isCoilKind(focus.node.kind)) {
    addCoilSuggestions(suggestions, focus);
  }

  return keepOutputCoilWithinLimit(dedupeSuggestions(suggestions), 6)
    .map((suggestion, index) =>
      toLocalSuggestion(suggestion, index, focus.segment),
    );
}

function addContactSuggestions(
  suggestions: LocalSuggestionDraft[],
  focus: FocusContext,
  graphState: SegmentGraphState,
): void {
  const node = focus.node;
  if (!node) {
    return;
  }

  const leftNodes = neighborNodes(focus.segment, node.from, "backward");
  const rightNodes = neighborNodes(focus.segment, node.to, "forward");
  const nodeText = nodePlacementLabelWithSegment(focus.segment, node);
  const leftRailInsertionPoint =
    findLeftRailInsertionPointBeforeNode(focus.segment, node);

  if (leftRailInsertionPoint) {
    addFrontSerialSuggestions(suggestions, focus, nodeText, {
      text: (targetText) => `在${targetText}前串联一个常开触点`,
      outsideText: (targetText) =>
        `在${targetText}所在分支组前串联一个常开触点`,
      addElement: contactElement(),
      leftRailInsertionPoint,
    });
  } else if (leftNodes.length) {
    for (const leftNode of leftNodes) {
      const leftText = nodePlacementLabelWithSegment(focus.segment, leftNode);
      suggestions.push(
        makeSuggestion(focus, {
          mode: "seriesBefore",
          relationToFocus: "beforeSelected",
          insertAfterNodeId: leftNode.id,
          insertBeforeNodeId: node.id,
          text: `在${leftText}和${nodeText}之间串联一个常开触点`,
          addElement: contactElement(),
        }),
      );
    }
  } else {
    suggestions.push(
      makeSuggestion(focus, {
        mode: "seriesBefore",
        relationToFocus: "beforeSelected",
        insertAfterNodeId: first(node.from),
        insertBeforeNodeId: node.id,
        text: `在${nodeText}前串联一个常开触点`,
        addElement: contactElement(),
      }),
    );
  }

  if (rightNodes.length) {
    for (const rightNode of rightNodes) {
      const rightText = nodePlacementLabelWithSegment(focus.segment, rightNode);
      const outsideBehindStartNodes = findOutsideBehindStartNodes(
        focus.segment,
        node,
        rightNode,
      );
      suggestions.push(
        makeSuggestion(focus, {
          mode: "seriesAfter",
          relationToFocus: "afterSelected",
          insertAfterNodeId: node.id,
          insertBeforeNodeId: rightNode.id,
          text: `在${nodeText}和${rightText}之间串联一个常开触点`,
          addElement: contactElement(),
        }),
        makeSuggestion(focus, {
          mode: "functionBlockAfter",
          relationToFocus: "afterSelected",
          insertAfterNodeId: node.id,
          insertBeforeNodeId: rightNode.id,
          text: `在${nodeText}和${rightText}之间插入一个功能块`,
          addElement: functionBlockElement(),
        }),
      );

      if (outsideBehindStartNodes.length > 1) {
        suggestions.push(
          makeSuggestion(focus, {
            mode: "seriesAfter",
            relationToFocus: "afterSelected",
            insertAfterNodeId: node.id,
            insertBeforeNodeId: rightNode.id,
            startNodes: outsideBehindStartNodes,
            endNodes: [rightNode.id],
            position: "outsideBehind",
            serialOrParallel: "serial",
            text: `在${nodeText}所在并联结构外侧和${rightText}之间串联一个常开触点`,
            addElement: contactElement(),
          }),
        );
      }
    }
  } else {
    suggestions.push(
      makeSuggestion(focus, {
        mode: "seriesAfter",
        relationToFocus: "afterSelected",
        insertAfterNodeId: node.id,
        insertBeforeNodeId: first(node.to),
        text: `在${nodeText}后串联一个常开触点`,
        addElement: contactElement(),
      }),
      makeSuggestion(focus, {
        mode: "functionBlockAfter",
        relationToFocus: "afterSelected",
        insertAfterNodeId: node.id,
        insertBeforeNodeId: first(node.to),
        text: `在${nodeText}后串联一个功能块`,
        addElement: functionBlockElement(),
      }),
    );
  }

  const parallelStartPlan = getParallelStartNodePlan(focus.segment, node);
  const parallelEndPlan = getParallelEndNodePlan(focus.segment, node);

  suggestions.push(
    makeSuggestion(focus, {
      mode: "parallelBranch",
      relationToFocus: "parallelWithSelected",
      parallelToNodeId: node.id,
      branchFromNodeId: first(node.from),
      branchToNodeId: first(node.to),
      startNodes: parallelStartPlan.startNodes,
      endNodes: parallelEndPlan.endNodes,
      preserveStartNodes: parallelStartPlan.preserveStartNodes,
      preserveEndNodes: parallelEndPlan.preserveEndNodes,
      text: `与${nodeText}并联一个常开触点`,
      addElement: contactElement(),
    }),
    makeSuggestion(focus, {
      mode: "parallelBranch",
      relationToFocus: "parallelWithSelected",
      parallelToNodeId: node.id,
      branchFromNodeId: first(node.from),
      branchToNodeId: first(node.to),
      startNodes: parallelStartPlan.startNodes,
      endNodes: parallelEndPlan.endNodes,
      preserveStartNodes: parallelStartPlan.preserveStartNodes,
      preserveEndNodes: parallelEndPlan.preserveEndNodes,
      text: `与${nodeText}并联一个功能块`,
      addElement: functionBlockElement(),
    }),
  );

  if (canAddOutputAfterNode(focus.segment, node)) {
    const outputPlan = createOutputCoilPlan(focus.segment, node);
    suggestions.push(
      makeSuggestion(focus, {
        mode: "outputCoil",
        relationToFocus: "afterSelected",
        insertAfterNodeId: node.id,
        insertBeforeNodeId: first(node.to),
        startNodes: outputPlan.startNodes,
        endNodes: outputPlan.endNodes,
        preserveStartNodes: outputPlan.preserveStartNodes,
        position: outputPlan.position,
        serialOrParallel: outputPlan.serialOrParallel,
        text: graphState.isPartialGraph
          ? outputPlan.partialText(nodeText)
          : outputPlan.text(nodeText),
        addElement: coilElement(),
      }),
    );
  }
}

function addFunctionBlockSuggestions(
  suggestions: LocalSuggestionDraft[],
  focus: FocusContext,
  graphState: SegmentGraphState,
): void {
  const node = focus.node;
  if (!node) {
    return;
  }

  const firstOutputPort = Object.keys(node.outputs ?? {})[0] ?? "";
  const leftNodes = neighborNodes(focus.segment, node.from, "backward");
  const rightNodes = neighborNodes(focus.segment, node.to, "forward");
  const nodeText = nodePlacementLabelWithSegment(focus.segment, node);
  const leftRailInsertionPoint =
    findLeftRailInsertionPointBeforeNode(focus.segment, node);

  if (leftRailInsertionPoint) {
    addFrontSerialSuggestions(suggestions, focus, nodeText, {
      text: (targetText) => `在${targetText}前串联一个常开触点`,
      outsideText: (targetText) =>
        `在${targetText}所在分支组前串联一个常开触点`,
      addElement: contactElement(),
      leftRailInsertionPoint,
    });
  } else if (leftNodes.length) {
    for (const leftNode of leftNodes) {
      const leftText = nodePlacementLabelWithSegment(focus.segment, leftNode);
      suggestions.push(
        makeSuggestion(focus, {
          mode: "seriesBefore",
          relationToFocus: "beforeSelected",
          insertAfterNodeId: leftNode.id,
          insertBeforeNodeId: node.id,
          text: `在${leftText}和${nodeText}之间串联一个常开触点`,
          addElement: contactElement(),
        }),
      );
    }
  } else {
    suggestions.push(
      makeSuggestion(focus, {
        mode: "seriesBefore",
        relationToFocus: "beforeSelected",
        insertAfterNodeId: first(node.from),
        insertBeforeNodeId: node.id,
        text: `在${nodeText}前串联一个常开触点`,
        addElement: contactElement(),
      }),
    );
  }

  if (canAddOutputAfterNode(focus.segment, node)) {
    const outputPlan = createOutputCoilPlan(focus.segment, node);
    suggestions.push(
      makeSuggestion(focus, {
        mode: "outputCoil",
        relationToFocus: "afterSelected",
        insertAfterNodeId: node.id,
        insertBeforeNodeId: first(node.to),
        portName: firstOutputPort,
        startNodes: outputPlan.startNodes,
        endNodes: outputPlan.endNodes,
        preserveStartNodes: outputPlan.preserveStartNodes,
        position: outputPlan.position,
        serialOrParallel: outputPlan.serialOrParallel,
        text: graphState.isPartialGraph
          ? outputPlan.partialText(nodeText)
          : outputPlan.text(nodeText),
        addElement: coilElement(),
      }),
    );
  }

  if (rightNodes.length) {
    for (const rightNode of rightNodes) {
      const rightText = nodePlacementLabelWithSegment(focus.segment, rightNode);
      suggestions.push(
        makeSuggestion(focus, {
          mode: "seriesAfter",
          relationToFocus: "afterSelected",
          insertAfterNodeId: node.id,
          insertBeforeNodeId: rightNode.id,
          portName: firstOutputPort,
          text: `在${nodeText}和${rightText}之间串联一个常开触点`,
          addElement: contactElement(),
        }),
      );
    }
  } else {
    suggestions.push(
      makeSuggestion(focus, {
        mode: "seriesAfter",
        relationToFocus: "afterSelected",
        insertAfterNodeId: node.id,
        insertBeforeNodeId: first(node.to),
        portName: firstOutputPort,
        text: `在${nodeText}输出端后添加一个常开触点`,
        addElement: contactElement(),
      }),
    );
  }
}

function addCoilSuggestions(
  suggestions: LocalSuggestionDraft[],
  focus: FocusContext,
): void {
  const node = focus.node;
  if (!node) {
    return;
  }

  const nodeText = nodePlacementLabelWithSegment(focus.segment, node);
  const leftRailInsertionPoint =
    findLeftRailInsertionPointBeforeNode(focus.segment, node);

  addFrontSerialSuggestions(suggestions, focus, nodeText, {
    text: (targetText) => `在${targetText}前串联一个常开触点`,
    outsideText: (targetText) =>
      `在${targetText}所在分支组前串联一个常开触点`,
    addElement: contactElement(),
    leftRailInsertionPoint,
  });

  const parallelStartPlan = getParallelStartNodePlan(focus.segment, node);
  const parallelEndPlan = getParallelEndNodePlan(focus.segment, node);

  suggestions.push(
    makeSuggestion(focus, {
      mode: "parallelBranch",
      relationToFocus: "parallelWithSelected",
      parallelToNodeId: node.id,
      branchFromNodeId: first(node.from),
      branchToNodeId: first(node.to),
      startNodes: parallelStartPlan.startNodes,
      endNodes: parallelEndPlan.endNodes,
      preserveStartNodes: parallelStartPlan.preserveStartNodes,
      preserveEndNodes: parallelEndPlan.preserveEndNodes,
      text: `与${nodeText}并联一个线圈`,
      addElement: coilElement(),
    }),
  );

  addFrontSerialSuggestions(suggestions, focus, nodeText, {
    text: (targetText) => `在${targetText}前插入一个功能块`,
    outsideText: (targetText) => `在${targetText}所在分支组前插入一个功能块`,
    addElement: functionBlockElement(),
    leftRailInsertionPoint,
  });

  addCoilReplaceSuggestions(suggestions, focus, nodeText);
}

function addFrontSerialSuggestions(
  suggestions: LocalSuggestionDraft[],
  focus: FocusContext,
  nodeText: string,
  input: {
    text: (targetText: string) => string;
    outsideText: (targetText: string) => string;
    addElement: LocalSuggestionAddElement;
    leftRailInsertionPoint:
      | { insertionPointId: string; sourceIds: string[] }
      | undefined;
  },
): void {
  const node = focus.node;
  if (!node) {
    return;
  }

  if (input.leftRailInsertionPoint) {
    suggestions.push(
      makeSuggestion(focus, {
        mode: "seriesBefore",
        relationToFocus: "atInsertionPoint",
        insertAfterNodeId: input.leftRailInsertionPoint.insertionPointId,
        insertBeforeNodeId: node.id,
        startNodes: [input.leftRailInsertionPoint.insertionPointId],
        endNodes: [node.id],
        preserveStartNodes: true,
        position: "front",
        serialOrParallel: "serial",
        text: input.text(nodeText),
        addElement: input.addElement,
      }),
      makeSuggestion(focus, {
        mode: "seriesBefore",
        relationToFocus: "atInsertionPoint",
        insertAfterNodeId: first(input.leftRailInsertionPoint.sourceIds),
        insertBeforeNodeId: input.leftRailInsertionPoint.insertionPointId,
        startNodes: input.leftRailInsertionPoint.sourceIds,
        endNodes: [input.leftRailInsertionPoint.insertionPointId],
        preserveStartNodes: true,
        position: "outsideFront",
        serialOrParallel: "serial",
        text: input.outsideText(nodeText),
        addElement: input.addElement,
      }),
    );
    return;
  }

  suggestions.push(
    makeSuggestion(focus, {
      mode: "seriesBefore",
      relationToFocus: "beforeSelected",
      insertAfterNodeId: first(node.from),
      insertBeforeNodeId: node.id,
      text: input.text(nodeText),
      addElement: input.addElement,
    }),
  );
}

function addInsertionPointSuggestions(
  suggestions: LocalSuggestionDraft[],
  focus: FocusContext,
  graphState: SegmentGraphState,
): void {
  const insertionPoint = focus.insertionPoint;
  if (!insertionPoint) {
    return;
  }

  const target = firstRealNode(focus.segment, insertionPoint.to);
  const source = firstRealNode(focus.segment, insertionPoint.from);
  const targetText =
    neighborListText(focus.segment, insertionPoint.to, "forward") || "末尾";
  const sourceText =
    neighborListText(focus.segment, insertionPoint.from, "backward") ||
    "前置节点";

  if (target && isCoilKind(target.kind)) {
    suggestions.push(
      makeSuggestion(focus, {
        mode: "seriesBefore",
        relationToFocus: "atInsertionPoint",
        insertAfterNodeId: first(insertionPoint.from),
        insertBeforeNodeId: target.id,
        startNodes: insertionPoint.from,
        endNodes: [target.id],
        text: `在${sourceText}和${targetText}之间串联一个常开触点`,
        addElement: contactElement(),
      }),
      makeSuggestion(focus, {
        mode: "functionBlockBefore",
        relationToFocus: "atInsertionPoint",
        insertAfterNodeId: first(insertionPoint.from),
        insertBeforeNodeId: target.id,
        startNodes: insertionPoint.from,
        endNodes: [target.id],
        text: `在${sourceText}和${targetText}之间插入一个功能块`,
        addElement: functionBlockElement(),
      }),
    );
    return;
  }

  if (target?.kind === "FBDCompartment") {
    suggestions.push(
      makeSuggestion(focus, {
        mode: "seriesBefore",
        relationToFocus: "atInsertionPoint",
        insertAfterNodeId: first(insertionPoint.from),
        insertBeforeNodeId: target.id,
        startNodes: insertionPoint.from,
        endNodes: [target.id],
        text: `在${targetText}的 EN 前串联一个常开触点`,
        addElement: contactElement(),
      }),
    );
    return;
  }

  if (!target) {
    if (graphState.isPartialGraph) {
      suggestions.push(
        makeSuggestion(focus, {
          mode: "outputCoil",
          relationToFocus: "atInsertionPoint",
          insertAfterNodeId: first(insertionPoint.from),
          startNodes: insertionPoint.from,
          endNodes: insertionPoint.to,
          text: `当前回路还没有输出节点，在${sourceText}后添加一个输出线圈`,
          addElement: coilElement(),
        }),
        makeSuggestion(focus, {
          mode: "outputFunctionBlock",
          relationToFocus: "atInsertionPoint",
          insertAfterNodeId: first(insertionPoint.from),
          startNodes: insertionPoint.from,
          endNodes: insertionPoint.to,
          text: `当前回路还没有输出节点，在${sourceText}后添加一个功能块作为输出节点`,
          addElement: functionBlockElement(),
        }),
        makeSuggestion(focus, {
          mode: "seriesAfter",
          relationToFocus: "atInsertionPoint",
          insertAfterNodeId: first(insertionPoint.from),
          startNodes: insertionPoint.from,
          endNodes: insertionPoint.to,
          text: `在${sourceText}后继续串联一个常开触点`,
          addElement: contactElement(),
        }),
      );
      return;
    }

    suggestions.push(
      makeSuggestion(focus, {
        mode: "outputCoil",
        relationToFocus: "atInsertionPoint",
        insertAfterNodeId: first(insertionPoint.from),
        startNodes: insertionPoint.from,
        endNodes: insertionPoint.to,
        text: `在${sourceText}后添加一个输出线圈`,
        addElement: coilElement(),
      }),
    );
    return;
  }

  suggestions.push(
    makeSuggestion(focus, {
      mode: "seriesAfter",
      relationToFocus: "atInsertionPoint",
      insertAfterNodeId: first(insertionPoint.from),
      insertBeforeNodeId: first(insertionPoint.to),
      startNodes: insertionPoint.from,
      endNodes: insertionPoint.to,
      text: `在${sourceText}和${targetText}之间串联一个常开触点`,
      addElement: contactElement(),
    }),
    makeSuggestion(focus, {
      mode: "functionBlockAfter",
      relationToFocus: "atInsertionPoint",
      insertAfterNodeId: first(insertionPoint.from),
      insertBeforeNodeId: first(insertionPoint.to),
      startNodes: insertionPoint.from,
      endNodes: insertionPoint.to,
      text: `在${sourceText}和${targetText}之间插入一个功能块`,
      addElement: functionBlockElement(),
    }),
  );
}

function makeSuggestion(
  focus: FocusContext,
  input: {
    mode: string;
    relationToFocus: string;
    insertAfterNodeId?: string;
    insertBeforeNodeId?: string;
    parallelToNodeId?: string;
    branchFromNodeId?: string;
    branchToNodeId?: string;
    portName?: string;
    startNodes?: string[];
    endNodes?: string[];
    preserveStartNodes?: boolean;
    preserveEndNodes?: boolean;
    position?: LocalSuggestionPosition;
    serialOrParallel?: LocalSuggestionSerialOrParallel;
    text: string;
    addElement: LocalSuggestionAddElement;
  },
): LocalSuggestionDraft {
  const addElement = input.addElement;
  const text =
    addElement.nodeType === "functionBlock"
      ? withFunctionBlockType(input.text, addElement.blockType)
      : input.text;

  return {
    id: "",
    mode: input.mode,
    confidence: 1,
    placement: {
      relationToFocus: input.relationToFocus,
      anchorNodeId: getFocusId(focus),
      anchorNodeVar: getFocusVar(focus),
      insertAfterNodeId: input.insertAfterNodeId ?? "",
      insertBeforeNodeId: input.insertBeforeNodeId ?? "",
      parallelToNodeId: input.parallelToNodeId ?? "",
      branchFromNodeId: input.branchFromNodeId ?? "",
      branchToNodeId: input.branchToNodeId ?? "",
      portName: input.portName ?? "",
      text,
    },
    startNodes: input.startNodes,
    endNodes: input.endNodes,
    preserveStartNodes: input.preserveStartNodes,
    preserveEndNodes: input.preserveEndNodes,
    position: input.position,
    serialOrParallel: input.serialOrParallel,
    addElement,
  };
}

function toLocalSuggestion(
  draft: LocalSuggestionDraft,
  index: number,
  segment: DiagramSegmentSummary,
): LocalSuggestion {
  const id = `local-${index + 1}`;
  const newNodeId = createSuggestedNodeId(draft.addElement, id);
  const newNode = createSuggestedNode(newNodeId, draft.addElement);
  const rawStartNodes = draft.startNodes ?? inferStartNodes(draft);
  const rawEndNodes = draft.endNodes ?? inferEndNodes(draft);
  const startNodes = draft.preserveStartNodes
    ? normalizeNodeIds(rawStartNodes)
    : resolveBoundaryNodeIds(segment, rawStartNodes, "backward");
  const endNodes = draft.preserveEndNodes
    ? normalizeNodeIds(rawEndNodes)
    : resolveSuggestionEndNodeIds(segment, draft, rawEndNodes);
  const position = draft.position ?? inferPosition(draft);
  const serialOrParallel =
    draft.serialOrParallel ?? inferSerialOrParallel(draft);
  const nodeLinks = createSuggestedNodeLinks(
    segment,
    draft.addElement.nodeType,
    startNodes,
    endNodes,
  );
  newNode.sourceIds = nodeLinks.sourceIds;
  newNode.targetIds = nodeLinks.targetIds;
  const addNode = {
    [newNodeId]: newNode,
  };

  const suggestion: LocalSuggestion = {
    id,
    title: "",
    startNodes,
    endNodes,
    position,
    serialOrParallel,
    text: draft.placement.text,
    addNode,
  };

  return {
    ...suggestion,
    title: suggestionTitle(suggestion, suggestedNodeLabel(suggestion)),
  };
}

function inferStartNodes(draft: LocalSuggestionDraft): string[] {
  if (draft.placement.relationToFocus === "parallelWithSelected") {
    return [draft.placement.branchFromNodeId];
  }

  if (draft.placement.relationToFocus === "replaceSelected") {
    return [draft.placement.anchorNodeId];
  }

  return [draft.placement.insertAfterNodeId];
}

function inferEndNodes(draft: LocalSuggestionDraft): string[] {
  if (draft.placement.relationToFocus === "parallelWithSelected") {
    return [draft.placement.branchToNodeId];
  }

  if (draft.placement.relationToFocus === "replaceSelected") {
    return [];
  }

  return [draft.placement.insertBeforeNodeId];
}

function resolveBoundaryNodeIds(
  segment: DiagramSegmentSummary,
  nodeIds: string[] | undefined,
  direction: "forward" | "backward",
): string[] {
  const resolved: string[] = [];

  for (const nodeId of nodeIds ?? []) {
    const trimmed = nodeId.trim();
    if (!trimmed) {
      continue;
    }

    const node = findNode(segment, trimmed);
    if (!node) {
      resolved.push(trimmed);
      continue;
    }

    if (isRealGraphElementKind(node.kind) || isBoundaryLineKind(node.kind)) {
      resolved.push(node.id);
      continue;
    }

    const realNodes = collectNearestDisplayNodes(segment, [node.id], direction);
    resolved.push(...realNodes.map((item) => item.id));
  }

  return normalizeNodeIds(resolved);
}

function resolveSuggestionEndNodeIds(
  segment: DiagramSegmentSummary,
  draft: LocalSuggestionDraft,
  nodeIds: string[] | undefined,
): string[] {
  const anchorNode = findNode(segment, draft.placement.anchorNodeId);
  const directInsertionTargets = new Set(
    anchorNode ? directInsertionPointTargetIds(segment, anchorNode) : [],
  );
  const directInsertionSources = new Set(
    anchorNode ? directInsertionPointSourceIds(segment, anchorNode) : [],
  );
  const resolved: string[] = [];

  for (const nodeId of nodeIds ?? []) {
    const trimmed = nodeId.trim();
    if (!trimmed) {
      continue;
    }

    if (directInsertionTargets.has(trimmed) || directInsertionSources.has(trimmed)) {
      resolved.push(trimmed);
      continue;
    }

    if (
      anchorNode &&
      draft.placement.relationToFocus === "beforeSelected" &&
      trimmed === anchorNode.id &&
      directInsertionSources.size > 0
    ) {
      resolved.push(...directInsertionSources);
      continue;
    }

    if (anchorNode) {
      const rightNode = findNode(segment, trimmed);
      if (rightNode && isRealGraphElementKind(rightNode.kind)) {
        const insertionTargets = directInsertionPointTargetsBeforeNode(
          segment,
          anchorNode,
          rightNode,
        );
        if (insertionTargets.length) {
          resolved.push(...insertionTargets);
          continue;
        }
      }
    }

    resolved.push(...resolveBoundaryNodeIds(segment, [trimmed], "forward"));
  }

  return normalizeNodeIds(resolved);
}

function inferPosition(draft: LocalSuggestionDraft): LocalSuggestionPosition {
  if (draft.placement.relationToFocus === "parallelWithSelected") {
    return "parallel";
  }

  if (draft.placement.relationToFocus === "replaceSelected") {
    return "replace";
  }

  if (
    draft.placement.relationToFocus === "beforeSelected" ||
    draft.mode === "functionBlockBefore"
  ) {
    return "front";
  }

  return "behind";
}

function inferSerialOrParallel(
  draft: LocalSuggestionDraft,
): LocalSuggestionSerialOrParallel {
  if (draft.placement.relationToFocus === "parallelWithSelected") {
    return "parallel";
  }

  if (draft.placement.relationToFocus === "replaceSelected") {
    return "replace";
  }

  return "serial";
}

function createSuggestedNodeId(
  addElement: LocalSuggestionAddElement,
  suggestionId: string,
): string {
  if (addElement.nodeType === "functionBlock") {
    return `FBD-compartment-${addElement.blockType || "FB"}-${suggestionId}`;
  }

  return `${addElement.nodeType}-${suggestionId}`;
}

function createSuggestedNode(
  nodeId: string,
  addElement: LocalSuggestionAddElement,
): SuggestedGraphNode {
  if (addElement.nodeType === "functionBlock") {
    const blockType = addElement.blockType || "TON";
    return {
      id: nodeId,
      type: "FBDCompartment",
      childrenNode: {
        type: blockType,
        isFunction: false,
        varName: {
          name: "",
          value:
            addElement.instanceName || addElement.variableName || "???",
          type: blockType,
          scope: "VAR",
        },
        portInputs: functionBlockInputPorts(blockType),
        portOutputs: functionBlockOutputPorts(blockType),
      },
    };
  }

  return {
    id: nodeId,
    type: addElement.nodeType,
    varName: {
      name: "",
      value: addElement.variableName || "???",
      type: addElement.dataType || "BOOL",
      scope: "VAR",
    },
  };
}

function createSuggestedNodeLinks(
  segment: DiagramSegmentSummary,
  nodeType: string,
  startNodes: string[],
  endNodes: string[],
): { sourceIds: string[]; targetIds: string[] } {
  if (isCoilKind(nodeType) && endNodes.some((nodeId) => isInsertionPointId(segment, nodeId))) {
    return {
      sourceIds: endNodes,
      targetIds: [],
    };
  }

  return {
    sourceIds: startNodes,
    targetIds: endNodes,
  };
}

function functionBlockInputPorts(blockType: string): SuggestedPort[] {
  const portsByType: Record<string, Array<[string, string, string]>> = {
    SR: [
      ["EN", "", ""],
      ["S1", "BOOL", "VAR_INPUT"],
      ["R", "BOOL", "VAR_INPUT"],
    ],
    RS: [
      ["EN", "", ""],
      ["S", "BOOL", "VAR_INPUT"],
      ["R1", "BOOL", "VAR_INPUT"],
    ],
    CTU: [
      ["EN", "", ""],
      ["CU", "BOOL", "VAR_INPUT"],
      ["R", "BOOL", "VAR_INPUT"],
      ["PV", "INT", "VAR_INPUT"],
    ],
    CTD: [
      ["EN", "", ""],
      ["CD", "BOOL", "VAR_INPUT"],
      ["LD", "BOOL", "VAR_INPUT"],
      ["PV", "INT", "VAR_INPUT"],
    ],
    CTUD: [
      ["EN", "", ""],
      ["CU", "BOOL", "VAR_INPUT"],
      ["CD", "BOOL", "VAR_INPUT"],
      ["R", "BOOL", "VAR_INPUT"],
      ["LD", "BOOL", "VAR_INPUT"],
      ["PV", "INT", "VAR_INPUT"],
    ],
    TON: [
      ["EN", "", ""],
      ["IN", "BOOL", "VAR_INPUT"],
      ["PT", "TIME", "VAR_INPUT"],
    ],
    TOF: [
      ["EN", "", ""],
      ["IN", "BOOL", "VAR_INPUT"],
      ["PT", "TIME", "VAR_INPUT"],
    ],
    TP: [
      ["EN", "", ""],
      ["IN", "BOOL", "VAR_INPUT"],
      ["PT", "TIME", "VAR_INPUT"],
    ],
  };

  return (portsByType[blockType] ?? portsByType.TON).map(toSuggestedPort);
}

function functionBlockOutputPorts(blockType: string): SuggestedPort[] {
  const portsByType: Record<string, Array<[string, string, string]>> = {
    SR: [
      ["ENO", "", ""],
      ["Q1", "BOOL", "VAR_OUTPUT"],
    ],
    RS: [
      ["ENO", "", ""],
      ["Q1", "BOOL", "VAR_OUTPUT"],
    ],
    CTU: [
      ["ENO", "", ""],
      ["Q", "BOOL", "VAR_OUTPUT"],
      ["CV", "INT", "VAR_OUTPUT"],
    ],
    CTD: [
      ["ENO", "", ""],
      ["Q", "BOOL", "VAR_OUTPUT"],
      ["CV", "INT", "VAR_OUTPUT"],
    ],
    CTUD: [
      ["ENO", "", ""],
      ["QU", "BOOL", "VAR_OUTPUT"],
      ["QD", "BOOL", "VAR_OUTPUT"],
      ["CV", "INT", "VAR_OUTPUT"],
    ],
    TON: [
      ["ENO", "", ""],
      ["Q", "BOOL", "VAR_OUTPUT"],
      ["ET", "TIME", "VAR_OUTPUT"],
    ],
    TOF: [
      ["ENO", "", ""],
      ["Q", "BOOL", "VAR_OUTPUT"],
      ["ET", "TIME", "VAR_OUTPUT"],
    ],
    TP: [
      ["ENO", "", ""],
      ["Q", "BOOL", "VAR_OUTPUT"],
      ["ET", "TIME", "VAR_OUTPUT"],
    ],
  };

  return (portsByType[blockType] ?? portsByType.TON).map(toSuggestedPort);
}

function toSuggestedPort([name, type, scope]: [
  string,
  string,
  string,
]): SuggestedPort {
  return {
    name,
    value: name === "EN" || name === "ENO" ? "" : "???",
    type,
    scope,
  };
}

function normalizeNodeIds(nodeIds: string[]): string[] {
  return [...new Set(nodeIds.map((item) => item.trim()).filter(Boolean))];
}

async function resolveFocus(
  summary: DiagramSummary,
  options: LocalGraphSuggestionOptions,
): Promise<FocusContext | undefined> {
  const fromProvided = findFocusByOptions(summary, options);
  if (fromProvided) {
    return { ...fromProvided, source: "provided" };
  }

  const manualQuery =
    options.focusQuery ??
    (await vscode.window.showInputBox({
      title: "Local LD/FBD Suggestions",
      prompt:
        "输入前端选中的 nodeId 或变量名。后续前端直接传 selectedNodeId 即可。",
      placeHolder: "例如 coil-57898079-1782202685942 / j",
      ignoreFocusOut: true,
    }));

  if (manualQuery === undefined) {
    return undefined;
  }

  const fromManualInput = findFocusByQuery(
    summary,
    manualQuery,
    options.segmentId,
  );
  if (fromManualInput) {
    return { ...fromManualInput, source: "manualInput" };
  }

  const fallback =
    findFirstInsertionPoint(summary, options.segmentId) ||
    findFirstRealNode(summary, options.segmentId);
  const picked = await pickFocus(summary, fallback, options.segmentId);
  if (picked) {
    return { ...picked, source: "quickPick" };
  }

  if (fallback) {
    const fallbackLabel = getFallbackFocusLabel(fallback);
    void vscode.window.showInformationMessage(
      `Ide Agent: no graph node was selected; using ${fallbackLabel} for local suggestions.`,
    );
    return { ...fallback, source: "fallback" };
  }

  return undefined;
}

function findFocusByOptions(
  summary: DiagramSummary,
  options: LocalGraphSuggestionOptions,
): Omit<FocusContext, "source"> | undefined {
  if (options.selectedNodeId) {
    const byNodeId = findNodeFocus(
      summary,
      options.selectedNodeId,
      options.segmentId,
    );
    if (byNodeId) {
      return byNodeId;
    }
  }

  if (options.selectedInsertionPointId) {
    const byInsertionId = findInsertionPointFocus(
      summary,
      options.selectedInsertionPointId,
      options.segmentId,
    );
    if (byInsertionId) {
      return byInsertionId;
    }
  }

  if (options.selectedVar) {
    return findFocusByToken(summary, options.selectedVar, options.segmentId);
  }

  if (options.focusQuery) {
    return findFocusByQuery(summary, options.focusQuery, options.segmentId);
  }

  return undefined;
}

function findFocusByQuery(
  summary: DiagramSummary,
  query: string,
  segmentId?: string,
): Omit<FocusContext, "source"> | undefined {
  const trimmed = query.trim();
  if (!trimmed) {
    return undefined;
  }

  return (
    findNodeFocus(summary, trimmed, segmentId) ||
    findInsertionPointFocus(summary, trimmed, segmentId) ||
    findFocusByToken(summary, trimmed, segmentId)
  );
}

function findFocusByToken(
  summary: DiagramSummary,
  token: string,
  segmentId?: string,
): Omit<FocusContext, "source"> | undefined {
  if (!token) {
    return undefined;
  }

  const normalized = token.toLowerCase();
  const matches = focusSegments(summary, segmentId).flatMap((segment) =>
    segment.nodes
      .filter((node) => isRealGraphElementKind(node.kind))
      .filter((node) =>
        [node.var, node.instance].some(
          (value) => value?.toLowerCase() === normalized,
        ),
      )
      .map((node) => ({ segment, node })),
  );

  return matches[0];
}

function findNodeFocus(
  summary: DiagramSummary,
  nodeId: string,
  segmentId?: string,
): Omit<FocusContext, "source"> | undefined {
  for (const segment of focusSegments(summary, segmentId)) {
    const node = findNode(segment, nodeId);
    if (node) {
      return { segment, node };
    }
  }

  return undefined;
}

function findInsertionPointFocus(
  summary: DiagramSummary,
  insertionPointId: string,
  segmentId?: string,
): Omit<FocusContext, "source"> | undefined {
  for (const segment of focusSegments(summary, segmentId)) {
    const insertionPoint = segment.insertionPoints.find(
      (item) => item.id === insertionPointId,
    );
    if (insertionPoint) {
      return { segment, insertionPoint };
    }
  }

  return undefined;
}

function focusSegments(
  summary: DiagramSummary,
  segmentId: string | undefined,
): DiagramSegmentSummary[] {
  const trimmed = segmentId?.trim();
  if (!trimmed) {
    return summary.segments;
  }

  return summary.segments.filter((segment) => segment.segmentId === trimmed);
}

function findFirstInsertionPoint(
  summary: DiagramSummary,
  segmentId?: string,
): Omit<FocusContext, "source"> | undefined {
  const segment = focusSegments(summary, segmentId).find(
    (item) => item.insertionPoints.length > 0,
  );
  const insertionPoint = segment?.insertionPoints[0];
  return segment && insertionPoint ? { segment, insertionPoint } : undefined;
}

function findFirstRealNode(
  summary: DiagramSummary,
  segmentId?: string,
): Omit<FocusContext, "source"> | undefined {
  for (const segment of focusSegments(summary, segmentId)) {
    const node = segment.nodes.find((item) =>
      isRealGraphElementKind(item.kind),
    );
    if (node) {
      return { segment, node };
    }
  }

  return undefined;
}

async function pickFocus(
  summary: DiagramSummary,
  fallback: Omit<FocusContext, "source"> | undefined,
  segmentId?: string,
): Promise<Omit<FocusContext, "source"> | undefined> {
  const items = focusSegments(summary, segmentId).flatMap((segment) =>
    segment.nodes
      .filter((node) => isRealGraphElementKind(node.kind))
      .map((node) => ({
        label: nodeLabel(node),
        description: node.id,
        focus: { segment, node },
      })),
  );

  if (!items.length) {
    return fallback;
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: "Select LD/FBD node for local suggestions",
    placeHolder: "Pick a graph node from transLd.txt.",
    matchOnDescription: true,
  });

  return picked?.focus;
}

function contactElement(): LocalSuggestionAddElement {
  return {
    nodeType: "contact",
    displayLabel: "常开触点",
    variableSource: "userInput",
    variableName: "",
    dataType: "BOOL",
    userInputRequired: true,
    blockType: "",
    instanceSource: "",
    instanceName: "",
  };
}

function coilElement(variableName = ""): LocalSuggestionAddElement {
  return {
    nodeType: "coil",
    displayLabel: "输出线圈",
    variableSource: variableName ? "existingVariable" : "userInput",
    variableName,
    dataType: "BOOL",
    userInputRequired: !variableName,
    blockType: "",
    instanceSource: "",
    instanceName: "",
  };
}

function setCoilElement(variableName = ""): LocalSuggestionAddElement {
  return {
    nodeType: "setCoil",
    displayLabel: "置位线圈",
    variableSource: variableName ? "existingVariable" : "userInput",
    variableName,
    dataType: "BOOL",
    userInputRequired: !variableName,
    blockType: "",
    instanceSource: "",
    instanceName: "",
  };
}

function resetCoilElement(variableName = ""): LocalSuggestionAddElement {
  return {
    nodeType: "resetCoil",
    displayLabel: "复位线圈",
    variableSource: variableName ? "existingVariable" : "userInput",
    variableName,
    dataType: "BOOL",
    userInputRequired: !variableName,
    blockType: "",
    instanceSource: "",
    instanceName: "",
  };
}

function functionBlockElement(): LocalSuggestionAddElement {
  const blockType = pickFunctionBlockType();
  return {
    nodeType: "functionBlock",
    displayLabel: `${blockType} 功能块`,
    variableSource: "userInput",
    variableName: "",
    dataType: blockType,
    userInputRequired: true,
    blockType,
    instanceSource: "userInput",
    instanceName: "",
  };
}

function pickFunctionBlockType(): string {
  const index = Math.floor(Math.random() * COMMON_FUNCTION_BLOCK_TYPES.length);
  return COMMON_FUNCTION_BLOCK_TYPES[index] ?? "TON";
}

function withFunctionBlockType(text: string, blockType: string): string {
  if (!text || !blockType) {
    return text;
  }

  return text.replace(/一个\s*功能块/g, `一个 ${blockType} 功能块`);
}

function findNode(
  segment: DiagramSegmentSummary,
  nodeId: string,
): DiagramNodeSummary | undefined {
  return segment.nodes.find((node) => node.id === nodeId);
}

function firstRealNode(
  segment: DiagramSegmentSummary,
  nodeIds: string[] | undefined,
): DiagramNodeSummary | undefined {
  return (nodeIds ?? [])
    .map((nodeId) => findNode(segment, nodeId))
    .find((node): node is DiagramNodeSummary =>
      Boolean(node && isRealGraphElementKind(node.kind)),
    );
}

function analyzeSegment(segment: DiagramSegmentSummary): SegmentGraphState {
  const hasLogicNode = segment.nodes.some((node) => isLogicNodeKind(node.kind));
  const hasOutputNode = segment.nodes.some((node) => isOutputNodeKind(node.kind));

  return {
    hasLogicNode,
    hasOutputNode,
    isPartialGraph: hasLogicNode && !hasOutputNode,
  };
}

function canAddOutputAfterNode(
  segment: DiagramSegmentSummary,
  node: DiagramNodeSummary,
): boolean {
  return (
    !hasDownstreamOutputNode(segment, node.id) &&
    !hasDownstreamLogicNode(segment, node.id)
  );
}

function createOutputCoilPlan(
  segment: DiagramSegmentSummary,
  node: DiagramNodeSummary,
): OutputCoilPlan {
  const directInsertionTargets = directInsertionPointTargetIds(segment, node);
  if (directInsertionTargets.length > 0) {
    const suffix = node.kind === "FBDCompartment" ? "输出端后" : "后";
    return {
      startNodes: directInsertionTargets,
      endNodes: [],
      preserveStartNodes: true,
      position: "behind",
      serialOrParallel: "serial",
      text: (nodeText) => `在${nodeText}${suffix}添加一个线圈`,
      partialText: (nodeText) =>
        `当前回路还没有输出节点，在${nodeText}${suffix}添加一个线圈`,
    };
  }

  const outsideStartNodes = findParallelOutputStartNodeIds(segment, node);
  if (outsideStartNodes.length > 1) {
    return {
      startNodes: outsideStartNodes,
      endNodes: [],
      position: "outsideBehind",
      serialOrParallel: "serial",
      text: (nodeText) =>
        `在${nodeText}所在并联结构汇合后添加一个线圈`,
      partialText: (nodeText) =>
        `当前回路还没有输出节点，在${nodeText}所在并联结构汇合后添加一个线圈`,
    };
  }

  const suffix = node.kind === "FBDCompartment" ? "输出端后" : "后";
  return {
    text: (nodeText) => `在${nodeText}${suffix}添加一个线圈`,
    partialText: (nodeText) =>
      `当前回路还没有输出节点，在${nodeText}${suffix}添加一个线圈`,
  };
}

function findParallelOutputStartNodeIds(
  segment: DiagramSegmentSummary,
  node: DiagramNodeSummary,
): string[] {
  const visited = new Set<string>();
  const queue = [...node.to];
  let bestTailNodes: DiagramNodeSummary[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }

    visited.add(currentId);
    const current = findNode(segment, currentId);
    if (!current) {
      continue;
    }

    const tailNodes = collectNearestDisplayNodes(
      segment,
      current.from,
      "backward",
    ).sort(compareDisplayOrder);
    if (
      tailNodes.length > 1 &&
      tailNodes.some((tailNode) => tailNode.id === node.id) &&
      tailNodes.length >= bestTailNodes.length
    ) {
      bestTailNodes = tailNodes;
    }

    if (isOutputNodeKind(current.kind)) {
      continue;
    }

    queue.push(...current.to);
  }

  return bestTailNodes.map((tailNode) => tailNode.id);
}

function hasDownstreamOutputNode(
  segment: DiagramSegmentSummary,
  startNodeId: string,
): boolean {
  const visited = new Set<string>();
  const queue = [...(findNode(segment, startNodeId)?.to ?? [])];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) {
      continue;
    }

    visited.add(nodeId);
    const node = findNode(segment, nodeId);
    if (!node) {
      continue;
    }

    if (isOutputNodeKind(node.kind)) {
      return true;
    }

    queue.push(...node.to);
  }

  return false;
}

function hasDownstreamLogicNode(
  segment: DiagramSegmentSummary,
  startNodeId: string,
): boolean {
  const visited = new Set<string>();
  const queue = [...(findNode(segment, startNodeId)?.to ?? [])];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) {
      continue;
    }

    visited.add(nodeId);
    const node = findNode(segment, nodeId);
    if (!node) {
      continue;
    }

    if (isLogicNodeKind(node.kind)) {
      return true;
    }

    queue.push(...node.to);
  }

  return false;
}

function dedupeSuggestions(
  suggestions: LocalSuggestionDraft[],
): LocalSuggestionDraft[] {
  const seen = new Set<string>();
  const result: LocalSuggestionDraft[] = [];

  for (const suggestion of suggestions) {
    const startNodes = normalizeNodeIds(
      suggestion.startNodes ?? inferStartNodes(suggestion),
    ).join(",");
    const endNodes = normalizeNodeIds(
      suggestion.endNodes ?? inferEndNodes(suggestion),
    ).join(",");
    const key = [
      suggestion.mode,
      suggestion.placement.relationToFocus,
      startNodes,
      endNodes,
      suggestion.position ?? inferPosition(suggestion),
      suggestion.serialOrParallel ?? inferSerialOrParallel(suggestion),
      suggestion.placement.parallelToNodeId,
      suggestion.placement.branchFromNodeId,
      suggestion.placement.branchToNodeId,
      suggestion.addElement.nodeType,
      suggestion.addElement.blockType,
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(suggestion);
  }

  return result;
}

function keepOutputCoilWithinLimit(
  suggestions: LocalSuggestionDraft[],
  limit: number,
): LocalSuggestionDraft[] {
  if (suggestions.length <= limit) {
    return suggestions;
  }

  const limited = suggestions.slice(0, limit);
  if (limited.some((suggestion) => suggestion.mode === "outputCoil")) {
    return limited;
  }

  const outputCoilSuggestion = suggestions
    .slice(limit)
    .find((suggestion) => suggestion.mode === "outputCoil");
  if (!outputCoilSuggestion || limit <= 0) {
    return limited;
  }

  return [...limited.slice(0, limit - 1), outputCoilSuggestion];
}

function getFocusId(focus: FocusContext): string {
  return focus.node?.id ?? focus.insertionPoint?.id ?? "";
}

function getFocusType(focus: FocusContext): string {
  return focus.node?.kind ?? focus.insertionPoint?.kind ?? "";
}

function getFocusVar(focus: FocusContext): string {
  return focus.node?.var ?? focus.node?.instance ?? "";
}

function getFocusVisualElement(focus: FocusContext): string {
  if (focus.node) {
    return nodeLabelWithSegment(focus.segment, focus.node);
  }

  const insertionPoint = focus.insertionPoint;
  if (!insertionPoint) {
    return "";
  }

  return `${insertionPoint.kind} ${insertionPoint.fromLabels.join(", ") || "start"} -> ${insertionPoint.toLabels.join(", ") || "end"}`;
}

function getFallbackFocusLabel(
  focus: Omit<FocusContext, "source">,
): string {
  if (focus.node) {
    return nodeLabelWithSegment(focus.segment, focus.node);
  }

  if (focus.insertionPoint) {
    return `${focus.insertionPoint.kind} ${focus.insertionPoint.id}`;
  }

  return "the first graph element";
}

function nodeLabel(node: DiagramNodeSummary): string {
  if (node.kind === "FBDCompartment") {
    if (node.isFunction) {
      return `${node.blockType || "FUN"} 函数(${node.id})`;
    }

    const instance = node.instance ? ` ${node.instance}` : "";
    return `${node.blockType || "功能块"}${instance} 功能块`;
  }

  if (isCoilKind(node.kind)) {
    return `${displayNodeName(undefined, node)} ${coilKindLabel(node.kind)}`;
  }

  if (isContactKind(node.kind)) {
    return `${displayNodeName(undefined, node)} ${contactKindLabel(node.kind)}`;
  }

  return node.var || node.instance || node.id;
}

function nodeLabelWithSegment(
  segment: DiagramSegmentSummary,
  node: DiagramNodeSummary,
): string {
  if (node.kind === "FBDCompartment") {
    if (node.isFunction) {
      return `${node.blockType || "FUN"} 函数(${node.id})`;
    }

    const instance = displayNodeName(segment, node);
    return instance ? `${node.blockType || "功能块"} ${instance} 功能块` : `${node.blockType || "功能块"} 功能块`;
  }

  if (isCoilKind(node.kind)) {
    return `${displayNodeName(segment, node)} ${coilKindLabel(node.kind)}`;
  }

  if (isContactKind(node.kind)) {
    return `${displayNodeName(segment, node)} ${contactKindLabel(node.kind)}`;
  }

  return displayNodeName(segment, node);
}

function neighborListText(
  segment: DiagramSegmentSummary,
  nodeIds: string[] | undefined,
  direction: "forward" | "backward",
): string {
  const labels = neighborNodes(segment, nodeIds, direction).map((node) =>
    nodePlacementLabelWithSegment(segment, node),
  );

  if (!labels.length) {
    return "";
  }

  return [...new Set(labels)].join(" / ");
}

function nodePlacementLabelWithSegment(
  segment: DiagramSegmentSummary,
  node: DiagramNodeSummary,
): string {
  const label = nodeLabelWithSegment(segment, node);
  if (label.includes(`(${node.id})`)) {
    return label;
  }

  return `${label}(${node.id})`;
}

function neighborNodes(
  segment: DiagramSegmentSummary,
  nodeIds: string[] | undefined,
  direction: "forward" | "backward",
): DiagramNodeSummary[] {
  const seen = new Set<string>();
  const nodes: DiagramNodeSummary[] = [];

  for (const nodeId of nodeIds ?? []) {
    const node = findNearestDisplayNode(segment, nodeId, direction);
    if (!node || seen.has(node.id)) {
      continue;
    }

    seen.add(node.id);
    nodes.push(node);
  }

  return nodes;
}

function directInsertionPointSourceIds(
  segment: DiagramSegmentSummary,
  node: DiagramNodeSummary,
): string[] {
  return normalizeNodeIds(
    node.from.filter((nodeId) => {
      const sourceNode = findNode(segment, nodeId);
      return Boolean(sourceNode && isInsertionPointKind(sourceNode.kind));
    }),
  );
}

function findLeftRailInsertionPointBeforeNode(
  segment: DiagramSegmentSummary,
  node: DiagramNodeSummary,
): { insertionPointId: string; sourceIds: string[] } | undefined {
  for (const insertionPointId of directInsertionPointSourceIds(segment, node)) {
    const insertionPoint = findNode(segment, insertionPointId);
    if (!insertionPoint) {
      continue;
    }

    const sourceIds = normalizeNodeIds(
      insertionPoint.from.filter((sourceId) => {
        const sourceNode = findNode(segment, sourceId);
        return sourceNode?.kind === "startLine";
      }),
    );
    if (sourceIds.length > 0) {
      return {
        insertionPointId,
        sourceIds,
      };
    }
  }

  return undefined;
}

function getParallelStartNodePlan(
  segment: DiagramSegmentSummary,
  node: DiagramNodeSummary,
): { startNodes: string[]; preserveStartNodes: boolean } {
  const insertionPointSourceIds = directInsertionPointSourceIds(segment, node);
  if (insertionPointSourceIds.length > 0) {
    return {
      startNodes: insertionPointSourceIds,
      preserveStartNodes: true,
    };
  }

  return {
    startNodes: resolveBoundaryNodeIds(segment, node.from, "backward"),
    preserveStartNodes: false,
  };
}

function getParallelEndNodePlan(
  segment: DiagramSegmentSummary,
  node: DiagramNodeSummary,
): { endNodes: string[]; preserveEndNodes: boolean } {
  const insertionPointTargetIds = directInsertionPointTargetIds(segment, node);
  if (insertionPointTargetIds.length > 0) {
    return {
      endNodes: insertionPointTargetIds,
      preserveEndNodes: true,
    };
  }

  return {
    endNodes: resolveBoundaryNodeIds(segment, node.to, "forward"),
    preserveEndNodes: false,
  };
}

function addCoilReplaceSuggestions(
  suggestions: LocalSuggestionDraft[],
  focus: FocusContext,
  nodeText: string,
): void {
  const node = focus.node;
  if (!node) {
    return;
  }

  const replaceTargets: Array<{
    kind: string;
    label: string;
    addElement: LocalSuggestionAddElement;
  }> = [
    {
      kind: "coil",
      label: "普通线圈",
      addElement: coilElement(node.var),
    },
    {
      kind: "setCoil",
      label: "置位线圈",
      addElement: setCoilElement(node.var),
    },
    {
      kind: "resetCoil",
      label: "复位线圈",
      addElement: resetCoilElement(node.var),
    },
  ];

  for (const target of replaceTargets) {
    if (node.kind === target.kind) {
      continue;
    }

    suggestions.push(
      makeSuggestion(focus, {
        mode: "replaceSelected",
        relationToFocus: "replaceSelected",
        text: `将${nodeText}改成${target.label}`,
        addElement: target.addElement,
      }),
    );
  }
}

function directInsertionPointTargetIds(
  segment: DiagramSegmentSummary,
  node: DiagramNodeSummary,
): string[] {
  return normalizeNodeIds(
    node.to.filter((nodeId) => {
      const targetNode = findNode(segment, nodeId);
      return Boolean(targetNode && isInsertionPointKind(targetNode.kind));
    }),
  );
}

function directInsertionPointTargetsBeforeNode(
  segment: DiagramSegmentSummary,
  sourceNode: DiagramNodeSummary,
  rightNode: DiagramNodeSummary,
): string[] {
  return directInsertionPointTargetIds(segment, sourceNode).filter(
    (insertionPointId) =>
      collectNearestDisplayNodes(segment, [insertionPointId], "forward").some(
        (node) => node.id === rightNode.id,
      ),
  );
}

function findOutsideBehindStartNodes(
  segment: DiagramSegmentSummary,
  anchorNode: DiagramNodeSummary,
  rightNode: DiagramNodeSummary,
): string[] {
  const branchTailNodes = collectNearestDisplayNodes(
    segment,
    rightNode.from,
    "backward",
  ).sort(compareDisplayOrder);

  if (
    branchTailNodes.length <= 1 ||
    !branchTailNodes.some((node) => node.id === anchorNode.id)
  ) {
    return [];
  }

  return branchTailNodes.map((node) => node.id);
}

function collectNearestDisplayNodes(
  segment: DiagramSegmentSummary,
  nodeIds: string[] | undefined,
  direction: "forward" | "backward",
): DiagramNodeSummary[] {
  const visited = new Set<string>();
  const resultById = new Map<string, DiagramNodeSummary>();
  const queue = [...(nodeIds ?? [])];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }

    visited.add(currentId);
    const node = findNode(segment, currentId);
    if (!node) {
      continue;
    }

    if (isRealGraphElementKind(node.kind)) {
      resultById.set(node.id, node);
      continue;
    }

    queue.push(...(direction === "forward" ? node.to : node.from));
  }

  return [...resultById.values()];
}

function findNearestDisplayNode(
  segment: DiagramSegmentSummary,
  nodeId: string,
  direction: "forward" | "backward",
): DiagramNodeSummary | undefined {
  const visited = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }

    visited.add(currentId);
    const node = findNode(segment, currentId);
    if (!node) {
      continue;
    }

    if (isRealGraphElementKind(node.kind)) {
      return node;
    }

    queue.push(...(direction === "forward" ? node.to : node.from));
  }

  return undefined;
}

function displayNodeName(
  segment: DiagramSegmentSummary | undefined,
  node: DiagramNodeSummary,
): string {
  const rawName = (node.var || node.instance || "").trim();
  if (rawName && !isUnnamedPlaceholder(rawName)) {
    return rawName;
  }

  if (!segment) {
    return `未命名(${node.id})`;
  }

  const index = unnamedNodeIndex(segment, node);
  const displayName = index > 0 ? `未命名${index}` : "未命名";
  return `${displayName}(${node.id})`;
}

function unnamedNodeIndex(
  segment: DiagramSegmentSummary,
  targetNode: DiagramNodeSummary,
): number {
  const unnamedNodes = segment.nodes
    .filter((node) => isRealGraphElementKind(node.kind))
    .filter((node) => !node.isFunction)
    .filter((node) => isUnnamedPlaceholder(node.var || node.instance || ""))
    .sort(compareDisplayOrder);

  return unnamedNodes.findIndex((node) => node.id === targetNode.id) + 1;
}

function compareDisplayOrder(a: DiagramNodeSummary, b: DiagramNodeSummary): number {
  const ay = a.y ?? Number.POSITIVE_INFINITY;
  const by = b.y ?? Number.POSITIVE_INFINITY;
  if (ay !== by) {
    return ay - by;
  }

  const ax = a.x ?? Number.POSITIVE_INFINITY;
  const bx = b.x ?? Number.POSITIVE_INFINITY;
  if (ax !== bx) {
    return ax - bx;
  }

  return (a.order ?? 0) - (b.order ?? 0);
}

function isUnnamedPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  return !trimmed || trimmed === "???";
}

function contactKindLabel(kind: string): string {
  switch (kind) {
    case "negatedContact":
      return "常闭触点";
    case "risingContact":
      return "上升沿";
    case "fallingContact":
      return "下降沿";
    case "contact":
    default:
      return "常开触点";
  }
}

function coilKindLabel(kind: string): string {
  switch (kind) {
    case "setCoil":
      return "置位线圈";
    case "resetCoil":
      return "复位线圈";
    case "coil":
    default:
      return "线圈";
  }
}

function isContactKind(kind: string): boolean {
  return [
    "contact",
    "negatedContact",
    "risingContact",
    "fallingContact",
  ].includes(kind);
}

function isCoilKind(kind: string): boolean {
  return ["coil", "setCoil", "resetCoil"].includes(kind);
}

function isOutputNodeKind(kind: string): boolean {
  return isCoilKind(kind) || kind === "FBDCompartment";
}

function isLogicNodeKind(kind: string): boolean {
  return isContactKind(kind) || kind === "FBDCompartment";
}

function isRealGraphElementKind(kind: string): boolean {
  return [
    "contact",
    "negatedContact",
    "risingContact",
    "fallingContact",
    "coil",
    "setCoil",
    "resetCoil",
    "FBDCompartment",
  ].includes(kind);
}

function isBoundaryLineKind(kind: string): boolean {
  return kind === "startLine" || kind === "endLine";
}

function isInsertionPointKind(kind: string): boolean {
  return kind === "editRect" || kind === "branchRect";
}

function isInsertionPointId(
  segment: DiagramSegmentSummary,
  nodeId: string,
): boolean {
  const node = findNode(segment, nodeId);
  return Boolean(node && isInsertionPointKind(node.kind));
}

function first(values: string[] | undefined): string {
  return values?.[0] ?? "";
}

function formatFocusOptions(options: LocalGraphSuggestionOptions): string {
  return (
    [
      options.segmentId ? `segmentId=${options.segmentId}` : "",
      options.selectedNodeId ? `nodeId=${options.selectedNodeId}` : "",
      options.selectedInsertionPointId
        ? `insertionPointId=${options.selectedInsertionPointId}`
        : "",
      options.selectedVar ? `var=${options.selectedVar}` : "",
      options.selectedNodeType ? `type=${options.selectedNodeType}` : "",
      options.focusQuery ? `query=${options.focusQuery}` : "",
    ]
      .filter(Boolean)
      .join(" ") || "(manual input)"
  );
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

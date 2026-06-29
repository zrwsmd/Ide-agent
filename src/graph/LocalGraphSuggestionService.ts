import * as vscode from "vscode";
import {
  DEFAULT_DIAGRAM_JSON_PATH,
  DiagramInsertionPointSummary,
  DiagramNodeSummary,
  DiagramSegmentSummary,
  DiagramSummary,
  loadDiagramSummary,
} from "../diagram/DiagramSummary";

export interface LocalGraphSuggestionOptions {
  selectedNodeId?: string;
  selectedInsertionPointId?: string;
  selectedVar?: string;
  selectedNodeType?: string;
  focusQuery?: string;
}

export interface LocalGraphSuggestionRequest {
  diagramPath: string;
  selectedNodeId?: string;
  selectedInsertionPointId?: string;
}

export interface LocalGraphSuggestionPayload {
  schemaVersion: string;
  action: string;
  source: string;
  segmentId: string;
  confidence: number;
  recognizedFocus: Record<string, unknown>;
  suggestions: LocalSuggestion[];
}

export interface LocalSuggestionOverview {
  index: number;
  id: string;
  mode: string;
  placement: string;
  add: string;
  text: string;
}

export interface LocalGraphSuggestionSummary extends DiagramSummary {
  suggestionOverview: LocalSuggestionOverview[];
}

export interface LocalGraphSuggestionResult {
  diagramPath: string;
  jsonText: string;
  payload: LocalGraphSuggestionPayload;
  summary: LocalGraphSuggestionSummary;
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

interface LocalSuggestion {
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
  addElement: {
    nodeType: string;
    displayLabel: string;
    variableSource: string;
    variableName: string;
    dataType: string;
    userInputRequired: boolean;
    blockType: string;
    instanceSource: string;
    instanceName: string;
  };
}

const COMMON_FUNCTION_BLOCK_TYPES = [
  "TON",
  "TOF",
  "TP",
  "CTU",
  "CTD",
  "CTUD",
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
      selectedNodeId: request?.selectedNodeId,
      selectedInsertionPointId: request?.selectedInsertionPointId,
    };

    this.log(
      `local graph command requested path=${diagramPath} focus=${formatFocusOptions(focusOptions)}`,
    );

    let summary: DiagramSummary;
    try {
      summary = await loadDiagramSummary(diagramPath);
    } catch (error) {
      this.log(
        `local graph command failed: cannot load diagram json: ${formatUnknownError(error)}`,
      );
      return undefined;
    }

    const focus = findFocusByOptions(summary, focusOptions);
    if (!focus) {
      this.log(
        `local graph command cancelled: focus not found ${formatFocusOptions(focusOptions)}`,
      );
      return undefined;
    }

    return this.createResult(diagramPath, summary, {
      ...focus,
      source: "provided",
    });
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
        `local graph suggestion #${index + 1} mode=${suggestion.mode} placement=${suggestion.placement.text} add=${suggestion.addElement.displayLabel}`,
      );
    }
    this.log(`local graph suggestions JSON=${result.jsonText}`);
    void vscode.env.clipboard.writeText(result.jsonText);
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
    const jsonText = JSON.stringify(payload, null, 2);
    const resultSummary = {
      ...summary,
      suggestionOverview: buildSuggestionOverview(payload.suggestions),
    };

    this.log(
      `local graph result path=${diagramPath} source=${focus.source} nodeId=${getFocusId(focus)} insertionPoint=${focus.insertionPoint?.id ?? ""} suggestions=${payload.suggestions.length}`,
    );

    return {
      diagramPath,
      jsonText,
      payload,
      summary: resultSummary,
    };
  }
}

function buildSuggestionOverview(
  suggestions: LocalSuggestion[],
): LocalSuggestionOverview[] {
  return suggestions.map((suggestion, index) => {
    const itemIndex = index + 1;
    const placement = suggestion.placement.text;
    const add = suggestion.addElement.displayLabel;

    return {
      index: itemIndex,
      id: suggestion.id,
      mode: suggestion.mode,
      placement,
      add,
      text: `#${itemIndex} mode=${suggestion.mode} placement=${placement} add=${add}`,
    };
  });
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
    confidence: suggestions.length ? 1 : 0,
    recognizedFocus: {
      visualElement: getFocusVisualElement(focus),
      matchedNodeId: getFocusId(focus),
      matchedNodeType: getFocusType(focus),
      matchedVar: getFocusVar(focus),
      confidence: 1,
      source: focus.source,
      pouName: summary.pouName,
    },
    suggestions,
  };
}

function buildSuggestions(focus: FocusContext): LocalSuggestion[] {
  const suggestions: LocalSuggestion[] = [];
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

  return dedupeSuggestions(suggestions)
    .slice(0, 6)
    .map((suggestion, index) => ({
    ...suggestion,
    id: `local-${index + 1}`,
  }));
}

function addContactSuggestions(
  suggestions: LocalSuggestion[],
  focus: FocusContext,
  graphState: SegmentGraphState,
): void {
  const node = focus.node;
  if (!node) {
    return;
  }

  const leftNodes = neighborNodes(focus.segment, node.from, "backward");
  const rightNodes = neighborNodes(focus.segment, node.to, "forward");
  const nodeText = nodeLabelWithSegment(focus.segment, node);

  if (leftNodes.length) {
    for (const leftNode of leftNodes) {
      const leftText = nodeLabelWithSegment(focus.segment, leftNode);
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
      const rightText = nodeLabelWithSegment(focus.segment, rightNode);
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

  suggestions.push(
    makeSuggestion(focus, {
      mode: "parallelBranch",
      relationToFocus: "parallelWithSelected",
      parallelToNodeId: node.id,
      branchFromNodeId: first(node.from),
      branchToNodeId: first(node.to),
      text: `与${nodeText}并联一个常开触点`,
      addElement: contactElement(),
    }),
    makeSuggestion(focus, {
      mode: "parallelBranch",
      relationToFocus: "parallelWithSelected",
      parallelToNodeId: node.id,
      branchFromNodeId: first(node.from),
      branchToNodeId: first(node.to),
      text: `与${nodeText}并联一个功能块`,
      addElement: functionBlockElement(),
    }),
  );

  if (canAddOutputAfterNode(focus.segment, node)) {
    suggestions.push(
      makeSuggestion(focus, {
        mode: "outputCoil",
        relationToFocus: "afterSelected",
        insertAfterNodeId: node.id,
        insertBeforeNodeId: first(node.to),
        text: graphState.isPartialGraph
          ? `当前回路还没有输出节点，在${nodeText}后添加一个线圈`
          : `在${nodeText}后添加一个线圈`,
        addElement: coilElement(),
      }),
    );
  }
}

function addFunctionBlockSuggestions(
  suggestions: LocalSuggestion[],
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
  const nodeText = nodeLabelWithSegment(focus.segment, node);

  if (leftNodes.length) {
    for (const leftNode of leftNodes) {
      const leftText = nodeLabelWithSegment(focus.segment, leftNode);
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
    suggestions.push(
      makeSuggestion(focus, {
        mode: "outputCoil",
        relationToFocus: "afterSelected",
        insertAfterNodeId: node.id,
        insertBeforeNodeId: first(node.to),
        portName: firstOutputPort,
        text: graphState.isPartialGraph
          ? `当前回路还没有输出节点，在${nodeText}输出端后添加一个线圈`
          : `在${nodeText}输出端后添加一个线圈`,
        addElement: coilElement(),
      }),
    );
  }

  if (rightNodes.length) {
    for (const rightNode of rightNodes) {
      const rightText = nodeLabelWithSegment(focus.segment, rightNode);
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
  suggestions: LocalSuggestion[],
  focus: FocusContext,
): void {
  const node = focus.node;
  if (!node) {
    return;
  }

  const nodeText = nodeLabelWithSegment(focus.segment, node);

  suggestions.push(
    makeSuggestion(focus, {
      mode: "seriesBefore",
      relationToFocus: "beforeSelected",
      insertAfterNodeId: first(node.from),
      insertBeforeNodeId: node.id,
      text: `在${nodeText}前串联一个常开触点`,
      addElement: contactElement(),
    }),
    makeSuggestion(focus, {
      mode: "parallelBranch",
      relationToFocus: "parallelWithSelected",
      parallelToNodeId: node.id,
      branchFromNodeId: first(node.from),
      branchToNodeId: first(node.to),
      text: `与${nodeText}并联一个线圈`,
      addElement: coilElement(),
    }),
    makeSuggestion(focus, {
      mode: "replaceSelected",
      relationToFocus: "replaceSelected",
      text: `将${nodeText}改成置位线圈`,
      addElement: setCoilElement(node.var),
    }),
    makeSuggestion(focus, {
      mode: "seriesBefore",
      relationToFocus: "beforeSelected",
      insertAfterNodeId: first(node.from),
      insertBeforeNodeId: node.id,
      text: `在${nodeText}前插入一个功能块`,
      addElement: functionBlockElement(),
    }),
  );
}

function addInsertionPointSuggestions(
  suggestions: LocalSuggestion[],
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
        text: `在${sourceText}和${targetText}之间串联一个常开触点`,
        addElement: contactElement(),
      }),
      makeSuggestion(focus, {
        mode: "functionBlockBefore",
        relationToFocus: "atInsertionPoint",
        insertAfterNodeId: first(insertionPoint.from),
        insertBeforeNodeId: target.id,
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
          text: `当前回路还没有输出节点，在${sourceText}后添加一个输出线圈`,
          addElement: coilElement(),
        }),
        makeSuggestion(focus, {
          mode: "outputFunctionBlock",
          relationToFocus: "atInsertionPoint",
          insertAfterNodeId: first(insertionPoint.from),
          text: `当前回路还没有输出节点，在${sourceText}后添加一个功能块作为输出节点`,
          addElement: functionBlockElement(),
        }),
        makeSuggestion(focus, {
          mode: "seriesAfter",
          relationToFocus: "atInsertionPoint",
          insertAfterNodeId: first(insertionPoint.from),
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
      text: `在${sourceText}和${targetText}之间串联一个常开触点`,
      addElement: contactElement(),
    }),
    makeSuggestion(focus, {
      mode: "functionBlockAfter",
      relationToFocus: "atInsertionPoint",
      insertAfterNodeId: first(insertionPoint.from),
      insertBeforeNodeId: first(insertionPoint.to),
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
    text: string;
    addElement: LocalSuggestion["addElement"];
  },
): LocalSuggestion {
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
    addElement,
  };
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

  const fromManualInput = findFocusByQuery(summary, manualQuery);
  if (fromManualInput) {
    return { ...fromManualInput, source: "manualInput" };
  }

  const fallback =
    findFirstInsertionPoint(summary) || findFirstRealNode(summary);
  const picked = await pickFocus(summary, fallback);
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
    const byNodeId = findNodeFocus(summary, options.selectedNodeId);
    if (byNodeId) {
      return byNodeId;
    }
  }

  if (options.selectedInsertionPointId) {
    const byInsertionId = findInsertionPointFocus(
      summary,
      options.selectedInsertionPointId,
    );
    if (byInsertionId) {
      return byInsertionId;
    }
  }

  if (options.selectedVar) {
    return findFocusByToken(summary, options.selectedVar);
  }

  if (options.focusQuery) {
    return findFocusByQuery(summary, options.focusQuery);
  }

  return undefined;
}

function findFocusByQuery(
  summary: DiagramSummary,
  query: string,
): Omit<FocusContext, "source"> | undefined {
  const trimmed = query.trim();
  if (!trimmed) {
    return undefined;
  }

  return (
    findNodeFocus(summary, trimmed) ||
    findInsertionPointFocus(summary, trimmed) ||
    findFocusByToken(summary, trimmed)
  );
}

function findFocusByToken(
  summary: DiagramSummary,
  token: string,
): Omit<FocusContext, "source"> | undefined {
  if (!token) {
    return undefined;
  }

  const normalized = token.toLowerCase();
  const matches = summary.segments.flatMap((segment) =>
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
): Omit<FocusContext, "source"> | undefined {
  for (const segment of summary.segments) {
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
): Omit<FocusContext, "source"> | undefined {
  for (const segment of summary.segments) {
    const insertionPoint = segment.insertionPoints.find(
      (item) => item.id === insertionPointId,
    );
    if (insertionPoint) {
      return { segment, insertionPoint };
    }
  }

  return undefined;
}

function findFirstInsertionPoint(
  summary: DiagramSummary,
): Omit<FocusContext, "source"> | undefined {
  const segment = summary.segments.find(
    (item) => item.insertionPoints.length > 0,
  );
  const insertionPoint = segment?.insertionPoints[0];
  return segment && insertionPoint ? { segment, insertionPoint } : undefined;
}

function findFirstRealNode(
  summary: DiagramSummary,
): Omit<FocusContext, "source"> | undefined {
  for (const segment of summary.segments) {
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
): Promise<Omit<FocusContext, "source"> | undefined> {
  const items = summary.segments.flatMap((segment) =>
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

function contactElement(): LocalSuggestion["addElement"] {
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

function coilElement(): LocalSuggestion["addElement"] {
  return {
    nodeType: "coil",
    displayLabel: "输出线圈",
    variableSource: "userInput",
    variableName: "",
    dataType: "BOOL",
    userInputRequired: true,
    blockType: "",
    instanceSource: "",
    instanceName: "",
  };
}

function setCoilElement(variableName = ""): LocalSuggestion["addElement"] {
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

function functionBlockElement(): LocalSuggestion["addElement"] {
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
  const hasLogicNode = segment.nodes.some(
    (node) => isContactKind(node.kind) || node.kind === "FBDCompartment",
  );
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
  return !hasDownstreamOutputNode(segment, node.id);
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

function dedupeSuggestions(suggestions: LocalSuggestion[]): LocalSuggestion[] {
  const seen = new Set<string>();
  const result: LocalSuggestion[] = [];

  for (const suggestion of suggestions) {
    const key = [
      suggestion.mode,
      suggestion.placement.relationToFocus,
      suggestion.placement.insertAfterNodeId,
      suggestion.placement.insertBeforeNodeId,
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
    nodeLabelWithSegment(segment, node),
  );

  if (!labels.length) {
    return "";
  }

  return [...new Set(labels)].join(" / ");
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

function first(values: string[] | undefined): string {
  return values?.[0] ?? "";
}

function formatFocusOptions(options: LocalGraphSuggestionOptions): string {
  return (
    [
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

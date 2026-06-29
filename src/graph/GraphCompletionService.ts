import * as vscode from 'vscode';
import { DEFAULT_DIAGRAM_JSON_PATH, DiagramNodeSummary, DiagramSegmentSummary, DiagramSummary, loadDiagramSummary } from '../diagram/DiagramSummary';
import { LLMAdapter, LLMMessage } from '../llm/types';
import { loadLastScreenshot, pickScreenshot, ScreenshotContext } from './ScreenshotContext';

type LLMAdapterGetter = () => Promise<LLMAdapter | null>;

const COMMON_FUNCTION_BLOCK_TYPES = [
  'TON',
  'TOF',
  'TP',
  'CTU',
  'CTD',
  'CTUD',
  'SR',
  'RS',
];

export interface GraphCompletionResult {
  diagramPath: string;
  rawText: string;
  jsonText: string;
  summary: DiagramSummary;
}

export class GraphCompletionService {
  constructor(
    private readonly getLLMAdapter: LLMAdapterGetter,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  async predictFromActiveEditor(options: { includeScreenshot?: boolean } = {}): Promise<GraphCompletionResult | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this.log('graph prediction skipped: no active editor');
      void vscode.window.showWarningMessage('Open an ST file before running graph prediction.');
      return undefined;
    }

    const document = editor.document;
    const stCode = document.getText();
    const cursor = {
      line: editor.selection.active.line + 1,
      character: editor.selection.active.character + 1,
    };
    const diagramPath = DEFAULT_DIAGRAM_JSON_PATH;
    let screenshot: ScreenshotContext | undefined;

    this.log(`graph prediction requested file=${document.fileName || document.uri.toString()} line=${cursor.line} column=${cursor.character}`);
    this.log(`loading diagram json path=${diagramPath}`);

    if (options.includeScreenshot) {
      try {
        screenshot = await pickScreenshot();
      } catch (error) {
        this.log(`graph screenshot skipped: ${formatUnknownError(error)}`);
        void vscode.window.showWarningMessage(`Ide Agent: failed to read screenshot. ${formatErrorMessage(error)}`);
      }

      if (!screenshot) {
        this.log('graph prediction cancelled: no screenshot selected');
        return undefined;
      }
    } else {
      try {
        screenshot = await loadLastScreenshot();
      } catch (error) {
        this.log(`graph last screenshot ignored: ${formatUnknownError(error)}`);
      }
    }

    let summary: DiagramSummary;
    try {
      summary = await loadDiagramSummary(diagramPath);
    } catch (error) {
      this.log(`graph prediction failed: cannot load diagram json: ${formatUnknownError(error)}`);
      void vscode.window.showErrorMessage(`Ide Agent: failed to read diagram JSON. ${formatErrorMessage(error)}`);
      return undefined;
    }

    this.log(
      `diagram summary pou=${summary.pouName || '(unknown)'} segments=${summary.segments.length} variables=${summary.variableCount} nodes=${summary.segments.map((segment) => segment.nodeCount).join(',')}`
    );
    if (screenshot) {
      this.log(`using screenshot path=${screenshot.path} mediaType=${screenshot.mediaType}`);
    } else {
      this.log('using text-only graph prediction; no screenshot context available');
    }

    const llmAdapter = await this.getLLMAdapter();
    if (!llmAdapter) {
      this.log('graph prediction skipped: no LLM adapter available');
      void vscode.window.showWarningMessage('Ide Agent: set provider API key before graph prediction.');
      return undefined;
    }

    const messages = buildGraphCompletionPrompt(stCode, summary, cursor, document.fileName || document.uri.toString(), screenshot);
    let rawText = '';

    try {
      this.log(`calling LLM for graph prediction adapter=${llmAdapter.constructor.name}`);
      rawText = await llmAdapter.complete(messages, {
        temperature: 0.1,
        maxTokens: 1800,
        stopSequences: ['```text', '\nExplanation:', '\n说明:'],
        timeoutMs: 30000,
      });
      this.log(`graph LLM returned chars=${rawText.length} preview=${JSON.stringify(rawText.slice(0, 240))}`);
    } catch (error) {
      this.log(`graph prediction failed: LLM request failed: ${formatUnknownError(error)}`);
      void vscode.window.showErrorMessage(`Ide Agent: graph prediction request failed. ${formatErrorMessage(error)}`);
      return undefined;
    }

    const jsonText = normalizeGraphPredictionJson(extractJsonText(rawText), summary, (message) => this.log(message));
    if (!jsonText) {
      this.log('graph prediction failed: LLM did not return JSON');
      void vscode.window.showWarningMessage('Ide Agent: graph prediction did not return JSON. Check Ide Agent logs.');
      return {
        diagramPath,
        rawText,
        jsonText: '',
        summary,
      };
    }

    logGraphPredictionSummary(jsonText, (message) => this.log(message));
    this.log(`graph prediction JSON=${jsonText}`);
    void vscode.env.clipboard.writeText(jsonText);
    void vscode.window.showInformationMessage('Ide Agent: graph prediction patch copied to clipboard.');

    return {
      diagramPath,
      rawText,
      jsonText,
      summary,
    };
  }

  private log(message: string): void {
    const line = `[${new Date().toISOString()}] ${message}`;
    this.outputChannel.appendLine(line);
    console.log(`[IdeAgent:GraphCompletion] ${message}`);
  }
}

function buildGraphCompletionPrompt(
  stCode: string,
  diagramSummary: DiagramSummary,
  cursor: { line: number; character: number },
  fileName: string,
  screenshot: ScreenshotContext | undefined
): LLMMessage[] {
  const compactDiagram = compactForPrompt(diagramSummary, Boolean(screenshot));
  const systemPrompt = [
    'You are an IEC 61131-3 LD/FBD graph completion engine.',
    'Predict the next likely ladder diagram or function block diagram edit from the provided ST code and diagram topology.',
    'Return only one valid JSON object. Do not return Markdown, comments, or explanations.',
    'The JSON must describe a preview patch the frontend can render, not ST code.',
    'Use existing segmentId and node ids from the topology when choosing insertion positions.',
    'Prefer IEC 61131 valid LD/FBD elements: contact, negatedContact, risingContact, fallingContact, coil, setCoil, resetCoil, FBDCompartment, branch.',
    'If an image is provided, the node enclosed by the red dashed selection box is the current selected node.',
    'Identify the real electrical/logic element inside that red dashed box, such as the contact labeled d.',
    'Do not return internal names like editRect, insertionPoint, placeholder, startLine, endLine, or empty red boxes as the selected node.',
    'Match the visual focus in the image to the most likely node in the topology by variable label and surrounding connections.',
    'The screenshot selection is more important than any generic insertion point in the topology.',
    'Do not explain your reasoning. Do not include long natural-language suggestions.',
    'Return 2 to 4 alternative graph suggestions when useful.',
    'The diagram summary includes displayName/typeLabel/graphState/neighbors. Use those display names in placement.text.',
    'If a node variable is "???" or empty, refer to it by displayName such as "未命名1 常开触点" or "未命名2 上升沿"; never output "???" in user-facing text.',
    'Use exact Chinese type labels: contact=常开触点, negatedContact=常闭触点, risingContact=上升沿, fallingContact=下降沿, coil=线圈, setCoil=置位线圈, resetCoil=复位线圈.',
    'If graphState.isPartialGraph is true, prioritize suggestions near the selected node/insertion point that complete the graph with a legal output node.',
    'Never expose internal placeholder ids or names such as edit-node-rect, start-node-line, end-node-line, editRect, branchRect, startLine, or endLine in placement.text.',
    'Use IEC 61131-3 LD/FBD semantics to judge legal adjacent edits; do not copy a fixed template of suggestions.',
    'Evaluate the selected node and its immediate neighbors in the topology: predecessor nodes, successor nodes, branch split/merge points, and function block ports.',
    'Every suggestion must be centered on recognizedFocus.matchedNodeId, but the legal placement may be before it, after it, parallel with it, around it as a branch, or on a nearby function block port.',
    'Each suggestion must include placement.relationToFocus, placement.text, and addElement.',
    'Use placement for all location and anchor fields. Do not duplicate those ids at the suggestion top level.',
    'Use addElement for all new graph element fields. Do not also return newElement, addNodeType, addNodeTypeLabel, addBlockType, or parallelElement.',
    'placement.text must explicitly say the location in Chinese, for example: "在 c 触点前串联一个常开触点", "在 c 触点后串联一个功能块", "与 c 触点并联一个常闭触点", or "围绕 c 触点添加一个并联功能块分支".',
    'Do not use vague wording like "给 c 触点添加触点" because it does not say before, after, or parallel.',
    'For parallel suggestions, clearly say whether the parallel element is a contact, negatedContact, functionBlock, coil, or another explicit element.',
    'Do not suggest graph edits far away from the selected node unless IEC 61131 topology makes that the nearest legal output position.',
    'For every suggestion, only say the legal adjacent placement and what exact graph element should be added.',
    'Do not return vague element descriptions like just "contact".',
    'Every suggestion must include addElement with an exact nodeType, displayLabel, variableSource, variableName, dataType, and userInputRequired flag.',
    'If the variable name cannot be inferred with confidence, set variableSource to "userInput", variableName to an empty string, and userInputRequired to true.',
    'For function blocks, choose one concrete IEC function block type such as TON, TOF, TP, CTU, CTD, CTUD, SR, or RS. Include it in addElement.blockType, addElement.displayLabel, addElement.dataType, and placement.text. Do not say only "function block" or only "功能块".',
    'For function blocks, include instanceSource. If the instance is unknown, set instanceSource to "userInput".',
    'The matchedNodeId and every non-empty placement node id must be ids from the realSelectableNodes list.',
    'Allowed suggestion node types: contact, negatedContact, risingContact, fallingContact, coil, setCoil, resetCoil, functionBlock, branch.',
  ].join('\n');

  const outputSchema = {
    schemaVersion: 'ide-agent.graph-completion.v1',
    action: 'suggestGraphCompletions | noSuggestion',
    segmentId: 'segment id from diagram summary',
    confidence: 0.0,
    recognizedFocus: {
      visualElement: 'real selected element inside the red dashed box, such as d contact',
      matchedNodeId: 'node id from diagram summary, or empty string',
      matchedNodeType: 'contact | coil | FBDCompartment | ...',
      matchedVar: 'variable name, or empty string',
      confidence: 0.0,
    },
    suggestions: [
      {
        id: 'option-1',
        mode: 'seriesAfter | parallelBranch | functionBlockAfter | outputCoil | other',
        confidence: 0.0,
        placement: {
          relationToFocus: 'beforeSelected | afterSelected | parallelWithSelected | branchAroundSelected | attachToInputPort | attachToOutputPort | nearRungOutput',
          anchorNodeId: 'must equal recognizedFocus.matchedNodeId',
          anchorNodeVar: 'must equal recognizedFocus.matchedVar when available',
          insertAfterNodeId: 'node after which the new element is inserted, or empty string',
          insertBeforeNodeId: 'node before which the new element is inserted, or empty string',
          parallelToNodeId: 'required only when relationToFocus is parallelWithSelected or branchAroundSelected',
          branchFromNodeId: 'optional branch start node id, or empty string',
          branchToNodeId: 'optional branch merge/end node id, or empty string',
          portName: 'optional function block port name, or empty string',
          text: 'short Chinese text that explicitly says before/after/parallel/branch/port location',
        },
        addElement: {
          nodeType: 'contact | negatedContact | risingContact | fallingContact | coil | setCoil | resetCoil | functionBlock',
          displayLabel: '常开触点 | 常闭触点 | 上升沿触点 | 下降沿触点 | 线圈 | 置位线圈 | 复位线圈 | 功能块',
          variableSource: 'existingVariable | inferredNewVariable | userInput',
          variableName: 'exact variable name, or empty string when userInputRequired is true',
          dataType: 'BOOL | INT | TIME | function block type | empty if unknown',
          userInputRequired: true,
          blockType: 'TON | CTD | RS | empty unless nodeType is functionBlock',
          instanceSource: 'existingInstance | inferredNewInstance | userInput | empty unless nodeType is functionBlock',
          instanceName: 'function block instance name, or empty string',
        },
      },
    ],
  };

  const userPrompt = [
    `File: ${fileName}`,
    `Cursor: line ${cursor.line}, column ${cursor.character}`,
    '',
    'Current generated ST code:',
    '<ST_CODE>',
    stCode,
    '</ST_CODE>',
    '',
    'Compressed frontend diagram topology:',
    '<DIAGRAM_SUMMARY_JSON>',
    JSON.stringify(compactDiagram, null, 2),
    '</DIAGRAM_SUMMARY_JSON>',
    '',
    screenshot
      ? `A LD/FBD screenshot is attached. The red dashed box marks the selected real node. Identify the actual element inside that box, not an internal placeholder name. Screenshot path: ${screenshot.path}`
      : 'No screenshot is attached. Use ST code and diagram topology only.',
    '',
    'Required output JSON shape:',
    JSON.stringify(outputSchema, null, 2),
    '',
    'Return only JSON. Do not include duplicate or legacy fields named suggestion, reason, explanation, preview, connections, frontendHint, afterNodeId, afterNodeVar, addNodeType, addNodeTypeLabel, addBlockType, newElement, insertBeforeNodeId, parallelToNodeId, branchFromNodeId, branchToNodeId, or parallelElement at suggestions[] top level.',
  ].join('\n');

  const userContent: LLMMessage['content'] = screenshot
    ? [
        {
          type: 'text',
          text: userPrompt,
        },
        {
          type: 'image_url',
          image_url: {
            url: screenshot.dataUrl,
          },
        },
      ]
    : userPrompt;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
}

function compactForPrompt(summary: DiagramSummary, omitInsertionPoints: boolean): unknown {
  return {
    sourcePath: summary.sourcePath,
    pouName: summary.pouName,
    pouType: summary.pouType,
    variables: summary.variables,
    segments: summary.segments.map((segment) => ({
      segmentId: segment.segmentId,
      graphState: analyzeSegment(segment),
      size: {
        width: segment.width,
        height: segment.height,
      },
      insertionPoints: omitInsertionPoints
        ? []
        : segment.insertionPoints.map((point) => ({
            ...point,
            fromDisplayNames: point.from.map((nodeId) => neighborDisplayText(segment, [nodeId], 'backward')).filter(Boolean),
            toDisplayNames: point.to.map((nodeId) => neighborDisplayText(segment, [nodeId], 'forward')).filter(Boolean),
          })),
      realSelectableNodes: filterSelectableNodes(segment.nodes).map((node) => ({
        id: node.id,
        kind: node.kind,
        displayName: nodeLabel(segment, node),
        typeLabel: elementKindLabel(node.kind),
        var: node.var,
        dataType: node.dataType,
        blockType: node.blockType,
        instance: node.instance,
        inputs: node.inputs,
        outputs: node.outputs,
        from: node.from,
        to: node.to,
        neighbors: {
          left: neighborDisplayText(segment, node.from, 'backward'),
          right: neighborDisplayText(segment, node.to, 'forward'),
        },
      })),
      edges: segment.edges.filter((edge) => isSelectableNodeId(edge.from, segment.nodes) && isSelectableNodeId(edge.to, segment.nodes)),
    })),
  };
}

function filterSelectableNodes(nodes: DiagramNodeSummary[]): DiagramNodeSummary[] {
  return nodes.filter((node) => isRealGraphElementKind(node.kind));
}

function isSelectableNodeId(nodeId: string, nodes: DiagramNodeSummary[]): boolean {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) {
    return false;
  }

  return isRealGraphElementKind(node.kind);
}

function isRealGraphElementKind(kind: string): boolean {
  return [
    'contact',
    'negatedContact',
    'risingContact',
    'fallingContact',
    'coil',
    'setCoil',
    'resetCoil',
    'FBDCompartment',
  ].includes(kind);
}

function analyzeSegment(segment: DiagramSegmentSummary): Record<string, boolean> {
  const hasLogicNode = segment.nodes.some((node) => isContactKind(node.kind) || node.kind === 'FBDCompartment');
  const hasOutputNode = segment.nodes.some((node) => isOutputNodeKind(node.kind));

  return {
    hasLogicNode,
    hasOutputNode,
    isPartialGraph: hasLogicNode && !hasOutputNode,
  };
}

function findNode(segment: DiagramSegmentSummary, nodeId: string): DiagramNodeSummary | undefined {
  return segment.nodes.find((node) => node.id === nodeId);
}

function findNodeById(summary: DiagramSummary, nodeId: string): DiagramNodeSummary | undefined {
  for (const segment of summary.segments) {
    const node = findNode(segment, nodeId);
    if (node) {
      return node;
    }
  }

  return undefined;
}

function findSegmentByNodeId(summary: DiagramSummary, nodeId: string): DiagramSegmentSummary | undefined {
  return summary.segments.find((segment) => Boolean(findNode(segment, nodeId)));
}

function findSegmentByAnyNodeId(summary: DiagramSummary, nodeIds: string[]): DiagramSegmentSummary | undefined {
  return summary.segments.find((segment) => nodeIds.some((nodeId) => Boolean(nodeId && findNode(segment, nodeId))));
}

function neighborDisplayText(segment: DiagramSegmentSummary, nodeIds: string[] | undefined, direction: 'forward' | 'backward'): string {
  const labels = (nodeIds ?? [])
    .map((nodeId) => findNearestDisplayNode(segment, nodeId, direction))
    .filter((node): node is DiagramNodeSummary => Boolean(node))
    .map((node) => nodeLabel(segment, node));

  return [...new Set(labels)].join(' / ');
}

function findNearestDisplayNode(
  segment: DiagramSegmentSummary,
  nodeId: string,
  direction: 'forward' | 'backward'
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

    queue.push(...(direction === 'forward' ? node.to : node.from));
  }

  return undefined;
}

function nodeLabel(segment: DiagramSegmentSummary, node: DiagramNodeSummary): string {
  if (node.kind === 'FBDCompartment') {
    const instance = displayNodeName(segment, node);
    return instance ? `${node.blockType || '功能块'} ${instance} 功能块` : `${node.blockType || '功能块'} 功能块`;
  }

  if (isCoilKind(node.kind)) {
    return `${displayNodeName(segment, node)} ${elementKindLabel(node.kind)}`;
  }

  if (isContactKind(node.kind)) {
    return `${displayNodeName(segment, node)} ${elementKindLabel(node.kind)}`;
  }

  return displayNodeName(segment, node);
}

function displayNodeName(segment: DiagramSegmentSummary, node: DiagramNodeSummary): string {
  const rawName = (node.var || node.instance || '').trim();
  if (rawName && !isUnnamedPlaceholder(rawName)) {
    return rawName;
  }

  const index = unnamedNodeIndex(segment, node);
  const displayName = index > 0 ? `未命名${index}` : '未命名';
  return `${displayName}(${node.id})`;
}

function unnamedNodeIndex(segment: DiagramSegmentSummary, targetNode: DiagramNodeSummary): number {
  const unnamedNodes = segment.nodes
    .filter((node) => isRealGraphElementKind(node.kind))
    .filter((node) => isUnnamedPlaceholder(node.var || node.instance || ''))
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

function elementKindLabel(kind: string): string {
  switch (kind) {
    case 'contact':
      return '常开触点';
    case 'negatedContact':
      return '常闭触点';
    case 'risingContact':
      return '上升沿';
    case 'fallingContact':
      return '下降沿';
    case 'coil':
      return '线圈';
    case 'setCoil':
      return '置位线圈';
    case 'resetCoil':
      return '复位线圈';
    case 'functionBlock':
    case 'FBDCompartment':
      return '功能块';
    default:
      return kind;
  }
}

function normalizeElementDisplayLabel(nodeType: string, fallback: string): string {
  const label = elementKindLabel(nodeType);
  return label && label !== nodeType ? label : fallback;
}

function isContactKind(kind: string): boolean {
  return ['contact', 'negatedContact', 'risingContact', 'fallingContact'].includes(kind);
}

function isCoilKind(kind: string): boolean {
  return ['coil', 'setCoil', 'resetCoil'].includes(kind);
}

function isOutputNodeKind(kind: string): boolean {
  return isCoilKind(kind) || kind === 'FBDCompartment';
}

function isOutputSuggestion(nodeType: string): boolean {
  return isCoilKind(nodeType) || nodeType === 'functionBlock' || nodeType === 'FBDCompartment';
}

function hasDownstreamOutputNode(segment: DiagramSegmentSummary, startNodeId: string): boolean {
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

function normalizeMaybePlaceholder(value: string): string {
  return isUnnamedPlaceholder(value) ? '' : value;
}

function isUnnamedPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  return !trimmed || trimmed === '???';
}

function replaceAll(value: string, search: string, replacement: string): string {
  return search ? value.split(search).join(replacement) : value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractJsonText(rawText: string): string {
  const withoutFence = rawText
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return '';
  }

  const jsonText = withoutFence.slice(firstBrace, lastBrace + 1);

  try {
    JSON.parse(jsonText);
    return JSON.stringify(JSON.parse(jsonText), null, 2);
  } catch {
    return jsonText;
  }
}

function normalizeGraphPredictionJson(
  jsonText: string,
  summary: DiagramSummary,
  log?: (message: string) => void
): string {
  if (!jsonText) {
    return '';
  }

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const rawSuggestions = getSuggestions(parsed);
    const normalizedFocus = normalizeRecognizedFocus(asRecord(parsed.recognizedFocus), summary);
    const normalizedSuggestions = rawSuggestions
      .map((suggestion, index) => normalizeSuggestion(suggestion, index, summary, normalizedFocus))
      .filter((suggestion) => !isInvalidGraphSuggestion(suggestion, summary, log));

    const normalized = {
      schemaVersion: asString(parsed.schemaVersion) || 'ide-agent.graph-completion.v1',
      action: asString(parsed.action) || (normalizedSuggestions.length ? 'suggestGraphCompletions' : 'noSuggestion'),
      segmentId: asString(parsed.segmentId),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      recognizedFocus: normalizedFocus,
      suggestions: normalizedSuggestions,
    };

    return JSON.stringify(normalized, null, 2);
  } catch {
    return jsonText;
  }
}

function normalizeSuggestion(
  suggestion: Record<string, unknown>,
  index: number,
  summary: DiagramSummary,
  focus: Record<string, unknown>
): Record<string, unknown> {
  const addElement = normalizeAddElement(suggestion);
  const placement = normalizePlacement(suggestion, summary, focus, addElement);

  return {
    id: asString(suggestion.id) || `option-${index + 1}`,
    mode: asString(suggestion.mode) || inferSuggestionMode(placement),
    confidence: typeof suggestion.confidence === 'number' ? suggestion.confidence : 0,
    placement,
    addElement,
  };
}

function normalizePlacement(
  suggestion: Record<string, unknown>,
  summary: DiagramSummary,
  focus: Record<string, unknown>,
  addElement: Record<string, unknown>
): Record<string, unknown> {
  const placement = asRecord(suggestion.placement) || {};
  const anchorNodeId = asString(placement.anchorNodeId) || asString(suggestion.anchorNodeId) || asString(focus.matchedNodeId);
  const anchorNode = findNodeById(summary, anchorNodeId);
  const rawInsertAfterNodeId = asString(placement.insertAfterNodeId) || asString(suggestion.afterNodeId);
  const rawInsertBeforeNodeId = asString(placement.insertBeforeNodeId) || asString(suggestion.insertBeforeNodeId);
  const rawParallelToNodeId = asString(placement.parallelToNodeId) || asString(suggestion.parallelToNodeId);
  const segment = anchorNode ? findSegmentByNodeId(summary, anchorNode.id) : findSegmentByAnyNodeId(summary, [
    rawInsertAfterNodeId,
    rawInsertBeforeNodeId,
    rawParallelToNodeId,
  ]);
  const insertAfterNodeId = normalizePlacementNodeId(segment, rawInsertAfterNodeId, 'backward');
  const insertBeforeNodeId = normalizePlacementNodeId(segment, rawInsertBeforeNodeId, 'forward');
  const parallelToNodeId = normalizePlacementNodeId(segment, rawParallelToNodeId, 'forward');
  const text = withFunctionBlockType(
    cleanPlacementText(
    asString(placement.text) || asString(placement.positionText) || asString(suggestion.frontendHint),
    summary,
    segment,
    ),
    asString(addElement.nodeType),
    asString(addElement.blockType),
  );

  return {
    relationToFocus: asString(placement.relationToFocus) || inferRelationToFocus(suggestion),
    anchorNodeId,
    anchorNodeVar: normalizeMaybePlaceholder(asString(placement.anchorNodeVar) || asString(suggestion.anchorNodeVar)),
    insertAfterNodeId,
    insertBeforeNodeId,
    parallelToNodeId,
    branchFromNodeId: normalizePlacementNodeId(segment, asString(placement.branchFromNodeId) || asString(suggestion.branchFromNodeId), 'backward'),
    branchToNodeId: normalizePlacementNodeId(segment, asString(placement.branchToNodeId) || asString(suggestion.branchToNodeId), 'forward'),
    portName: asString(placement.portName),
    text: text || inferPlacementText(summary, segment, {
      relationToFocus: asString(placement.relationToFocus) || inferRelationToFocus(suggestion),
      anchorNodeId,
      insertAfterNodeId,
      insertBeforeNodeId,
      parallelToNodeId,
      addElement,
    }),
  };
}

function normalizeAddElement(suggestion: Record<string, unknown>): Record<string, unknown> {
  const addElement = asRecord(suggestion.addElement)
    || asRecord(suggestion.newElement)
    || asRecord(asRecord(suggestion.parallelElement)?.newElement)
    || {};
  const parallelElement = asRecord(suggestion.parallelElement);
  const nodeType = asString(addElement.nodeType) || asString(suggestion.addNodeType) || asString(parallelElement?.addNodeType);
  const rawBlockType = asString(addElement.blockType) || asString(suggestion.addBlockType) || asString(parallelElement?.addBlockType);
  const blockType = isSuggestedFunctionBlock(nodeType)
    ? normalizeFunctionBlockType(rawBlockType) || inferFunctionBlockType(suggestion) || pickFunctionBlockType()
    : rawBlockType;

  return {
    nodeType,
    displayLabel: isSuggestedFunctionBlock(nodeType)
      ? functionBlockDisplayLabel(blockType)
      : normalizeElementDisplayLabel(
      nodeType,
      asString(addElement.displayLabel) || asString(suggestion.addNodeTypeLabel) || asString(parallelElement?.addNodeTypeLabel),
    ),
    variableSource: asString(addElement.variableSource) || 'userInput',
    variableName: normalizeMaybePlaceholder(asString(addElement.variableName)),
    dataType: asString(addElement.dataType) || (isSuggestedFunctionBlock(nodeType) ? blockType : ''),
    userInputRequired: typeof addElement.userInputRequired === 'boolean' ? addElement.userInputRequired : true,
    blockType,
    instanceSource: asString(addElement.instanceSource) || (isSuggestedFunctionBlock(nodeType) ? 'userInput' : ''),
    instanceName: asString(addElement.instanceName),
  };
}

function isSuggestedFunctionBlock(nodeType: string): boolean {
  return nodeType === 'functionBlock' || nodeType === 'FBDCompartment';
}

function functionBlockDisplayLabel(blockType: string): string {
  return blockType ? `${blockType} 功能块` : '功能块';
}

function normalizeFunctionBlockType(blockType: string): string {
  const upper = blockType.trim().toUpperCase();
  return COMMON_FUNCTION_BLOCK_TYPES.find((type) => type === upper) ?? '';
}

function inferFunctionBlockType(suggestion: Record<string, unknown>): string {
  const text = JSON.stringify(suggestion).toUpperCase();
  return COMMON_FUNCTION_BLOCK_TYPES.find((type) => new RegExp(`(^|\\W)${type}(\\W|$)`).test(text)) ?? '';
}

function pickFunctionBlockType(): string {
  const index = Math.floor(Math.random() * COMMON_FUNCTION_BLOCK_TYPES.length);
  return COMMON_FUNCTION_BLOCK_TYPES[index] ?? 'TON';
}

function withFunctionBlockType(text: string, nodeType: string, blockType: string): string {
  if (!text || !isSuggestedFunctionBlock(nodeType) || !blockType) {
    return text;
  }

  if (COMMON_FUNCTION_BLOCK_TYPES.some((type) => text.includes(type))) {
    return text;
  }

  return text.replace(/功能块/g, `${blockType} 功能块`);
}

function inferSuggestionMode(placement: Record<string, unknown>): string {
  const relation = asString(placement.relationToFocus);
  if (relation === 'parallelWithSelected' || relation === 'branchAroundSelected') {
    return 'parallelBranch';
  }
  if (relation === 'attachToInputPort' || relation === 'attachToOutputPort') {
    return 'functionBlockPort';
  }
  if (relation === 'nearRungOutput') {
    return 'outputCoil';
  }

  return 'seriesAfter';
}

function inferRelationToFocus(suggestion: Record<string, unknown>): string {
  const mode = asString(suggestion.mode);
  if (mode === 'parallelBranch') {
    return 'parallelWithSelected';
  }
  if (mode === 'outputCoil') {
    return 'nearRungOutput';
  }
  if (asString(suggestion.insertBeforeNodeId)) {
    return 'beforeSelected';
  }

  return 'afterSelected';
}

function normalizeRecognizedFocus(
  focus: Record<string, unknown> | undefined,
  summary: DiagramSummary
): Record<string, unknown> {
  const matchedNodeId = asString(focus?.matchedNodeId);
  const node = findNodeById(summary, matchedNodeId) || inferFocusNodeFromText(summary, [
    asString(focus?.visualElement),
    asString(focus?.matchedNodeType),
    asString(focus?.matchedVar),
  ]);
  const segment = node ? findSegmentByNodeId(summary, node.id) : undefined;

  return {
    visualElement: node && segment ? nodeLabel(segment, node) : cleanPlacementText(asString(focus?.visualElement), summary, segment),
    matchedNodeId: node?.id ?? matchedNodeId,
    matchedNodeType: node?.kind ?? asString(focus?.matchedNodeType),
    matchedVar: normalizeMaybePlaceholder(node?.var ?? node?.instance ?? asString(focus?.matchedVar)),
    confidence: typeof focus?.confidence === 'number' ? focus.confidence : 0,
  };
}

function inferFocusNodeFromText(
  summary: DiagramSummary,
  values: string[],
): DiagramNodeSummary | undefined {
  const text = values.filter(Boolean).join(' ').toLowerCase();
  if (!text) {
    return undefined;
  }

  const realNodes = summary.segments.flatMap((segment) =>
    segment.nodes.filter((node) => isRealGraphElementKind(node.kind)),
  );

  const exactNamed = realNodes.find((node) =>
    [node.var, node.instance]
      .map((value) => value?.toLowerCase())
      .some((value) => Boolean(value && new RegExp(`(^|\\W)${escapeRegExp(value)}(\\W|$)`).test(text))),
  );
  if (exactNamed) {
    return exactNamed;
  }

  const blockTypeMatches = realNodes.filter((node) =>
    node.kind === 'FBDCompartment' &&
    Boolean(node.blockType && new RegExp(`(^|\\W)${escapeRegExp(node.blockType.toLowerCase())}(\\W|$)`).test(text)),
  );
  if (blockTypeMatches.length === 1) {
    return blockTypeMatches[0];
  }

  const kindMatches = realNodes.filter((node) =>
    elementKindLabel(node.kind).toLowerCase() &&
    text.includes(elementKindLabel(node.kind).toLowerCase()),
  );
  return kindMatches.length === 1 ? kindMatches[0] : undefined;
}

function isInvalidGraphSuggestion(
  suggestion: Record<string, unknown>,
  summary: DiagramSummary,
  log?: (message: string) => void
): boolean {
  const placement = asRecord(suggestion.placement) || {};
  const ids = [
    asString(placement.anchorNodeId),
    asString(placement.insertAfterNodeId),
    asString(placement.insertBeforeNodeId),
    asString(placement.parallelToNodeId),
    asString(placement.branchFromNodeId),
    asString(placement.branchToNodeId),
  ].filter(Boolean);

  if (ids.some((id) => isInternalGraphNodeId(id))) {
    log?.(`graph post-process removed suggestion with internal node id: ${ids.join(',')}`);
    return true;
  }

  const addElement = asRecord(suggestion.addElement) || {};
  const addNodeType = asString(addElement.nodeType);
  const afterNodeId = asString(placement.insertAfterNodeId) || asString(placement.anchorNodeId);
  const segment = findSegmentByAnyNodeId(summary, ids);
  if (segment && isOutputSuggestion(addNodeType) && afterNodeId && hasDownstreamOutputNode(segment, afterNodeId)) {
    log?.(`graph post-process removed output suggestion because downstream already has output node after=${afterNodeId}`);
    return true;
  }

  return false;
}

function inferPlacementText(
  summary: DiagramSummary,
  segment: DiagramSegmentSummary | undefined,
  input: {
    relationToFocus: string;
    anchorNodeId: string;
    insertAfterNodeId: string;
    insertBeforeNodeId: string;
    parallelToNodeId: string;
    addElement: Record<string, unknown>;
  },
): string {
  const resolvedSegment = segment || findSegmentByAnyNodeId(summary, [
    input.anchorNodeId,
    input.insertAfterNodeId,
    input.insertBeforeNodeId,
    input.parallelToNodeId,
  ]);
  const elementLabel = normalizeElementDisplayLabel(asString(input.addElement.nodeType), asString(input.addElement.displayLabel)) || '节点';
  if (!resolvedSegment) {
    return `添加一个${elementLabel}`;
  }

  const anchor = findNode(resolvedSegment, input.anchorNodeId);
  const after = findNode(resolvedSegment, input.insertAfterNodeId);
  const before = findNode(resolvedSegment, input.insertBeforeNodeId);
  const parallel = findNode(resolvedSegment, input.parallelToNodeId);

  if (input.relationToFocus === 'parallelWithSelected' || input.relationToFocus === 'branchAroundSelected') {
    const target = parallel || anchor;
    return target ? `与${nodeLabel(resolvedSegment, target)}并联一个${elementLabel}` : `并联一个${elementLabel}`;
  }

  if (after && before) {
    return `在${nodeLabel(resolvedSegment, after)}和${nodeLabel(resolvedSegment, before)}之间插入一个${elementLabel}`;
  }

  if (after) {
    return `在${nodeLabel(resolvedSegment, after)}后添加一个${elementLabel}`;
  }

  if (before) {
    return `在${nodeLabel(resolvedSegment, before)}前添加一个${elementLabel}`;
  }

  if (anchor) {
    return `在${nodeLabel(resolvedSegment, anchor)}附近添加一个${elementLabel}`;
  }

  return `添加一个${elementLabel}`;
}

function cleanPlacementText(
  text: string,
  summary: DiagramSummary,
  segment?: DiagramSegmentSummary,
): string {
  let result = text;
  if (!result) {
    return '';
  }

  const segments = segment ? [segment] : summary.segments;
  for (const item of segments) {
    for (const node of item.nodes) {
      const label = nodeLabel(item, node);
      result = replaceAll(result, node.id, label);
      const rawName = node.var || node.instance || '';
      if (isUnnamedPlaceholder(rawName)) {
        result = result.replace(/\?\?\?/g, displayNodeName(item, node));
      }
    }
  }

  result = result
    .replace(/\bedit-node-rect\b/gi, '当前位置')
    .replace(/\bstart-node-line\b/gi, '起点')
    .replace(/\bend-node-line-[\w-]*\b/gi, '末尾')
    .replace(/\beditRect\b/gi, '当前位置')
    .replace(/\bbranchRect\b/gi, '分支位置')
    .replace(/\bstartLine\b/gi, '起点')
    .replace(/\bendLine\b/gi, '末尾');

  return result.trim();
}

function normalizePlacementNodeId(
  segment: DiagramSegmentSummary | undefined,
  nodeId: string,
  direction: 'forward' | 'backward'
): string {
  if (!nodeId || !segment) {
    return nodeId;
  }

  const node = findNode(segment, nodeId);
  if (!node || isRealGraphElementKind(node.kind)) {
    return nodeId;
  }

  const nearest = findNearestDisplayNode(segment, nodeId, direction);
  return nearest?.id ?? '';
}

function logGraphPredictionSummary(jsonText: string, log: (message: string) => void): void {
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const focus = asRecord(parsed.recognizedFocus);
    const suggestion = asRecord(parsed.suggestion);
    const focusText = [
      `visual=${asString(focus?.visualElement) || '(unknown)'}`,
      `nodeId=${asString(focus?.matchedNodeId) || '(unknown)'}`,
      `nodeType=${asString(focus?.matchedNodeType) || '(unknown)'}`,
      `var=${asString(focus?.matchedVar) || '(unknown)'}`,
      `confidence=${formatConfidence(focus?.confidence)}`,
    ].join(' ');
    const suggestions = getSuggestions(parsed);
    const focusNodeId = asString(focus?.matchedNodeId);

    log(`AI recognized graph focus: ${focusText}`);
    log(`AI graph suggestions count=${suggestions.length}`);
    suggestions.forEach((suggestion, index) => {
      const suggestionText = [
        `#${index + 1}`,
        `mode=${asString(suggestion.mode) || '(unknown)'}`,
        `placement=${formatPlacement(suggestion.placement)}`,
        `addElement=${formatAddElement(getSuggestionAddElement(suggestion))}`,
        `confidence=${formatConfidence(suggestion.confidence)}`,
      ].join(' ');
      log(`AI graph suggestion: ${suggestionText}`);
      const warning = getSuggestionFocusWarning(focusNodeId, suggestion);
      if (warning) {
        log(`AI graph warning: suggestion #${index + 1} ${warning}`);
      }
      const elementWarning = getAddElementWarning(suggestion);
      if (elementWarning) {
        log(`AI graph warning: suggestion #${index + 1} ${elementWarning}`);
      }
      const placementWarning = getPlacementWarning(suggestion);
      if (placementWarning) {
        log(`AI graph warning: suggestion #${index + 1} ${placementWarning}`);
      }
    });
    if (isInternalGraphNodeKind(asString(focus?.matchedNodeType)) || isInternalGraphNodeId(asString(focus?.matchedNodeId))) {
      log('AI graph warning: recognized focus is an internal/placeholder node; result should be ignored or retried with a tighter screenshot crop.');
    }
  } catch (error) {
    log(`AI graph summary parse failed: ${formatUnknownError(error)}`);
  }
}

function getSuggestions(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const suggestions = parsed.suggestions;
  if (Array.isArray(suggestions)) {
    return suggestions
      .map(asRecord)
      .filter((item): item is Record<string, unknown> => Boolean(item));
  }

  const legacySuggestion = asRecord(parsed.suggestion);
  return legacySuggestion ? [legacySuggestion] : [];
}

function getSuggestionFocusWarning(focusNodeId: string, suggestion: Record<string, unknown>): string {
  if (!focusNodeId) {
    return '';
  }

  const mode = asString(suggestion.mode);
  const placement = asRecord(suggestion.placement);
  const anchorNodeId = asString(placement?.anchorNodeId) || asString(suggestion.anchorNodeId);
  const insertAfterNodeId = asString(placement?.insertAfterNodeId) || asString(suggestion.afterNodeId);
  const relationToFocus = asString(placement?.relationToFocus);
  const parallelToNodeId = asString(placement?.parallelToNodeId) || asString(suggestion.parallelToNodeId);

  if (anchorNodeId && anchorNodeId !== focusNodeId) {
    return `anchorNodeId=${anchorNodeId} does not match recognized focus ${focusNodeId}`;
  }

  if (mode === 'parallelBranch' || relationToFocus === 'parallelWithSelected' || relationToFocus === 'branchAroundSelected') {
    if (parallelToNodeId && parallelToNodeId !== focusNodeId) {
      return `parallelToNodeId=${parallelToNodeId} does not match recognized focus ${focusNodeId}`;
    }
    return '';
  }

  if (relationToFocus === 'afterSelected' && insertAfterNodeId && insertAfterNodeId !== focusNodeId) {
    return `placement.insertAfterNodeId=${insertAfterNodeId} does not match recognized focus ${focusNodeId}`;
  }

  return '';
}

function formatAddElement(value: unknown): string {
  const element = asRecord(value);
  if (!element) {
    return '(missing)';
  }

  return [
    asString(element.nodeType) || 'unknown',
    asString(element.displayLabel) || 'unknown',
    `var=${asString(element.variableName) || '(empty)'}`,
    `varSource=${asString(element.variableSource) || '(unknown)'}`,
    `input=${String(Boolean(element.userInputRequired))}`,
    `block=${asString(element.blockType) || '(none)'}`,
  ].join('/');
}

function getSuggestionAddElement(suggestion: Record<string, unknown>): Record<string, unknown> | undefined {
  return asRecord(suggestion.addElement) || asRecord(suggestion.newElement);
}

function getAddElementWarning(suggestion: Record<string, unknown>): string {
  const element = getSuggestionAddElement(suggestion);
  if (!element) {
    return 'addElement is missing; suggestion may be too vague for frontend rendering';
  }

  const nodeType = asString(element.nodeType);
  const displayLabel = asString(element.displayLabel);
  const variableSource = asString(element.variableSource);
  const userInputRequired = Boolean(element.userInputRequired);
  const variableName = asString(element.variableName);

  if (!nodeType || !displayLabel) {
    return 'addElement.nodeType/displayLabel is missing';
  }

  if (!variableSource) {
    return 'addElement.variableSource is missing';
  }

  if (!userInputRequired && !variableName && nodeType !== 'functionBlock') {
    return 'addElement.variableName is empty but userInputRequired is false';
  }

  if (nodeType === 'functionBlock' && !asString(element.blockType)) {
    return 'addElement.blockType is missing for functionBlock';
  }

  return '';
}

function formatPlacement(value: unknown): string {
  const placement = asRecord(value);
  if (!placement) {
    return '(missing)';
  }

  return [
    asString(placement.relationToFocus) || 'unknown',
    `after=${asString(placement.insertAfterNodeId) || '(none)'}`,
    `before=${asString(placement.insertBeforeNodeId) || '(none)'}`,
    `parallelTo=${asString(placement.parallelToNodeId) || '(none)'}`,
    `text=${asString(placement.text) || asString(placement.positionText) || '(empty)'}`,
  ].join('/');
}

function getPlacementWarning(suggestion: Record<string, unknown>): string {
  const placement = asRecord(suggestion.placement);
  if (!placement) {
    return 'placement is missing; suggestion does not say before/after/parallel location clearly';
  }

  const relation = asString(placement.relationToFocus);
  const positionText = asString(placement.text) || asString(placement.positionText);

  if (!relation) {
    return 'placement.relationToFocus is missing';
  }

  if (!positionText) {
    return 'placement.text is missing';
  }

  if (!/(前|后|并联|分支|端口|输入|输出)/.test(positionText)) {
    return `placement.text is vague: ${positionText}`;
  }

  return '';
}

function isInternalGraphNodeKind(kind: string): boolean {
  return ['editRect', 'branchRect', 'startLine', 'endLine'].includes(kind);
}

function isInternalGraphNodeId(nodeId: string): boolean {
  return /(^edit-node-rect$|^start-node-line$|^end-node-line|branch)/i.test(nodeId);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function formatConfidence(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '(unknown)';
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

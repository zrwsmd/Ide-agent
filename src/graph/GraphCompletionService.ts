import * as vscode from 'vscode';
import { DEFAULT_DIAGRAM_JSON_PATH, DiagramNodeSummary, DiagramSummary, loadDiagramSummary } from '../diagram/DiagramSummary';
import { LLMAdapter, LLMMessage } from '../llm/types';
import { loadLastScreenshot, pickScreenshot, ScreenshotContext } from './ScreenshotContext';

type LLMAdapterGetter = () => Promise<LLMAdapter | null>;

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

    const jsonText = extractJsonText(rawText);
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
    'Every suggestion must be centered on recognizedFocus.matchedNodeId.',
    'Set suggestions[].anchorNodeId equal to recognizedFocus.matchedNodeId.',
    'For seriesAfter, functionBlockAfter, and outputCoil suggestions, set afterNodeId equal to recognizedFocus.matchedNodeId.',
    'For parallelBranch suggestions, set parallelToNodeId equal to recognizedFocus.matchedNodeId and clearly describe the element placed in parallel.',
    'Parallel suggestions must say whether the parallel element is a contact, negatedContact, functionBlock, coil, or another explicit element.',
    'Do not suggest graph edits far away from the selected node.',
    'Suggestions may include adding a node in series after the selected node, adding a parallel branch around it, adding a function block after it, or adding an output coil where valid.',
    'For every suggestion, only say where it applies and what type of graph node/structure should be added.',
    'Do not return vague element descriptions like just "contact".',
    'Every suggestion must include newElement with an exact nodeType, displayLabel, variableSource, variableName, dataType, and userInputRequired flag.',
    'If the variable name cannot be inferred with confidence, set variableSource to "userInput", variableName to an empty string, and userInputRequired to true.',
    'For function blocks, include blockType and instanceSource. If the instance is unknown, set instanceSource to "userInput".',
    'The matchedNodeId, anchorNodeId, afterNodeId, parallelToNodeId, branchFromNodeId, branchToNodeId, and insertBeforeNodeId must be ids from the realSelectableNodes list only when non-empty.',
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
        anchorNodeId: 'must equal recognizedFocus.matchedNodeId',
        anchorNodeVar: 'must equal recognizedFocus.matchedVar when available',
        afterNodeId: 'existing node id after which the frontend should preview insertion',
        afterNodeVar: 'variable of the after node, or empty string',
        addNodeType: 'contact | coil | functionBlock | branch | ...',
        addNodeTypeLabel: '触点 | 线圈 | 功能块 | 分支',
        addBlockType: 'TON | CTD | RS | empty unless addNodeType is functionBlock',
        newElement: {
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
        insertBeforeNodeId: 'optional next existing node id, or empty string',
        parallelToNodeId: 'required only for parallelBranch; must equal recognizedFocus.matchedNodeId',
        branchFromNodeId: 'optional branch start node id for parallel suggestions, or empty string',
        branchToNodeId: 'optional branch merge/end node id for parallel suggestions, or empty string',
        parallelElement: {
          addNodeType: 'contact | negatedContact | functionBlock | coil | ...',
          addNodeTypeLabel: '触点 | 常闭触点 | 功能块 | 线圈 | ...',
          addBlockType: 'TON | CTD | RS | empty unless addNodeType is functionBlock',
          newElement: 'same structure as suggestions[].newElement',
        },
        confidence: 0.0,
        frontendHint: 'short Chinese sentence, for example: 在 d 触点后串联一个触点 or 给 d 触点并联一个功能块',
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
    'Return only JSON. Keep each suggestions[].frontendHint short. Do not include fields named reason, explanation, preview, or connections.',
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
      size: {
        width: segment.width,
        height: segment.height,
      },
      insertionPoints: omitInsertionPoints ? [] : segment.insertionPoints,
      realSelectableNodes: filterSelectableNodes(segment.nodes, omitInsertionPoints).map((node) => ({
        id: node.id,
        kind: node.kind,
        var: node.var,
        dataType: node.dataType,
        blockType: node.blockType,
        instance: node.instance,
        inputs: node.inputs,
        outputs: node.outputs,
        from: node.from,
        to: node.to,
      })),
      edges: segment.edges.filter((edge) => isSelectableNodeId(edge.from, segment.nodes, omitInsertionPoints) && isSelectableNodeId(edge.to, segment.nodes, omitInsertionPoints)),
    })),
  };
}

function filterSelectableNodes(nodes: DiagramNodeSummary[], strictRealOnly: boolean): DiagramNodeSummary[] {
  if (!strictRealOnly) {
    return nodes;
  }

  return nodes.filter((node) => isRealGraphElementKind(node.kind));
}

function isSelectableNodeId(nodeId: string, nodes: DiagramNodeSummary[], strictRealOnly: boolean): boolean {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) {
    return false;
  }

  return !strictRealOnly || isRealGraphElementKind(node.kind);
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
        `anchorNodeId=${asString(suggestion.anchorNodeId) || '(unknown)'}`,
        `anchorNodeVar=${asString(suggestion.anchorNodeVar) || '(unknown)'}`,
        `afterNodeId=${asString(suggestion.afterNodeId) || '(unknown)'}`,
        `afterNodeVar=${asString(suggestion.afterNodeVar) || '(unknown)'}`,
        `parallelToNodeId=${asString(suggestion.parallelToNodeId) || '(none)'}`,
        `branchFromNodeId=${asString(suggestion.branchFromNodeId) || '(none)'}`,
        `branchToNodeId=${asString(suggestion.branchToNodeId) || '(none)'}`,
        `addNodeType=${asString(suggestion.addNodeType) || '(unknown)'}`,
        `addNodeTypeLabel=${asString(suggestion.addNodeTypeLabel) || '(unknown)'}`,
        `addBlockType=${asString(suggestion.addBlockType) || '(none)'}`,
        `newElement=${formatNewElement(suggestion.newElement)}`,
        `parallelElement=${formatParallelElement(suggestion.parallelElement)}`,
        `insertBeforeNodeId=${asString(suggestion.insertBeforeNodeId) || '(none)'}`,
        `confidence=${formatConfidence(suggestion.confidence)}`,
      ].join(' ');
      log(`AI graph suggestion: ${suggestionText}`);
      const warning = getSuggestionFocusWarning(focusNodeId, suggestion);
      if (warning) {
        log(`AI graph warning: suggestion #${index + 1} ${warning}`);
      }
      const elementWarning = getNewElementWarning(suggestion);
      if (elementWarning) {
        log(`AI graph warning: suggestion #${index + 1} ${elementWarning}`);
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
  const anchorNodeId = asString(suggestion.anchorNodeId);
  const afterNodeId = asString(suggestion.afterNodeId);
  const parallelToNodeId = asString(suggestion.parallelToNodeId);

  if (anchorNodeId && anchorNodeId !== focusNodeId) {
    return `anchorNodeId=${anchorNodeId} does not match recognized focus ${focusNodeId}`;
  }

  if (mode === 'parallelBranch') {
    if (parallelToNodeId && parallelToNodeId !== focusNodeId) {
      return `parallelToNodeId=${parallelToNodeId} does not match recognized focus ${focusNodeId}`;
    }
    return '';
  }

  if (afterNodeId && afterNodeId !== focusNodeId) {
    return `afterNodeId=${afterNodeId} does not match recognized focus ${focusNodeId}`;
  }

  return '';
}

function formatParallelElement(value: unknown): string {
  const element = asRecord(value);
  if (!element) {
    return '(none)';
  }

  return [
    asString(element.addNodeType) || 'unknown',
    asString(element.addNodeTypeLabel) || 'unknown',
    asString(element.addBlockType) || '',
  ].filter(Boolean).join('/');
}

function formatNewElement(value: unknown): string {
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

function getNewElementWarning(suggestion: Record<string, unknown>): string {
  const element = asRecord(suggestion.newElement);
  if (!element) {
    return 'newElement is missing; suggestion may be too vague for frontend rendering';
  }

  const nodeType = asString(element.nodeType);
  const displayLabel = asString(element.displayLabel);
  const variableSource = asString(element.variableSource);
  const userInputRequired = Boolean(element.userInputRequired);
  const variableName = asString(element.variableName);

  if (!nodeType || !displayLabel) {
    return 'newElement.nodeType/displayLabel is missing';
  }

  if (!variableSource) {
    return 'newElement.variableSource is missing';
  }

  if (!userInputRequired && !variableName && nodeType !== 'functionBlock') {
    return 'newElement.variableName is empty but userInputRequired is false';
  }

  if (nodeType === 'functionBlock' && !asString(element.blockType)) {
    return 'newElement.blockType is missing for functionBlock';
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

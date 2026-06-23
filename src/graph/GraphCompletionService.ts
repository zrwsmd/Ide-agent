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
    'Only say which existing node is focused and what type of graph node should be added after it.',
    'The matchedNodeId and afterNodeId must be ids from the realSelectableNodes list only.',
    'Allowed suggestion node types: contact, negatedContact, risingContact, fallingContact, coil, setCoil, resetCoil, functionBlock, branch.',
  ].join('\n');

  const outputSchema = {
    schemaVersion: 'ide-agent.graph-completion.v1',
    action: 'suggestAfterNode | noSuggestion',
    segmentId: 'segment id from diagram summary',
    confidence: 0.0,
    recognizedFocus: {
      visualElement: 'real selected element inside the red dashed box, such as d contact',
      matchedNodeId: 'node id from diagram summary, or empty string',
      matchedNodeType: 'contact | coil | FBDCompartment | ...',
      matchedVar: 'variable name, or empty string',
      confidence: 0.0,
    },
    suggestion: {
      afterNodeId: 'existing node id after which the frontend should preview insertion',
      afterNodeVar: 'variable of the after node, or empty string',
      addNodeType: 'contact | coil | functionBlock | branch | ...',
      addNodeTypeLabel: '触点 | 线圈 | 功能块 | 分支',
      addBlockType: 'TON | CTD | RS | empty unless addNodeType is functionBlock',
      insertBeforeNodeId: 'optional next existing node id, or empty string',
    },
    frontendHint: {
      text: 'short Chinese sentence only, for example: 在 d 触点后添加功能块',
    },
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
    'Return only JSON. Keep frontendHint.text short. Do not include fields named reason, explanation, preview, or connections.',
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
    const suggestionText = [
      `afterNodeId=${asString(suggestion?.afterNodeId) || '(unknown)'}`,
      `afterNodeVar=${asString(suggestion?.afterNodeVar) || '(unknown)'}`,
      `addNodeType=${asString(suggestion?.addNodeType) || '(unknown)'}`,
      `addNodeTypeLabel=${asString(suggestion?.addNodeTypeLabel) || '(unknown)'}`,
      `insertBeforeNodeId=${asString(suggestion?.insertBeforeNodeId) || '(none)'}`,
    ].join(' ');

    log(`AI recognized graph focus: ${focusText}`);
    log(`AI graph suggestion: ${suggestionText}`);
    if (isInternalGraphNodeKind(asString(focus?.matchedNodeType)) || isInternalGraphNodeId(asString(focus?.matchedNodeId))) {
      log('AI graph warning: recognized focus is an internal/placeholder node; result should be ignored or retried with a tighter screenshot crop.');
    }
  } catch (error) {
    log(`AI graph summary parse failed: ${formatUnknownError(error)}`);
  }
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

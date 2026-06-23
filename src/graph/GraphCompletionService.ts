import * as vscode from 'vscode';
import { DEFAULT_DIAGRAM_JSON_PATH, DiagramSummary, loadDiagramSummary } from '../diagram/DiagramSummary';
import { LLMAdapter, LLMMessage } from '../llm/types';

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

  async predictFromActiveEditor(): Promise<GraphCompletionResult | undefined> {
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

    this.log(`graph prediction requested file=${document.fileName || document.uri.toString()} line=${cursor.line} column=${cursor.character}`);
    this.log(`loading diagram json path=${diagramPath}`);

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

    const llmAdapter = await this.getLLMAdapter();
    if (!llmAdapter) {
      this.log('graph prediction skipped: no LLM adapter available');
      void vscode.window.showWarningMessage('Ide Agent: set provider API key before graph prediction.');
      return undefined;
    }

    const messages = buildGraphCompletionPrompt(stCode, summary, cursor, document.fileName || document.uri.toString());
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
  fileName: string
): LLMMessage[] {
  const compactDiagram = compactForPrompt(diagramSummary);
  const systemPrompt = [
    'You are an IEC 61131-3 LD/FBD graph completion engine.',
    'Predict the next likely ladder diagram or function block diagram edit from the provided ST code and diagram topology.',
    'Return only one valid JSON object. Do not return Markdown, comments, or explanations.',
    'The JSON must describe a preview patch the frontend can render, not ST code.',
    'Use existing segmentId and node ids from the topology when choosing insertion positions.',
    'Prefer IEC 61131 valid LD/FBD elements: contact, negatedContact, risingContact, fallingContact, coil, setCoil, resetCoil, FBDCompartment, branch.',
    'If an editRect insertion point exists, prefer using it as the suggested insertion location unless the ST context clearly points elsewhere.',
    'Do not invent impossible connections. When unsure, create a conservative single contact or function block preview before the final coil.',
  ].join('\n');

  const outputSchema = {
    schemaVersion: 'ide-agent.graph-completion.v1',
    action: 'insertNode | insertFunctionBlock | insertBranch | noSuggestion',
    segmentId: 'segment id from diagram summary',
    confidence: 0.0,
    reason: 'short reason in Chinese',
    target: {
      insertionPointId: 'editRect/branchRect id if available',
      insertAfterNodeId: 'existing source node id',
      insertBeforeNodeId: 'existing target node id',
    },
    preview: {
      node: {
        id: 'preview temporary id',
        type: 'contact | coil | FBDCompartment | ...',
        varName: {
          value: 'variable name',
          type: 'BOOL',
          scope: 'VAR',
        },
        childrenNode: {
          type: 'TON | CTD | RS | ...',
          varName: {
            value: 'function block instance',
            type: 'same as block type',
            scope: 'VAR',
          },
          portInputs: {},
          portOutputs: {},
        },
      },
      connections: [
        {
          from: 'source node id',
          to: 'preview node id',
        },
        {
          from: 'preview node id',
          to: 'target node id',
        },
      ],
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
    'Required output JSON shape:',
    JSON.stringify(outputSchema, null, 2),
    '',
    'Return only the JSON preview patch.',
  ].join('\n');

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

function compactForPrompt(summary: DiagramSummary): unknown {
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
      insertionPoints: segment.insertionPoints,
      nodes: segment.nodes.map((node) => ({
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
      edges: segment.edges,
    })),
  };
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

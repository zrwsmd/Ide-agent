import * as vscode from 'vscode';
import { LLMAdapter, LLMMessage } from '../llm/types';
import {
  buildSTCompletionContext,
  formatSymbols,
  isGenerateSegmentEnd,
  isGenerateSegmentStart,
  isPouClosingLine,
  isStructuredTextDocument,
  limitLines,
  shouldTriggerAutomatically,
  STCompletionContext,
  STCompletionOptions,
} from './STContext';

type LLMAdapterGetter = () => Promise<LLMAdapter | null>;

export class STInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private lastAutomaticRequestAt = 0;
  private lastResult:
    | {
        key: string;
        value: vscode.InlineCompletionItem[];
        createdAt: number;
      }
    | undefined;
  private currentRequestController?: AbortController;

  constructor(
    private readonly getLLMAdapter: LLMAdapterGetter,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    inlineContext: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const options = this.getOptions();
    this.log(
      options,
      `request trigger=${triggerKindToString(inlineContext.triggerKind)} file=${document.fileName || document.uri.toString()} language=${document.languageId} line=${position.line + 1} column=${position.character + 1}`
    );

    if (!options.enabled) {
      this.log(options, 'skip: completion disabled');
      return undefined;
    }

    if (!isStructuredTextDocument(document)) {
      this.log(options, 'skip: document is not recognized as ST');
      return undefined;
    }

    const completionContext = buildSTCompletionContext(document, position, options);
    this.log(
      options,
      `context region=${completionContext.region} token=${JSON.stringify(completionContext.currentTokenPrefix)} prefix=${JSON.stringify(completionContext.currentLinePrefix)} prev=${JSON.stringify(completionContext.previousNonEmptyLine)} symbols=${completionContext.declarations.length} segments=${completionContext.recentSegments.length} openSegment=${completionContext.openSegmentHeader ? 'yes' : 'no'}`
    );

    if (
      inlineContext.triggerKind === vscode.InlineCompletionTriggerKind.Automatic &&
      !options.automatic
    ) {
      this.log(options, 'skip: automatic trigger disabled');
      return undefined;
    }

    if (
      inlineContext.triggerKind === vscode.InlineCompletionTriggerKind.Automatic &&
      !shouldTriggerAutomatically(completionContext)
    ) {
      this.log(options, 'skip: automatic trigger conditions did not match');
      return undefined;
    }

    if (
      inlineContext.triggerKind === vscode.InlineCompletionTriggerKind.Automatic &&
      Date.now() - this.lastAutomaticRequestAt < 1200
    ) {
      this.log(options, 'skip: automatic request throttled');
      return undefined;
    }

    const cacheKey = buildCacheKey(document, position, completionContext);
    if (this.lastResult && this.lastResult.key === cacheKey && Date.now() - this.lastResult.createdAt < 30000) {
      this.log(options, `return cached result count=${this.lastResult.value.length}`);
      return this.lastResult.value;
    }

    const llmAdapter = await this.getLLMAdapter();
    if (!llmAdapter) {
      this.log(options, 'skip: no LLM adapter available; set provider API key first');
      return undefined;
    }

    if (inlineContext.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
      this.lastAutomaticRequestAt = Date.now();
    }

    // 取消上一个还在飞的请求，避免并发堆积
    if (this.currentRequestController) {
      this.log(options, 'aborting previous in-flight LLM request');
      this.currentRequestController.abort();
    }
    const requestController = new AbortController();
    this.currentRequestController = requestController;

    // 把 VS Code 的取消信号绑到本次请求的 controller 上
    const tokenSubscription = token.onCancellationRequested(() => {
      requestController.abort();
    });

    const messages = buildPrompt(completionContext, options);
    let rawCompletion = '';

    try {
      this.log(options, `calling LLM adapter=${llmAdapter.constructor.name}`);
      rawCompletion = await llmAdapter.complete(messages, {
        temperature: 0.15,
        maxTokens: Math.min(1600, Math.max(320, options.maxCompletionLines * 80)),
        stopSequences: ['```', '\nExplanation:', '\nNotes:'],
        timeoutMs: options.requestTimeoutMs,
        signal: requestController.signal,
      });
      this.log(options, `LLM returned chars=${rawCompletion.length} preview=${JSON.stringify(rawCompletion.slice(0, 180))}`);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.log(options, 'LLM request aborted (cancelled or superseded)');
        return undefined;
      }
      this.log(options, `error: LLM request failed: ${formatUnknownError(error)}`);
      return undefined;
    } finally {
      tokenSubscription.dispose();
      if (this.currentRequestController === requestController) {
        this.currentRequestController = undefined;
      }
    }

    const completion = sanitizeCompletion(rawCompletion, completionContext, options.maxCompletionLines);
    if (!completion) {
      this.log(options, 'skip: sanitized completion is empty');
      return undefined;
    }

    const item = new vscode.InlineCompletionItem(completion, new vscode.Range(position, position));
    const value = [item];
    this.lastResult = {
      key: cacheKey,
      value,
      createdAt: Date.now(),
    };

    if (token.isCancellationRequested) {
      this.log(options, 'LLM response arrived after VS Code cancelled the request; cached and retriggering');
      void vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
      return undefined;
    }

    this.log(options, `return completion chars=${completion.length} lines=${completion.split('\n').length}`);
    return value;
  }

  private getOptions(): STCompletionOptions {
    const config = vscode.workspace.getConfiguration('ide-agent');

    return {
      enabled: config.get<boolean>('completion.enabled') ?? true,
      automatic: config.get<boolean>('completion.automatic') ?? true,
      debug: config.get<boolean>('completion.debug') ?? true,
      maxContextLines: clampNumber(config.get<number>('completion.maxContextLines') ?? 140, 30, 800),
      maxAfterLines: clampNumber(config.get<number>('completion.maxAfterLines') ?? 30, 0, 300),
      maxCompletionLines: clampNumber(config.get<number>('completion.maxCompletionLines') ?? 16, 1, 120),
      requestTimeoutMs: clampNumber(config.get<number>('completion.requestTimeoutMs') ?? 20000, 3000, 120000),
    };
  }

  private log(options: Pick<STCompletionOptions, 'debug'>, message: string): void {
    if (!options.debug) {
      return;
    }

    const line = `[${new Date().toISOString()}] ${message}`;
    this.outputChannel.appendLine(line);
    console.log(`[IdeAgent:STCompletion] ${message}`);
  }
}

function buildPrompt(context: STCompletionContext, options: STCompletionOptions): LLMMessage[] {
  const recentSegments = context.recentSegments.length > 0
    ? context.recentSegments.join('\n\n--- previous complete generated ST segment ---\n\n')
    : '(none)';

  const systemPrompt = [
    'You are an inline code completion engine for IEC 61131-3 Structured Text (ST).',
    'Return only the exact text to insert at the cursor.',
    'Do not use Markdown fences, comments about the answer, or explanations.',
    'Continue from the cursor, not from the start of the current line.',
    'Preserve the existing ST style, indentation, variable names, and operators.',
    'Do not include generate segment start/end marker comments.',
    'Never return END_PROGRAM, END_FUNCTION_BLOCK, END_FUNCTION, or END_CONFIGURATION.',
    'Prefer executable ST logic: assignments, IF/CASE blocks, loops, and function block calls.',
    'Prefer variables and function block instances already present in the file.',
    'Avoid duplicating code that already appears before or after the cursor.',
    `Keep the completion focused and no longer than ${options.maxCompletionLines} lines.`,
  ].join('\n');

  const userPrompt = [
    `File: ${context.fileName}`,
    `Language id: ${context.languageId}`,
    `Cursor: line ${context.line}, column ${context.character}`,
    `Region: ${context.region}`,
    `Current token prefix: ${context.currentTokenPrefix || '(empty)'}`,
    `Current line before cursor: ${JSON.stringify(context.currentLinePrefix)}`,
    `Current line after cursor: ${JSON.stringify(context.currentLineSuffix)}`,
    `Previous non-empty line: ${context.previousNonEmptyLine || '(none)'}`,
    '',
    'Declared symbols:',
    formatSymbols(context.declarations),
    '',
    'Function block instances and custom typed variables:',
    formatSymbols(context.functionBlocks),
    '',
    'Recent complete generated ST segments:',
    recentSegments,
    '',
    'Open generated segment header at cursor:',
    context.openSegmentHeader || '(none)',
    '',
    'Code before cursor:',
    '<BEFORE>',
    context.beforeText,
    '</BEFORE>',
    '',
    'Code after cursor:',
    '<AFTER>',
    context.afterText,
    '</AFTER>',
    '',
    'Return only ST code to insert at the cursor.',
  ].join('\n');

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

function sanitizeCompletion(
  rawCompletion: string,
  context: STCompletionContext,
  maxCompletionLines: number
): string {
  let completion = rawCompletion
    .replace(/\r\n/g, '\n')
    .replace(/^```(?:st|iecst|structured-text|pascal)?\s*/i, '')
    .replace(/```$/i, '')
    .trimEnd();

  completion = removeLeadingBlankLines(completion);
  completion = removeIntroductoryText(completion);
  completion = removeGenerateSegmentMarkerLines(completion);

  const trimmedLinePrefix = context.currentLinePrefix.trim();
  if (trimmedLinePrefix && completion.startsWith(trimmedLinePrefix)) {
    completion = completion.slice(trimmedLinePrefix.length);
  } else if (context.currentTokenPrefix && completion.startsWith(context.currentTokenPrefix)) {
    completion = completion.slice(context.currentTokenPrefix.length);
  }

  completion = limitLines(completion.trimEnd(), maxCompletionLines);
  completion = removeTrailingFence(completion).trimEnd();
  completion = removeGenerateSegmentMarkerLines(completion);
  completion = removePouClosingLines(completion);
  completion = removeLeadingBlankLines(completion).trimEnd();

  return completion.trim() ? completion : '';
}

function removeIntroductoryText(text: string): string {
  const lines = text.split('\n');
  const firstCodeLine = lines.findIndex((line) => looksLikeSTLine(line.trim()));
  if (firstCodeLine > 0) {
    return removeLeadingBlankLines(lines.slice(firstCodeLine).join('\n'));
  }

  return text;
}

function removeLeadingBlankLines(text: string): string {
  return text.replace(/^(?:[ \t]*\n)+/, '');
}

function removeGenerateSegmentMarkerLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !isGenerateSegmentStart(line) && !isGenerateSegmentEnd(line))
    .join('\n');
}

function removePouClosingLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !isPouClosingLine(line))
    .join('\n');
}

function looksLikeSTLine(line: string): boolean {
  return /^(IF|ELSIF|ELSE|END_IF|FOR|WHILE|CASE|REPEAT|[A-Za-z_][A-Za-z0-9_.]*\s*(?::=|\(|:)|\(\*)/i.test(line);
}

function removeTrailingFence(text: string): string {
  const fenceIndex = text.indexOf('```');
  return fenceIndex >= 0 ? text.slice(0, fenceIndex) : text;
}

function buildCacheKey(
  document: vscode.TextDocument,
  position: vscode.Position,
  context: STCompletionContext
): string {
  return [
    document.uri.toString(),
    document.version,
    position.line,
    position.character,
    context.currentLinePrefix,
    context.currentLineSuffix,
  ].join('|');
}

function triggerKindToString(triggerKind: vscode.InlineCompletionTriggerKind): string {
  return triggerKind === vscode.InlineCompletionTriggerKind.Automatic ? 'automatic' : 'explicit';
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

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

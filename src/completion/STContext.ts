import * as vscode from 'vscode';

export type STRegion = 'declaration' | 'code' | 'unknown';

export interface STCompletionOptions {
  enabled: boolean;
  automatic: boolean;
  debug: boolean;
  maxContextLines: number;
  maxAfterLines: number;
  maxCompletionLines: number;
  requestTimeoutMs: number;
}

export interface STSymbol {
  name: string;
  type: string;
  scope: string;
}

export interface STCompletionContext {
  fileName: string;
  languageId: string;
  region: STRegion;
  line: number;
  character: number;
  currentLinePrefix: string;
  currentLineSuffix: string;
  currentTokenPrefix: string;
  previousNonEmptyLine: string;
  beforeText: string;
  afterText: string;
  declarations: STSymbol[];
  functionBlocks: STSymbol[];
  recentSegments: string[];
  openSegmentHeader?: string;
}

const ST_LANGUAGE_IDS = new Set([
  'st',
  'iecst',
  'plc-st',
  'plc_st',
  'structured-text',
  'structuredtext',
]);

const ST_FILE_EXTENSIONS = new Set(['.st', '.iecst', '.exp']);

const PRIMITIVE_ST_TYPES = new Set([
  'BOOL',
  'BYTE',
  'WORD',
  'DWORD',
  'LWORD',
  'SINT',
  'INT',
  'DINT',
  'LINT',
  'USINT',
  'UINT',
  'UDINT',
  'ULINT',
  'REAL',
  'LREAL',
  'TIME',
  'LTIME',
  'DATE',
  'TIME_OF_DAY',
  'TOD',
  'DATE_AND_TIME',
  'DT',
  'STRING',
  'WSTRING',
  'CHAR',
  'WCHAR',
]);

export const ST_DOCUMENT_SELECTOR: vscode.DocumentSelector = [
  { scheme: 'file', language: 'st' },
  { scheme: 'file', language: 'iecst' },
  { scheme: 'file', language: 'plc-st' },
  { scheme: 'file', language: 'plc_st' },
  { scheme: 'file', language: 'structured-text' },
  { scheme: 'file', language: 'structuredtext' },
  { scheme: 'file', pattern: '**/*.st' },
  { scheme: 'file', pattern: '**/*.ST' },
  { scheme: 'file', pattern: '**/*.iecst' },
  { scheme: 'untitled', language: 'st' },
  { scheme: 'untitled', language: 'iecst' },
  { scheme: 'untitled', language: 'plc-st' },
  { scheme: 'untitled', language: 'structured-text' },
];

export function isStructuredTextDocument(document: vscode.TextDocument): boolean {
  const languageId = document.languageId.toLowerCase();
  if (ST_LANGUAGE_IDS.has(languageId)) {
    return true;
  }

  if (document.uri.scheme === 'untitled') {
    return false;
  }

  return ST_FILE_EXTENSIONS.has(getFileExtension(document.fileName).toLowerCase());
}

export function buildSTCompletionContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  options: STCompletionOptions
): STCompletionContext {
  const currentLine = document.lineAt(position.line).text;
  const startLine = Math.max(0, position.line - options.maxContextLines);
  const endLine = Math.min(document.lineCount - 1, position.line + options.maxAfterLines);
  const beforeText = document.getText(new vscode.Range(new vscode.Position(startLine, 0), position));
  const afterText = document.getText(
    new vscode.Range(position, new vscode.Position(endLine, document.lineAt(endLine).text.length))
  );
  const declarations = extractSymbols(document, position);
  const segments = extractRecentSegments(document, position);
  const currentLinePrefix = currentLine.slice(0, position.character);

  return {
    fileName: getBaseName(document.fileName || document.uri.toString()),
    languageId: document.languageId,
    region: detectRegion(document, position),
    line: position.line + 1,
    character: position.character + 1,
    currentLinePrefix,
    currentLineSuffix: currentLine.slice(position.character),
    currentTokenPrefix: getCurrentTokenPrefix(currentLinePrefix),
    previousNonEmptyLine: getPreviousNonEmptyLine(document, position),
    beforeText,
    afterText,
    declarations,
    functionBlocks: declarations.filter((symbol) => !isPrimitiveType(symbol.type)),
    recentSegments: segments.completeSegments,
    openSegmentHeader: segments.openSegmentHeader,
  };
}

export function shouldTriggerAutomatically(context: STCompletionContext): boolean {
  const trimmedPrefix = context.currentLinePrefix.trim();
  const previous = context.previousNonEmptyLine.trim();

  if (context.openSegmentHeader && !isGenerateSegmentEnd(previous)) {
    return true;
  }

  if (isGenerateSegmentStart(previous)) {
    return true;
  }

  if (trimmedPrefix.length === 0) {
    return /(;|THEN|DO|ELSE|END_IF|END_CASE|END_FOR|\*\))$/i.test(previous);
  }

  if (trimmedPrefix.length < 2 && !/[().:=]/.test(trimmedPrefix)) {
    return false;
  }

  if (/^(IF|ELSIF|FOR|WHILE|CASE|REPEAT|[A-Za-z_][A-Za-z0-9_.]*\s*:?=|[A-Za-z_][A-Za-z0-9_.]*\()$/i.test(trimmedPrefix)) {
    return true;
  }

  return context.region === 'code' && /[.;)]$/.test(trimmedPrefix);
}

export function formatSymbols(symbols: STSymbol[]): string {
  if (symbols.length === 0) {
    return '(none)';
  }

  return symbols
    .slice(-80)
    .map((symbol) => `- ${symbol.name}: ${symbol.type} (${symbol.scope})`)
    .join('\n');
}

export function limitLines(text: string, maxLines: number): string {
  const lines = text.split('\n');
  return lines.length <= maxLines ? text : lines.slice(0, maxLines).join('\n');
}

export function isGenerateSegmentStart(line: string): boolean {
  return /\(\*\s*generate\b[\s\S]*\bcode\s+start\s*\*\)/i.test(line);
}

export function isGenerateSegmentEnd(line: string): boolean {
  return /\(\*\s*generate\b[\s\S]*\bcode\s+end\s*\*\)/i.test(line);
}

export function isPouClosingLine(line: string): boolean {
  return /^(END_PROGRAM|END_FUNCTION_BLOCK|END_FUNCTION|END_CONFIGURATION)\s*;?\s*$/i.test(line.trim());
}

function detectRegion(document: vscode.TextDocument, position: vscode.Position): STRegion {
  let currentVarBlock = '';

  for (let lineIndex = 0; lineIndex <= position.line; lineIndex++) {
    const text = document.lineAt(lineIndex).text.trim();

    if (isVarStartLine(text)) {
      currentVarBlock = text.split(/\s+/)[0].toUpperCase();
      continue;
    }

    if (/^END_VAR\b/i.test(text)) {
      currentVarBlock = '';
    }
  }

  if (currentVarBlock) {
    return 'declaration';
  }

  const beforeCurrentLine = document.lineAt(position.line).text.slice(0, position.character).trim();
  if (beforeCurrentLine.length > 0 || getPreviousNonEmptyLine(document, position).length > 0) {
    return 'code';
  }

  return 'unknown';
}

function extractSymbols(document: vscode.TextDocument, position: vscode.Position): STSymbol[] {
  const symbols: STSymbol[] = [];
  let currentScope = '';

  for (let lineIndex = 0; lineIndex <= position.line; lineIndex++) {
    const rawLine = document.lineAt(lineIndex).text;
    const text = rawLine.trim();

    if (isVarStartLine(text)) {
      currentScope = text.split(/\s+/)[0].toUpperCase();
      continue;
    }

    if (/^END_VAR\b/i.test(text)) {
      currentScope = '';
      continue;
    }

    if (!currentScope) {
      continue;
    }

    const match = rawLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^;]+);/);
    if (!match) {
      continue;
    }

    symbols.push({
      name: match[1],
      type: match[2].trim(),
      scope: currentScope,
    });
  }

  return symbols.slice(-160);
}

function extractRecentSegments(
  document: vscode.TextDocument,
  position: vscode.Position
): { completeSegments: string[]; openSegmentHeader?: string } {
  const completeSegments: string[] = [];
  let activeLines: string[] = [];
  let openSegmentHeader: string | undefined;

  for (let lineIndex = 0; lineIndex <= position.line; lineIndex++) {
    const line = document.lineAt(lineIndex).text;

    if (isGenerateSegmentStart(line)) {
      activeLines = [line];
      openSegmentHeader = line.trim();
      continue;
    }

    if (activeLines.length === 0) {
      continue;
    }

    activeLines.push(line);
    if (isGenerateSegmentEnd(line)) {
      completeSegments.push(activeLines.join('\n'));
      activeLines = [];
      openSegmentHeader = undefined;
    }
  }

  return {
    completeSegments: completeSegments.slice(-3).map((segment) => limitLines(segment, 80)),
    openSegmentHeader,
  };
}

function getPreviousNonEmptyLine(document: vscode.TextDocument, position: vscode.Position): string {
  const currentLinePrefix = document.lineAt(position.line).text.slice(0, position.character).trim();
  if (currentLinePrefix) {
    return currentLinePrefix;
  }

  for (let lineIndex = position.line - 1; lineIndex >= 0; lineIndex--) {
    const text = document.lineAt(lineIndex).text.trim();
    if (text) {
      return text;
    }
  }

  return '';
}

function getCurrentTokenPrefix(linePrefix: string): string {
  const match = linePrefix.match(/[A-Za-z_][A-Za-z0-9_.]*$/);
  return match ? match[0] : '';
}

function isVarStartLine(text: string): boolean {
  return /^VAR(?:\b|_)/i.test(text) && !/^VARIANT\b/i.test(text);
}

function isPrimitiveType(typeName: string): boolean {
  const normalized = typeName
    .replace(/\(.+\)$/, '')
    .replace(/\s*:=.+$/, '')
    .trim()
    .toUpperCase();

  return PRIMITIVE_ST_TYPES.has(normalized);
}

function getFileExtension(fileName: string): string {
  const baseName = getBaseName(fileName);
  const dotIndex = baseName.lastIndexOf('.');

  return dotIndex >= 0 ? baseName.slice(dotIndex) : '';
}

function getBaseName(fileName: string): string {
  const normalized = fileName.replace(/\\/g, '/');
  const slashIndex = normalized.lastIndexOf('/');

  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

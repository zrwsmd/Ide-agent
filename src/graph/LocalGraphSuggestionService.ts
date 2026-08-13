import * as vscode from "vscode";
import {
  getLocalGraphSuggestions as getCoreLocalGraphSuggestions,
} from "@ide-agent/core";
import type {
  LocalGraphSuggestionOptions as CoreLocalGraphSuggestionOptions,
  LocalGraphSuggestionPayload as CoreLocalGraphSuggestionPayload,
  LocalGraphSuggestionRequest as CoreLocalGraphSuggestionRequest,
  LocalGraphSuggestionResult as CoreLocalGraphSuggestionResult,
  LocalSuggestion,
} from "@ide-agent/core";
import {
  DEFAULT_DIAGRAM_JSON_PATH,
  loadDiagramSummary,
} from "../diagram/DiagramSummary";
import {
  getFocusId,
  getFocusType,
  getFocusVar,
  resolveLocalGraphFocus,
} from "./LocalGraphFocusResolver";

// These aliases are kept at the extension boundary for consumers that imported
// the service types before the core package became the canonical API.
export interface LocalGraphSuggestionOptions
  extends CoreLocalGraphSuggestionOptions {}

export interface LocalGraphSuggestionRequest
  extends CoreLocalGraphSuggestionRequest {}

export interface LocalGraphSuggestionPayload
  extends CoreLocalGraphSuggestionPayload {}

export interface LocalGraphSuggestionResult
  extends CoreLocalGraphSuggestionResult {}

export type { LocalSuggestion };

export class LocalGraphSuggestionService {
  constructor(private readonly outputChannel: vscode.OutputChannel) {}

  /**
   * Stable VS Code command adapter. The command delegates to the same core
   * function that is exported for direct imports from @ide-agent/core.
   */
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
      selectedVar: request?.selectedVar,
      focusQuery: request?.focusQuery,
    };
    this.log(
      `local graph command requested path=${diagramPath} focus=${formatFocusOptions(focusOptions)}`,
    );

    try {
      const result = await getCoreLocalGraphSuggestions({
        ...request,
        diagramPath,
      });
      if (!result) {
        this.log(
          `local graph command cancelled: focus not found ${formatFocusOptions(focusOptions)}`,
        );
        return undefined;
      }

      this.logResult("local graph result", result);
      return result;
    } catch (error) {
      this.log(
        `local graph command failed: cannot load diagram json: ${formatUnknownError(error)}`,
      );
      return undefined;
    }
  }

  /** Stable adapter used by the panel's active-editor action. */
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

    let summary;
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

    const focus = await resolveLocalGraphFocus(summary, options);
    if (!focus) {
      this.log("local graph suggestions cancelled: no focus selected");
      return undefined;
    }

    const request: LocalGraphSuggestionRequest = {
      diagramPath,
      segmentId: focus.segment.segmentId,
      selectedNodeId: focus.node?.id,
      selectedInsertionPointId: focus.insertionPoint?.id,
      selectedVar: getFocusVar(focus) || options.selectedVar,
      focusQuery: options.focusQuery,
    };

    let result: LocalGraphSuggestionResult | undefined;
    try {
      result = await getCoreLocalGraphSuggestions(request);
    } catch (error) {
      this.log(
        `local graph suggestions core failed; no unvalidated legacy suggestions will be returned: ${formatUnknownError(error)}`,
      );
    }

    if (!result) {
      this.log(
        "local graph suggestions cancelled: library-validated core result unavailable",
      );
      return undefined;
    }

    this.logResult("local graph result", result);
    this.log(
      `local graph focus source=${focus.source} nodeId=${getFocusId(focus)} type=${getFocusType(focus)} var=${getFocusVar(focus) || "(none)"}`,
    );
    this.log(`local graph suggestions count=${result.payload.suggestions.length}`);
    for (const [index, suggestion] of result.payload.suggestions.entries()) {
      this.log(
        `local graph suggestion #${index + 1} title=${suggestion.title} position=${suggestion.position} serialOrParallel=${suggestion.serialOrParallel} start=${suggestion.startNodes.join(",")} end=${suggestion.endNodes.join(",")}`,
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

  private logResult(
    prefix: string,
    result: LocalGraphSuggestionResult,
  ): void {
    this.log(
      `${prefix} path=${result.diagramPath} source=${String(result.payload.recognizedFocus.source ?? "")} nodeId=${result.payload.anchorNodeId} suggestions=${result.payload.suggestions.length}`,
    );
  }

  private log(message: string): void {
    const line = `[${new Date().toISOString()}] ${message}`;
    this.outputChannel.appendLine(line);
    console.log(`[IdeAgent:LocalGraphSuggestion] ${message}`);
  }
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

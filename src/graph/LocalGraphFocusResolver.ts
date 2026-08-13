import * as vscode from "vscode";
import {
  DiagramInsertionPointSummary,
  DiagramNodeSummary,
  DiagramSegmentSummary,
  DiagramSummary,
} from "../diagram/DiagramSummary";

export interface LocalGraphFocusOptions {
  segmentId?: string;
  selectedNodeId?: string;
  selectedInsertionPointId?: string;
  selectedVar?: string;
  selectedNodeType?: string;
  focusQuery?: string;
}

export interface LocalGraphFocusContext {
  segment: DiagramSegmentSummary;
  node?: DiagramNodeSummary;
  insertionPoint?: DiagramInsertionPointSummary;
  source: "provided" | "manualInput" | "quickPick" | "fallback";
}

type FocusTarget = Omit<LocalGraphFocusContext, "source">;

const REAL_GRAPH_KINDS = new Set([
  "contact",
  "negatedContact",
  "risingContact",
  "fallingContact",
  "coil",
  "setCoil",
  "resetCoil",
  "FBDCompartment",
]);

export async function resolveLocalGraphFocus(
  summary: DiagramSummary,
  options: LocalGraphFocusOptions,
): Promise<LocalGraphFocusContext | undefined> {
  const provided = findFocusByOptions(summary, options);
  if (provided) {
    return { ...provided, source: "provided" };
  }

  const manualQuery =
    options.focusQuery ??
    (await vscode.window.showInputBox({
      title: "Local LD/FBD Suggestions",
      prompt: "输入前端选中的 nodeId 或变量名。",
      placeHolder: "例如 coil-... / Pump_Start",
      ignoreFocusOut: true,
    }));

  if (manualQuery === undefined) {
    return undefined;
  }

  const manual = findFocusByQuery(summary, manualQuery, options.segmentId);
  if (manual) {
    return { ...manual, source: "manualInput" };
  }

  const fallback =
    findFirstInsertionPoint(summary, options.segmentId) ||
    findFirstRealNode(summary, options.segmentId);
  const picked = await pickFocus(summary, fallback, options.segmentId);
  if (picked) {
    return { ...picked, source: "quickPick" };
  }

  if (fallback) {
    void vscode.window.showInformationMessage(
      `Ide Agent: no graph node was selected; using ${focusLabel(fallback)} for local suggestions.`,
    );
    return { ...fallback, source: "fallback" };
  }

  return undefined;
}

export function getFocusId(focus: LocalGraphFocusContext): string {
  return focus.node?.id ?? focus.insertionPoint?.id ?? "";
}

export function getFocusType(focus: LocalGraphFocusContext): string {
  return focus.node?.kind ?? focus.insertionPoint?.kind ?? "";
}

export function getFocusVar(focus: LocalGraphFocusContext): string {
  return focus.node?.var ?? focus.node?.instance ?? "";
}

function findFocusByOptions(
  summary: DiagramSummary,
  options: LocalGraphFocusOptions,
): FocusTarget | undefined {
  if (options.selectedNodeId) {
    const focus = findNodeFocus(summary, options.selectedNodeId, options.segmentId);
    if (focus) {
      return focus;
    }
  }

  if (options.selectedInsertionPointId) {
    const focus = findInsertionPointFocus(
      summary,
      options.selectedInsertionPointId,
      options.segmentId,
    );
    if (focus) {
      return focus;
    }
  }

  if (options.selectedVar) {
    const focus = findFocusByToken(summary, options.selectedVar, options.segmentId);
    if (focus) {
      return focus;
    }
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
): FocusTarget | undefined {
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
): FocusTarget | undefined {
  const normalized = token.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  for (const segment of focusSegments(summary, segmentId)) {
    const node = segment.nodes.find(
      (item) =>
        isRealGraphElementKind(item.kind) &&
        [item.var, item.instance].some(
          (value) => value?.trim().toLowerCase() === normalized,
        ),
    );
    if (node) {
      return { segment, node };
    }
  }

  return undefined;
}

function findNodeFocus(
  summary: DiagramSummary,
  nodeId: string,
  segmentId?: string,
): FocusTarget | undefined {
  for (const segment of focusSegments(summary, segmentId)) {
    const node = segment.nodes.find((item) => item.id === nodeId);
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
): FocusTarget | undefined {
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
  segmentId?: string,
): DiagramSegmentSummary[] {
  const trimmed = segmentId?.trim();
  return trimmed
    ? summary.segments.filter((segment) => segment.segmentId === trimmed)
    : summary.segments;
}

function findFirstInsertionPoint(
  summary: DiagramSummary,
  segmentId?: string,
): FocusTarget | undefined {
  const segment = focusSegments(summary, segmentId).find(
    (item) => item.insertionPoints.length > 0,
  );
  const insertionPoint = segment?.insertionPoints[0];
  return segment && insertionPoint ? { segment, insertionPoint } : undefined;
}

function findFirstRealNode(
  summary: DiagramSummary,
  segmentId?: string,
): FocusTarget | undefined {
  for (const segment of focusSegments(summary, segmentId)) {
    const node = segment.nodes.find((item) => isRealGraphElementKind(item.kind));
    if (node) {
      return { segment, node };
    }
  }

  return undefined;
}

async function pickFocus(
  summary: DiagramSummary,
  fallback: FocusTarget | undefined,
  segmentId?: string,
): Promise<FocusTarget | undefined> {
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

function focusLabel(focus: FocusTarget): string {
  if (focus.node) {
    return nodeLabel(focus.node);
  }

  return focus.insertionPoint
    ? `${focus.insertionPoint.kind} ${focus.insertionPoint.id}`
    : "the first graph element";
}

function nodeLabel(node: DiagramNodeSummary): string {
  const name = node.var || node.instance || node.id;
  if (node.kind === "FBDCompartment") {
    return `${node.blockType || "FB"} ${name}`;
  }

  return `${name} ${node.kind}`;
}

function isRealGraphElementKind(kind: string): boolean {
  return REAL_GRAPH_KINDS.has(kind);
}

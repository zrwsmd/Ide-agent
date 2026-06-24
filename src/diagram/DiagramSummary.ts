import * as vscode from "vscode";

export const DEFAULT_DIAGRAM_JSON_PATH =
  "C:\\Users\\Administrator\\.vscode\\extensions\\ytak.devuni-ide-vscode-1.0.21\\tool\\iec-runtime-gen-run\\.depworkspace\\transLd2.txt";

export interface DiagramVariableSummary {
  name: string;
  type: string;
  scope: string;
}

export interface DiagramNodeSummary {
  id: string;
  kind: string;
  order?: number;
  x?: number;
  y?: number;
  var?: string;
  dataType?: string;
  scope?: string;
  blockType?: string;
  instance?: string;
  inputs?: Record<string, string>;
  outputs?: Record<string, string>;
  from: string[];
  to: string[];
}

export interface DiagramEdgeSummary {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
}

export interface DiagramInsertionPointSummary {
  id: string;
  kind: string;
  from: string[];
  to: string[];
  fromLabels: string[];
  toLabels: string[];
}

export interface DiagramSegmentSummary {
  segmentId: string;
  width?: number;
  height?: number;
  nodeCount: number;
  nodes: DiagramNodeSummary[];
  edges: DiagramEdgeSummary[];
  insertionPoints: DiagramInsertionPointSummary[];
}

export interface DiagramSummary {
  sourcePath: string;
  pouName: string;
  pouType: string;
  variableCount: number;
  variables: DiagramVariableSummary[];
  segments: DiagramSegmentSummary[];
}

export async function loadDiagramSummary(
  sourcePath: string = DEFAULT_DIAGRAM_JSON_PATH,
): Promise<DiagramSummary> {
  const rawBytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(sourcePath),
  );
  const rawText = new TextDecoder("utf-8").decode(rawBytes);
  const parsed = JSON.parse(rawText) as unknown;

  return summarizeDiagramJson(parsed, sourcePath);
}

export function summarizeDiagramJson(
  parsed: unknown,
  sourcePath: string,
): DiagramSummary {
  const roots = Array.isArray(parsed) ? parsed : [parsed];
  const root = asRecord(roots[0]);

  if (!root) {
    throw new Error("Diagram JSON is empty or not an object.");
  }

  const variables = asArray(root.variableList)
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map(
      (item): DiagramVariableSummary => ({
        name: asString(item.name),
        type: asString(item.type),
        scope: asString(item.scope),
      }),
    )
    .filter((item) => item.name.length > 0);

  const segments = asArray(root.segmentList)
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map(summarizeSegment);

  return {
    sourcePath,
    pouName: asString(root.pouName),
    pouType: asString(root.pouType),
    variableCount: variables.length,
    variables,
    segments,
  };
}

function summarizeSegment(
  segment: Record<string, unknown>,
): DiagramSegmentSummary {
  const nodesObj = asRecord(segment.nodesObj) ?? {};
  const nodes = Object.entries(nodesObj)
    .map(([nodeId, node], index) =>
      summarizeNode(nodeId, asRecord(node), index),
    )
    .filter((item): item is DiagramNodeSummary => Boolean(item));
  const labelById = new Map(nodes.map((node) => [node.id, labelNode(node)]));
  const edges = nodes.flatMap((node) =>
    node.to.map(
      (targetId): DiagramEdgeSummary => ({
        from: node.id,
        to: targetId,
        fromLabel: labelById.get(node.id) ?? node.id,
        toLabel: labelById.get(targetId) ?? targetId,
      }),
    ),
  );
  const insertionPoints = nodes
    .filter((node) => node.kind === "editRect" || node.kind === "branchRect")
    .map(
      (node): DiagramInsertionPointSummary => ({
        id: node.id,
        kind: node.kind,
        from: node.from,
        to: node.to,
        fromLabels: node.from.map((id) => labelById.get(id) ?? id),
        toLabels: node.to.map((id) => labelById.get(id) ?? id),
      }),
    );

  return {
    segmentId: asString(segment.id),
    width: asOptionalNumber(segment.width),
    height: asOptionalNumber(segment.height),
    nodeCount: nodes.length,
    nodes,
    edges,
    insertionPoints,
  };
}

function summarizeNode(
  nodeId: string,
  node: Record<string, unknown> | undefined,
  index: number,
): DiagramNodeSummary | undefined {
  if (!node) {
    return undefined;
  }

  const type = asString(node.type);
  const varName = asRecord(node.varName);
  const child = asRecord(node.childrenNode);
  const position = asRecord(node.position);
  const summary: DiagramNodeSummary = {
    id: asString(node.id) || nodeId,
    kind: type || "unknown",
    order: index,
    x: firstNumber(node.Xlayer, node.x, position?.x),
    y: firstNumber(node.Ylayer, node.y, position?.y),
    from: stringArray(node.sourceIds),
    to: stringArray(node.targetIds),
  };

  if (varName) {
    summary.var = asString(varName.value);
    summary.dataType = asString(varName.type);
    summary.scope = asString(varName.scope);
  }

  if (child) {
    const childVarName = asRecord(child.varName);
    summary.blockType = asString(child.type);
    summary.instance = childVarName ? asString(childVarName.value) : undefined;
    summary.inputs = summarizePorts(child.portInputs, ["EN"]);
    summary.outputs = summarizePorts(child.portOutputs, ["ENO"]);
  }

  return summary;
}

function summarizePorts(
  value: unknown,
  ignoredNames: string[],
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const port of asArray(value)) {
    const record = asRecord(port);
    if (!record) {
      continue;
    }

    const name = asString(record.name);
    if (!name || ignoredNames.includes(name)) {
      continue;
    }

    result[name] = asString(record.value);
  }

  return result;
}

function labelNode(node: DiagramNodeSummary): string {
  if (node.kind === "FBDCompartment") {
    const instance = node.instance ? `(${node.instance})` : "";
    return `${node.blockType || "FB"}${instance}`;
  }

  if (node.var) {
    return `${node.kind}:${node.var}`;
  }

  return node.kind || node.id;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = asOptionalNumber(value);
    if (number !== undefined) {
      return number;
    }
  }

  return undefined;
}

function stringArray(value: unknown): string[] {
  return asArray(value).filter(
    (item): item is string => typeof item === "string",
  );
}

import { promises as fs } from "fs";

export const DEFAULT_DIAGRAM_JSON_PATH =
  "C:\\Users\\Administrator\\.vscode\\extensions\\ytak.devuni-ide-vscode-1.0.21\\tool\\iec-runtime-gen-run\\.depworkspace\\transLd.txt";

export interface DiagramVariableSummary {
  name: string;
  type: string;
  scope: string;
  deviceId?: string;
  groupId?: string;
  label?: string;
  note?: string;
  comment?: string;
}

export interface DiagramPortSummary {
  name: string;
  value: string;
  type: string;
  scope: string;
  direction: "input" | "output";
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
  isFunction?: boolean;
  instance?: string;
  inputs?: Record<string, string>;
  outputs?: Record<string, string>;
  inputPorts?: DiagramPortSummary[];
  outputPorts?: DiagramPortSummary[];
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
  label?: string;
  note?: string;
  pouName?: string;
  pouType?: string;
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
  variablesByPou: Record<string, DiagramVariableSummary[]>;
  segments: DiagramSegmentSummary[];
}

export async function loadDiagramSummary(
  sourcePath: string = DEFAULT_DIAGRAM_JSON_PATH,
): Promise<DiagramSummary> {
  const rawText = await fs.readFile(sourcePath, "utf8");
  const parsed = JSON.parse(rawText) as unknown;

  return summarizeDiagramJson(parsed, sourcePath);
}

export function summarizeDiagramJson(
  parsed: unknown,
  sourcePath: string,
): DiagramSummary {
  const roots = (Array.isArray(parsed) ? parsed : [parsed])
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item));

  if (!roots.length) {
    throw new Error("Diagram JSON is empty or not an object.");
  }

  const variablesByPou: Record<string, DiagramVariableSummary[]> = {};
  for (const root of roots) {
    const pouName = asString(root.pouName);
    variablesByPou[pouName] = dedupeVariables([
      ...(variablesByPou[pouName] ?? []),
      ...summarizeVariables(root.variableList),
    ]);
  }
  const variables = dedupeVariables(Object.values(variablesByPou).flat());

  const segments = roots.flatMap((root) => {
    const pouName = asString(root.pouName);
    const pouType = asString(root.pouType);

    return asArray(root.segmentList)
      .map(asRecord)
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((segment) => summarizeSegment(segment, pouName, pouType));
  });

  return {
    sourcePath,
    pouName: uniqueNonEmpty(roots.map((root) => asString(root.pouName))).join(
      ", ",
    ),
    pouType: uniqueNonEmpty(roots.map((root) => asString(root.pouType))).join(
      ", ",
    ),
    variableCount: variables.length,
    variables,
    variablesByPou,
    segments,
  };
}

function summarizeVariables(value: unknown): DiagramVariableSummary[] {
  return asArray(value)
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map(
      (item): DiagramVariableSummary => ({
        name: asString(item.name) || asString(item.value),
        type: asString(item.type),
        scope: asString(item.scope),
        deviceId: asIdentifier(item.deviceId),
        groupId: asIdentifier(item.groupId),
        label: asString(item.label),
        note: asString(item.note),
        comment: asString(item.comment),
      }),
    )
    .filter((item) => item.name.length > 0);
}

function dedupeVariables(
  variables: DiagramVariableSummary[],
): DiagramVariableSummary[] {
  const seen = new Set<string>();
  const result: DiagramVariableSummary[] = [];

  for (const variable of variables) {
    const key = `${variable.scope}\u0000${variable.name}\u0000${variable.type}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(variable);
  }

  return result;
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function summarizeSegment(
  segment: Record<string, unknown>,
  pouName?: string,
  pouType?: string,
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
    label: asString(segment.label),
    note: asString(segment.note),
    pouName,
    pouType,
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
    const inputPorts = summarizePortDetails(
      child.portInputs,
      ["EN"],
      "input",
    );
    const outputPorts = summarizePortDetails(
      child.portOutputs,
      ["ENO"],
      "output",
    );
    summary.blockType = asString(child.type);
    summary.isFunction = asBoolean(child.isFunction);
    summary.instance = childVarName ? asString(childVarName.value) : undefined;
    summary.inputs = summarizePortValues(inputPorts);
    summary.outputs = summarizePortValues(outputPorts);
    summary.inputPorts = inputPorts;
    summary.outputPorts = outputPorts;
  }

  return summary;
}

function summarizePortDetails(
  value: unknown,
  ignoredNames: string[],
  direction: DiagramPortSummary["direction"],
): DiagramPortSummary[] {
  const result: DiagramPortSummary[] = [];
  const normalizedIgnoredNames = new Set(
    ignoredNames.map((name) => name.trim().toUpperCase()),
  );

  for (const port of asArray(value)) {
    const record = asRecord(port);
    if (!record) {
      continue;
    }

    const name = asString(record.name);
    if (!name || normalizedIgnoredNames.has(name.toUpperCase())) {
      continue;
    }

    result.push({
      name,
      value: asString(record.value),
      type: asString(record.type),
      scope: asString(record.scope),
      direction,
    });
  }

  return result;
}

function summarizePortValues(
  ports: DiagramPortSummary[],
): Record<string, string> {
  return Object.fromEntries(ports.map((port) => [port.name, port.value]));
}

function labelNode(node: DiagramNodeSummary): string {
  if (node.kind === "FBDCompartment") {
    if (node.isFunction) {
      return `${node.blockType || "FUN"} 函数`;
    }

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

function asIdentifier(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function asBoolean(value: unknown): boolean {
  return value === true;
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

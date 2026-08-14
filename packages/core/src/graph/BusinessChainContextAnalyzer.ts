import type {
  DiagramNodeSummary,
  DiagramPortSummary,
  DiagramSegmentSummary,
  DiagramSummary,
} from "../diagram/DiagramSummary";
import {
  collectBlockInstances,
  evaluateVariableRoles,
} from "./BusinessLoopSignatures";
import type {
  BusinessBlockInstanceSummary,
  BusinessVariableRoleMatch,
} from "./BusinessLoopSignatures";
import { BUSINESS_RULES_CONFIG } from "./BusinessRulesConfig";
import type { FocusContext } from "./BusinessContextTypes";
import {
  collectNodeReferences,
  normalizeBlockType,
  normalizeReference,
} from "./BusinessEvidence";

export type BusinessChainResolution =
  | "resolved"
  | "partial"
  | "insufficientEvidence";

export type BusinessChainNodeRole =
  | "condition"
  | "trigger"
  | "functionBlock"
  | "action"
  | "unknown";

export type BusinessChainEvidenceStrength = "high" | "medium" | "low";

export interface BusinessChainRoleEvidenceDiagnostic {
  role: string;
  score: number;
  strength: BusinessChainEvidenceStrength;
  sources: string[];
  groupKeys: string[];
}

export interface BusinessChainPortBindingDiagnostic {
  port: string;
  direction: "input" | "output";
  reference: string;
  dataType: string;
  roles: BusinessChainRoleEvidenceDiagnostic[];
}

export interface BusinessChainNodeDiagnostic {
  nodeId: string;
  nodeType: string;
  selected: boolean;
  chainRole: BusinessChainNodeRole;
  variableName: string;
  dataType: string;
  blockType: string;
  instanceName: string;
  contactPolarity?: "normal" | "negated";
  edgeDirection?: "rising" | "falling";
  references: string[];
  roles: BusinessChainRoleEvidenceDiagnostic[];
  ports: BusinessChainPortBindingDiagnostic[];
}

export interface BusinessChainCapabilityDiagnostic {
  capability: string;
  scope: "localChain" | "relatedSegment";
  segmentId: string;
  providerNodeId: string;
  blockType?: string;
  reference?: string;
  sharedReferences: string[];
}

export interface BusinessChainContextDiagnostics {
  schemaVersion: "ide-agent.business-chain-context.v1";
  resolution: BusinessChainResolution;
  segmentId: string;
  segmentLabel: string;
  segmentNote: string;
  focusNodeId: string;
  primaryActionNodeId: string;
  actionNodeIds: string[];
  nodes: BusinessChainNodeDiagnostic[];
  localCapabilities: BusinessChainCapabilityDiagnostic[];
  relatedCapabilities: BusinessChainCapabilityDiagnostic[];
  evidenceSummary: {
    high: number;
    medium: number;
    low: number;
    unresolvedConditionNodeIds: string[];
  };
}

export function analyzeBusinessChainContext(
  summary: DiagramSummary,
  focus: FocusContext,
): BusinessChainContextDiagnostics {
  const samePouSegments = segmentsForFocusPou(summary, focus.segment);
  const variables = focus.segment.pouName
    ? summary.variablesByPou[focus.segment.pouName] ?? []
    : summary.variables;
  const blockInstances = collectBlockInstances(samePouSegments);
  const roleMatches = evaluateVariableRoles(
    BUSINESS_RULES_CONFIG.variablePatterns,
    variables,
    BUSINESS_RULES_CONFIG.blockPortRoleRules,
    blockInstances,
  );
  const rolesByReference = indexRolesByReference(roleMatches);
  const actionNodes = downstreamActionNodes(focus);
  const actionNodeIds = new Set(actionNodes.map((node) => node.id));
  const chainNodeIds = collectUpstreamChainNodeIds(
    focus.segment,
    actionNodes,
    focus.node,
  );
  const nodes = focus.segment.nodes
    .filter(
      (node) => chainNodeIds.has(node.id) && isBusinessChainNode(node),
    )
    .map((node) =>
      buildNodeDiagnostic(
        node,
        focus,
        actionNodeIds,
        rolesByReference,
      ),
    );
  const chainReferences = collectChainReferences(nodes);
  const capabilities = collectCapabilities(
    focus.segment,
    nodes,
    blockInstances,
    chainReferences,
  );
  const evidenceSummary = summarizeEvidence(nodes);

  return {
    schemaVersion: "ide-agent.business-chain-context.v1",
    resolution: resolveBusinessChain(
      actionNodes.length,
      nodes,
      evidenceSummary,
    ),
    segmentId: focus.segment.segmentId,
    segmentLabel: focus.segment.label ?? "",
    segmentNote: focus.segment.note ?? "",
    focusNodeId: focus.node?.id ?? focus.insertionPoint?.id ?? "",
    primaryActionNodeId: actionNodes[0]?.id ?? "",
    actionNodeIds: actionNodes.map((node) => node.id),
    nodes,
    localCapabilities: capabilities.filter(
      (capability) => capability.scope === "localChain",
    ),
    relatedCapabilities: capabilities.filter(
      (capability) => capability.scope === "relatedSegment",
    ),
    evidenceSummary,
  };
}

export function tryAnalyzeBusinessChainContext(
  summary: DiagramSummary,
  focus: FocusContext,
): BusinessChainContextDiagnostics | undefined {
  try {
    return analyzeBusinessChainContext(summary, focus);
  } catch {
    return undefined;
  }
}

function segmentsForFocusPou(
  summary: DiagramSummary,
  focusSegment: DiagramSegmentSummary,
): DiagramSegmentSummary[] {
  const pouName = (focusSegment.pouName ?? "").trim();
  if (!pouName) {
    return [focusSegment];
  }
  return summary.segments.filter(
    (segment) => (segment.pouName ?? "").trim() === pouName,
  );
}

function indexRolesByReference(
  roleMatches: BusinessVariableRoleMatch[],
): Map<string, BusinessVariableRoleMatch[]> {
  const result = new Map<string, BusinessVariableRoleMatch[]>();
  for (const match of roleMatches) {
    const reference = normalizeReference(match.variableName);
    if (!reference) {
      continue;
    }
    const matches = result.get(reference) ?? [];
    matches.push(match);
    result.set(reference, matches);
  }
  return result;
}

function downstreamActionNodes(
  focus: FocusContext,
): DiagramNodeSummary[] {
  const pendingIds = uniqueStrings([
    ...(focus.node ? [focus.node.id] : []),
    ...(focus.node?.to ?? []),
    ...(focus.insertionPoint?.to ?? []),
  ]);
  const visited = new Set<string>();
  const reachableNodes: DiagramNodeSummary[] = [];
  while (pendingIds.length > 0) {
    const nodeId = pendingIds.shift();
    if (!nodeId || visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);
    const node = findNode(focus.segment, nodeId);
    if (!node) {
      continue;
    }
    reachableNodes.push(node);
    pendingIds.push(...node.to);
  }

  return reachableNodes.filter(
    (node) =>
      isCoilNode(node) ||
      (node.kind === "FBDCompartment" &&
        !hasDownstreamOutputNode(focus.segment, node)),
  );
}

function hasDownstreamOutputNode(
  segment: DiagramSegmentSummary,
  startNode: DiagramNodeSummary,
): boolean {
  const visited = new Set<string>();
  const queue = [...startNode.to];
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
    if (isCoilNode(node) || node.kind === "FBDCompartment") {
      return true;
    }
    queue.push(...node.to);
  }
  return false;
}

function collectUpstreamChainNodeIds(
  segment: DiagramSegmentSummary,
  actionNodes: DiagramNodeSummary[],
  focusNode: DiagramNodeSummary | undefined,
): Set<string> {
  const result = new Set<string>();
  const queue = actionNodes.flatMap((node) => [node.id, ...node.from]);
  if (queue.length === 0 && focusNode) {
    queue.push(focusNode.id);
  }

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || result.has(nodeId)) {
      continue;
    }
    result.add(nodeId);
    const node = findNode(segment, nodeId);
    if (node) {
      queue.push(...node.from);
    }
  }
  return result;
}

function buildNodeDiagnostic(
  node: DiagramNodeSummary,
  focus: FocusContext,
  actionNodeIds: Set<string>,
  rolesByReference: Map<string, BusinessVariableRoleMatch[]>,
): BusinessChainNodeDiagnostic {
  const variableName = node.var?.trim() ?? "";
  const edgeDirection = edgeDirectionForNode(node);
  return {
    nodeId: node.id,
    nodeType: node.kind,
    selected: node.id === focus.node?.id,
    chainRole: actionNodeIds.has(node.id)
      ? "action"
      : edgeDirection
        ? "trigger"
        : isContactNode(node)
          ? "condition"
          : node.kind === "FBDCompartment"
            ? "functionBlock"
            : "unknown",
    variableName,
    dataType: node.dataType?.trim() ?? "",
    blockType: node.blockType?.trim() ?? "",
    instanceName: node.instance?.trim() ?? "",
    ...(contactPolarityForNode(node)
      ? { contactPolarity: contactPolarityForNode(node) }
      : {}),
    ...(edgeDirection ? { edgeDirection } : {}),
    references: displayReferences(node),
    roles: rolesForReference(variableName, rolesByReference),
    ports: portBindingsForNode(node, rolesByReference),
  };
}

function rolesForReference(
  reference: string | undefined,
  rolesByReference: Map<string, BusinessVariableRoleMatch[]>,
): BusinessChainRoleEvidenceDiagnostic[] {
  const normalized = normalizeReference(reference);
  if (!normalized) {
    return [];
  }
  return (rolesByReference.get(normalized) ?? [])
    .map((match) => ({
      role: match.role,
      score: match.score,
      strength: evidenceStrength(match),
      sources: [...match.matchedSources],
      groupKeys: [...match.groupKeys],
    }))
    .sort(
      (left, right) =>
        evidenceStrengthRank(right.strength) -
          evidenceStrengthRank(left.strength) ||
        right.score - left.score ||
        left.role.localeCompare(right.role),
    );
}

function portBindingsForNode(
  node: DiagramNodeSummary,
  rolesByReference: Map<string, BusinessVariableRoleMatch[]>,
): BusinessChainPortBindingDiagnostic[] {
  return nodePorts(node)
    .filter((port) => Boolean(normalizeReference(port.value)))
    .map((port) => ({
      port: port.name,
      direction: port.direction,
      reference: port.value,
      dataType: port.type,
      roles: rolesForReference(port.value, rolesByReference),
    }));
}

function nodePorts(node: DiagramNodeSummary): DiagramPortSummary[] {
  const explicitPorts = [
    ...(node.inputPorts ?? []),
    ...(node.outputPorts ?? []),
  ];
  if (explicitPorts.length > 0) {
    return explicitPorts;
  }

  return [
    ...Object.entries(node.inputs ?? {}).map(([name, value]) => ({
      name,
      value,
      type: "",
      scope: "",
      direction: "input" as const,
    })),
    ...Object.entries(node.outputs ?? {}).map(([name, value]) => ({
      name,
      value,
      type: "",
      scope: "",
      direction: "output" as const,
    })),
  ];
}

function collectChainReferences(
  nodes: BusinessChainNodeDiagnostic[],
): Map<string, string> {
  const result = new Map<string, string>();
  for (const node of nodes) {
    for (const reference of node.references) {
      const normalized = normalizeReference(reference);
      if (normalized && !result.has(normalized)) {
        result.set(normalized, reference);
      }
    }
  }
  return result;
}

function collectCapabilities(
  focusSegment: DiagramSegmentSummary,
  nodes: BusinessChainNodeDiagnostic[],
  blockInstances: BusinessBlockInstanceSummary[],
  chainReferences: Map<string, string>,
): BusinessChainCapabilityDiagnostic[] {
  const result: BusinessChainCapabilityDiagnostic[] = [];
  const localNodeIds = new Set(nodes.map((node) => node.nodeId));

  for (const node of nodes) {
    if (node.edgeDirection) {
      result.push({
        capability: `edge:${node.edgeDirection}`,
        scope: "localChain",
        segmentId: focusSegment.segmentId,
        providerNodeId: node.nodeId,
        reference: node.variableName,
        sharedReferences: [],
      });
    }
    if (["coil", "setCoil", "resetCoil"].includes(node.nodeType)) {
      result.push({
        capability: `output:${node.nodeType}`,
        scope: "localChain",
        segmentId: focusSegment.segmentId,
        providerNodeId: node.nodeId,
        reference: node.variableName,
        sharedReferences: [],
      });
    }
  }

  for (const instance of blockInstances) {
    const sharedReferences = sharedInstanceReferences(
      instance,
      chainReferences,
    );
    const isLocal =
      instance.segmentId === focusSegment.segmentId &&
      localNodeIds.has(instance.nodeId);
    if (!isLocal && sharedReferences.length === 0) {
      continue;
    }
    result.push({
      capability: `${instance.isFunction ? "function" : "functionBlock"}:${normalizeBlockType(instance.blockType)}`,
      scope: isLocal ? "localChain" : "relatedSegment",
      segmentId: instance.segmentId,
      providerNodeId: instance.nodeId,
      blockType: instance.blockType,
      sharedReferences: isLocal ? [] : sharedReferences,
    });

    const edgeDirection = edgeDirectionForBlockType(instance.blockType);
    if (edgeDirection) {
      result.push({
        capability: `edge:${edgeDirection}`,
        scope: isLocal ? "localChain" : "relatedSegment",
        segmentId: instance.segmentId,
        providerNodeId: instance.nodeId,
        blockType: instance.blockType,
        sharedReferences: isLocal ? [] : sharedReferences,
      });
    }
  }

  return dedupeCapabilities(result);
}

function sharedInstanceReferences(
  instance: BusinessBlockInstanceSummary,
  chainReferences: Map<string, string>,
): string[] {
  const result = new Map<string, string>();
  for (const port of instance.ports) {
    const normalized = normalizeReference(port.value);
    const display = chainReferences.get(normalized);
    if (normalized && display) {
      result.set(normalized, display);
    }
  }
  return [...result.values()].sort();
}

function dedupeCapabilities(
  capabilities: BusinessChainCapabilityDiagnostic[],
): BusinessChainCapabilityDiagnostic[] {
  const result = new Map<string, BusinessChainCapabilityDiagnostic>();
  for (const capability of capabilities) {
    const key = JSON.stringify([
      capability.capability,
      capability.scope,
      capability.segmentId,
      capability.providerNodeId,
      capability.reference ?? "",
    ]);
    if (!result.has(key)) {
      result.set(key, capability);
    }
  }
  return [...result.values()];
}

function summarizeEvidence(
  nodes: BusinessChainNodeDiagnostic[],
): BusinessChainContextDiagnostics["evidenceSummary"] {
  const allRoles = nodes.flatMap((node) => [
    ...node.roles,
    ...node.ports.flatMap((port) => port.roles),
  ]);
  return {
    high: allRoles.filter((role) => role.strength === "high").length,
    medium: allRoles.filter((role) => role.strength === "medium").length,
    low: allRoles.filter((role) => role.strength === "low").length,
    unresolvedConditionNodeIds: nodes
      .filter(
        (node) => node.chainRole === "condition" && node.roles.length === 0,
      )
      .map((node) => node.nodeId),
  };
}

function resolveBusinessChain(
  actionCount: number,
  nodes: BusinessChainNodeDiagnostic[],
  evidence: BusinessChainContextDiagnostics["evidenceSummary"],
): BusinessChainResolution {
  if (actionCount > 0 && nodes.length > 1 && evidence.high > 0) {
    return "resolved";
  }
  if (actionCount > 0 || evidence.high + evidence.medium + evidence.low > 0) {
    return "partial";
  }
  return "insufficientEvidence";
}

function evidenceStrength(
  match: BusinessVariableRoleMatch,
): BusinessChainEvidenceStrength {
  if (match.matchedSources.includes("port")) {
    return "high";
  }
  if (
    match.matchedSources.some((source) =>
      ["label", "note", "comment"].includes(source),
    )
  ) {
    return "medium";
  }
  return "low";
}

function evidenceStrengthRank(
  strength: BusinessChainEvidenceStrength,
): number {
  return strength === "high" ? 3 : strength === "medium" ? 2 : 1;
}

function displayReferences(node: DiagramNodeSummary): string[] {
  const normalizedReferences = collectNodeReferences(node);
  const candidates = [
    node.var,
    ...Object.values(node.inputs ?? {}),
    ...Object.values(node.outputs ?? {}),
  ];
  const result = new Map<string, string>();
  for (const candidate of candidates) {
    const normalized = normalizeReference(candidate);
    if (
      normalized &&
      normalizedReferences.has(normalized) &&
      !result.has(normalized)
    ) {
      result.set(normalized, String(candidate).trim());
    }
  }
  return [...result.values()];
}

function contactPolarityForNode(
  node: DiagramNodeSummary,
): "normal" | "negated" | undefined {
  if (node.kind === "negatedContact") {
    return "negated";
  }
  return isContactNode(node) ? "normal" : undefined;
}

function edgeDirectionForNode(
  node: DiagramNodeSummary,
): "rising" | "falling" | undefined {
  if (node.kind === "risingContact") {
    return "rising";
  }
  if (node.kind === "fallingContact") {
    return "falling";
  }
  return node.kind === "FBDCompartment"
    ? edgeDirectionForBlockType(node.blockType)
    : undefined;
}

function edgeDirectionForBlockType(
  blockType: string | undefined,
): "rising" | "falling" | undefined {
  const normalized = normalizeBlockType(blockType);
  if (normalized === "R_TRIG") {
    return "rising";
  }
  if (normalized === "F_TRIG") {
    return "falling";
  }
  return undefined;
}

function isBusinessChainNode(node: DiagramNodeSummary): boolean {
  return isContactNode(node) || isActionNode(node);
}

function isContactNode(node: DiagramNodeSummary): boolean {
  return [
    "contact",
    "negatedContact",
    "risingContact",
    "fallingContact",
  ].includes(node.kind);
}

function isActionNode(node: DiagramNodeSummary): boolean {
  return node.kind === "FBDCompartment" || isCoilNode(node);
}

function isCoilNode(node: DiagramNodeSummary): boolean {
  return ["coil", "setCoil", "resetCoil"].includes(node.kind);
}

function findNode(
  segment: DiagramSegmentSummary,
  nodeId: string,
): DiagramNodeSummary | undefined {
  return segment.nodes.find((node) => node.id === nodeId);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

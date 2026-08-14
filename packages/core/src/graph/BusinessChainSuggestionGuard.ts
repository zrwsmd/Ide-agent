import type { FocusContext } from "./BusinessContextTypes";
import type {
  BusinessChainCapabilityDiagnostic,
  BusinessChainContextDiagnostics,
  BusinessChainNodeDiagnostic,
} from "./BusinessChainContextAnalyzer";
import { BUSINESS_RULES_CONFIG } from "./BusinessRulesConfig";
import {
  isMotionBlockType,
  normalizeBlockType,
  normalizeReference,
} from "./BusinessEvidence";
import { filterRedundantEdgeDetectionSuggestions } from "./EdgeDetectionSuggestionFilter";
import type { LocalSuggestionDraft } from "./LocalSuggestionModels";

type EdgeDirection = "rising" | "falling";

export function filterBusinessChainGuardedSuggestions(
  suggestions: LocalSuggestionDraft[],
  focus: FocusContext,
  context: BusinessChainContextDiagnostics | undefined,
): LocalSuggestionDraft[] {
  const boundaryFiltered = filterRedundantEdgeDetectionSuggestions(
    suggestions,
    focus,
  );
  if (!context || context.resolution === "insufficientEvidence") {
    return boundaryFiltered;
  }

  return boundaryFiltered.filter(
    (suggestion) =>
      !hasSatisfiedChainEdge(suggestion, context) &&
      !hasExistingBusinessCapability(suggestion, context) &&
      !bypassesProtectedCondition(suggestion, context),
  );
}

function hasSatisfiedChainEdge(
  suggestion: LocalSuggestionDraft,
  context: BusinessChainContextDiagnostics,
): boolean {
  const direction = suggestedEdgeDirection(suggestion);
  if (!direction) {
    return false;
  }

  const existingCapabilities = context.localCapabilities.filter(
    (capability) => capability.capability === `edge:${direction}`,
  );
  if (existingCapabilities.length === 0) {
    return false;
  }

  const explicitReference = normalizeReference(
    suggestion.addElement.variableName,
  );
  if (!explicitReference) {
    return true;
  }

  return existingCapabilities.some(
    (capability) =>
      normalizeReference(capability.reference) === explicitReference,
  );
}

function hasExistingBusinessCapability(
  suggestion: LocalSuggestionDraft,
  context: BusinessChainContextDiagnostics,
): boolean {
  if (
    suggestion.addElement.nodeType !== "functionBlock" ||
    suggestion.addElement.isFunction
  ) {
    return false;
  }

  const blockType = normalizeBlockType(suggestion.addElement.blockType);
  if (!blockType) {
    return false;
  }

  const capability = `functionBlock:${blockType}`;
  if (
    context.localCapabilities.some(
      (candidate) => candidate.capability === capability,
    )
  ) {
    return true;
  }

  return context.relatedCapabilities.some(
    (candidate) =>
      candidate.capability === capability &&
      hasReliableSharedIdentity(candidate, context),
  );
}

function hasReliableSharedIdentity(
  capability: BusinessChainCapabilityDiagnostic,
  context: BusinessChainContextDiagnostics,
): boolean {
  const blockType = normalizeBlockType(capability.blockType);
  const hasIdentityReference = capability.sharedReferences.some(
    (reference) =>
      hasHighConfidenceIdentityRole(reference, context.nodes),
  );
  const identityScopedBlockTypes = new Set(
    BUSINESS_RULES_CONFIG.businessChainGuards
      .identityScopedCapabilityBlockTypes.map(normalizeBlockType),
  );
  if (identityScopedBlockTypes.has(blockType)) {
    return hasIdentityReference;
  }

  if (
    capability.sharedReferences.length <
    BUSINESS_RULES_CONFIG.businessChainGuards
      .relatedCapabilityMinSharedReferences
  ) {
    return false;
  }

  return !isMotionBlockType(blockType) || hasIdentityReference;
}

function hasHighConfidenceIdentityRole(
  reference: string,
  nodes: BusinessChainNodeDiagnostic[],
): boolean {
  const normalizedReference = normalizeReference(reference);
  if (!normalizedReference) {
    return false;
  }
  const identityRoles = new Set(
    BUSINESS_RULES_CONFIG.businessChainGuards.relatedCapabilityIdentityRoles,
  );

  return nodes.some((node) => {
    if (
      node.references.some(
        (candidate) =>
          normalizeReference(candidate) === normalizedReference,
      ) &&
      node.roles.some(
        (role) => role.strength === "high" && identityRoles.has(role.role),
      )
    ) {
      return true;
    }

    return node.ports.some(
      (port) =>
        normalizeReference(port.reference) === normalizedReference &&
        port.roles.some(
          (role) =>
            role.strength === "high" && identityRoles.has(role.role),
        ),
    );
  });
}

function bypassesProtectedCondition(
  suggestion: LocalSuggestionDraft,
  context: BusinessChainContextDiagnostics,
): boolean {
  if (!isParallelSuggestion(suggestion)) {
    return false;
  }

  const bypassedNodeId =
    suggestion.placement.parallelToNodeId || context.focusNodeId;
  const bypassedNode = context.nodes.find(
    (node) => node.nodeId === bypassedNodeId,
  );
  if (!bypassedNode || bypassedNode.chainRole !== "condition") {
    return false;
  }

  const protectedRoles = new Set(
    BUSINESS_RULES_CONFIG.businessChainGuards.parallelBypassProtectedRoles,
  );
  return bypassedNode.roles.some(
    (role) =>
      role.strength !== "low" && protectedRoles.has(role.role),
  );
}

function isParallelSuggestion(suggestion: LocalSuggestionDraft): boolean {
  return (
    suggestion.serialOrParallel === "parallel" ||
    suggestion.placement.relationToFocus === "parallelWithSelected" ||
    suggestion.mode === "parallelBranch"
  );
}

function suggestedEdgeDirection(
  suggestion: LocalSuggestionDraft,
): EdgeDirection | undefined {
  if (suggestion.addElement.nodeType === "risingContact") {
    return "rising";
  }
  if (suggestion.addElement.nodeType === "fallingContact") {
    return "falling";
  }
  if (suggestion.addElement.nodeType !== "functionBlock") {
    return undefined;
  }

  switch (normalizeBlockType(suggestion.addElement.blockType)) {
    case "R_TRIG":
      return "rising";
    case "F_TRIG":
      return "falling";
    default:
      return undefined;
  }
}

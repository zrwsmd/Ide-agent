import type { DiagramNodeSummary } from "../diagram/DiagramSummary";
import type { FocusContext } from "./BusinessContextTypes";
import {
  collectNodeReferences,
  normalizeBlockType,
  normalizeReference,
} from "./BusinessEvidence";
import type { LocalSuggestionDraft } from "./LocalSuggestionModels";

type EdgeDirection = "rising" | "falling";

export function filterRedundantEdgeDetectionSuggestions(
  suggestions: LocalSuggestionDraft[],
  focus: FocusContext,
): LocalSuggestionDraft[] {
  return suggestions.filter(
    (suggestion) => !hasSatisfiedEdgeDetection(suggestion, focus),
  );
}

function hasSatisfiedEdgeDetection(
  suggestion: LocalSuggestionDraft,
  focus: FocusContext,
): boolean {
  const direction = suggestedEdgeDirection(suggestion);
  if (!direction) {
    return false;
  }

  const existingEdgeNodes = localBoundaryNodes(suggestion, focus).filter(
    (node) => existingEdgeDirection(node) === direction,
  );
  if (existingEdgeNodes.length === 0) {
    return false;
  }

  const explicitReference = normalizeReference(
    suggestion.addElement.variableName,
  );
  if (!explicitReference) {
    return true;
  }

  return existingEdgeNodes.some((node) =>
    collectNodeReferences(node).has(explicitReference),
  );
}

function localBoundaryNodes(
  suggestion: LocalSuggestionDraft,
  focus: FocusContext,
): DiagramNodeSummary[] {
  const nodeIds = new Set(
    [
      focus.node?.id,
      suggestion.placement.anchorNodeId,
      suggestion.placement.insertAfterNodeId,
      suggestion.placement.insertBeforeNodeId,
      suggestion.placement.parallelToNodeId,
      suggestion.placement.branchFromNodeId,
      suggestion.placement.branchToNodeId,
      ...(suggestion.startNodes ?? []),
      ...(suggestion.endNodes ?? []),
    ].filter((nodeId): nodeId is string => Boolean(nodeId)),
  );

  return focus.segment.nodes.filter((node) => nodeIds.has(node.id));
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

  return blockEdgeDirection(suggestion.addElement.blockType);
}

function existingEdgeDirection(
  node: DiagramNodeSummary,
): EdgeDirection | undefined {
  if (node.kind === "risingContact") {
    return "rising";
  }
  if (node.kind === "fallingContact") {
    return "falling";
  }
  if (node.kind !== "FBDCompartment") {
    return undefined;
  }

  return blockEdgeDirection(node.blockType);
}

function blockEdgeDirection(
  blockType: string | undefined,
): EdgeDirection | undefined {
  switch (normalizeBlockType(blockType)) {
    case "R_TRIG":
      return "rising";
    case "F_TRIG":
      return "falling";
    default:
      return undefined;
  }
}

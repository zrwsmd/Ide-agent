export interface SuggestionDedupeKeyParts {
  mode: string;
  relationToFocus: string;
  startNodes: string[];
  endNodes: string[];
  position: string;
  serialOrParallel: string;
  parallelToNodeId: string;
  branchFromNodeId: string;
  branchToNodeId: string;
  nodeType: string;
  blockType: string;
  variableName: string;
}

export function createSuggestionDedupeKey(
  parts: SuggestionDedupeKeyParts,
): string {
  return JSON.stringify({
    mode: parts.mode,
    relationToFocus: parts.relationToFocus,
    startNodes: parts.startNodes,
    endNodes: parts.endNodes,
    position: parts.position,
    serialOrParallel: parts.serialOrParallel,
    parallelToNodeId: parts.parallelToNodeId,
    branchFromNodeId: parts.branchFromNodeId,
    branchToNodeId: parts.branchToNodeId,
    nodeType: parts.nodeType,
    blockType: parts.blockType,
    variableName: parts.variableName,
  });
}

export interface SegmentGraphState {
  hasLogicNode: boolean;
  hasOutputNode: boolean;
  isPartialGraph: boolean;
}

export type LocalSuggestionPosition =
  | "front"
  | "behind"
  | "outsideFront"
  | "outsideBehind"
  | "parallel"
  | "replace";

export type LocalSuggestionSerialOrParallel =
  | "serial"
  | "parallel"
  | "replace";

export interface SuggestedVarName {
  name: string;
  value: string;
  type: string;
  scope: string;
}

export interface SuggestedPort {
  name: string;
  value: string;
  type: string;
  scope: string;
}

export interface SuggestedGraphNode {
  id: string;
  type: string;
  sourceIds?: string[];
  targetIds?: string[];
  varName?: SuggestedVarName;
  childrenNode?: {
    type: string;
    isFunction: boolean;
    varName: SuggestedVarName;
    portInputs: SuggestedPort[];
    portOutputs: SuggestedPort[];
  };
}

export interface LocalSuggestion {
  id: string;
  title: string;
  startNodes: string[];
  endNodes: string[];
  position: LocalSuggestionPosition;
  serialOrParallel: LocalSuggestionSerialOrParallel;
  text: string;
  addNode: Record<string, SuggestedGraphNode>;
  diagnostics?: LocalSuggestionDiagnostics;
}

export interface LocalSuggestionDiagnostics {
  source: "businessRules";
  ruleIds: string[];
  signatureIds: string[];
  reason: string;
  confidence: number;
  score: LocalSuggestionScoreBreakdown;
}

export interface LocalSuggestionScoreBreakdown {
  total: number;
  topology: number;
  rankingRules: number;
  businessEvidence: number;
}

export interface LocalSuggestionDraft {
  id: string;
  mode: string;
  confidence: number;
  placement: {
    relationToFocus: string;
    anchorNodeId: string;
    anchorNodeVar: string;
    insertAfterNodeId: string;
    insertBeforeNodeId: string;
    parallelToNodeId: string;
    branchFromNodeId: string;
    branchToNodeId: string;
    portName: string;
    text: string;
  };
  startNodes?: string[];
  endNodes?: string[];
  preserveStartNodes?: boolean;
  preserveEndNodes?: boolean;
  position?: LocalSuggestionPosition;
  serialOrParallel?: LocalSuggestionSerialOrParallel;
  addElement: LocalSuggestionAddElement;
  businessPresentation?: BusinessSuggestionPresentation;
  businessEvidence?: BusinessSuggestionEvidence;
  scoreBreakdown?: LocalSuggestionScoreBreakdown;
}

export interface BusinessSuggestionPresentation {
  title: string;
  text: string;
  ruleId: string;
  confidence: number;
  reason?: string;
}

export interface BusinessSuggestionEvidence {
  ruleIds: string[];
  signatureIds: string[];
  reason: string;
  confidence: number;
}

export interface LocalSuggestionAddElement {
  nodeType: string;
  displayLabel: string;
  variableSource: string;
  variableName: string;
  dataType: string;
  variableScope?: string;
  userInputRequired: boolean;
  blockType: string;
  instanceSource: string;
  instanceName: string;
  isFunction?: boolean;
  portInputs?: SuggestedPort[];
  portOutputs?: SuggestedPort[];
}

export function inferPosition(
  draft: LocalSuggestionDraft,
): LocalSuggestionPosition {
  if (draft.placement.relationToFocus === "parallelWithSelected") {
    return "parallel";
  }

  if (draft.placement.relationToFocus === "replaceSelected") {
    return "replace";
  }

  if (
    draft.placement.relationToFocus === "beforeSelected" ||
    draft.mode === "functionBlockBefore"
  ) {
    return "front";
  }

  return "behind";
}

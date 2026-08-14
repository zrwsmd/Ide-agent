import {
  DiagramInsertionPointSummary,
  DiagramNodeSummary,
  DiagramSegmentSummary,
} from "../diagram/DiagramSummary";
import { BusinessLoopSignatureMatch, BusinessVariableRoleMatch } from "./BusinessLoopSignatures";
import { BusinessActionLifecycleRuleConfig, BusinessTerm } from "./BusinessRulesConfig";

export interface FocusContext {
  segment: DiagramSegmentSummary;
  node?: DiagramNodeSummary;
  insertionPoint?: DiagramInsertionPointSummary;
  source: "provided" | "manualInput" | "quickPick" | "fallback";
}

export interface RelatedSegmentContext {
  segment: DiagramSegmentSummary;
  relationScore: number;
  sharedReferences: Set<string>;
  terms: Set<BusinessTerm>;
  dataTypes: Set<string>;
  blockTypes: Set<string>;
}

export interface MotionAxisCommandInstance {
  nodeId: string;
  segmentId: string;
  blockType: string;
  instance: string;
  axisReference: string;
  executeReference: string;
  triggerModel: "level" | "risingEdge";
  triggerPort: string;
  triggerReference: string;
  completionReferences: string[];
  activeReferences: string[];
  busyReferences: string[];
  faultReferences: string[];
  abortedReferences: string[];
  locksAxisWhileTriggerTrue: boolean;
}

export interface MotionAxisContext {
  axisReference: string;
  resolution: "focusPort" | "neighborPort" | "segmentUniquePort";
  commands: MotionAxisCommandInstance[];
  lockingStops: MotionAxisCommandInstance[];
}

export interface DeviceCommandAnchor {
  nodeId: string;
  variableName: string;
  roles: Set<string>;
  terms: Set<BusinessTerm>;
}

export interface DeviceLoopRoleCandidate {
  variableName: string;
  dataType: string;
  scope: string;
  role: string;
  evidenceScore: number;
  associationKey: string;
  association: "groupId" | "deviceId" | "descriptionStem" | "nameStem";
  relation?: "sameAction" | "oppositeAction";
  relationRuleId?: string;
  relationId?: string;
}

export interface DeviceLoopContext {
  action: DeviceCommandAnchor;
  candidates: DeviceLoopRoleCandidate[];
  existingCommandPathReferences: Set<string>;
}

export interface FaultResponseContext {
  condition: DeviceCommandAnchor;
  candidates: DeviceLoopRoleCandidate[];
  existingOutputPathReferences: Set<string>;
}

export interface FaultResetContext {
  resetCommand: DeviceCommandAnchor;
  candidates: DeviceLoopRoleCandidate[];
}

export interface ActionLifecycleCandidate extends DeviceLoopRoleCandidate {
  kind: BusinessActionLifecycleRuleConfig["kind"];
  actionName: string;
}

export interface ActionLifecycleContext {
  anchor: DeviceCommandAnchor;
  candidates: ActionLifecycleCandidate[];
}

export interface BusinessSuggestionContext {
  hasBusinessContext: boolean;
  hasLocalBusinessContext: boolean;
  focusKind: string;
  focusTerms: Set<BusinessTerm>;
  nearbyTerms: Set<BusinessTerm>;
  segmentTerms: Set<BusinessTerm>;
  pouTerms: Set<BusinessTerm>;
  focusDataTypes: Set<string>;
  nearbyDataTypes: Set<string>;
  segmentDataTypes: Set<string>;
  localDataTypes: Set<string>;
  focusBlockType: string;
  segmentBlockTypes: Set<string>;
  relatedSegments: RelatedSegmentContext[];
  relatedTerms: Set<BusinessTerm>;
  relatedDataTypes: Set<string>;
  relatedBlockTypes: Set<string>;
  matchedLoopSignatures: Set<string>;
  completionLoopMatches: BusinessLoopSignatureMatch[];
  observedLoopMatches: BusinessLoopSignatureMatch[];
  observedLoopBlockTypes: Set<string>;
  descriptorTerms: Set<BusinessTerm>;
  localVariableRoles: BusinessVariableRoleMatch[];
  coherentRoleCount: number;
  focusReferences: Set<string>;
  actionAnchorName: string;
  actionAnchorTerms: Set<BusinessTerm>;
  actionAnchorRoles: Set<string>;
  motionAxisContext?: MotionAxisContext;
  deviceLoopContext?: DeviceLoopContext;
  faultResponseContext?: FaultResponseContext;
  faultResetContext?: FaultResetContext;
  actionLifecycleContext?: ActionLifecycleContext;
}

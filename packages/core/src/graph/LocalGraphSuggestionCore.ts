import * as fs from "fs";
import * as path from "path";
import {
  DEFAULT_DIAGRAM_JSON_PATH,
  DiagramInsertionPointSummary,
  DiagramNodeSummary,
  DiagramSegmentSummary,
  DiagramSummary,
  DiagramVariableSummary,
  loadDiagramSummary,
} from "../diagram/DiagramSummary";
import {
  BusinessLoopSignatureMatch,
  BusinessVariableRoleMatch,
  collectBlockInstances,
  evaluateLoopSignatures,
  evaluateVariableRoles,
} from "./BusinessLoopSignatures";
import {
  BUSINESS_RULES_CONFIG,
  BUSINESS_TERM_MATCHERS,
  COMMON_FUNCTION_BLOCK_TYPES,
  BusinessActionLifecycleRuleConfig,
  BusinessContactPolarityRuleConfig,
  BusinessDeviceLoopRuleConfig,
  BusinessFaultResetRuleConfig,
  BusinessFaultResponseRuleConfig,
  BusinessLibraryRuleConfig,
  BusinessMotionCommandProfileConfig,
  BusinessNodeIntentRuleConfig,
  BusinessOppositeActionPairConfig,
  BusinessPortRequirementConfig,
  BusinessPresentationConfig,
  BusinessRankingRuleConfig,
  BusinessTerm,
} from "./BusinessRulesConfig";

export interface LocalGraphSuggestionOptions {
  segmentId?: string;
  selectedNodeId?: string;
  selectedInsertionPointId?: string;
  selectedVar?: string;
  selectedNodeType?: string;
  focusQuery?: string;
}

export interface LocalGraphSuggestionRequest {
  diagramPath: string;
  segmentId?: string;
  selectedNodeId?: string;
  selectedInsertionPointId?: string;
  selectedVar?: string;
  focusQuery?: string;
}

export interface LocalGraphSuggestionPayload {
  schemaVersion: string;
  action: string;
  source: string;
  segmentId: string;
  anchorNodeId: string;
  anchorNodeVar: string;
  confidence: number;
  recognizedFocus: Record<string, unknown>;
  suggestions: LocalSuggestion[];
}

export interface LocalGraphSuggestionResult {
  diagramPath: string;
  payload: LocalGraphSuggestionPayload;
}

interface FocusContext {
  segment: DiagramSegmentSummary;
  node?: DiagramNodeSummary;
  insertionPoint?: DiagramInsertionPointSummary;
  source: "provided" | "manualInput" | "quickPick" | "fallback";
}

interface SegmentGraphState {
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

interface OutputCoilPlan {
  startNodes?: string[];
  endNodes?: string[];
  preserveStartNodes?: boolean;
  position?: LocalSuggestionPosition;
  serialOrParallel?: LocalSuggestionSerialOrParallel;
  text: (nodeText: string) => string;
  partialText: (nodeText: string) => string;
}

interface OutsideBehindPlan {
  startNodes: string[];
  endNodes: string[];
  preserveEndNodes?: boolean;
}

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

interface LocalSuggestionDraft {
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

interface BusinessSuggestionPresentation {
  title: string;
  text: string;
  ruleId: string;
  confidence: number;
  reason?: string;
}

interface BusinessSuggestionEvidence {
  ruleIds: string[];
  signatureIds: string[];
  reason: string;
  confidence: number;
}

interface LocalSuggestionAddElement {
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

interface RelatedSegmentContext {
  segment: DiagramSegmentSummary;
  relationScore: number;
  sharedReferences: Set<string>;
  terms: Set<BusinessTerm>;
  dataTypes: Set<string>;
  blockTypes: Set<string>;
}

interface SegmentBusinessSnapshot {
  references: Set<string>;
  terms: Set<BusinessTerm>;
  dataTypes: Set<string>;
  blockTypes: Set<string>;
}

interface MotionAxisCommandInstance {
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

interface MotionAxisContext {
  axisReference: string;
  resolution: "focusPort" | "neighborPort" | "segmentUniquePort";
  commands: MotionAxisCommandInstance[];
  lockingStops: MotionAxisCommandInstance[];
}

interface DeviceCommandAnchor {
  nodeId: string;
  variableName: string;
  roles: Set<string>;
  terms: Set<BusinessTerm>;
}

interface DeviceLoopRoleCandidate {
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

interface DeviceLoopContext {
  action: DeviceCommandAnchor;
  candidates: DeviceLoopRoleCandidate[];
  existingCommandPathReferences: Set<string>;
}

interface FaultResponseContext {
  condition: DeviceCommandAnchor;
  candidates: DeviceLoopRoleCandidate[];
  existingOutputPathReferences: Set<string>;
}

interface FaultResetContext {
  resetCommand: DeviceCommandAnchor;
  candidates: DeviceLoopRoleCandidate[];
}

interface ActionLifecycleCandidate extends DeviceLoopRoleCandidate {
  kind: BusinessActionLifecycleRuleConfig["kind"];
  actionName: string;
}

interface ActionLifecycleContext {
  anchor: DeviceCommandAnchor;
  candidates: ActionLifecycleCandidate[];
}

interface BusinessSuggestionContext {
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

interface LibraryElementInfo {
  name: string;
  type: string;
  inputs?: Array<[string, string, string]>;
  outputs?: Array<[string, string, string]>;
  comment?: string;
  category?: string;
}

interface LibraryPorts {
  portInputs: SuggestedPort[];
  portOutputs: SuggestedPort[];
}

interface BusinessElementCandidate {
  name: string;
  priority: number;
  score: number;
  ruleId: string;
  reason?: string;
  libraryElement: LibraryElementInfo;
  presentation?: BusinessPresentationConfig;
  completionMatch?: BusinessLoopSignatureMatch;
}

const MAX_RETURNED_SUGGESTIONS = 16;
function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArrayRecord(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value
        .map(asPlainRecord)
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function asStringConfig(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStringList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function asArrayConfig(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export async function getLocalGraphSuggestions(
  request: LocalGraphSuggestionRequest | undefined,
): Promise<LocalGraphSuggestionResult | undefined> {
  const diagramPath = request?.diagramPath?.trim();
  if (!diagramPath) {
    return undefined;
  }

  const summary = await loadDiagramSummary(diagramPath);
  const focus = findFocusByOptions(summary, {
    segmentId: request?.segmentId,
    selectedNodeId: request?.selectedNodeId,
    selectedInsertionPointId: request?.selectedInsertionPointId,
    selectedVar: request?.selectedVar,
    focusQuery: request?.focusQuery,
  });
  if (!focus) {
    return undefined;
  }

  return createLocalGraphSuggestionResult(diagramPath, summary, {
    ...focus,
    source: "provided",
  });
}

function createLocalGraphSuggestionResult(
  diagramPath: string,
  summary: DiagramSummary,
  focus: FocusContext,
): LocalGraphSuggestionResult {
  const payload = buildLocalPayload(summary, focus);

  return {
    diagramPath,
    payload,
  };
}

function suggestionTitle(
  suggestion: LocalSuggestion,
  add: string,
): string {
  if (suggestion.serialOrParallel === "parallel") {
    return `并联 ${add}`;
  }

  if (suggestion.position === "replace") {
    return `替换为 ${add}`;
  }

  if (suggestion.position === "front") {
    return `前串联 ${add}`;
  }

  if (suggestion.position === "outsideFront") {
    return `外侧前串联 ${add}`;
  }

  if (suggestion.position === "outsideBehind") {
    return `外侧后串联 ${add}`;
  }

  if (add.includes("线圈")) {
    return `添加 ${add}`;
  }

  if (add.includes("功能块")) {
    return `后插入 ${add}`;
  }

  return `后串联 ${add}`;
}

function suggestedNodeLabel(suggestion: LocalSuggestion): string {
  const node = getSuggestedNode(suggestion);
  if (!node) {
    return "";
  }

  if (node.type === "FBDCompartment") {
    return `${node.childrenNode?.type || "FB"} ${
      node.childrenNode?.isFunction ? "函数" : "功能块"
    }`;
  }

  switch (node.type) {
    case "contact":
      return "常开触点";
    case "negatedContact":
      return "常闭触点";
    case "risingContact":
      return "上升沿";
    case "fallingContact":
      return "下降沿";
    case "coil":
      return "线圈";
    case "setCoil":
      return "置位线圈";
    case "resetCoil":
      return "复位线圈";
    default:
      return node.type;
  }
}

function getSuggestedNode(
  suggestion: LocalSuggestion,
): SuggestedGraphNode | undefined {
  for (const value of Object.values(suggestion.addNode)) {
    if (isSuggestedGraphNode(value)) {
      return value;
    }
  }

  return undefined;
}

function isSuggestedGraphNode(value: unknown): value is SuggestedGraphNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "type" in value
  );
}

function buildLocalPayload(
  summary: DiagramSummary,
  focus: FocusContext,
): LocalGraphSuggestionPayload {
  const suggestions = buildSuggestions(summary, focus);
  const motionAxisContext = analyzeMotionAxisContext(summary, focus);

  return {
    schemaVersion: "ide-agent.graph-completion.v1",
    action: suggestions.length ? "suggestGraphCompletions" : "noSuggestion",
    source: "local-rules",
    segmentId: focus.segment.segmentId,
    anchorNodeId: getFocusId(focus),
    anchorNodeVar: getFocusVar(focus),
    confidence: suggestions.length ? 1 : 0,
    recognizedFocus: {
      visualElement: getFocusVisualElement(focus),
      matchedNodeId: getFocusId(focus),
      matchedNodeType: getFocusType(focus),
      matchedVar: getFocusVar(focus),
      confidence: 1,
      source: focus.source,
      pouName: focus.segment.pouName || summary.pouName,
      ...(motionAxisContext
        ? {
            motionAxisContext: {
              axisReference: motionAxisContext.axisReference,
              resolution: motionAxisContext.resolution,
              runtimeStateKnown: false,
              commands: motionAxisContext.commands.map((command) => ({
                nodeId: command.nodeId,
                segmentId: command.segmentId,
                blockType: command.blockType,
                instance: command.instance,
                executeReference: command.executeReference,
                triggerModel: command.triggerModel,
                triggerPort: command.triggerPort,
                triggerReference: command.triggerReference,
                completionReferences: command.completionReferences,
                activeReferences: command.activeReferences,
                busyReferences: command.busyReferences,
                faultReferences: command.faultReferences,
                abortedReferences: command.abortedReferences,
              })),
              lockingStops: motionAxisContext.lockingStops.map((command) => ({
                nodeId: command.nodeId,
                segmentId: command.segmentId,
                instance: command.instance,
                executeReference: command.executeReference,
                requiresExecuteRelease: true,
              })),
            },
          }
        : {}),
    },
    suggestions,
  };
}

function buildSuggestions(
  summary: DiagramSummary,
  focus: FocusContext,
): LocalSuggestion[] {
  const suggestions: LocalSuggestionDraft[] = [];
  const graphState = analyzeSegment(focus.segment);

  if (focus.insertionPoint) {
    addInsertionPointSuggestions(suggestions, focus, graphState);
  } else if (focus.node && isContactKind(focus.node.kind)) {
    addContactSuggestions(suggestions, focus, graphState);
  } else if (focus.node?.kind === "FBDCompartment") {
    addFunctionBlockSuggestions(suggestions, focus, graphState);
  } else if (focus.node && isCoilKind(focus.node.kind)) {
    addCoilSuggestions(suggestions, focus);
  }

  const candidates = dedupeSuggestions(suggestions);
  const rankedSuggestions = rankBusinessSuggestions(
    candidates,
    summary,
    focus,
    graphState,
  ).filter(isLibraryBackedSuggestion);
  return limitRankedSuggestions(
    rankedSuggestions,
    MAX_RETURNED_SUGGESTIONS,
  )
    .map((suggestion, index) =>
      toLocalSuggestion(suggestion, index, focus.segment),
    )
    .filter((suggestion) =>
      hasValidSuggestionBoundaries(focus.segment, suggestion),
    );
}

function hasValidSuggestionBoundaries(
  segment: DiagramSegmentSummary,
  suggestion: LocalSuggestion,
): boolean {
  const endNodeIds = new Set(suggestion.endNodes);
  if (suggestion.startNodes.some((nodeId) => endNodeIds.has(nodeId))) {
    return false;
  }

  return !suggestion.endNodes.some((endNodeId) =>
    suggestion.startNodes.some((startNodeId) =>
      canReachNode(segment, endNodeId, startNodeId),
    ),
  );
}

function rankBusinessSuggestions(
  suggestions: LocalSuggestionDraft[],
  summary: DiagramSummary,
  focus: FocusContext,
  graphState: SegmentGraphState,
): LocalSuggestionDraft[] {
  const context = buildBusinessSuggestionContext(summary, focus);
  if (!context.hasBusinessContext) {
    return rankTopologySuggestions(
      suggestions.filter(
        (suggestion) => !isGenericFunctionBlockDraft(suggestion),
      ),
    );
  }

  const contactAwareSuggestions = addBusinessContactVariants(
    addActionLifecycleSuggestions(
      addFaultResetSuggestions(
        addFaultResponseSuggestions(
          addDeviceLoopSuggestions(suggestions, context, focus),
          context,
        ),
        context,
      ),
      context,
    ),
    context,
  );
  const enhancedSuggestions = applyBusinessLibraryEnhancements(
    contactAwareSuggestions,
    context,
    focus,
  );
  const presentedSuggestions = applyNodeIntentPresentations(
    enhancedSuggestions,
    context,
  );
  const applicableSuggestions = presentedSuggestions.filter(
    (suggestion) =>
      !hasExistingFunctionBlockAtInsertionBoundary(suggestion, focus.segment) &&
      !hasExistingFunctionBlockInRelatedSegment(suggestion, context, focus),
  );
  const ranked = applicableSuggestions.map((suggestion, index) => {
    const score = scoreBusinessSuggestion(suggestion, context, graphState);
    return {
      suggestion: { ...suggestion, scoreBreakdown: score },
      index,
      score: score.total,
    };
  });

  if (!ranked.some((item) => item.score > 0)) {
    return ranked.map((item) => item.suggestion);
  }

  return ranked
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.suggestion);
}

function applyNodeIntentPresentations(
  suggestions: LocalSuggestionDraft[],
  context: BusinessSuggestionContext,
): LocalSuggestionDraft[] {
  return suggestions.map((suggestion) => {
    if (suggestion.businessPresentation) {
      return suggestion;
    }

    const matchedRule = BUSINESS_RULES_CONFIG.nodeIntentRules
      .filter((rule) => matchesNodeIntentRule(rule, suggestion, context))
      .sort((left, right) => right.priority - left.priority)[0];
    if (!matchedRule?.presentation) {
      return suggestion;
    }

    const evidenceCount = nodeIntentEvidenceCount(matchedRule, context);
    const presentation = renderBusinessPresentation(
      matchedRule.presentation,
      suggestion,
      {
        ruleId: matchedRule.id,
        confidence: Math.min(98, 75 + evidenceCount * 5),
        businessName: matchedRule.businessName,
        reason: matchedRule.reason,
        actionName: context.actionAnchorName || "当前回路",
      },
    );
    return presentation
      ? { ...suggestion, businessPresentation: presentation }
      : suggestion;
  });
}

function matchesNodeIntentRule(
  rule: BusinessNodeIntentRuleConfig,
  suggestion: LocalSuggestionDraft,
  context: BusinessSuggestionContext,
): boolean {
  if (!includesCaseInsensitive(rule.nodeTypes, suggestion.addElement.nodeType)) {
    return false;
  }
  const position = suggestion.position ?? inferPosition(suggestion);
  if (rule.positions.length > 0 && !rule.positions.includes(position)) {
    return false;
  }
  if (
    rule.termsAny.length > 0 &&
    !rule.termsAny.some((term) => localBusinessTermWeight(context, term) > 0)
  ) {
    return false;
  }
  if (
    rule.termsAll.length > 0 &&
    !rule.termsAll.every((term) => localBusinessTermWeight(context, term) > 0)
  ) {
    return false;
  }
  if (
    rule.excludedTerms.some(
      (term) => localBusinessTermWeight(context, term) > 0,
    )
  ) {
    return false;
  }
  if (rule.requireActionAnchor && !context.actionAnchorName) {
    return false;
  }
  if (
    rule.actionRolesAny.length > 0 &&
    !rule.actionRolesAny.some((role) => context.actionAnchorRoles.has(role))
  ) {
    return false;
  }
  const localRoles = new Set(context.localVariableRoles.map((match) => match.role));
  if (
    rule.chainRolesAny.length > 0 &&
    !rule.chainRolesAny.some((role) => localRoles.has(role))
  ) {
    return false;
  }

  const matchedTerms = matchedNodeIntentTerms(rule, context);
  const descriptorMatchCount = [...matchedTerms].filter((term) =>
    context.descriptorTerms.has(term),
  ).length;
  const hasReliableEvidence =
    Boolean(context.actionAnchorName) ||
    context.coherentRoleCount >= 2 ||
    descriptorMatchCount >= 2;
  return (
    hasReliableEvidence &&
    nodeIntentEvidenceCount(rule, context) >= rule.minimumEvidenceCount
  );
}

function matchedNodeIntentTerms(
  rule: BusinessNodeIntentRuleConfig,
  context: BusinessSuggestionContext,
): Set<BusinessTerm> {
  return new Set(
    [...rule.termsAll, ...rule.termsAny].filter(
      (term) => localBusinessTermWeight(context, term) > 0,
    ),
  );
}

function nodeIntentEvidenceCount(
  rule: BusinessNodeIntentRuleConfig,
  context: BusinessSuggestionContext,
): number {
  const matchedTerms = matchedNodeIntentTerms(rule, context);
  const localRoles = new Set(context.localVariableRoles.map((match) => match.role));
  const matchedChainRoles = rule.chainRolesAny.filter((role) =>
    localRoles.has(role),
  );
  const matchedActionRoles = rule.actionRolesAny.filter((role) =>
    context.actionAnchorRoles.has(role),
  );
  return (
    matchedTerms.size +
    Math.min(matchedChainRoles.length, 2) +
    Math.min(matchedActionRoles.length, 1) +
    (context.actionAnchorName ? 1 : 0) +
    (context.coherentRoleCount >= 2 ? 1 : 0)
  );
}

function rankTopologySuggestions(
  suggestions: LocalSuggestionDraft[],
): LocalSuggestionDraft[] {
  return suggestions
    .map((suggestion, index) => {
      const topology = scoreTopologySuggestion(suggestion);
      return {
        suggestion: {
          ...suggestion,
          scoreBreakdown: {
            total: topology,
            topology,
            rankingRules: 0,
            businessEvidence: 0,
          },
        },
        index,
        score: topology,
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.suggestion);
}

function scoreTopologySuggestion(suggestion: LocalSuggestionDraft): number {
  const position = suggestion.position ?? inferPosition(suggestion);
  if (
    position === "outsideBehind" &&
    isContactNodeType(suggestion.addElement.nodeType)
  ) {
    return 3;
  }

  return 0;
}

function addBusinessContactVariants(
  suggestions: LocalSuggestionDraft[],
  context: BusinessSuggestionContext,
): LocalSuggestionDraft[] {
  return suggestions.flatMap((suggestion) => {
    if (
      suggestion.addElement.nodeType !== "contact" ||
      suggestion.addElement.variableSource === "existingVariable"
    ) {
      return [suggestion];
    }

    const normalRule = matchingContactPolarityRule("normal", context);
    const variants = [
      normalRule
        ? {
            ...suggestion,
            businessEvidence: mergeBusinessEvidence(
              suggestion.businessEvidence,
              evidenceFromRule(
                normalRule.id,
                normalRule.reason || "当前业务条件需要使用常开触点",
                0.9,
              ),
            ),
          }
        : suggestion,
    ];
    const negatedRule = matchingContactPolarityRule("negated", context);
    if (negatedRule) {
      variants.push({
        ...replaceWithContactType(suggestion, "negatedContact"),
        businessEvidence: mergeBusinessEvidence(
          suggestion.businessEvidence,
          evidenceFromRule(
            negatedRule.id,
            negatedRule.reason || "当前业务条件需要使用常闭触点",
            0.9,
          ),
        ),
      });
    }

    const hasSafetyEvidence = localBusinessTermWeight(context, "safety") > 0;
    const hasExplicitRisingEvidence = context.descriptorTerms.has("rising");
    const hasExplicitFallingEvidence = context.descriptorTerms.has("falling");
    if (!hasSafetyEvidence && hasExplicitRisingEvidence && !hasExplicitFallingEvidence) {
      variants.push(replaceWithContactType(suggestion, "risingContact"));
    }
    if (!hasSafetyEvidence && hasExplicitFallingEvidence && !hasExplicitRisingEvidence) {
      variants.push(replaceWithContactType(suggestion, "fallingContact"));
    }

    return variants;
  });
}

function addDeviceLoopSuggestions(
  suggestions: LocalSuggestionDraft[],
  context: BusinessSuggestionContext,
  focus: FocusContext,
): LocalSuggestionDraft[] {
  const deviceLoop = context.deviceLoopContext;
  if (!BUSINESS_RULES_CONFIG.enabled || !deviceLoop) {
    return suggestions;
  }

  const generated: LocalSuggestionDraft[] = [];
  const matchingRules = BUSINESS_RULES_CONFIG.deviceLoopRules
    .filter((rule) => matchesDeviceLoopRule(rule, context, deviceLoop))
    .sort((left, right) => right.priority - left.priority);

  for (const rule of matchingRules) {
    const roleCandidates = deviceLoop.candidates.filter(
      (candidate) => {
        const isRuleOppositeAction =
          candidate.relation === "oppositeAction" &&
          candidate.relationRuleId === rule.id &&
          Boolean(rule.oppositeActionCandidates?.rolesAny.includes(candidate.role));
        return (
          (isRuleOppositeAction ||
            (candidate.relation !== "oppositeAction" &&
              rule.candidateRolesAny.includes(candidate.role))) &&
        !deviceLoop.existingCommandPathReferences.has(
          normalizeReference(candidate.variableName),
        )
        );
      },
    );
    for (const candidate of roleCandidates) {
      for (const suggestion of suggestions) {
        if (!isDeviceLoopInsertion(suggestion, rule, deviceLoop, focus)) {
          continue;
        }

        const addElement = contactVariantElement(
          rule.candidateNodeType,
          candidate.variableName,
          candidate.dataType,
          candidate.scope,
        );
        const nextDraft: LocalSuggestionDraft = {
          ...suggestion,
          addElement,
          placement: {
            ...suggestion.placement,
            text: suggestion.placement.text.replaceAll(
              "常开触点",
              addElement.displayLabel,
            ),
          },
        };
        const oppositeActionConfig =
          candidate.relation === "oppositeAction"
            ? rule.oppositeActionCandidates
            : undefined;
        const presentationConfig =
          oppositeActionConfig?.presentation ?? rule.presentation;
        const presentation = presentationConfig
          ? renderBusinessPresentation(presentationConfig, nextDraft, {
              ruleId: [
                rule.id,
                candidate.relationId,
                candidate.variableName,
              ]
                .filter(Boolean)
                .join(":"),
              confidence:
                candidate.association === "nameStem" ? 90 : 98,
              businessName:
                oppositeActionConfig?.businessName ?? rule.businessName,
              reason: oppositeActionConfig?.reason ?? rule.reason,
              actionName: deviceLoop.action.variableName,
              candidateVar: candidate.variableName,
            })
          : undefined;
        generated.push(
          presentation
            ? { ...nextDraft, businessPresentation: presentation }
            : nextDraft,
        );
      }
    }
  }

  return dedupeSuggestions([...generated, ...suggestions]);
}

function addFaultResponseSuggestions(
  suggestions: LocalSuggestionDraft[],
  context: BusinessSuggestionContext,
): LocalSuggestionDraft[] {
  const responseContext = context.faultResponseContext;
  if (!BUSINESS_RULES_CONFIG.enabled || !responseContext) {
    return suggestions;
  }

  const generated: LocalSuggestionDraft[] = [];
  const matchingRules = BUSINESS_RULES_CONFIG.faultResponseRules
    .filter((rule) => matchesFaultResponseRule(rule, context, responseContext))
    .sort((left, right) => right.priority - left.priority);

  for (const rule of matchingRules) {
    const roleCandidates = responseContext.candidates.filter(
      (candidate) =>
        rule.candidateRolesAny.includes(candidate.role) &&
        !responseContext.existingOutputPathReferences.has(
          normalizeReference(candidate.variableName),
        ),
    );
    for (const candidate of roleCandidates) {
      for (const suggestion of suggestions) {
        if (!isFaultResponseInsertion(suggestion, rule)) {
          continue;
        }
        const addElement =
          rule.candidateNodeType === "setCoil"
            ? setCoilElement(candidate.variableName)
            : coilElement(candidate.variableName);
        addElement.variableScope = candidate.scope;
        const nextDraft: LocalSuggestionDraft = {
          ...suggestion,
          addElement,
          placement: {
            ...suggestion.placement,
            text: suggestion.placement.text.replaceAll(
              "输出线圈",
              addElement.displayLabel,
            ),
          },
        };
        const presentation = rule.presentation
          ? renderBusinessPresentation(rule.presentation, nextDraft, {
              ruleId: `${rule.id}:${candidate.variableName}`,
              confidence: candidate.association === "nameStem" ? 90 : 98,
              businessName: rule.businessName,
              reason: rule.reason,
              actionName: responseContext.condition.variableName,
              candidateVar: candidate.variableName,
            })
          : undefined;
        generated.push(
          presentation
            ? { ...nextDraft, businessPresentation: presentation }
            : nextDraft,
        );
      }
    }
  }

  return dedupeSuggestions([...generated, ...suggestions]);
}

function matchesFaultResponseRule(
  rule: BusinessFaultResponseRuleConfig,
  context: BusinessSuggestionContext,
  responseContext: FaultResponseContext,
): boolean {
  if (
    rule.excludedTerms.some(
      (term) =>
        responseContext.condition.terms.has(term) ||
        localBusinessTermWeight(context, term) > 0,
    )
  ) {
    return false;
  }
  if (
    !rule.anchorRolesAny.some((role) =>
      responseContext.condition.roles.has(role),
    )
  ) {
    return false;
  }
  return (
    rule.anchorTermsAny.length === 0 ||
    rule.anchorTermsAny.some((term) =>
      responseContext.condition.terms.has(term),
    )
  );
}

function isFaultResponseInsertion(
  suggestion: LocalSuggestionDraft,
  rule: BusinessFaultResponseRuleConfig,
): boolean {
  if (
    suggestion.mode !== "outputCoil" ||
    suggestion.addElement.nodeType !== "coil" ||
    inferSerialOrParallel(suggestion) !== "serial"
  ) {
    return false;
  }
  const position = suggestion.position ?? inferPosition(suggestion);
  return (
    rule.allowedPositions.length === 0 ||
    rule.allowedPositions.includes(position)
  );
}

function addFaultResetSuggestions(
  suggestions: LocalSuggestionDraft[],
  context: BusinessSuggestionContext,
): LocalSuggestionDraft[] {
  const resetContext = context.faultResetContext;
  if (!BUSINESS_RULES_CONFIG.enabled || !resetContext) {
    return suggestions;
  }

  const generated: LocalSuggestionDraft[] = [];
  const matchingRules = BUSINESS_RULES_CONFIG.faultResetRules
    .filter((rule) => matchesFaultResetRule(rule, context, resetContext))
    .sort((left, right) => right.priority - left.priority);

  for (const rule of matchingRules) {
    const roleCandidates = resetContext.candidates.filter((candidate) =>
      rule.candidateRolesAny.includes(candidate.role),
    );
    for (const candidate of roleCandidates) {
      for (const suggestion of suggestions) {
        if (!isFaultResetInsertion(suggestion, rule)) {
          continue;
        }
        const addElement = resetCoilElement(candidate.variableName);
        addElement.variableScope = candidate.scope;
        const nextDraft: LocalSuggestionDraft = {
          ...suggestion,
          addElement,
          placement: {
            ...suggestion.placement,
            text: suggestion.placement.text.replaceAll(
              "输出线圈",
              addElement.displayLabel,
            ),
          },
        };
        const presentation = rule.presentation
          ? renderBusinessPresentation(rule.presentation, nextDraft, {
              ruleId: `${rule.id}:${candidate.variableName}`,
              confidence: candidate.association === "nameStem" ? 90 : 98,
              businessName: rule.businessName,
              reason: rule.reason,
              actionName: resetContext.resetCommand.variableName,
              candidateVar: candidate.variableName,
            })
          : undefined;
        generated.push(
          presentation
            ? { ...nextDraft, businessPresentation: presentation }
            : nextDraft,
        );
      }
    }
  }

  return dedupeSuggestions([...generated, ...suggestions]);
}

function matchesFaultResetRule(
  rule: BusinessFaultResetRuleConfig,
  context: BusinessSuggestionContext,
  resetContext: FaultResetContext,
): boolean {
  if (
    rule.excludedTerms.some(
      (term) =>
        resetContext.resetCommand.terms.has(term) ||
        localBusinessTermWeight(context, term) > 0,
    )
  ) {
    return false;
  }
  return rule.anchorRolesAny.some((role) =>
    resetContext.resetCommand.roles.has(role),
  );
}

function isFaultResetInsertion(
  suggestion: LocalSuggestionDraft,
  rule: BusinessFaultResetRuleConfig,
): boolean {
  if (
    suggestion.mode !== "outputCoil" ||
    suggestion.addElement.nodeType !== "coil" ||
    inferSerialOrParallel(suggestion) !== "serial"
  ) {
    return false;
  }
  const position = suggestion.position ?? inferPosition(suggestion);
  return (
    rule.allowedPositions.length === 0 ||
    rule.allowedPositions.includes(position)
  );
}

function addActionLifecycleSuggestions(
  suggestions: LocalSuggestionDraft[],
  context: BusinessSuggestionContext,
): LocalSuggestionDraft[] {
  const lifecycle = context.actionLifecycleContext;
  if (!BUSINESS_RULES_CONFIG.enabled || !lifecycle) {
    return suggestions;
  }

  const generated: LocalSuggestionDraft[] = [];
  const matchingRules = BUSINESS_RULES_CONFIG.actionLifecycleRules
    .filter((rule) => matchesActionLifecycleRule(rule, context, lifecycle))
    .sort((left, right) => right.priority - left.priority);
  for (const rule of matchingRules) {
    const candidates = lifecycle.candidates.filter(
      (candidate) =>
        candidate.kind === rule.kind &&
        rule.candidateRolesAny.includes(candidate.role),
    );
    for (const candidate of candidates) {
      for (const suggestion of suggestions) {
        if (!isActionLifecycleInsertion(suggestion, rule)) {
          continue;
        }
        const addElement =
          rule.candidateNodeType === "resetCoil"
            ? resetCoilElement(candidate.variableName)
            : rule.candidateNodeType === "setCoil"
              ? setCoilElement(candidate.variableName)
              : rule.candidateNodeType === "coil"
                ? coilElement(candidate.variableName)
                : contactVariantElement(
                    rule.candidateNodeType,
                    candidate.variableName,
                    candidate.dataType,
                    candidate.scope,
                  );
        addElement.variableScope = candidate.scope;
        const nextDraft: LocalSuggestionDraft = {
          ...suggestion,
          addElement,
          placement: {
            ...suggestion.placement,
            text: suggestion.placement.text
              .replaceAll("常开触点", addElement.displayLabel)
              .replaceAll("输出线圈", addElement.displayLabel),
          },
        };
        const presentation = rule.presentation
          ? renderBusinessPresentation(rule.presentation, nextDraft, {
              ruleId: `${rule.id}:${candidate.variableName}`,
              confidence: candidate.association === "nameStem" ? 90 : 98,
              businessName: rule.businessName,
              reason: rule.reason,
              actionName: candidate.actionName,
              candidateVar: candidate.variableName,
            })
          : undefined;
        generated.push(
          presentation
            ? { ...nextDraft, businessPresentation: presentation }
            : nextDraft,
        );
      }
    }
  }
  return dedupeSuggestions([...generated, ...suggestions]);
}

function matchesActionLifecycleRule(
  rule: BusinessActionLifecycleRuleConfig,
  context: BusinessSuggestionContext,
  lifecycle: ActionLifecycleContext,
): boolean {
  if (
    rule.excludedTerms.some(
      (term) =>
        lifecycle.anchor.terms.has(term) ||
        localBusinessTermWeight(context, term) > 0,
    )
  ) {
    return false;
  }
  return rule.anchorRolesAny.some((role) => lifecycle.anchor.roles.has(role));
}

function isActionLifecycleInsertion(
  suggestion: LocalSuggestionDraft,
  rule: BusinessActionLifecycleRuleConfig,
): boolean {
  const position = suggestion.position ?? inferPosition(suggestion);
  if (
    rule.allowedPositions.length > 0 &&
    !rule.allowedPositions.includes(position)
  ) {
    return false;
  }
  if (rule.kind === "selfHold") {
    return (
      suggestion.mode === "parallelBranch" &&
      suggestion.addElement.nodeType === "contact" &&
      inferSerialOrParallel(suggestion) === "parallel"
    );
  }
  if (rule.kind === "stopInterlock") {
    return (
      suggestion.addElement.nodeType === "contact" &&
      inferSerialOrParallel(suggestion) === "serial"
    );
  }
  if (
    rule.kind === "countCompletionOutput" ||
    rule.kind === "countCompletionLatch"
  ) {
    return (
      suggestion.mode === "outputCoil" &&
      suggestion.addElement.nodeType === "coil" &&
      inferSerialOrParallel(suggestion) === "serial"
    );
  }
  return (
    suggestion.mode === "outputCoil" &&
    suggestion.addElement.nodeType === "coil" &&
    inferSerialOrParallel(suggestion) === "serial"
  );
}

function matchesDeviceLoopRule(
  rule: BusinessDeviceLoopRuleConfig,
  context: BusinessSuggestionContext,
  deviceLoop: DeviceLoopContext,
): boolean {
  if (
    rule.excludedTerms.some(
      (term) =>
        deviceLoop.action.terms.has(term) ||
        localBusinessTermWeight(context, term) > 0,
    )
  ) {
    return false;
  }
  if (
    rule.anchorRolesAny.length > 0 &&
    !rule.anchorRolesAny.some((role) => deviceLoop.action.roles.has(role))
  ) {
    return false;
  }
  return (
    rule.anchorTermsAny.length === 0 ||
    rule.anchorTermsAny.some((term) => deviceLoop.action.terms.has(term))
  );
}

function isDeviceLoopInsertion(
  suggestion: LocalSuggestionDraft,
  rule: BusinessDeviceLoopRuleConfig,
  deviceLoop: DeviceLoopContext,
  focus: FocusContext,
): boolean {
  if (
    suggestion.addElement.nodeType !== "contact" ||
    inferSerialOrParallel(suggestion) !== "serial"
  ) {
    return false;
  }
  const position = suggestion.position ?? inferPosition(suggestion);
  if (
    rule.allowedPositions.length > 0 &&
    !rule.allowedPositions.includes(position)
  ) {
    return false;
  }

  const insertionBefore = suggestion.placement.insertBeforeNodeId;
  return Boolean(
    insertionBefore &&
      (insertionBefore === deviceLoop.action.nodeId ||
        canReachNode(
          focus.segment,
          insertionBefore,
          deviceLoop.action.nodeId,
        )),
  );
}

function matchesContactPolarity(
  polarity: "normal" | "negated",
  context: BusinessSuggestionContext,
): boolean {
  return Boolean(matchingContactPolarityRule(polarity, context));
}

function matchingContactPolarityRule(
  polarity: "normal" | "negated",
  context: BusinessSuggestionContext,
): BusinessContactPolarityRuleConfig | undefined {
  const matchingRules = BUSINESS_RULES_CONFIG.contactPolarityRules
    .filter((rule) => matchesContactPolarityRule(rule, context))
    .sort((left, right) => right.priority - left.priority);
  return matchingRules[0]?.polarity === polarity ? matchingRules[0] : undefined;
}

function matchesContactPolarityRule(
  rule: BusinessContactPolarityRuleConfig,
  context: BusinessSuggestionContext,
): boolean {
  if (
    rule.termsAny?.length &&
    !rule.termsAny.some(
      (term) => localBusinessTermWeight(context, term) > 0,
    )
  ) {
    return false;
  }
  if (
    rule.termsAll?.length &&
    !rule.termsAll.every(
      (term) => localBusinessTermWeight(context, term) > 0,
    )
  ) {
    return false;
  }
  if (
    rule.excludedTerms?.some(
      (term) => localBusinessTermWeight(context, term) > 0,
    )
  ) {
    return false;
  }

  const anchorTerms =
    rule.anchorTermScope === "selectedNode"
      ? context.focusTerms
      : context.focusTerms.size > 0
        ? context.focusTerms
        : context.nearbyTerms;
  return !rule.excludedAnchorTerms?.some((term) => anchorTerms.has(term));
}

function replaceWithContactType(
  suggestion: LocalSuggestionDraft,
  nodeType: "negatedContact" | "risingContact" | "fallingContact",
): LocalSuggestionDraft {
  const element = contactVariantElement(
    nodeType,
    suggestion.addElement.variableName,
    suggestion.addElement.dataType,
    suggestion.addElement.variableScope,
  );
  return {
    ...suggestion,
    placement: {
      ...suggestion.placement,
      text: suggestion.placement.text.replaceAll(
        "常开触点",
        element.displayLabel,
      ),
    },
    addElement: element,
  };
}

function applyBusinessLibraryEnhancements(
  suggestions: LocalSuggestionDraft[],
  context: BusinessSuggestionContext,
  focus: FocusContext,
): LocalSuggestionDraft[] {
  if (!BUSINESS_RULES_CONFIG.enabled) {
    return suggestions;
  }

  let candidateIndex = 0;
  return suggestions.flatMap((suggestion) => {
    if (!isGenericFunctionBlockDraft(suggestion)) {
      return [suggestion];
    }

    const candidates = resolveBusinessLibraryCandidates(context, suggestion);
    if (!candidates.length) {
      return [];
    }

    const offset = candidateIndex % candidates.length;
    candidateIndex += 1;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[(offset + index) % candidates.length];
      const replacement = replaceFunctionBlockDraft(
        suggestion,
        candidate,
        context,
      );
      if (
        !hasExistingFunctionBlockAtInsertionBoundary(
          replacement,
          focus.segment,
        ) &&
        !hasExistingFunctionBlockInRelatedSegment(
          replacement,
          context,
          focus,
        )
      ) {
        return [replacement];
      }
    }
    return [];
  });
}

function resolveBusinessLibraryCandidates(
  context: BusinessSuggestionContext,
  suggestion: LocalSuggestionDraft,
): BusinessElementCandidate[] {
  const ruleMatches = BUSINESS_RULES_CONFIG.libraryRules
    .map((rule) => matchBusinessRule(rule, context, suggestion))
    .filter((item): item is BusinessElementCandidate[] => item.length > 0)
    .flat();

  if (!ruleMatches.length) {
    return [];
  }
  const deduped = new Map<string, BusinessElementCandidate>();
  for (const candidate of ruleMatches) {
    const current = deduped.get(candidate.name);
    if (
      !current ||
      candidate.priority > current.priority ||
      (candidate.priority === current.priority &&
        candidate.score > current.score)
    ) {
      deduped.set(candidate.name, candidate);
    }
  }

  return [...deduped.values()].sort(
    (left, right) =>
      right.priority - left.priority || right.score - left.score,
  );
}

function matchBusinessRule(
  rule: BusinessLibraryRuleConfig,
  context: BusinessSuggestionContext,
  suggestion: LocalSuggestionDraft,
): BusinessElementCandidate[] {
  const position = suggestion.position ?? inferPosition(suggestion);
  if (rule.focusKinds?.length && !includesCaseInsensitive(rule.focusKinds, context.focusKind)) {
    return [];
  }

  if (rule.allowedModes?.length && !rule.allowedModes.includes(suggestion.mode)) {
    return [];
  }

  if (rule.allowedPositions?.length && !rule.allowedPositions.includes(position)) {
    return [];
  }

  if (
    rule.signatureRefsAny?.length &&
    !rule.signatureRefsAny.some((signatureId) =>
      context.completionLoopMatches.some((match) => match.id === signatureId),
    )
  ) {
    return [];
  }

  if (
    rule.excludedExistingBlockTypes?.some(
      (blockType) =>
        context.segmentBlockTypes.has(normalizeBlockType(blockType)),
    )
  ) {
    return [];
  }

  if (rule.termsAny && rule.termsAny.length > 0) {
    const hasAny = rule.termsAny.some((term) => localBusinessTermWeight(context, term) > 0);
    if (!hasAny) {
      return [];
    }
  }

  if (rule.termsAll && rule.termsAll.length > 0) {
    const hasAll = rule.termsAll.every((term) => localBusinessTermWeight(context, term) > 0);
    if (!hasAll) {
      return [];
    }
  }

  if (rule.excludedTerms && rule.excludedTerms.some((term) => businessTermWeight(context, term) > 0)) {
    return [];
  }

  if (
    rule.requiredAnyDataTypes?.length &&
    !hasAnyDataType(context.localDataTypes, rule.requiredAnyDataTypes)
  ) {
    return [];
  }

  if (
    rule.requiredAllDataTypes?.length &&
    !rule.requiredAllDataTypes.every((dataType) =>
      hasDataType(context.localDataTypes, dataType),
    )
  ) {
    return [];
  }

  if (
    rule.excludedDataTypes?.some((dataType) =>
      hasDataType(context.localDataTypes, dataType),
    )
  ) {
    return [];
  }

  if (
    rule.requiredTypeCapabilities?.length &&
    !rule.requiredTypeCapabilities.every((capability) =>
      hasTypeCapability(context.localDataTypes, capability),
    )
  ) {
    return [];
  }

  const baseScore = rule.baseScore ?? 0;

  return rule.candidateNames.flatMap((candidateName, candidateIndex) => {
    const libraryElement = getLibraryElement(candidateName);
    const matchingCompletionMatches = context.completionLoopMatches.filter(
      (match) =>
        rule.signatureRefsAny?.includes(match.id) &&
        (match.targetBlockTypes.length === 0 ||
          match.targetBlockTypes.some(
            (targetBlockType) =>
              normalizeBlockType(targetBlockType) ===
              normalizeBlockType(candidateName),
          )),
    );
    const isSignatureDrivenCandidate = matchingCompletionMatches.length > 0;
    if (rule.signatureRefsAny?.length && !isSignatureDrivenCandidate) {
      return [];
    }
    if (
      !libraryElement ||
      (!isSignatureDrivenCandidate &&
        context.observedLoopBlockTypes.has(
          normalizeBlockType(libraryElement.name),
        )) ||
      hasExistingSameAxisMotionCommand(libraryElement.name, context) ||
      !matchesPortRequirements(
        rule.portRequirements ?? [],
        libraryElement,
        context.localDataTypes,
      )
    ) {
      return [];
    }

    return [
      {
        name: libraryElement.name,
        priority: rule.priority,
        score:
          baseScore +
          businessTermWeight(context, ...(rule.termsAny ?? [])) * 2 +
          businessTermWeight(context, ...(rule.termsAll ?? [])) * 3 +
          (rule.preferredModes?.includes(suggestion.mode) ? 4 : 0) +
          (rule.preferredPositions?.includes(position) ? 3 : 0) -
          candidateIndex,
        ruleId: rule.id,
        reason: rule.reason,
        libraryElement,
        presentation: rule.presentation,
        completionMatch: matchingCompletionMatches[0],
      },
    ];
  });
}

function hasExistingSameAxisMotionCommand(
  candidateName: string,
  context: BusinessSuggestionContext,
): boolean {
  if (!context.motionAxisContext || context.focusReferences.size === 0) {
    return false;
  }

  const normalizedCandidateName = normalizeBlockType(candidateName);
  return context.motionAxisContext.commands.some((command) => {
    const triggerReference = normalizeReference(command.triggerReference);
    return (
      normalizeBlockType(command.blockType) === normalizedCandidateName &&
      Boolean(triggerReference) &&
      context.focusReferences.has(triggerReference)
    );
  });
}

function matchesPortRequirements(
  requirements: BusinessPortRequirementConfig[],
  libraryElement: LibraryElementInfo,
  localDataTypes: Set<string>,
): boolean {
  if (requirements.length === 0) {
    return true;
  }

  return requirements.every((requirement) => {
    if (requirement.required && requirement.acceptedDataTypes.length === 0) {
      return false;
    }

    const candidatePorts: Array<{
      direction: "input" | "output";
      port: [string, string, string];
    }> =
      requirement.direction === "input"
        ? (libraryElement.inputs ?? []).map((port) => ({
            direction: "input",
            port,
          }))
        : requirement.direction === "output"
          ? (libraryElement.outputs ?? []).map((port) => ({
              direction: "output",
              port,
            }))
          : [
              ...(libraryElement.inputs ?? []).map((port) => ({
                direction: "input" as const,
                port,
              })),
              ...(libraryElement.outputs ?? []).map((port) => ({
                direction: "output" as const,
                port,
              })),
            ];
    const matchingLibraryPorts = candidatePorts.filter(
      ({ port: [name] }) =>
        name.trim().toUpperCase() === requirement.port.trim().toUpperCase(),
    );
    if (matchingLibraryPorts.length === 0) {
      return !requirement.required;
    }

    if (
      requirement.acceptedDataTypes.length > 0 &&
      !matchingLibraryPorts.some(({ port: libraryPort }) =>
        hasAnyDataType(
          new Set([normalizeDataType(libraryPort[1])]),
          requirement.acceptedDataTypes,
        ),
      )
    ) {
      return false;
    }

    if (!requirement.required) {
      return true;
    }

    const hasMatchingOutput = matchingLibraryPorts.some(
      ({ direction, port }) =>
        direction === "output" &&
        hasAnyDataType(
          new Set([normalizeDataType(port[1])]),
          requirement.acceptedDataTypes,
        ),
    );
    return (
      hasMatchingOutput ||
      requirement.allowCreateParameter ||
      hasAnyDataType(localDataTypes, requirement.acceptedDataTypes)
    );
  });
}

function buildBusinessSuggestionContext(
  summary: DiagramSummary,
  focus: FocusContext,
): BusinessSuggestionContext {
  const focusTexts = focus.node ? nodeBusinessTexts(focus.node) : [];
  const surroundingNodes = focus.node
    ? [
        ...neighborNodes(focus.segment, focus.node.from, "backward"),
        ...neighborNodes(focus.segment, focus.node.to, "forward"),
      ]
    : focus.insertionPoint
      ? [
          ...neighborNodes(focus.segment, focus.insertionPoint.from, "backward"),
          ...neighborNodes(focus.segment, focus.insertionPoint.to, "forward"),
        ]
      : [];
  const nearbyTexts = surroundingNodes.flatMap((node) => nodeBusinessTexts(node));
  const segmentTexts = [
    focus.segment.label,
    focus.segment.note,
    focus.segment.pouName,
    focus.segment.pouType,
    ...focus.segment.nodes.flatMap((node) => nodeBusinessTexts(node)),
  ];
  const pouVariables = focus.segment.pouName
    ? summary.variablesByPou[focus.segment.pouName] ?? []
    : [];
  const pouTexts = [
    focus.segment.pouName,
    focus.segment.pouType,
    ...pouVariables.flatMap(variableBusinessTexts),
  ];
  const focusBlockType = normalizeBlockType(focus.node?.blockType);
  const focusDataTypes = collectNodeDataTypes(
    focus.node ? [focus.node] : [],
    pouVariables,
  );
  const nearbyDataTypes = collectNodeDataTypes(surroundingNodes, pouVariables);
  const segmentDataTypes = collectNodeDataTypes(
    focus.segment.nodes,
    pouVariables,
  );
  const localDataTypes = new Set([
    ...focusDataTypes,
    ...nearbyDataTypes,
    ...segmentDataTypes,
  ]);
  const segmentBlockTypes = new Set(
    focus.segment.nodes
      .map((node) => normalizeBlockType(node.blockType))
      .filter((value) => value.length > 0),
  );
  const focusTerms = collectBusinessTerms(focusTexts);
  const nearbyTerms = collectBusinessTerms(nearbyTexts);
  const segmentTerms = collectBusinessTerms(segmentTexts);
  const pouTerms = collectBusinessTerms(pouTexts);
  addDerivedTerms(focusTerms, focusDataTypes);
  addDerivedTerms(nearbyTerms, nearbyDataTypes);
  addDerivedTerms(segmentTerms, segmentDataTypes);
  const relatedSegments = findRelatedSegments(
    summary,
    focus.segment,
    pouVariables,
  );
  const relatedTerms = new Set(
    relatedSegments.flatMap((item) => [...item.terms]),
  );
  const relatedDataTypes = new Set(
    relatedSegments.flatMap((item) => [...item.dataTypes]),
  );
  const relatedBlockTypes = new Set(
    relatedSegments.flatMap((item) => [...item.blockTypes]),
  );
  const signatureContextTexts = [
    focus.segment.label,
    focus.segment.note,
    ...focus.segment.nodes.flatMap((node) => nodeBusinessTexts(node)),
  ];
  const signatureContextTerms = collectBusinessTerms(signatureContextTexts);
  addDerivedTerms(signatureContextTerms, segmentDataTypes);
  const blockInstances = collectBlockInstances(
    summary.segments.filter(
      (segment) => segment.pouName?.trim() === focus.segment.pouName?.trim(),
    ),
  );
  const variableRoleMatches = evaluateVariableRoles(
    BUSINESS_RULES_CONFIG.variablePatterns,
    pouVariables,
    BUSINESS_RULES_CONFIG.blockPortRoleRules,
    blockInstances,
  );
  const knownReferences = new Set(
    pouVariables
      .map((variable) => normalizeReference(variable.name))
      .filter(Boolean),
  );
  const segmentReferences = collectSegmentReferences(
    focus.segment,
    knownReferences,
  );
  const localVariableRoles = variableRoleMatches.filter((match) =>
    segmentReferences.has(normalizeReference(match.variableName)),
  );
  const descriptorTerms = collectBusinessTerms([
    focus.segment.label,
    focus.segment.note,
  ]);
  const actionAnchor = findBusinessActionAnchor(focus);
  const focusReferences = new Set(
    collectFocusVariableNames(focus, surroundingNodes)
      .map((reference) => normalizeReference(reference))
      .filter(Boolean),
  );
  const motionAxisContext = analyzeMotionAxisContext(summary, focus);
  const actionAnchorRoles = new Set(
    localVariableRoles
      .filter(
        (match) =>
          actionAnchor.name &&
          normalizeReference(match.variableName) ===
            normalizeReference(actionAnchor.name),
      )
      .map((match) => match.role),
  );
  const coherentRoleCount = maxCoherentRoleCount(localVariableRoles);
  const deviceLoopContext = analyzeDeviceLoopContext(
    focus,
    pouVariables,
    variableRoleMatches,
    actionAnchor.name,
  );
  const faultResponseContext = analyzeFaultResponseContext(
    focus,
    pouVariables,
    variableRoleMatches,
  );
  const faultResetContext = analyzeFaultResetContext(
    summary,
    focus,
    pouVariables,
    variableRoleMatches,
  );
  const actionLifecycleContext = analyzeActionLifecycleContext(
    summary,
    focus,
    pouVariables,
    variableRoleMatches,
  );
  const signatureMatches = evaluateLoopSignatures(
    BUSINESS_RULES_CONFIG.variablePatterns,
    BUSINESS_RULES_CONFIG.loopSignatures,
    pouVariables,
    signatureContextTexts,
    signatureContextTerms,
    BUSINESS_RULES_CONFIG.blockPortRoleRules,
    blockInstances,
    [...focusReferences],
  );
  const completionLoopMatches = signatureMatches.filter(
    (match) => match.kind === "completion",
  );
  const observedLoopMatches = signatureMatches.filter(
    (match) =>
      match.kind === "observed" &&
      match.blockSegmentId === focus.segment.segmentId,
  );
  const matchedLoopSignatures = new Set(
    completionLoopMatches.map((match) => match.id),
  );
  const observedLoopSignatures = new Set(
    observedLoopMatches.map((match) => match.id),
  );
  const observedLoopBlockTypes = new Set(
    observedLoopMatches
      .map((match) => normalizeBlockType(match.blockType))
      .filter(Boolean),
  );
  const hasLocalBusinessContext =
    focusTerms.size > 0 ||
    nearbyTerms.size > 0 ||
    segmentTerms.size > 0;

  return {
    hasBusinessContext:
      hasLocalBusinessContext ||
      matchedLoopSignatures.size > 0 ||
      observedLoopSignatures.size > 0 ||
      Boolean(deviceLoopContext) ||
      Boolean(faultResponseContext) ||
      Boolean(faultResetContext) ||
      Boolean(actionLifecycleContext) ||
      isBusinessBlockType(focusBlockType) ||
      [...segmentBlockTypes].some((value) => isBusinessBlockType(value)),
    hasLocalBusinessContext,
    focusKind: focus.node?.kind ?? focus.insertionPoint?.kind ?? "",
    focusTerms,
    nearbyTerms,
    segmentTerms,
    pouTerms,
    focusDataTypes,
    nearbyDataTypes,
    segmentDataTypes,
    localDataTypes,
    focusBlockType,
    segmentBlockTypes,
    relatedSegments,
    relatedTerms,
    relatedDataTypes,
    relatedBlockTypes,
    matchedLoopSignatures,
    completionLoopMatches,
    observedLoopMatches,
    observedLoopBlockTypes,
    descriptorTerms,
    localVariableRoles,
    coherentRoleCount,
    focusReferences,
    actionAnchorName: actionAnchor.name,
    actionAnchorTerms: actionAnchor.terms,
    actionAnchorRoles,
    motionAxisContext,
    deviceLoopContext,
    faultResponseContext,
    faultResetContext,
    actionLifecycleContext,
  };
}

function collectFocusVariableNames(
  focus: FocusContext,
  surroundingNodes: DiagramNodeSummary[],
): string[] {
  const focusNodes = focus.node ? [focus.node] : surroundingNodes;
  return [
    ...new Set(
      focusNodes.flatMap((node) => [...collectNodeReferences(node)]),
    ),
  ];
}

function findRelatedSegments(
  summary: DiagramSummary,
  focusSegment: DiagramSegmentSummary,
  pouVariables: DiagramVariableSummary[],
): RelatedSegmentContext[] {
  const pouName = focusSegment.pouName?.trim();
  if (!pouName) {
    return [];
  }

  const samePouSegments = summary.segments.filter(
    (segment) => segment.pouName?.trim() === pouName,
  );
  const focusIndex = samePouSegments.findIndex(
    (segment) => segment.segmentId === focusSegment.segmentId,
  );
  if (focusIndex < 0) {
    return [];
  }

  const focusSnapshot = buildSegmentBusinessSnapshot(
    focusSegment,
    pouVariables,
  );
  const related = samePouSegments
    .filter((segment) => segment.segmentId !== focusSegment.segmentId)
    .map((segment) => {
      const snapshot = buildSegmentBusinessSnapshot(segment, pouVariables);
      const sharedReferences = intersection(
        focusSnapshot.references,
        snapshot.references,
      );
      const sharedTerms = intersection(focusSnapshot.terms, snapshot.terms);
      const sharedBlockTypes = intersection(
        focusSnapshot.blockTypes,
        snapshot.blockTypes,
      );
      const segmentIndex = samePouSegments.findIndex(
        (item) => item.segmentId === segment.segmentId,
      );
      const isAdjacent = Math.abs(segmentIndex - focusIndex) === 1;
      const isSemanticallyRelated =
        sharedReferences.size > 0 ||
        (sharedTerms.size >= 2 && sharedBlockTypes.size > 0);

      if (!isSemanticallyRelated) {
        return undefined;
      }

      return {
        segment,
        relationScore:
          sharedReferences.size * 10 +
          Math.min(sharedTerms.size, 3) * 2 +
          Math.min(sharedBlockTypes.size, 1) +
          (isAdjacent ? 1 : 0),
        sharedReferences,
        terms: snapshot.terms,
        dataTypes: snapshot.dataTypes,
        blockTypes: snapshot.blockTypes,
      } satisfies RelatedSegmentContext;
    })
    .filter((item): item is RelatedSegmentContext => Boolean(item))
    .sort((left, right) => right.relationScore - left.relationScore)
    .slice(0, 3);

  return related;
}

function buildSegmentBusinessSnapshot(
  segment: DiagramSegmentSummary,
  pouVariables: DiagramVariableSummary[],
): SegmentBusinessSnapshot {
  const dataTypes = collectNodeDataTypes(segment.nodes, pouVariables);
  const knownReferences = new Set(
    pouVariables
      .map((variable) => normalizeReference(variable.name))
      .filter((value) => value.length > 0),
  );
  const terms = collectBusinessTerms([
    segment.label,
    segment.note,
    ...segment.nodes.flatMap((node) => nodeBusinessTexts(node)),
  ]);
  addDerivedTerms(terms, dataTypes);

  return {
    references: collectSegmentReferences(segment, knownReferences),
    terms,
    dataTypes,
    blockTypes: new Set(
      segment.nodes
        .map((node) => normalizeBlockType(node.blockType))
        .filter((value) => value.length > 0),
    ),
  };
}

function collectSegmentReferences(
  segment: DiagramSegmentSummary,
  knownReferences: Set<string>,
): Set<string> {
  return new Set(
    segment.nodes.flatMap((node) =>
      [...collectNodeReferences(node)].filter((value) =>
        knownReferences.has(value),
      ),
    ),
  );
}

function collectNodeReferences(node: DiagramNodeSummary): Set<string> {
  return new Set(
    [
      node.var,
      node.instance,
      ...Object.values(node.inputs ?? {}),
      ...Object.values(node.outputs ?? {}),
    ]
      .map(normalizeReference)
      .filter((value): value is string => Boolean(value)),
  );
}

function findBusinessActionAnchor(
  focus: FocusContext,
): { name: string; terms: Set<BusinessTerm> } {
  const directNode = focus.node;
  if (directNode && isOutputNodeKind(directNode.kind)) {
    const name = actionAnchorName(directNode);
    if (name) {
      return { name, terms: collectBusinessTerms(nodeBusinessTexts(directNode)) };
    }
  }

  const queue = [
    ...(focus.node?.to ?? []),
    ...(focus.insertionPoint?.to ?? []),
  ];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);
    const node = findNode(focus.segment, nodeId);
    if (!node) {
      continue;
    }

    if (isOutputNodeKind(node.kind)) {
      const name = actionAnchorName(node);
      if (name) {
        return { name, terms: collectBusinessTerms(nodeBusinessTexts(node)) };
      }
    }
    queue.push(...node.to);
  }

  return { name: "", terms: new Set<BusinessTerm>() };
}

function actionAnchorName(node: DiagramNodeSummary): string {
  const candidate = isCoilKind(node.kind)
    ? node.var
    : node.instance || node.blockType;
  const normalized = String(candidate ?? "").trim();
  return normalized && !isUnnamedPlaceholder(normalized) ? normalized : "";
}

function maxCoherentRoleCount(
  matches: BusinessVariableRoleMatch[],
): number {
  const rolesByGroup = new Map<string, Set<string>>();
  for (const match of matches) {
    for (const groupKey of match.groupKeys) {
      const roles = rolesByGroup.get(groupKey) ?? new Set<string>();
      roles.add(match.role);
      rolesByGroup.set(groupKey, roles);
    }
  }
  return Math.max(0, ...[...rolesByGroup.values()].map((roles) => roles.size));
}

function analyzeDeviceLoopContext(
  focus: FocusContext,
  variables: DiagramVariableSummary[],
  roleMatches: BusinessVariableRoleMatch[],
  actionAnchor: string,
): DeviceLoopContext | undefined {
  const anchorNode = findDeviceCommandAnchorNode(focus, actionAnchor);
  if (!anchorNode) {
    return undefined;
  }

  const anchorReference = normalizeReference(anchorNode.var);
  const anchorVariable = variables.find(
    (variable) => normalizeReference(variable.name) === anchorReference,
  );
  const anchorRoleMatches = roleMatches.filter(
    (match) => normalizeReference(match.variableName) === anchorReference,
  );
  const anchorRoles = new Set(anchorRoleMatches.map((match) => match.role));
  const anchorTerms = collectBusinessTerms([
    ...nodeBusinessTexts(anchorNode),
    ...(anchorVariable ? variableBusinessTexts(anchorVariable) : []),
  ]);
  if (
    !anchorRoles.has("commandSignal") ||
    !hasDeviceActionTerm(anchorTerms) ||
    anchorTerms.has("stop") ||
    anchorTerms.has("reset") ||
    anchorTerms.has("safety") ||
    anchorTerms.has("fault") ||
    anchorTerms.has("alarm")
  ) {
    return undefined;
  }

  const variablesByReference = new Map(
    variables.map((variable) => [normalizeReference(variable.name), variable]),
  );
  const rolesByReference = new Map<string, Set<string>>();
  for (const match of roleMatches) {
    const reference = normalizeReference(match.variableName);
    const roles = rolesByReference.get(reference) ?? new Set<string>();
    roles.add(match.role);
    rolesByReference.set(reference, roles);
  }
  const candidates: DeviceLoopRoleCandidate[] = [];
  for (const match of roleMatches) {
    if (
      ![
        "readySignal",
        "permitSignal",
        "faultSignal",
        "inhibitSignal",
        "presenceSignal",
      ].includes(match.role)
    ) {
      continue;
    }
    const variable = variablesByReference.get(
      normalizeReference(match.variableName),
    );
    if (!variable || normalizeDataType(variable.type) !== "BOOL") {
      continue;
    }
    const candidateTerms = collectBusinessTerms(variableBusinessTexts(variable));
    if (hasConflictingDeviceActionTerms(anchorTerms, candidateTerms)) {
      continue;
    }
    const association = strongestDeviceAssociation(
      anchorRoleMatches,
      match,
      anchorVariable,
      variable,
    );
    if (!association) {
      continue;
    }
    candidates.push({
      variableName: variable.name,
      dataType: variable.type,
      scope: variable.scope || "VAR",
      role: match.role,
      evidenceScore: match.score,
      associationKey: association.key,
      association: association.strategy,
      relation: "sameAction",
    });
  }

  for (const rule of BUSINESS_RULES_CONFIG.deviceLoopRules) {
    const oppositeConfig = rule.oppositeActionCandidates;
    if (!oppositeConfig) {
      continue;
    }
    for (const match of roleMatches) {
      if (!oppositeConfig.rolesAny.includes(match.role)) {
        continue;
      }
      const candidateReference = normalizeReference(match.variableName);
      if (!candidateReference || candidateReference === anchorReference) {
        continue;
      }
      const variable = variablesByReference.get(candidateReference);
      if (!variable || normalizeDataType(variable.type) !== "BOOL") {
        continue;
      }
      const candidateRoles = rolesByReference.get(candidateReference) ?? new Set();
      if (
        ["runFeedback", "completionSignal", "readySignal", "faultSignal"].some(
          (role) => candidateRoles.has(role),
        )
      ) {
        continue;
      }
      const candidateTerms = collectBusinessTerms(variableBusinessTexts(variable));
      if (
        candidateTerms.has("safety") ||
        candidateTerms.has("fault") ||
        candidateTerms.has("alarm") ||
        candidateTerms.has("reset") ||
        candidateTerms.has("stop")
      ) {
        continue;
      }
      const pair = oppositeActionPair(
        anchorTerms,
        candidateTerms,
        oppositeConfig.pairs,
      );
      if (!pair) {
        continue;
      }
      const association = strongestDeviceAssociation(
        anchorRoleMatches,
        match,
        anchorVariable,
        variable,
      );
      if (!association) {
        continue;
      }
      candidates.push({
        variableName: variable.name,
        dataType: variable.type,
        scope: variable.scope || "VAR",
        role: match.role,
        evidenceScore: match.score,
        associationKey: association.key,
        association: association.strategy,
        relation: "oppositeAction",
        relationRuleId: rule.id,
        relationId: pair.id,
      });
    }
  }

  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort(
    (left, right) =>
      deviceAssociationWeight(right.association) -
        deviceAssociationWeight(left.association) ||
      right.evidenceScore - left.evidenceScore ||
      left.variableName.localeCompare(right.variableName),
  );

  return {
    action: {
      nodeId: anchorNode.id,
      variableName: anchorNode.var?.trim() || actionAnchor,
      roles: anchorRoles,
      terms: anchorTerms,
    },
    candidates: dedupeDeviceLoopCandidates(candidates),
    existingCommandPathReferences: collectUpstreamReferences(
      focus.segment,
      anchorNode.id,
    ),
  };
}

function analyzeFaultResponseContext(
  focus: FocusContext,
  variables: DiagramVariableSummary[],
  roleMatches: BusinessVariableRoleMatch[],
): FaultResponseContext | undefined {
  const anchorNode = focus.node;
  if (!anchorNode) {
    return undefined;
  }

  const candidateAnchorReferences = isContactKind(anchorNode.kind)
    ? [normalizeReference(anchorNode.var)]
    : anchorNode.kind === "FBDCompartment"
      ? (anchorNode.outputPorts ?? [])
          .map((port) => normalizeReference(port.value))
          .filter(Boolean)
      : [];
  const responseAnchorReferences = uniqueDisplayNames(
    candidateAnchorReferences,
  ).filter((reference) =>
    roleMatches.some(
      (match) =>
        normalizeReference(match.variableName) === reference &&
        ["faultSignal", "timeoutSignal"].includes(match.role) &&
        !roleMatches.some(
          (other) =>
            normalizeReference(other.variableName) === reference &&
            ["alarmOutput", "faultLatch"].includes(other.role),
        ),
    ),
  );
  if (responseAnchorReferences.length !== 1) {
    return undefined;
  }
  const anchorReference = responseAnchorReferences[0];
  const anchorVariable = variables.find(
    (variable) => normalizeReference(variable.name) === anchorReference,
  );
  const anchorRoleMatches = roleMatches.filter(
    (match) => normalizeReference(match.variableName) === anchorReference,
  );
  const anchorRoles = new Set(anchorRoleMatches.map((match) => match.role));
  const anchorTerms = collectBusinessTerms([
    ...nodeBusinessTexts(anchorNode),
    ...(anchorVariable ? variableBusinessTexts(anchorVariable) : []),
  ]);
  if (
    !["faultSignal", "timeoutSignal"].some((role) => anchorRoles.has(role)) ||
    anchorRoles.has("alarmOutput") ||
    anchorRoles.has("faultLatch") ||
    anchorTerms.has("safety") ||
    anchorTerms.has("reset")
  ) {
    return undefined;
  }

  const variablesByReference = new Map(
    variables.map((variable) => [normalizeReference(variable.name), variable]),
  );
  const candidates: DeviceLoopRoleCandidate[] = [];
  for (const match of roleMatches) {
    if (!["alarmOutput", "faultLatch"].includes(match.role)) {
      continue;
    }
    const variable = variablesByReference.get(
      normalizeReference(match.variableName),
    );
    if (!variable || normalizeDataType(variable.type) !== "BOOL") {
      continue;
    }
    if (hasConflictingExplicitGroups(anchorRoleMatches, match)) {
      continue;
    }
    const candidateTerms = collectBusinessTerms(variableBusinessTexts(variable));
    if (hasConflictingDeviceActionTerms(anchorTerms, candidateTerms)) {
      continue;
    }
    const association = strongestDeviceAssociation(
      anchorRoleMatches,
      match,
      anchorVariable,
      variable,
    );
    if (!association) {
      continue;
    }
    candidates.push({
      variableName: variable.name,
      dataType: variable.type,
      scope: variable.scope || "VAR",
      role: match.role,
      evidenceScore: match.score,
      associationKey: association.key,
      association: association.strategy,
    });
  }
  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort(
    (left, right) =>
      deviceAssociationWeight(right.association) -
        deviceAssociationWeight(left.association) ||
      right.evidenceScore - left.evidenceScore ||
      left.variableName.localeCompare(right.variableName),
  );
  return {
    condition: {
      nodeId: anchorNode.id,
      variableName:
        variables.find(
          (variable) => normalizeReference(variable.name) === anchorReference,
        )?.name ?? anchorReference,
      roles: anchorRoles,
      terms: anchorTerms,
    },
    candidates: dedupeDeviceLoopCandidates(candidates),
    existingOutputPathReferences: collectDownstreamReferences(
      focus.segment,
      anchorNode.id,
    ),
  };
}

function analyzeFaultResetContext(
  summary: DiagramSummary,
  focus: FocusContext,
  variables: DiagramVariableSummary[],
  roleMatches: BusinessVariableRoleMatch[],
): FaultResetContext | undefined {
  const anchorNode = focus.node;
  if (!anchorNode || !isContactKind(anchorNode.kind)) {
    return undefined;
  }

  const anchorReference = normalizeReference(anchorNode.var);
  if (!anchorReference) {
    return undefined;
  }
  const anchorVariable = variables.find(
    (variable) => normalizeReference(variable.name) === anchorReference,
  );
  const anchorRoleMatches = roleMatches.filter(
    (match) => normalizeReference(match.variableName) === anchorReference,
  );
  const anchorRoles = new Set(anchorRoleMatches.map((match) => match.role));
  const anchorTerms = collectBusinessTerms([
    ...nodeBusinessTexts(anchorNode),
    ...(anchorVariable ? variableBusinessTexts(anchorVariable) : []),
    focus.segment.label,
    focus.segment.note,
  ]);
  if (!anchorRoles.has("resetCommand") || anchorTerms.has("safety")) {
    return undefined;
  }

  const pouName = (focus.segment.pouName || summary.pouName).trim();
  const samePouSegments = summary.segments.filter(
    (segment) => (segment.pouName || summary.pouName).trim() === pouName,
  );
  const existingResetReferences = new Set(
    samePouSegments.flatMap((segment) =>
      segment.nodes
        .filter((node) => node.kind === "resetCoil")
        .map((node) => normalizeReference(node.var))
        .filter(Boolean),
    ),
  );
  const setCoilReferences = new Set(
    samePouSegments
      .filter((segment) => segment.segmentId !== focus.segment.segmentId)
      .flatMap((segment) =>
        segment.nodes
          .filter((node) => node.kind === "setCoil")
          .map((node) => normalizeReference(node.var))
          .filter(Boolean),
      ),
  );
  if (setCoilReferences.size === 0) {
    return undefined;
  }

  const variablesByReference = new Map(
    variables.map((variable) => [normalizeReference(variable.name), variable]),
  );
  const candidates: DeviceLoopRoleCandidate[] = [];
  for (const match of roleMatches) {
    const candidateReference = normalizeReference(match.variableName);
    if (
      match.role !== "faultLatch" ||
      !setCoilReferences.has(candidateReference) ||
      existingResetReferences.has(candidateReference)
    ) {
      continue;
    }
    const variable = variablesByReference.get(candidateReference);
    if (!variable || normalizeDataType(variable.type) !== "BOOL") {
      continue;
    }
    if (hasConflictingExplicitGroups(anchorRoleMatches, match)) {
      continue;
    }
    const candidateTerms = collectBusinessTerms(variableBusinessTexts(variable));
    if (hasConflictingDeviceActionTerms(anchorTerms, candidateTerms)) {
      continue;
    }
    const association = strongestDeviceAssociation(
      anchorRoleMatches,
      match,
      anchorVariable,
      variable,
      "resetCommand",
    );
    if (!association) {
      continue;
    }
    candidates.push({
      variableName: variable.name,
      dataType: variable.type,
      scope: variable.scope || "VAR",
      role: match.role,
      evidenceScore: match.score,
      associationKey: association.key,
      association: association.strategy,
    });
  }
  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort(
    (left, right) =>
      deviceAssociationWeight(right.association) -
        deviceAssociationWeight(left.association) ||
      right.evidenceScore - left.evidenceScore ||
      left.variableName.localeCompare(right.variableName),
  );
  return {
    resetCommand: {
      nodeId: anchorNode.id,
      variableName: anchorVariable?.name ?? anchorNode.var?.trim() ?? "",
      roles: anchorRoles,
      terms: anchorTerms,
    },
    candidates: dedupeDeviceLoopCandidates(candidates),
  };
}

function analyzeActionLifecycleContext(
  summary: DiagramSummary,
  focus: FocusContext,
  variables: DiagramVariableSummary[],
  roleMatches: BusinessVariableRoleMatch[],
): ActionLifecycleContext | undefined {
  const anchorNode = focus.node;
  if (!anchorNode) {
    return undefined;
  }
  if (isCounterBlockType(normalizeBlockType(anchorNode.blockType))) {
    return analyzeCounterCompletionLifecycleContext(
      summary,
      focus,
      variables,
      roleMatches,
    );
  }
  if (!isContactKind(anchorNode.kind)) {
    return undefined;
  }
  const anchorReference = normalizeReference(anchorNode.var);
  if (!anchorReference) {
    return undefined;
  }
  const anchorVariable = variables.find(
    (variable) => normalizeReference(variable.name) === anchorReference,
  );
  const anchorRoleMatches = roleMatches.filter(
    (match) => normalizeReference(match.variableName) === anchorReference,
  );
  const anchorRoles = new Set(anchorRoleMatches.map((match) => match.role));
  const anchorTerms = collectBusinessTerms([
    ...nodeBusinessTexts(anchorNode),
    ...(anchorVariable ? variableBusinessTexts(anchorVariable) : []),
    focus.segment.label,
    focus.segment.note,
  ]);
  if (anchorTerms.has("safety")) {
    return undefined;
  }

  const pouName = (focus.segment.pouName || summary.pouName).trim();
  const samePouSegments = summary.segments.filter(
    (segment) => (segment.pouName || summary.pouName).trim() === pouName,
  );
  const variablesByReference = new Map(
    variables.map((variable) => [normalizeReference(variable.name), variable]),
  );
  const outputNodes = samePouSegments.flatMap((segment) =>
    segment.nodes.filter((node) => isCoilKind(node.kind)),
  );
  const actionOutputs = outputNodes
    .map((node) => {
      const reference = normalizeReference(node.var);
      const variable = variablesByReference.get(reference);
      const matches = roleMatches.filter(
        (match) =>
          normalizeReference(match.variableName) === reference &&
          ["actionOutput", "commandSignal"].includes(match.role),
      );
      if (!reference || !variable || normalizeDataType(variable.type) !== "BOOL") {
        return undefined;
      }
      const outputTerms = collectBusinessTerms([
        ...nodeBusinessTexts(node),
        ...variableBusinessTexts(variable),
      ]);
      return { node, variable, matches, terms: outputTerms };
    })
    .filter(
      (
        item,
      ): item is {
        node: DiagramNodeSummary;
        variable: DiagramVariableSummary;
        matches: BusinessVariableRoleMatch[];
        terms: Set<BusinessTerm>;
      } => Boolean(item),
    );
  const candidates: ActionLifecycleCandidate[] = [];
  const existingUpstreamReferences = collectUpstreamReferences(
    focus.segment,
    anchorNode.id,
  );

  for (const output of actionOutputs) {
    if (output.matches.length === 0) {
      continue;
    }
    if (hasConflictingDeviceActionTerms(anchorTerms, output.terms)) {
      continue;
    }
    const outputRole = output.matches.find((match) => match.role === "actionOutput") ?? output.matches[0];
    const association = strongestDeviceAssociation(
      anchorRoleMatches,
      outputRole,
      anchorVariable,
      output.variable,
      anchorRoles.has("stopCommand") ? "stopCommand" : "startCommand",
    );
    if (!association) {
      continue;
    }
    if (
      anchorRoles.has("startCommand") &&
      existingUpstreamReferences.has(normalizeReference(output.variable.name))
    ) {
      continue;
    }
    const roleForAction = anchorRoles.has("stopCommand")
      ? "stopCommand"
      : anchorRoles.has("startCommand")
        ? "startCommand"
        : "commandSignal";
    const actionName = output.variable.name;
    if (roleForAction === "startCommand" || roleForAction === "commandSignal") {
      if (
        !samePouSegments.some(
          (segment) =>
            segment.segmentId === focus.segment.segmentId &&
            canReachNode(segment, anchorNode.id, output.node.id),
        )
      ) {
        continue;
      }
      const existingSelfHold = samePouSegments.some((segment) =>
        segment.nodes.some(
          (node) =>
            isContactKind(node.kind) &&
            node.id !== anchorNode.id &&
            normalizeReference(node.var) ===
              normalizeReference(output.variable.name) &&
            canReachNode(segment, node.id, output.node.id),
        ),
      );
      if (!existingSelfHold) {
        candidates.push({
          variableName: output.variable.name,
          dataType: output.variable.type,
          scope: output.variable.scope || "VAR",
          role: "actionOutput",
          evidenceScore: outputRole.score,
          associationKey: association.key,
          association: association.strategy,
          kind: "selfHold",
          actionName,
        });
      }
    }
    if (anchorRoles.has("stopCommand")) {
      const existingReset = samePouSegments.some((segment) =>
        segment.nodes.some(
          (node) =>
            node.kind === "resetCoil" &&
            normalizeReference(node.var) ===
              normalizeReference(output.variable.name),
        ),
      );
      if (!existingReset && outputNodes.some((node) => node.kind === "setCoil")) {
        candidates.push({
          variableName: output.variable.name,
          dataType: output.variable.type,
          scope: output.variable.scope || "VAR",
          role: "actionOutput",
          evidenceScore: outputRole.score,
          associationKey: association.key,
          association: association.strategy,
          kind: "latchedRelease",
          actionName,
        });
      }
    }
  }

  const stopRole = anchorRoles.has("stopCommand") || anchorTerms.has("stop");
  const startRole = anchorRoles.has("startCommand") || anchorTerms.has("start");
  if (!stopRole && !startRole) {
    return undefined;
  }
  for (const match of roleMatches) {
    if (match.role !== "stopCommand" || !startRole) {
      continue;
    }
    const variable = variablesByReference.get(normalizeReference(match.variableName));
    if (!variable || normalizeDataType(variable.type) !== "BOOL") {
      continue;
    }
    if (hasConflictingExplicitGroups(anchorRoleMatches, match)) {
      continue;
    }
    const association = strongestDeviceAssociation(
      anchorRoleMatches,
      match,
      anchorVariable,
      variable,
      "startCommand",
    );
    if (!association) {
      continue;
    }
    candidates.push({
      variableName: variable.name,
      dataType: variable.type,
      scope: variable.scope || "VAR",
      role: "stopCommand",
      evidenceScore: match.score,
      associationKey: association.key,
      association: association.strategy,
      kind: "stopInterlock",
      actionName: anchorVariable?.name ?? anchorNode.var ?? "",
    });
  }
  if (candidates.length === 0) {
    return undefined;
  }
  return {
    anchor: {
      nodeId: anchorNode.id,
      variableName: anchorVariable?.name ?? anchorNode.var?.trim() ?? "",
      roles: anchorRoles,
      terms: anchorTerms,
    },
    candidates: candidates.filter(
      (candidate, index, all) =>
        all.findIndex(
          (item) =>
            item.kind === candidate.kind &&
            normalizeReference(item.variableName) ===
              normalizeReference(candidate.variableName),
        ) === index,
    ),
  };
}

function analyzeCounterCompletionLifecycleContext(
  summary: DiagramSummary,
  focus: FocusContext,
  variables: DiagramVariableSummary[],
  roleMatches: BusinessVariableRoleMatch[],
): ActionLifecycleContext | undefined {
  const anchorNode = focus.node;
  if (
    !anchorNode ||
    !isCounterBlockType(normalizeBlockType(anchorNode.blockType))
  ) {
    return undefined;
  }

  const completionPorts = (anchorNode.outputPorts ?? []).filter(
    (port) =>
      ["Q", "QU", "QD"].includes(port.name.trim().toUpperCase()) &&
      normalizeDataType(port.type) === "BOOL" &&
      Boolean(normalizeReference(port.value)),
  );
  if (completionPorts.length !== 1) {
    return undefined;
  }

  const completionReference = normalizeReference(completionPorts[0].value);
  const anchorVariable = variables.find(
    (variable) => normalizeReference(variable.name) === completionReference,
  );
  if (!anchorVariable) {
    return undefined;
  }
  const anchorRoleMatches = roleMatches.filter(
    (match) => normalizeReference(match.variableName) === completionReference,
  );
  const anchorRoles = new Set(anchorRoleMatches.map((match) => match.role));
  const anchorTerms = collectBusinessTerms([
    ...nodeBusinessTexts(anchorNode),
    ...variableBusinessTexts(anchorVariable),
    focus.segment.label,
    focus.segment.note,
  ]);
  if (!anchorRoles.has("completionSignal") || anchorTerms.has("safety")) {
    return undefined;
  }

  const pouName = (focus.segment.pouName || summary.pouName).trim();
  const samePouSegments = summary.segments.filter(
    (segment) => (segment.pouName || summary.pouName).trim() === pouName,
  );
  const existingOutputReferences = new Set(
    samePouSegments.flatMap((segment) =>
      segment.nodes
        .filter((node) => isCoilKind(node.kind))
        .map((node) => normalizeReference(node.var))
        .filter(Boolean),
    ),
  );
  const variablesByReference = new Map(
    variables.map((variable) => [normalizeReference(variable.name), variable]),
  );
  const candidates: ActionLifecycleCandidate[] = [];
  const candidateReferences = new Set(
    roleMatches
      .filter((match) =>
        ["batchCompletionOutput", "batchCompletionLatch"].includes(match.role),
      )
      .map((match) => normalizeReference(match.variableName))
      .filter(Boolean),
  );

  for (const candidateReference of candidateReferences) {
    if (
      candidateReference === completionReference ||
      existingOutputReferences.has(candidateReference)
    ) {
      continue;
    }
    const variable = variablesByReference.get(candidateReference);
    if (!variable || normalizeDataType(variable.type) !== "BOOL") {
      continue;
    }
    const candidateMatches = roleMatches.filter(
      (match) =>
        normalizeReference(match.variableName) === candidateReference &&
        ["batchCompletionOutput", "batchCompletionLatch"].includes(match.role),
    );
    const candidateMatch =
      candidateMatches.find((match) => match.role === "batchCompletionLatch") ??
      candidateMatches.find((match) => match.role === "batchCompletionOutput");
    if (!candidateMatch || hasConflictingExplicitGroups(anchorRoleMatches, candidateMatch)) {
      continue;
    }
    const association = strongestDeviceAssociation(
      anchorRoleMatches,
      candidateMatch,
      anchorVariable,
      variable,
      "completionSignal",
    );
    if (!association) {
      continue;
    }
    const isLatch = candidateMatch.role === "batchCompletionLatch";
    candidates.push({
      variableName: variable.name,
      dataType: variable.type,
      scope: variable.scope || "VAR",
      role: candidateMatch.role,
      evidenceScore: candidateMatch.score,
      associationKey: association.key,
      association: association.strategy,
      kind: isLatch ? "countCompletionLatch" : "countCompletionOutput",
      actionName: anchorVariable.name,
    });
  }

  if (candidates.length === 0) {
    return undefined;
  }
  candidates.sort(
    (left, right) =>
      deviceAssociationWeight(right.association) -
        deviceAssociationWeight(left.association) ||
      right.evidenceScore - left.evidenceScore ||
      left.variableName.localeCompare(right.variableName),
  );
  return {
    anchor: {
      nodeId: anchorNode.id,
      variableName: anchorVariable.name,
      roles: anchorRoles,
      terms: anchorTerms,
    },
    candidates,
  };
}

function hasConflictingExplicitGroups(
  anchorMatches: BusinessVariableRoleMatch[],
  candidate: BusinessVariableRoleMatch,
): boolean {
  const anchorGroups = new Set(
    anchorMatches
      .flatMap((match) => match.groupKeys)
      .filter((key) => key.startsWith("group:")),
  );
  const candidateGroups = candidate.groupKeys.filter((key) =>
    key.startsWith("group:"),
  );
  return (
    anchorGroups.size > 0 &&
    candidateGroups.length > 0 &&
    !candidateGroups.some((key) => anchorGroups.has(key))
  );
}

const DEVICE_ACTION_TERMS = new Set([
  "start",
  "run",
  "enable",
  "open",
  "extend",
  "clamp",
  "retract",
  "close",
  "push",
  "feed",
  "seal",
  "cut",
  "release",
  "move",
  "forward",
  "reverse",
  "heat",
  "cool",
]);

const DEVICE_ACTION_NAME_TOKENS = new Set([
  ...DEVICE_ACTION_TERMS,
  "home",
]);

const DEVICE_SPECIFIC_ACTION_TERMS = new Set([
  "open",
  "extend",
  "clamp",
  "retract",
  "close",
  "push",
  "feed",
  "seal",
  "cut",
  "release",
  "move",
  "forward",
  "reverse",
  "heat",
  "cool",
]);

function hasDeviceActionTerm(terms: Set<BusinessTerm>): boolean {
  return [...DEVICE_ACTION_TERMS].some((term) => terms.has(term));
}

function hasConflictingDeviceActionTerms(
  anchorTerms: Set<BusinessTerm>,
  candidateTerms: Set<BusinessTerm>,
): boolean {
  const anchorActions = [...DEVICE_SPECIFIC_ACTION_TERMS].filter((term) =>
    anchorTerms.has(term),
  );
  const candidateActions = [...DEVICE_SPECIFIC_ACTION_TERMS].filter((term) =>
    candidateTerms.has(term),
  );
  return (
    anchorActions.length > 0 &&
    candidateActions.length > 0 &&
    !anchorActions.some((term) => candidateActions.includes(term))
  );
}

function oppositeActionPair(
  anchorTerms: Set<BusinessTerm>,
  candidateTerms: Set<BusinessTerm>,
  pairs: BusinessOppositeActionPairConfig[],
): BusinessOppositeActionPairConfig | undefined {
  return pairs.find((pair) => {
    const anchorLeft = pair.leftTerms.some((term) => anchorTerms.has(term));
    const anchorRight = pair.rightTerms.some((term) => anchorTerms.has(term));
    const candidateLeft = pair.leftTerms.some((term) => candidateTerms.has(term));
    const candidateRight = pair.rightTerms.some((term) =>
      candidateTerms.has(term),
    );
    return (
      (anchorLeft && !anchorRight && candidateRight && !candidateLeft) ||
      (anchorRight && !anchorLeft && candidateLeft && !candidateRight)
    );
  });
}

function findDeviceCommandAnchorNode(
  focus: FocusContext,
  actionAnchor: string,
): DiagramNodeSummary | undefined {
  const normalizedAction = normalizeReference(actionAnchor);
  if (!normalizedAction) {
    return undefined;
  }
  if (
    focus.node &&
    isCoilKind(focus.node.kind) &&
    normalizeReference(focus.node.var) === normalizedAction
  ) {
    return focus.node;
  }
  return focus.segment.nodes.find(
    (node) =>
      isCoilKind(node.kind) &&
      normalizeReference(node.var) === normalizedAction,
  );
}

function strongestDeviceAssociation(
  anchorMatches: BusinessVariableRoleMatch[],
  candidate: BusinessVariableRoleMatch,
  anchorVariable: DiagramVariableSummary | undefined,
  candidateVariable: DiagramVariableSummary,
  anchorRole = "commandSignal",
):
  | { key: string; strategy: DeviceLoopRoleCandidate["association"] }
  | undefined {
  const anchorKeys = new Set(anchorMatches.flatMap((match) => match.groupKeys));
  const sharedKeys = candidate.groupKeys.filter((key) => anchorKeys.has(key));
  for (const strategy of ["groupId", "deviceId"] as const) {
    const key = sharedKeys
      .filter((item) => deviceAssociationStrategy(item) === strategy)
      .sort((left, right) => right.length - left.length)[0];
    if (key) {
      return { key, strategy };
    }
  }
  const anchorHasExplicitGroup = [...anchorKeys].some((key) =>
    ["groupId", "deviceId"].includes(deviceAssociationStrategy(key)),
  );
  const candidateHasExplicitGroup = candidate.groupKeys.some((key) =>
    ["groupId", "deviceId"].includes(deviceAssociationStrategy(key)),
  );
  if (anchorHasExplicitGroup && candidateHasExplicitGroup) {
    return undefined;
  }

  const anchorDescriptionStems = deviceDescriptionStems(
    anchorVariable,
    anchorRole,
  );
  const candidateDescriptionStems = new Set(
    deviceDescriptionStems(candidateVariable, candidate.role),
  );
  const descriptionStem = anchorDescriptionStems.find((stem) =>
    candidateDescriptionStems.has(stem),
  );
  if (descriptionStem) {
    return {
      key: `description:${descriptionStem}`,
      strategy: "descriptionStem",
    };
  }

  const anchorNameStem = deviceVariableNameStem(
    anchorVariable?.name ?? anchorMatches[0]?.variableName ?? "",
    anchorRole,
  );
  const candidateNameStem = deviceVariableNameStem(
    candidateVariable.name,
    candidate.role,
  );
  if (anchorNameStem && anchorNameStem === candidateNameStem) {
    return { key: `name:${anchorNameStem}`, strategy: "nameStem" };
  }
  return undefined;
}

function deviceDescriptionStems(
  variable: DiagramVariableSummary | undefined,
  role: string,
): string[] {
  if (!variable) {
    return [];
  }
  return uniqueDisplayNames(
    [variable.label, variable.note, variable.comment]
      .map((value) => deviceDescriptionStem(value, role))
      .filter(Boolean),
  ).map((value) => value.toLowerCase());
}

function deviceDescriptionStem(
  value: string | undefined,
  role: string,
): string {
  let normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-.、，,:：;；()（）\[\]【】]+/gu, "");
  if (!normalized) {
    return "";
  }

  const rolePhrases =
    role === "commandSignal"
      ? [
          "启动命令", "运行命令", "使能命令", "执行命令", "控制命令",
          "动作命令", "启动请求", "运行请求", "开门请求", "开阀请求",
          "伸出请求", "command", "request", "start", "run", "enable",
          "open", "extend", "forward", "reverse", "heat", "cool", "cmd", "req",
          "命令", "请求", "启动", "运行", "使能", "开门", "开阀", "伸出",
          "正转", "反转", "加热", "冷却",
        ]
      : role === "startCommand"
        ? [
            "启动按钮", "启动命令", "启动请求", "运行按钮", "运行命令", "运行请求",
            "startbutton", "startcommand", "runbutton", "runcommand", "start", "run",
            "按钮", "命令", "请求", "信号",
          ]
        : role === "stopCommand"
          ? [
              "停止按钮", "停止命令", "停止请求", "停机按钮", "停机命令",
              "stopbutton", "stopcommand", "stoprequest", "stop", "按钮", "命令", "请求", "信号",
            ]
        : role === "actionOutput"
          ? [
              "运行输出", "运行状态", "动作输出", "动作状态", "设备运行", "执行输出",
              "actionoutput", "runoutput", "running", "active", "运行", "输出", "状态", "信号",
            ]
        : role === "completionSignal"
          ? [
              "计数完成信号", "计数器完成输出", "批次计数完成信号", "完成信号",
              "counterdone", "countercomplete", "completion", "complete", "done",
              "计数", "计数器", "完成", "输出", "状态", "信号",
            ]
        : role === "batchCompletionOutput"
          ? [
              "批次完成输出", "批次完成状态", "批次完成信号", "批次完成",
              "batchcomplete", "batchdone", "lotdone", "批次", "批量",
              "完成", "输出", "状态", "信号",
            ]
        : role === "batchCompletionLatch"
          ? [
              "批次完成状态锁存", "批次完成锁存", "批次完成保持",
              "batchcompletionlatch", "batchdonelatched", "批次", "批量",
              "完成", "锁存", "保持", "输出", "状态", "信号",
            ]
      : role === "readySignal"
        ? [
            "设备就绪", "就绪信号", "设备健康", "健康状态", "可用状态",
            "可用信号", "待机可用", "readysignal", "healthysignal",
            "available", "standby", "healthy", "ready", "就绪", "健康", "可用",
            "状态", "信号",
          ]
        : role === "startCommand"
          ? ["start", "run", "button", "command", "cmd", "request", "req", "signal"]
        : role === "stopCommand"
          ? ["stop", "button", "command", "cmd", "request", "req", "signal"]
        : role === "actionOutput"
          ? ["run", "running", "active", "output", "out", "command", "cmd", "status", "signal"]
        : role === "resetCommand"
          ? [
              "故障复位命令", "报警复位命令", "故障复位按钮", "报警复位按钮",
              "确认复位", "复位命令", "复位按钮", "resetcommand", "resetbutton",
              "acknowledge", "reset", "clear", "ack", "复位", "确认", "清除",
              "命令", "按钮", "请求", "信号",
            ]
        : role === "permitSignal"
          ? [
              "运行许可", "启动许可", "允许运行", "许可条件", "允许条件",
              "联锁正常", "联锁满足", "许可信号", "permit", "permissive",
              "interlockok", "enableok", "allowed", "许可", "允许", "联锁",
            ]
          : role === "inhibitSignal"
            ? [
                "阻断信号", "阻断状态", "禁止信号", "禁止动作", "堵料信号",
                "堵料状态", "跳闸信号", "blocksignal", "inhibitsignal",
                "blocked", "inhibit", "jam", "trip", "阻断", "禁止", "堵料", "跳闸",
              ]
              : role === "presenceSignal"
              ? [
                  "入口检测", "出口检测", "入口光电", "出口光电", "物料存在",
                  "工件存在", "有料状态", "占位状态", "present", "occupied",
                  "entrysensor", "exitsensor", "photoelectric", "photoeye",
                  "material", "workpiece", "part", "传感器", "检测", "光电",
                ]
              : role === "alarmOutput"
                ? [
                    "故障报警输出", "超时报警输出", "报警输出", "告警输出",
                    "alarmoutput", "warningoutput", "faultalarm", "报警", "告警",
                    "输出", "状态", "信号",
                  ]
                : role === "faultLatch"
                  ? [
                      "故障锁存", "报警锁存", "故障保持输出", "报警保持输出",
                      "faultlatched", "alarmlatched", "faultlatch", "alarmlatch",
                      "锁存", "保持", "输出", "状态", "信号",
                    ]
                  : role === "timeoutSignal"
                    ? [
                        "反馈超时输出", "动作超时输出", "超时条件", "超时信号",
                        "超时状态", "timeoutsignal", "timeout", "超时", "状态", "信号",
                      ]
                    : [
                  "故障信号", "故障状态", "设备故障", "错误信号", "过载信号",
                  "过载状态", "变频器故障", "faultsignal", "failure", "overload",
                  "error", "fault", "故障", "错误", "异常", "过载", "状态", "信号",
                      ];
  for (const phrase of rolePhrases.sort((left, right) => right.length - left.length)) {
    normalized = normalized.replaceAll(phrase, "");
  }
  for (const phrase of [
    "clamp", "retract", "extend", "open", "close", "push", "feed", "seal",
    "cut", "release", "move", "forward", "reverse", "heat", "cool", "夹紧",
    "缩回", "伸出", "开门", "开阀", "关门", "关阀", "推料", "送料",
    "封口", "切断", "释放", "正转", "反转", "加热", "冷却", "动作",
  ]) {
    normalized = normalized.replaceAll(phrase, "");
  }
  return isReliableDeviceStem(normalized) ? normalized : "";
}

function deviceVariableNameStem(name: string, role: string): string {
  const tokens = splitBusinessIdentifierWords(name)
    .toLowerCase()
    .split(/[^a-z0-9\u0080-\uFFFF]+/gu)
    .filter(Boolean);
  const roleTokens = new Set(
    role === "commandSignal"
      ? ["command", "cmd", "request", "req", "start", "run", "enable", "open", "extend", "forward", "reverse", "heat", "cool"]
      : role === "readySignal"
        ? ["ready", "available", "standby", "healthy", "status", "signal"]
        : role === "completionSignal"
          ? ["counter", "count", "completion", "complete", "completed", "done", "output", "out", "status", "signal", "q", "qu", "qd"]
        : role === "batchCompletionOutput"
          ? ["batch", "lot", "completion", "complete", "completed", "done", "finished", "output", "out", "status", "signal"]
        : role === "batchCompletionLatch"
          ? ["batch", "lot", "completion", "complete", "completed", "done", "latched", "latch", "hold", "output", "out", "status", "signal"]
        : role === "resetCommand"
          ? [
              "fault", "alarm", "reset", "ack", "acknowledge", "clear",
              "command", "cmd", "request", "req", "button", "pb", "signal",
            ]
        : role === "permitSignal"
          ? ["permit", "permissive", "allowed", "allow", "interlock", "ok", "enable", "status", "signal"]
          : role === "inhibitSignal"
            ? ["block", "blocked", "inhibit", "inhibited", "jam", "trip", "status", "signal"]
            : role === "presenceSignal"
              ? [
                  "present", "occupied", "entry", "exit", "sensor", "photoelectric",
                  "photoeye", "material", "workpiece", "part", "pe", "status", "signal",
                ]
              : role === "alarmOutput"
                ? ["alarm", "warning", "fault", "output", "out", "status", "signal"]
                : role === "faultLatch"
                  ? ["fault", "alarm", "latched", "latch", "hold", "output", "status", "signal"]
                  : role === "timeoutSignal"
                    ? ["feedback", "action", "timeout", "timed", "out", "status", "signal"]
                    : ["fault", "failure", "error", "overload", "ol", "status", "signal"],
  );
  for (const token of DEVICE_ACTION_NAME_TOKENS) {
    roleTokens.add(token);
  }
  while (tokens.length > 0 && roleTokens.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  const stem = tokens.join("_");
  return isReliableDeviceStem(stem) ? stem : "";
}

function isReliableDeviceStem(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return Boolean(
    normalized &&
      normalized.length >= 2 &&
      !["device", "equipment", "设备", "机器", "信号", "状态"].includes(
        normalized,
      ),
  );
}

function deviceAssociationStrategy(
  groupKey: string,
): DeviceLoopRoleCandidate["association"] {
  if (groupKey.startsWith("group:")) {
    return "groupId";
  }
  return groupKey.startsWith("device:") ? "deviceId" : "nameStem";
}

function deviceAssociationWeight(
  association: DeviceLoopRoleCandidate["association"],
): number {
  return association === "groupId"
    ? 4
    : association === "deviceId"
      ? 3
      : association === "descriptionStem"
        ? 2
        : 1;
}

function dedupeDeviceLoopCandidates(
  candidates: DeviceLoopRoleCandidate[],
): DeviceLoopRoleCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key =
      candidate.relation === "oppositeAction"
        ? `${normalizeReference(candidate.variableName)}:oppositeAction:${candidate.relationRuleId}`
        : `${normalizeReference(candidate.variableName)}:${candidate.role}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function collectUpstreamReferences(
  segment: DiagramSegmentSummary,
  targetNodeId: string,
): Set<string> {
  const references = new Set<string>();
  const visited = new Set<string>();
  const queue = [...(findNode(segment, targetNodeId)?.from ?? [])];
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
    for (const reference of collectNodeReferences(node)) {
      references.add(reference);
    }
    queue.push(...node.from);
  }
  return references;
}

function collectDownstreamReferences(
  segment: DiagramSegmentSummary,
  sourceNodeId: string,
): Set<string> {
  const references = new Set<string>();
  const visited = new Set<string>();
  const queue = [...(findNode(segment, sourceNodeId)?.to ?? [])];
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
    for (const reference of collectNodeReferences(node)) {
      references.add(reference);
    }
    queue.push(...node.to);
  }
  return references;
}

function normalizeReference(value: string | undefined): string {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (
    !normalized ||
    normalized === "???" ||
    normalized === "TRUE" ||
    normalized === "FALSE" ||
    normalized === "NULL" ||
    /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized) ||
    normalized.startsWith("\"") ||
    normalized.startsWith("'")
  ) {
    return "";
  }

  return normalized;
}

function analyzeMotionAxisContext(
  summary: DiagramSummary,
  focus: FocusContext,
): MotionAxisContext | undefined {
  const resolvedAxis = resolveMotionAxisReference(focus);
  if (!resolvedAxis) {
    return undefined;
  }

  const pouName = (focus.segment.pouName || summary.pouName).trim();
  const samePouSegments = summary.segments.filter(
    (segment) => (segment.pouName || summary.pouName).trim() === pouName,
  );
  const normalizedAxisReference = normalizeReference(
    resolvedAxis.axisReference,
  );
  const commands = samePouSegments.flatMap((segment) =>
    segment.nodes.flatMap((node): MotionAxisCommandInstance[] => {
      const blockType = normalizeBlockType(node.blockType);
      const profile = motionCommandProfileForBlockType(blockType);
      if (!profile) {
        return [];
      }

      const axisReference = motionAxisReferenceForNode(node);
      if (normalizeReference(axisReference) !== normalizedAxisReference) {
        return [];
      }

      const triggerReference = motionPortReferencesForNode(
        node,
        [profile.triggerPort],
        "input",
      )[0] ?? "";
      return [{
        nodeId: node.id,
        segmentId: segment.segmentId,
        blockType: node.blockType?.trim() || blockType,
        instance: node.instance?.trim() || "",
        axisReference,
        executeReference:
          profile.triggerPort.trim().toUpperCase() === "EXECUTE"
            ? triggerReference
            : "",
        triggerModel: profile.triggerModel,
        triggerPort: profile.triggerPort,
        triggerReference,
        completionReferences: motionPortReferencesForNode(
          node,
          profile.completionPorts,
          "output",
        ),
        activeReferences: motionPortReferencesForNode(
          node,
          profile.activePorts,
          "output",
        ),
        busyReferences: motionPortReferencesForNode(
          node,
          profile.busyPorts,
          "output",
        ),
        faultReferences: motionPortReferencesForNode(
          node,
          profile.faultPorts,
          "output",
        ),
        abortedReferences: motionPortReferencesForNode(
          node,
          profile.abortedPorts,
          "output",
        ),
        locksAxisWhileTriggerTrue: profile.locksAxisWhileTriggerTrue,
      }];
    }),
  );

  return {
    axisReference: resolvedAxis.axisReference,
    resolution: resolvedAxis.resolution,
    commands,
    lockingStops: commands.filter(
      (command) => command.locksAxisWhileTriggerTrue,
    ),
  };
}

function motionCommandProfileForBlockType(
  blockType: string,
): BusinessMotionCommandProfileConfig | undefined {
  const normalizedBlockType = normalizeBlockType(blockType);
  return BUSINESS_RULES_CONFIG.motionCommandProfiles.find((profile) =>
    profile.blockTypes.some(
      (configuredBlockType) =>
        normalizeBlockType(configuredBlockType) === normalizedBlockType,
    ),
  );
}

function resolveMotionAxisReference(
  focus: FocusContext,
): Pick<MotionAxisContext, "axisReference" | "resolution"> | undefined {
  const focusAxisReferences = uniqueMotionAxisReferences(
    focus.node ? [focus.node] : [],
  );
  if (focusAxisReferences.length === 1) {
    return {
      axisReference: focusAxisReferences[0],
      resolution: "focusPort",
    };
  }
  if (focusAxisReferences.length > 1) {
    return undefined;
  }

  const boundaryIds = focus.node
    ? [...focus.node.from, ...focus.node.to]
    : focus.insertionPoint
      ? [...focus.insertionPoint.from, ...focus.insertionPoint.to]
      : [];
  const boundaryNodes = boundaryIds
    .map((nodeId) => findNode(focus.segment, nodeId))
    .filter((node): node is DiagramNodeSummary => Boolean(node));
  const neighborAxisReferences = uniqueMotionAxisReferences(boundaryNodes);
  if (neighborAxisReferences.length === 1) {
    return {
      axisReference: neighborAxisReferences[0],
      resolution: "neighborPort",
    };
  }
  if (neighborAxisReferences.length > 1) {
    return undefined;
  }

  const segmentAxisReferences = uniqueMotionAxisReferences(
    focus.segment.nodes,
  );
  return segmentAxisReferences.length === 1
    ? {
        axisReference: segmentAxisReferences[0],
        resolution: "segmentUniquePort",
      }
    : undefined;
}

function uniqueMotionAxisReferences(nodes: DiagramNodeSummary[]): string[] {
  const references = new Map<string, string>();
  for (const node of nodes) {
    const axisReference = motionAxisReferenceForNode(node);
    const normalized = normalizeReference(axisReference);
    if (normalized && !references.has(normalized)) {
      references.set(normalized, axisReference.trim());
    }
  }
  return [...references.values()];
}

function motionAxisReferenceForNode(node: DiagramNodeSummary): string {
  const axisPort = [...(node.inputPorts ?? []), ...(node.outputPorts ?? [])].find(
    (port) =>
      port.name.trim().toUpperCase() === "AXIS" &&
      hasTypeCapability(
        new Set([normalizeDataType(port.type)]),
        "MOTION_AXIS_REFERENCE",
      ),
  );
  return normalizeReference(axisPort?.value) ? axisPort?.value.trim() ?? "" : "";
}

function motionPortReferencesForNode(
  node: DiagramNodeSummary,
  portNames: string[],
  direction: "input" | "output",
): string[] {
  const normalizedPortNames = new Set(
    portNames.map((portName) => portName.trim().toUpperCase()),
  );
  return uniqueDisplayNames(
    (direction === "input" ? node.inputPorts ?? [] : node.outputPorts ?? [])
      .filter((port) => normalizedPortNames.has(port.name.trim().toUpperCase()))
      .map((port) => port.value)
      .filter((reference) => normalizeReference(reference)),
  );
}

function intersection<T>(left: Set<T>, right: Set<T>): Set<T> {
  return new Set([...left].filter((value) => right.has(value)));
}

function scoreBusinessSuggestion(
  suggestion: LocalSuggestionDraft,
  context: BusinessSuggestionContext,
  graphState: SegmentGraphState,
): LocalSuggestionScoreBreakdown {
  const addType = suggestion.addElement.nodeType;
  const addBlockType = normalizeBlockType(suggestion.addElement.blockType);
  const position = suggestion.position ?? inferPosition(suggestion);
  const isBefore = position === "front" || position === "outsideFront";
  const isAfter = position === "behind" || position === "outsideBehind";
  const isParallel = position === "parallel";
  const isContact = isContactNodeType(addType);
  const isFunctionBlock = addType === "functionBlock";
  const isCoil = isCoilNodeType(addType);
  const topology = scoreTopologySuggestion(suggestion);
  const rankingRules = scoreConfiguredRankingRules(suggestion, context);
  let businessEvidence = 0;

  const startSignals = businessTermWeight(
    context,
    "start",
    "run",
    "enable",
    "ready",
  );
  const inhibitSignals = businessTermWeight(
    context,
    "stop",
    "fault",
    "alarm",
    "interlock",
  );
  const stopSignals =
    inhibitSignals + businessTermWeight(context, "reset");
  const timerSignals = businessTermWeight(context, "timer");
  const counterSignals = businessTermWeight(context, "counter");
  const doneSignals = businessTermWeight(context, "done");

  if (isContact) {
    businessEvidence += startSignals * (isBefore ? 3 : isParallel ? 2 : 1);
    businessEvidence += stopSignals * (isBefore ? 2 : isParallel ? 1 : 0);
    businessEvidence += doneSignals * (isAfter ? 1 : 0);
  }

  if (addType === "negatedContact") {
    businessEvidence += inhibitSignals * 3;
    businessEvidence += businessTermWeight(context, "fault") * 2;
  }

  if (addType === "risingContact" || addType === "fallingContact") {
    businessEvidence += startSignals * 2;
    businessEvidence += businessTermWeight(context, "enable") * 2;
  }

  if (addType === "setCoil") {
    businessEvidence += startSignals * 2;
    businessEvidence += businessTermWeight(context, "done") * 2;
    businessEvidence += businessTermWeight(context, "alarm") * 2;
    businessEvidence -= stopSignals;
  }

  if (addType === "resetCoil") {
    const resetSignals = businessTermWeight(context, "reset");
    if (resetSignals > 0) {
      businessEvidence += resetSignals * 3;
      businessEvidence += businessTermWeight(context, "fault", "alarm", "latch") * 2;
    }
  }

  if (isCoil) {
    businessEvidence += doneSignals;
    businessEvidence += graphState.isPartialGraph ? 3 : 1;
    if (isAfter) {
      businessEvidence += 2;
    }
  }

  if (isFunctionBlock) {
    businessEvidence += scoreRelatedFunctionBlockEvidence(addBlockType, context);

    if (isTimerBlockType(addBlockType)) {
      businessEvidence += timerSignals * 3;
      businessEvidence += isTimerBlockType(context.focusBlockType) ? 4 : 0;
      businessEvidence += hasSegmentBlockType(context, isTimerBlockType) ? 1 : 0;
    }

    if (isCounterBlockType(addBlockType)) {
      businessEvidence += counterSignals * 3;
      businessEvidence += isCounterBlockType(context.focusBlockType) ? 4 : 0;
      businessEvidence += hasSegmentBlockType(context, isCounterBlockType) ? 1 : 0;
    }

    if (isLatchBlockType(addBlockType)) {
      businessEvidence += startSignals + stopSignals;
    }

    if (isMotionBlockType(context.focusBlockType)) {
      businessEvidence += startSignals * 2;
      businessEvidence += businessTermWeight(context, "fault", "stop", "reset");
      if (isBefore) {
        businessEvidence += 4;
      }
      if (isAfter) {
        businessEvidence -= 2;
      }
    }

    if (isTimerBlockType(context.focusBlockType) && isTimerBlockType(addBlockType)) {
      businessEvidence += 2;
    }

    if (isCounterBlockType(context.focusBlockType) && isCounterBlockType(addBlockType)) {
      businessEvidence += 2;
    }
  }

  if (isBefore) {
    businessEvidence += isContact ? 2 : 0;
    businessEvidence += isFunctionBlock ? 1 : 0;
  } else if (isAfter) {
    businessEvidence += isCoil ? 2 : 0;
  } else if (isParallel) {
    businessEvidence += isContact ? 2 : 1;
  }

  if (context.focusBlockType === "MC_RESET" && isBefore && isContact) {
    businessEvidence += 4;
  }

  if (context.focusBlockType.startsWith("MC_") && isFunctionBlock && isAfter) {
    businessEvidence -= 3;
  }

  if (graphState.hasOutputNode && isCoil && isAfter) {
    businessEvidence -= 1;
  }

  if (graphState.isPartialGraph && isCoil) {
    businessEvidence += 1;
  }

  return {
    total: topology + rankingRules + businessEvidence,
    topology,
    rankingRules,
    businessEvidence,
  };
}

function businessTermWeight(
  context: BusinessSuggestionContext,
  ...terms: BusinessTerm[]
): number {
  let score = 0;
  for (const term of terms) {
    const localScore = localBusinessTermWeight(context, term);
    score += localScore;

    if (localScore > 0 && context.pouTerms.has(term)) {
      score += 1;
    }
  }
  return score;
}

function scoreRelatedFunctionBlockEvidence(
  blockType: string,
  context: BusinessSuggestionContext,
): number {
  let score = context.relatedBlockTypes.has(blockType) ? 1 : 0;

  if (isTimerBlockType(blockType) && context.relatedTerms.has("timer")) {
    score += 1;
  } else if (
    isCounterBlockType(blockType) &&
    context.relatedTerms.has("counter")
  ) {
    score += 1;
  } else if (
    isLatchBlockType(blockType) &&
    context.relatedTerms.has("latch")
  ) {
    score += 1;
  } else if (
    isMotionBlockType(blockType) &&
    context.relatedTerms.has("motion") &&
    context.relatedTerms.has("axis")
  ) {
    score += 1;
  }

  return Math.min(score, 2);
}

function scoreConfiguredRankingRules(
  suggestion: LocalSuggestionDraft,
  context: BusinessSuggestionContext,
): number {
  const nodeType = suggestion.addElement.nodeType;
  const blockType = normalizeBlockType(suggestion.addElement.blockType);
  const position = suggestion.position ?? inferPosition(suggestion);

  const matchedRules = BUSINESS_RULES_CONFIG.rankingRules.filter((rule) => {
    if (
      rule.candidateNodeTypes?.length &&
      !includesCaseInsensitive(rule.candidateNodeTypes, nodeType)
    ) {
      return false;
    }
    if (
      rule.candidateBlockTypes?.length &&
      !includesCaseInsensitive(rule.candidateBlockTypes, blockType)
    ) {
      return false;
    }
    if (rule.modes?.length && !rule.modes.includes(suggestion.mode)) {
      return false;
    }
    if (rule.positions?.length && !rule.positions.includes(position)) {
      return false;
    }
    if (
      rule.termsAny?.length &&
      !rule.termsAny.some((term) => localBusinessTermWeight(context, term) > 0)
    ) {
      return false;
    }
    if (
      rule.termsAll?.length &&
      !rule.termsAll.every((term) => localBusinessTermWeight(context, term) > 0)
    ) {
      return false;
    }
    if (
      rule.excludedTerms?.some(
        (term) => localBusinessTermWeight(context, term) > 0,
      )
    ) {
      return false;
    }
    return true;
  });

  if (!matchedRules.length) {
    return 0;
  }

  const highestPriority = Math.max(
    ...matchedRules.map((rule) => rule.priority),
  );
  return matchedRules
    .filter((rule) => rule.priority === highestPriority)
    .reduce((score, rule) => {
      const evidenceTerms = [
        ...(rule.termsAny ?? []),
        ...(rule.termsAll ?? []),
      ];
      return (
        score +
        rule.baseScore +
        businessTermWeight(context, ...evidenceTerms) * rule.termMultiplier
      );
    }, 0);
}

function localBusinessTermWeight(
  context: BusinessSuggestionContext,
  term: BusinessTerm,
): number {
  let score = 0;
  if (context.focusTerms.has(term)) {
    score += 4;
  }
  if (context.nearbyTerms.has(term)) {
    score += 3;
  }
  if (context.segmentTerms.has(term)) {
    score += 2;
  }
  return score;
}

function collectNodeDataTypes(
  nodes: DiagramNodeSummary[],
  variables: Array<{ name: string; type: string }>,
): Set<string> {
  const variableTypes = new Map(
    variables
      .filter((variable) => variable.name && variable.type)
      .map((variable) => [variable.name.trim().toUpperCase(), variable.type]),
  );
  const dataTypes = new Set<string>();

  for (const node of nodes) {
    addNormalizedDataType(dataTypes, node.dataType);
    const references = [
      node.var,
      ...Object.values(node.inputs ?? {}),
      ...Object.values(node.outputs ?? {}),
    ];
    for (const reference of references) {
      const dataType = variableTypes.get(String(reference ?? "").trim().toUpperCase());
      addNormalizedDataType(dataTypes, dataType);
    }
  }

  return dataTypes;
}

function addNormalizedDataType(
  target: Set<string>,
  dataType: string | undefined,
): void {
  const normalized = normalizeDataType(dataType);
  if (normalized) {
    target.add(normalized);
  }
}

function normalizeDataType(dataType: string | undefined): string {
  return String(dataType ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function hasAnyDataType(
  localDataTypes: Set<string>,
  requiredDataTypes: string[],
): boolean {
  return requiredDataTypes.some((dataType) =>
    hasDataType(localDataTypes, dataType),
  );
}

function hasDataType(
  localDataTypes: Set<string>,
  requiredDataType: string,
): boolean {
  return hasDataTypeInternal(
    localDataTypes,
    requiredDataType,
    new Set<string>(),
  );
}

function hasDataTypeInternal(
  localDataTypes: Set<string>,
  requiredDataType: string,
  visitedGroups: Set<string>,
): boolean {
  const normalizedRequired = normalizeDataType(requiredDataType);
  if (!normalizedRequired) {
    return false;
  }

  if (
    [...localDataTypes].some(
      (dataType) =>
        dataType === normalizedRequired ||
        dataType.startsWith(`${normalizedRequired}(`) ||
        dataType.startsWith(`${normalizedRequired}[`) ||
        dataType.endsWith(`.${normalizedRequired}`),
    )
  ) {
    return true;
  }

  const groupMembers =
    BUSINESS_RULES_CONFIG.dataTypeGroups[normalizedRequired];
  if (groupMembers?.length && !visitedGroups.has(normalizedRequired)) {
    const nextVisited = new Set(visitedGroups).add(normalizedRequired);
    return groupMembers.some((member) =>
      hasDataTypeInternal(localDataTypes, member, nextVisited),
    );
  }

  return false;
}

function hasTypeCapability(
  localDataTypes: Set<string>,
  capability: string,
): boolean {
  const mappedDataTypes =
    BUSINESS_RULES_CONFIG.typeCapabilities[normalizeDataType(capability)] ?? [];
  return mappedDataTypes.some((dataType) =>
    hasDataType(localDataTypes, dataType),
  );
}

function addDerivedTerms(
  terms: Set<BusinessTerm>,
  dataTypes: Set<string>,
): void {
  for (const rule of BUSINESS_RULES_CONFIG.derivedTerms) {
    if (
      (rule.whenDataTypesAny.length > 0 &&
        hasAnyDataType(dataTypes, rule.whenDataTypesAny)) ||
      (rule.whenTypeCapabilitiesAny.length > 0 &&
        rule.whenTypeCapabilitiesAny.some((capability) =>
          hasTypeCapability(dataTypes, capability),
        ))
    ) {
      terms.add(rule.term);
    }
  }
  applyTermImplications(terms);
}

function applyTermImplications(terms: Set<BusinessTerm>): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const implication of BUSINESS_RULES_CONFIG.termImplications) {
      if (!terms.has(implication.ifMatched)) {
        continue;
      }
      for (const impliedTerm of implication.alsoMatch) {
        if (!terms.has(impliedTerm)) {
          terms.add(impliedTerm);
          changed = true;
        }
      }
    }
  }
}

function includesCaseInsensitive(values: string[], target: string): boolean {
  const normalizedTarget = target.trim().toUpperCase();
  return values.some((value) => value.trim().toUpperCase() === normalizedTarget);
}

function collectBusinessTerms(values: Array<string | undefined>): Set<BusinessTerm> {
  const haystack = compactBusinessTexts(values)
    .flatMap((value) => [value, splitBusinessIdentifierWords(value)])
    .map((value) => value.toLowerCase())
    .join(" ");
  const terms = new Set<BusinessTerm>();

  if (!haystack) {
    return terms;
  }

  for (const entry of BUSINESS_TERM_MATCHERS) {
    if (
      entry.literalPatterns.some((pattern) => haystack.includes(pattern)) ||
      entry.regexPatterns.some((pattern) => pattern.test(haystack))
    ) {
      terms.add(entry.term);
    }
  }

  applyTermImplications(terms);
  return terms;
}

function splitBusinessIdentifierWords(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

function nodeBusinessTexts(node: DiagramNodeSummary): string[] {
  return compactBusinessTexts([
    nodeKindBusinessText(node.kind),
    node.var,
    node.dataType,
    node.scope,
    node.blockType,
    node.instance,
    ...recordBusinessTexts(node.inputs),
    ...recordBusinessTexts(node.outputs),
  ]);
}

function nodeKindBusinessText(kind: string): string {
  switch (kind) {
    case "risingContact":
      return "rising";
    case "fallingContact":
      return "falling";
    case "negatedContact":
      return "negated";
    case "setCoil":
      return "set";
    case "resetCoil":
      return "reset";
    default:
      return "";
  }
}

function variableBusinessTexts(
  variable: {
    name: string;
    type: string;
    scope: string;
    label?: string;
    note?: string;
    comment?: string;
  },
): string[] {
  return compactBusinessTexts([
    variable.name,
    variable.type,
    variable.scope,
    variable.label,
    variable.note,
    variable.comment,
  ]);
}

function recordBusinessTexts(record: Record<string, string> | undefined): string[] {
  if (!record) {
    return [];
  }

  return Object.entries(record).flatMap(([key, value]) => [key, value]);
}

function compactBusinessTexts(values: Array<string | undefined>): string[] {
  return values
    .map((value) => String(value ?? "").trim())
    .filter((value) => value.length > 0 && value !== "???");
}

function normalizeBlockType(value: string | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

function hasSegmentBlockType(
  context: BusinessSuggestionContext,
  predicate: (blockType: string) => boolean,
): boolean {
  return [...context.segmentBlockTypes].some(predicate);
}

function isBusinessBlockType(blockType: string): boolean {
  return (
    isMotionBlockType(blockType) ||
    isTimerBlockType(blockType) ||
    isCounterBlockType(blockType) ||
    isLatchBlockType(blockType)
  );
}

function isContactNodeType(nodeType: string): boolean {
  return [
    "contact",
    "negatedContact",
    "risingContact",
    "fallingContact",
  ].includes(nodeType);
}

function isCoilNodeType(nodeType: string): boolean {
  return ["coil", "setCoil", "resetCoil"].includes(nodeType);
}

function isTimerBlockType(blockType: string): boolean {
  return ["TON", "TOF", "TP"].includes(blockType);
}

function isCounterBlockType(blockType: string): boolean {
  return ["CTU", "CTD", "CTUD"].includes(blockType);
}

function isLatchBlockType(blockType: string): boolean {
  return ["SR", "RS"].includes(blockType);
}

function isMotionBlockType(blockType: string): boolean {
  return blockType.startsWith("MC_") || blockType.startsWith("SMC_");
}

function addContactSuggestions(
  suggestions: LocalSuggestionDraft[],
  focus: FocusContext,
  graphState: SegmentGraphState,
): void {
  const node = focus.node;
  if (!node) {
    return;
  }

  const leftNodes = neighborNodes(focus.segment, node.from, "backward");
  const rightNodes = neighborNodes(focus.segment, node.to, "forward");
  const nodeText = nodePlacementLabelWithSegment(focus.segment, node);
  const leftRailInsertionPoint =
    findLeftRailInsertionPointBeforeNode(focus.segment, node);
  const outsideBehindPlan = findOutsideBehindPlan(focus.segment, node);

  if (leftRailInsertionPoint) {
    addFrontSerialSuggestions(suggestions, focus, nodeText, {
      text: (targetText) => `在${targetText}前串联一个常开触点`,
      outsideText: (targetText) =>
        `在${targetText}所在分支组前串联一个常开触点`,
      addElement: contactElement(),
      leftRailInsertionPoint,
    });
  } else if (leftNodes.length) {
    for (const leftNode of leftNodes) {
      const leftText = nodePlacementLabelWithSegment(focus.segment, leftNode);
      suggestions.push(
        makeSuggestion(focus, {
          mode: "seriesBefore",
          relationToFocus: "beforeSelected",
          insertAfterNodeId: leftNode.id,
          insertBeforeNodeId: node.id,
          text: `在${leftText}和${nodeText}之间串联一个常开触点`,
          addElement: contactElement(),
        }),
      );
    }
  } else {
    suggestions.push(
      makeSuggestion(focus, {
        mode: "seriesBefore",
        relationToFocus: "beforeSelected",
        insertAfterNodeId: first(node.from),
        insertBeforeNodeId: node.id,
        text: `在${nodeText}前串联一个常开触点`,
        addElement: contactElement(),
      }),
    );
  }

  if (rightNodes.length) {
    for (const rightNode of rightNodes) {
      const rightText = nodePlacementLabelWithSegment(focus.segment, rightNode);
      suggestions.push(
        makeSuggestion(focus, {
          mode: "seriesAfter",
          relationToFocus: "afterSelected",
          insertAfterNodeId: node.id,
          insertBeforeNodeId: rightNode.id,
          text: `在${nodeText}和${rightText}之间串联一个常开触点`,
          addElement: contactElement(),
        }),
        makeSuggestion(focus, {
          mode: "functionBlockAfter",
          relationToFocus: "afterSelected",
          insertAfterNodeId: node.id,
          insertBeforeNodeId: rightNode.id,
          text: `在${nodeText}和${rightText}之间插入一个功能块`,
          addElement: functionBlockElement(),
        }),
      );
    }
  } else {
    suggestions.push(
      makeSuggestion(focus, {
        mode: "seriesAfter",
        relationToFocus: "afterSelected",
        insertAfterNodeId: node.id,
        insertBeforeNodeId: first(node.to),
        text: `在${nodeText}后串联一个常开触点`,
        addElement: contactElement(),
      }),
      makeSuggestion(focus, {
        mode: "functionBlockAfter",
        relationToFocus: "afterSelected",
        insertAfterNodeId: node.id,
        insertBeforeNodeId: first(node.to),
        text: `在${nodeText}后串联一个功能块`,
        addElement: functionBlockElement(),
      }),
    );
  }

  if (outsideBehindPlan) {
    suggestions.push(
      makeSuggestion(focus, {
        mode: "seriesAfter",
        relationToFocus: "afterSelected",
        insertAfterNodeId: node.id,
        insertBeforeNodeId: first(outsideBehindPlan.endNodes),
        startNodes: outsideBehindPlan.startNodes,
        endNodes: outsideBehindPlan.endNodes,
        preserveEndNodes: outsideBehindPlan.preserveEndNodes,
        position: "outsideBehind",
        serialOrParallel: "serial",
        text: `在${nodeText}所在并联结构汇合后串联一个常开触点`,
        addElement: contactElement(),
      }),
    );
  }

  const parallelStartPlan = getParallelStartNodePlan(focus.segment, node);
  const parallelEndPlan = getParallelEndNodePlan(focus.segment, node);

  suggestions.push(
    makeSuggestion(focus, {
      mode: "parallelBranch",
      relationToFocus: "parallelWithSelected",
      parallelToNodeId: node.id,
      branchFromNodeId: first(node.from),
      branchToNodeId: first(node.to),
      startNodes: parallelStartPlan.startNodes,
      endNodes: parallelEndPlan.endNodes,
      preserveStartNodes: parallelStartPlan.preserveStartNodes,
      preserveEndNodes: parallelEndPlan.preserveEndNodes,
      text: `与${nodeText}并联一个常开触点`,
      addElement: contactElement(),
    }),
    makeSuggestion(focus, {
      mode: "parallelBranch",
      relationToFocus: "parallelWithSelected",
      parallelToNodeId: node.id,
      branchFromNodeId: first(node.from),
      branchToNodeId: first(node.to),
      startNodes: parallelStartPlan.startNodes,
      endNodes: parallelEndPlan.endNodes,
      preserveStartNodes: parallelStartPlan.preserveStartNodes,
      preserveEndNodes: parallelEndPlan.preserveEndNodes,
      text: `与${nodeText}并联一个功能块`,
      addElement: functionBlockElement(),
    }),
  );

  if (canAddOutputAfterNode(focus.segment, node)) {
    const outputPlan = createOutputCoilPlan(focus.segment, node);
    suggestions.push(
      makeSuggestion(focus, {
        mode: "outputCoil",
        relationToFocus: "afterSelected",
        insertAfterNodeId: node.id,
        insertBeforeNodeId: first(node.to),
        startNodes: outputPlan.startNodes,
        endNodes: outputPlan.endNodes,
        preserveStartNodes: outputPlan.preserveStartNodes,
        position: outputPlan.position,
        serialOrParallel: outputPlan.serialOrParallel,
        text: graphState.isPartialGraph
          ? outputPlan.partialText(nodeText)
          : outputPlan.text(nodeText),
        addElement: coilElement(),
      }),
    );
  }
}

function addFunctionBlockSuggestions(
  suggestions: LocalSuggestionDraft[],
  focus: FocusContext,
  graphState: SegmentGraphState,
): void {
  const node = focus.node;
  if (!node) {
    return;
  }

  const firstOutputPort = Object.keys(node.outputs ?? {})[0] ?? "";
  const leftNodes = neighborNodes(focus.segment, node.from, "backward");
  const rightNodes = neighborNodes(focus.segment, node.to, "forward");
  const nodeText = nodePlacementLabelWithSegment(focus.segment, node);
  const leftRailInsertionPoint =
    findLeftRailInsertionPointBeforeNode(focus.segment, node);

  if (leftRailInsertionPoint) {
    addFrontSerialSuggestions(suggestions, focus, nodeText, {
      text: (targetText) => `在${targetText}前串联一个常开触点`,
      outsideText: (targetText) =>
        `在${targetText}所在分支组前串联一个常开触点`,
      addElement: contactElement(),
      leftRailInsertionPoint,
    });
  } else if (leftNodes.length) {
    for (const leftNode of leftNodes) {
      const leftText = nodePlacementLabelWithSegment(focus.segment, leftNode);
      suggestions.push(
        makeSuggestion(focus, {
          mode: "seriesBefore",
          relationToFocus: "beforeSelected",
          insertAfterNodeId: leftNode.id,
          insertBeforeNodeId: node.id,
          text: `在${leftText}和${nodeText}之间串联一个常开触点`,
          addElement: contactElement(),
        }),
      );
    }
  } else {
    suggestions.push(
      makeSuggestion(focus, {
        mode: "seriesBefore",
        relationToFocus: "beforeSelected",
        insertAfterNodeId: first(node.from),
        insertBeforeNodeId: node.id,
        text: `在${nodeText}前串联一个常开触点`,
        addElement: contactElement(),
      }),
    );
  }

  if (canAddOutputAfterNode(focus.segment, node)) {
    const outputPlan = createOutputCoilPlan(focus.segment, node);
    suggestions.push(
      makeSuggestion(focus, {
        mode: "outputCoil",
        relationToFocus: "afterSelected",
        insertAfterNodeId: node.id,
        insertBeforeNodeId: first(node.to),
        portName: firstOutputPort,
        startNodes: outputPlan.startNodes,
        endNodes: outputPlan.endNodes,
        preserveStartNodes: outputPlan.preserveStartNodes,
        position: outputPlan.position,
        serialOrParallel: outputPlan.serialOrParallel,
        text: graphState.isPartialGraph
          ? outputPlan.partialText(nodeText)
          : outputPlan.text(nodeText),
        addElement: coilElement(),
      }),
    );
  }

  if (rightNodes.length) {
    for (const rightNode of rightNodes) {
      const rightText = nodePlacementLabelWithSegment(focus.segment, rightNode);
      suggestions.push(
        makeSuggestion(focus, {
          mode: "seriesAfter",
          relationToFocus: "afterSelected",
          insertAfterNodeId: node.id,
          insertBeforeNodeId: rightNode.id,
          portName: firstOutputPort,
          text: `在${nodeText}和${rightText}之间串联一个常开触点`,
          addElement: contactElement(),
        }),
      );
    }
  } else {
    suggestions.push(
      makeSuggestion(focus, {
        mode: "seriesAfter",
        relationToFocus: "afterSelected",
        insertAfterNodeId: node.id,
        insertBeforeNodeId: first(node.to),
        portName: firstOutputPort,
        text: `在${nodeText}输出端后添加一个常开触点`,
        addElement: contactElement(),
      }),
    );
  }
}

function addCoilSuggestions(
  suggestions: LocalSuggestionDraft[],
  focus: FocusContext,
): void {
  const node = focus.node;
  if (!node) {
    return;
  }

  const nodeText = nodePlacementLabelWithSegment(focus.segment, node);
  const leftRailInsertionPoint =
    findLeftRailInsertionPointBeforeNode(focus.segment, node);

  addFrontSerialSuggestions(suggestions, focus, nodeText, {
    text: (targetText) => `在${targetText}前串联一个常开触点`,
    outsideText: (targetText) =>
      `在${targetText}所在分支组前串联一个常开触点`,
    addElement: contactElement(),
    leftRailInsertionPoint,
  });

  const parallelStartPlan = getParallelStartNodePlan(focus.segment, node);
  const parallelEndPlan = getParallelEndNodePlan(focus.segment, node);

  suggestions.push(
    makeSuggestion(focus, {
      mode: "parallelBranch",
      relationToFocus: "parallelWithSelected",
      parallelToNodeId: node.id,
      branchFromNodeId: first(node.from),
      branchToNodeId: first(node.to),
      startNodes: parallelStartPlan.startNodes,
      endNodes: parallelEndPlan.endNodes,
      preserveStartNodes: parallelStartPlan.preserveStartNodes,
      preserveEndNodes: parallelEndPlan.preserveEndNodes,
      text: `与${nodeText}并联一个线圈`,
      addElement: coilElement(),
    }),
  );

  addFrontSerialSuggestions(suggestions, focus, nodeText, {
    text: (targetText) => `在${targetText}前插入一个功能块`,
    outsideText: (targetText) => `在${targetText}所在分支组前插入一个功能块`,
    addElement: functionBlockElement(),
    leftRailInsertionPoint,
  });

  addCoilReplaceSuggestions(suggestions, focus, nodeText);
}

function addFrontSerialSuggestions(
  suggestions: LocalSuggestionDraft[],
  focus: FocusContext,
  nodeText: string,
  input: {
    text: (targetText: string) => string;
    outsideText: (targetText: string) => string;
    addElement: LocalSuggestionAddElement;
    leftRailInsertionPoint:
      | { insertionPointId: string; sourceIds: string[] }
      | undefined;
  },
): void {
  const node = focus.node;
  if (!node) {
    return;
  }

  if (input.leftRailInsertionPoint) {
    suggestions.push(
      makeSuggestion(focus, {
        mode: "seriesBefore",
        relationToFocus: "atInsertionPoint",
        insertAfterNodeId: input.leftRailInsertionPoint.insertionPointId,
        insertBeforeNodeId: node.id,
        startNodes: [input.leftRailInsertionPoint.insertionPointId],
        endNodes: [node.id],
        preserveStartNodes: true,
        position: "front",
        serialOrParallel: "serial",
        text: input.text(nodeText),
        addElement: input.addElement,
      }),
      makeSuggestion(focus, {
        mode: "seriesBefore",
        relationToFocus: "atInsertionPoint",
        insertAfterNodeId: first(input.leftRailInsertionPoint.sourceIds),
        insertBeforeNodeId: input.leftRailInsertionPoint.insertionPointId,
        startNodes: input.leftRailInsertionPoint.sourceIds,
        endNodes: [input.leftRailInsertionPoint.insertionPointId],
        preserveStartNodes: true,
        position: "outsideFront",
        serialOrParallel: "serial",
        text: input.outsideText(nodeText),
        addElement: input.addElement,
      }),
    );
    return;
  }

  suggestions.push(
    makeSuggestion(focus, {
      mode: "seriesBefore",
      relationToFocus: "beforeSelected",
      insertAfterNodeId: first(node.from),
      insertBeforeNodeId: node.id,
      text: input.text(nodeText),
      addElement: input.addElement,
    }),
  );
}

function addInsertionPointSuggestions(
  suggestions: LocalSuggestionDraft[],
  focus: FocusContext,
  graphState: SegmentGraphState,
): void {
  const insertionPoint = focus.insertionPoint;
  if (!insertionPoint) {
    return;
  }

  const target = firstRealNode(focus.segment, insertionPoint.to);
  const source = firstRealNode(focus.segment, insertionPoint.from);
  const targetText =
    neighborListText(focus.segment, insertionPoint.to, "forward") || "末尾";
  const sourceText =
    neighborListText(focus.segment, insertionPoint.from, "backward") ||
    "前置节点";

  if (target && isCoilKind(target.kind)) {
    suggestions.push(
      makeSuggestion(focus, {
        mode: "seriesBefore",
        relationToFocus: "atInsertionPoint",
        insertAfterNodeId: first(insertionPoint.from),
        insertBeforeNodeId: target.id,
        startNodes: insertionPoint.from,
        endNodes: [target.id],
        text: `在${sourceText}和${targetText}之间串联一个常开触点`,
        addElement: contactElement(),
      }),
      makeSuggestion(focus, {
        mode: "functionBlockBefore",
        relationToFocus: "atInsertionPoint",
        insertAfterNodeId: first(insertionPoint.from),
        insertBeforeNodeId: target.id,
        startNodes: insertionPoint.from,
        endNodes: [target.id],
        text: `在${sourceText}和${targetText}之间插入一个功能块`,
        addElement: functionBlockElement(),
      }),
    );
    return;
  }

  if (target?.kind === "FBDCompartment") {
    suggestions.push(
      makeSuggestion(focus, {
        mode: "seriesBefore",
        relationToFocus: "atInsertionPoint",
        insertAfterNodeId: first(insertionPoint.from),
        insertBeforeNodeId: target.id,
        startNodes: insertionPoint.from,
        endNodes: [target.id],
        text: `在${targetText}的 EN 前串联一个常开触点`,
        addElement: contactElement(),
      }),
    );
    return;
  }

  if (!target) {
    if (graphState.isPartialGraph) {
      suggestions.push(
        makeSuggestion(focus, {
          mode: "outputCoil",
          relationToFocus: "atInsertionPoint",
          insertAfterNodeId: first(insertionPoint.from),
          startNodes: insertionPoint.from,
          endNodes: insertionPoint.to,
          text: `当前回路还没有输出节点，在${sourceText}后添加一个输出线圈`,
          addElement: coilElement(),
        }),
        makeSuggestion(focus, {
          mode: "outputFunctionBlock",
          relationToFocus: "atInsertionPoint",
          insertAfterNodeId: first(insertionPoint.from),
          startNodes: insertionPoint.from,
          endNodes: insertionPoint.to,
          text: `当前回路还没有输出节点，在${sourceText}后添加一个功能块作为输出节点`,
          addElement: functionBlockElement(),
        }),
        makeSuggestion(focus, {
          mode: "seriesAfter",
          relationToFocus: "atInsertionPoint",
          insertAfterNodeId: first(insertionPoint.from),
          startNodes: insertionPoint.from,
          endNodes: insertionPoint.to,
          text: `在${sourceText}后继续串联一个常开触点`,
          addElement: contactElement(),
        }),
      );
      return;
    }

    suggestions.push(
      makeSuggestion(focus, {
        mode: "outputCoil",
        relationToFocus: "atInsertionPoint",
        insertAfterNodeId: first(insertionPoint.from),
        startNodes: insertionPoint.from,
        endNodes: insertionPoint.to,
        text: `在${sourceText}后添加一个输出线圈`,
        addElement: coilElement(),
      }),
    );
    return;
  }

  suggestions.push(
    makeSuggestion(focus, {
      mode: "seriesAfter",
      relationToFocus: "atInsertionPoint",
      insertAfterNodeId: first(insertionPoint.from),
      insertBeforeNodeId: first(insertionPoint.to),
      startNodes: insertionPoint.from,
      endNodes: insertionPoint.to,
      text: `在${sourceText}和${targetText}之间串联一个常开触点`,
      addElement: contactElement(),
    }),
    makeSuggestion(focus, {
      mode: "functionBlockAfter",
      relationToFocus: "atInsertionPoint",
      insertAfterNodeId: first(insertionPoint.from),
      insertBeforeNodeId: first(insertionPoint.to),
      startNodes: insertionPoint.from,
      endNodes: insertionPoint.to,
      text: `在${sourceText}和${targetText}之间插入一个功能块`,
      addElement: functionBlockElement(),
    }),
  );
}

function makeSuggestion(
  focus: FocusContext,
  input: {
    mode: string;
    relationToFocus: string;
    insertAfterNodeId?: string;
    insertBeforeNodeId?: string;
    parallelToNodeId?: string;
    branchFromNodeId?: string;
    branchToNodeId?: string;
    portName?: string;
    startNodes?: string[];
    endNodes?: string[];
    preserveStartNodes?: boolean;
    preserveEndNodes?: boolean;
    position?: LocalSuggestionPosition;
    serialOrParallel?: LocalSuggestionSerialOrParallel;
    text: string;
    addElement: LocalSuggestionAddElement;
  },
): LocalSuggestionDraft {
  const addElement = input.addElement;
  const text =
    addElement.nodeType === "functionBlock"
      ? withFunctionBlockType(
          input.text,
          addElement.blockType,
          Boolean(addElement.isFunction),
        )
      : input.text;

  return {
    id: "",
    mode: input.mode,
    confidence: 1,
    placement: {
      relationToFocus: input.relationToFocus,
      anchorNodeId: getFocusId(focus),
      anchorNodeVar: getFocusVar(focus),
      insertAfterNodeId: input.insertAfterNodeId ?? "",
      insertBeforeNodeId: input.insertBeforeNodeId ?? "",
      parallelToNodeId: input.parallelToNodeId ?? "",
      branchFromNodeId: input.branchFromNodeId ?? "",
      branchToNodeId: input.branchToNodeId ?? "",
      portName: input.portName ?? "",
      text,
    },
    startNodes: input.startNodes,
    endNodes: input.endNodes,
    preserveStartNodes: input.preserveStartNodes,
    preserveEndNodes: input.preserveEndNodes,
    position: input.position,
    serialOrParallel: input.serialOrParallel,
    addElement,
  };
}

function toLocalSuggestion(
  draft: LocalSuggestionDraft,
  index: number,
  segment: DiagramSegmentSummary,
): LocalSuggestion {
  const id = `local-${index + 1}`;
  const newNodeId = createSuggestedNodeId(draft.addElement, id);
  const newNode = createSuggestedNode(newNodeId, draft.addElement);
  const rawStartNodes = draft.startNodes ?? inferStartNodes(draft);
  const rawEndNodes = draft.endNodes ?? inferEndNodes(draft);
  const startNodes = draft.preserveStartNodes
    ? normalizeNodeIds(rawStartNodes)
    : resolveBoundaryNodeIds(segment, rawStartNodes, "backward");
  const endNodes = draft.preserveEndNodes
    ? normalizeNodeIds(rawEndNodes)
    : resolveSuggestionEndNodeIds(segment, draft, rawEndNodes);
  const position = draft.position ?? inferPosition(draft);
  const serialOrParallel =
    draft.serialOrParallel ?? inferSerialOrParallel(draft);
  const nodeLinks = createSuggestedNodeLinks(
    segment,
    draft.addElement.nodeType,
    startNodes,
    endNodes,
  );
  newNode.sourceIds = nodeLinks.sourceIds;
  newNode.targetIds = nodeLinks.targetIds;
  const addNode = {
    [newNodeId]: newNode,
  };
  const evidence = mergeBusinessEvidence(
    draft.businessEvidence,
    evidenceFromPresentation(draft.businessPresentation),
  );
  const diagnostics: LocalSuggestionDiagnostics | undefined = evidence
    ? {
        source: "businessRules",
        ruleIds: evidence.ruleIds,
        signatureIds: evidence.signatureIds,
        reason: evidence.reason,
        confidence: evidence.confidence,
        score: draft.scoreBreakdown ?? {
          total: 0,
          topology: 0,
          rankingRules: 0,
          businessEvidence: 0,
        },
      }
    : undefined;

  const suggestion: LocalSuggestion = {
    id,
    title: "",
    startNodes,
    endNodes,
    position,
    serialOrParallel,
    text: draft.businessPresentation?.text ?? draft.placement.text,
    addNode,
    ...(diagnostics ? { diagnostics } : {}),
  };

  return {
    ...suggestion,
    title:
      draft.businessPresentation?.title ??
      suggestionTitle(suggestion, suggestedNodeLabel(suggestion)),
  };
}

function inferStartNodes(draft: LocalSuggestionDraft): string[] {
  if (draft.placement.relationToFocus === "parallelWithSelected") {
    return [draft.placement.branchFromNodeId];
  }

  if (draft.placement.relationToFocus === "replaceSelected") {
    return [draft.placement.anchorNodeId];
  }

  return [draft.placement.insertAfterNodeId];
}

function inferEndNodes(draft: LocalSuggestionDraft): string[] {
  if (draft.placement.relationToFocus === "parallelWithSelected") {
    return [draft.placement.branchToNodeId];
  }

  if (draft.placement.relationToFocus === "replaceSelected") {
    return [];
  }

  return [draft.placement.insertBeforeNodeId];
}

function resolveBoundaryNodeIds(
  segment: DiagramSegmentSummary,
  nodeIds: string[] | undefined,
  direction: "forward" | "backward",
): string[] {
  const resolved: string[] = [];

  for (const nodeId of nodeIds ?? []) {
    const trimmed = nodeId.trim();
    if (!trimmed) {
      continue;
    }

    const node = findNode(segment, trimmed);
    if (!node) {
      resolved.push(trimmed);
      continue;
    }

    if (isRealGraphElementKind(node.kind) || isBoundaryLineKind(node.kind)) {
      resolved.push(node.id);
      continue;
    }

    const realNodes = collectNearestDisplayNodes(segment, [node.id], direction);
    resolved.push(...realNodes.map((item) => item.id));
  }

  return normalizeNodeIds(resolved);
}

function resolveSuggestionEndNodeIds(
  segment: DiagramSegmentSummary,
  draft: LocalSuggestionDraft,
  nodeIds: string[] | undefined,
): string[] {
  const anchorNode = findNode(segment, draft.placement.anchorNodeId);
  const directInsertionTargets = new Set(
    anchorNode ? directInsertionPointTargetIds(segment, anchorNode) : [],
  );
  const directInsertionSources = new Set(
    anchorNode ? directInsertionPointSourceIds(segment, anchorNode) : [],
  );
  const resolved: string[] = [];

  for (const nodeId of nodeIds ?? []) {
    const trimmed = nodeId.trim();
    if (!trimmed) {
      continue;
    }

    if (directInsertionTargets.has(trimmed) || directInsertionSources.has(trimmed)) {
      resolved.push(trimmed);
      continue;
    }

    if (
      anchorNode &&
      draft.placement.relationToFocus === "beforeSelected" &&
      trimmed === anchorNode.id &&
      directInsertionSources.size > 0
    ) {
      resolved.push(...directInsertionSources);
      continue;
    }

    if (anchorNode) {
      const rightNode = findNode(segment, trimmed);
      if (rightNode && isRealGraphElementKind(rightNode.kind)) {
        const insertionTargets = directInsertionPointTargetsBeforeNode(
          segment,
          anchorNode,
          rightNode,
        );
        if (insertionTargets.length) {
          resolved.push(...insertionTargets);
          continue;
        }
      }
    }

    resolved.push(...resolveBoundaryNodeIds(segment, [trimmed], "forward"));
  }

  return normalizeNodeIds(resolved);
}

function inferPosition(draft: LocalSuggestionDraft): LocalSuggestionPosition {
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

function inferSerialOrParallel(
  draft: LocalSuggestionDraft,
): LocalSuggestionSerialOrParallel {
  if (draft.placement.relationToFocus === "parallelWithSelected") {
    return "parallel";
  }

  if (draft.placement.relationToFocus === "replaceSelected") {
    return "replace";
  }

  return "serial";
}

function createSuggestedNodeId(
  addElement: LocalSuggestionAddElement,
  suggestionId: string,
): string {
  if (addElement.nodeType === "functionBlock") {
    const prefix = addElement.isFunction ? "FUN" : "FBD";
    return `${prefix}-compartment-${addElement.blockType || "FB"}-${suggestionId}`;
  }

  return `${addElement.nodeType}-${suggestionId}`;
}

function createSuggestedNode(
  nodeId: string,
  addElement: LocalSuggestionAddElement,
): SuggestedGraphNode {
  if (addElement.nodeType === "functionBlock") {
    const blockType = addElement.blockType.trim();
    const libraryElement = getLibraryElement(blockType);
    const libraryPorts = buildLibraryPorts(libraryElement);
    return {
      id: nodeId,
      type: "FBDCompartment",
      childrenNode: {
        type: blockType,
        isFunction: Boolean(addElement.isFunction),
        varName: {
          name: "",
          value:
            addElement.instanceName || addElement.variableName || "???",
          type: blockType,
          scope: "VAR",
        },
        portInputs:
          Array.isArray(addElement.portInputs) &&
          addElement.portInputs.length > 0
            ? addElement.portInputs
            : libraryPorts.portInputs,
        portOutputs:
          Array.isArray(addElement.portOutputs) &&
          addElement.portOutputs.length > 0
            ? addElement.portOutputs
            : libraryPorts.portOutputs,
      },
    };
  }

  return {
    id: nodeId,
    type: addElement.nodeType,
    varName: {
      name: "",
      value: addElement.variableName || "???",
      type: addElement.dataType || "BOOL",
      scope: addElement.variableScope || "VAR",
    },
  };
}

function createSuggestedNodeLinks(
  segment: DiagramSegmentSummary,
  nodeType: string,
  startNodes: string[],
  endNodes: string[],
): { sourceIds: string[]; targetIds: string[] } {
  if (isCoilKind(nodeType) && endNodes.some((nodeId) => isInsertionPointId(segment, nodeId))) {
    return {
      sourceIds: endNodes,
      targetIds: [],
    };
  }

  return {
    sourceIds: startNodes,
    targetIds: endNodes,
  };
}

function normalizeNodeIds(nodeIds: string[]): string[] {
  return [...new Set(nodeIds.map((item) => item.trim()).filter(Boolean))];
}

function findFocusByOptions(
  summary: DiagramSummary,
  options: LocalGraphSuggestionOptions,
): Omit<FocusContext, "source"> | undefined {
  if (options.selectedNodeId) {
    const byNodeId = findNodeFocus(
      summary,
      options.selectedNodeId,
      options.segmentId,
    );
    if (byNodeId) {
      return byNodeId;
    }
  }

  if (options.selectedInsertionPointId) {
    const byInsertionId = findInsertionPointFocus(
      summary,
      options.selectedInsertionPointId,
      options.segmentId,
    );
    if (byInsertionId) {
      return byInsertionId;
    }
  }

  if (options.selectedVar) {
    return findFocusByToken(summary, options.selectedVar, options.segmentId);
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
): Omit<FocusContext, "source"> | undefined {
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
): Omit<FocusContext, "source"> | undefined {
  if (!token) {
    return undefined;
  }

  const normalized = token.toLowerCase();
  const matches = focusSegments(summary, segmentId).flatMap((segment) =>
    segment.nodes
      .filter((node) => isRealGraphElementKind(node.kind))
      .filter((node) =>
        [node.var, node.instance].some(
          (value) => value?.toLowerCase() === normalized,
        ),
      )
      .map((node) => ({ segment, node })),
  );

  return matches[0];
}

function findNodeFocus(
  summary: DiagramSummary,
  nodeId: string,
  segmentId?: string,
): Omit<FocusContext, "source"> | undefined {
  for (const segment of focusSegments(summary, segmentId)) {
    const node = findNode(segment, nodeId);
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
): Omit<FocusContext, "source"> | undefined {
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
  segmentId: string | undefined,
): DiagramSegmentSummary[] {
  const trimmed = segmentId?.trim();
  if (!trimmed) {
    return summary.segments;
  }

  return summary.segments.filter((segment) => segment.segmentId === trimmed);
}

function contactElement(): LocalSuggestionAddElement {
  return {
    nodeType: "contact",
    displayLabel: "常开触点",
    variableSource: "userInput",
    variableName: "",
    dataType: "BOOL",
    userInputRequired: true,
    blockType: "",
    instanceSource: "",
    instanceName: "",
  };
}

function negatedContactElement(): LocalSuggestionAddElement {
  return contactVariantElement("negatedContact");
}

function contactVariantElement(
  nodeType: "contact" | "negatedContact" | "risingContact" | "fallingContact",
  variableName = "",
  dataType = "BOOL",
  variableScope = "VAR",
): LocalSuggestionAddElement {
  const displayLabels = {
    contact: "常开触点",
    negatedContact: "常闭触点",
    risingContact: "上升沿",
    fallingContact: "下降沿",
  } as const;
  return {
    nodeType,
    displayLabel: displayLabels[nodeType],
    variableSource: variableName ? "existingVariable" : "userInput",
    variableName,
    dataType: dataType || "BOOL",
    variableScope: variableScope || "VAR",
    userInputRequired: !variableName,
    blockType: "",
    instanceSource: "",
    instanceName: "",
  };
}

function coilElement(variableName = ""): LocalSuggestionAddElement {
  return {
    nodeType: "coil",
    displayLabel: "输出线圈",
    variableSource: variableName ? "existingVariable" : "userInput",
    variableName,
    dataType: "BOOL",
    userInputRequired: !variableName,
    blockType: "",
    instanceSource: "",
    instanceName: "",
  };
}

function setCoilElement(variableName = ""): LocalSuggestionAddElement {
  return {
    nodeType: "setCoil",
    displayLabel: "置位线圈",
    variableSource: variableName ? "existingVariable" : "userInput",
    variableName,
    dataType: "BOOL",
    userInputRequired: !variableName,
    blockType: "",
    instanceSource: "",
    instanceName: "",
  };
}

function resetCoilElement(variableName = ""): LocalSuggestionAddElement {
  return {
    nodeType: "resetCoil",
    displayLabel: "复位线圈",
    variableSource: variableName ? "existingVariable" : "userInput",
    variableName,
    dataType: "BOOL",
    userInputRequired: !variableName,
    blockType: "",
    instanceSource: "",
    instanceName: "",
  };
}

function functionBlockElement(blockType?: string): LocalSuggestionAddElement {
  const requestedBlockType = blockType?.trim() || pickFunctionBlockType();
  const libraryElement = getLibraryElement(requestedBlockType);
  const normalizedBlockType =
    libraryElement?.name || normalizeBlockType(requestedBlockType);
  const isFunction = Boolean(libraryElement && isFunctionLibraryElement(libraryElement));
  const { portInputs, portOutputs } = buildLibraryPorts(libraryElement);
  return {
    nodeType: "functionBlock",
    displayLabel: `${normalizedBlockType} ${isFunction ? "函数" : "功能块"}`,
    variableSource: "userInput",
    variableName: "",
    dataType: normalizedBlockType,
    userInputRequired: true,
    blockType: normalizedBlockType,
    instanceSource: "userInput",
    instanceName: "",
    isFunction,
    portInputs,
    portOutputs,
  };
}

function pickFunctionBlockType(): string {
  const availableTypes = COMMON_FUNCTION_BLOCK_TYPES.filter((blockType) =>
    Boolean(getLibraryElement(blockType)),
  );
  return availableTypes[0] ?? "";
}

function withFunctionBlockType(
  text: string,
  blockType: string,
  isFunction = false,
): string {
  if (!text || !blockType) {
    return text;
  }

  return replaceFunctionBlockText(text, blockType, isFunction);
}

function replaceFunctionBlockText(
  text: string,
  blockType: string,
  isFunction = false,
): string {
  const label = isFunction ? "函数" : "功能块";
  return text.replace(
    /一个\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*)?(?:功能块|函数)/g,
    `一个 ${blockType} ${label}`,
  );
}

function isGenericFunctionBlockDraft(draft: LocalSuggestionDraft): boolean {
  return draft.addElement.nodeType === "functionBlock";
}

function isLibraryBackedSuggestion(draft: LocalSuggestionDraft): boolean {
  if (draft.addElement.nodeType !== "functionBlock") {
    return true;
  }

  return Boolean(getLibraryElement(draft.addElement.blockType));
}

function replaceFunctionBlockDraft(
  draft: LocalSuggestionDraft,
  candidate: BusinessElementCandidate,
  context: BusinessSuggestionContext,
): LocalSuggestionDraft {
  const libraryElement = candidate.libraryElement;
  const isFunction = Boolean(libraryElement && isFunctionLibraryElement(libraryElement));
  const { portInputs, portOutputs } = buildLibraryPorts(libraryElement);
  const nextAddElement: LocalSuggestionAddElement = {
    ...draft.addElement,
    displayLabel: `${candidate.name} ${isFunction ? "函数" : "功能块"}`,
    blockType: candidate.name,
    dataType: candidate.name,
    isFunction,
    portInputs,
    portOutputs,
  };
  const nextDraft: LocalSuggestionDraft = {
    ...draft,
    addElement: nextAddElement,
    placement: {
      ...draft.placement,
      text: replaceFunctionBlockText(
        draft.placement.text,
        candidate.name,
        isFunction,
      ),
    },
  };
  const businessPresentation = candidate.presentation
    ? renderBusinessPresentation(candidate.presentation, nextDraft, {
        ruleId: candidate.ruleId,
        confidence: candidate.completionMatch ? 98 : 85,
        businessName: candidate.name,
        reason: candidate.reason || `当前业务条件适合使用 ${candidate.name}。`,
        actionName: candidate.name,
        groupName: formatBusinessGroupName(candidate.completionMatch?.groupKey),
        candidateName: candidate.name,
      })
    : undefined;
  const motionAxisPresentation = buildMotionAxisPresentation(
    candidate,
    nextDraft,
    context.motionAxisContext,
  );
  const businessEvidence = mergeBusinessEvidence(
    nextDraft.businessEvidence,
    evidenceFromRule(
      candidate.ruleId,
      candidate.reason || `当前业务条件适合使用 ${candidate.name}`,
      candidate.completionMatch ? 0.98 : 0.85,
      candidate.completionMatch ? [candidate.completionMatch.id] : [],
    ),
  );

  return {
    ...nextDraft,
    businessEvidence,
    businessPresentation:
      motionAxisPresentation ??
      businessPresentation ??
      nextDraft.businessPresentation,
  };
}

function buildMotionAxisPresentation(
  candidate: BusinessElementCandidate,
  suggestion: LocalSuggestionDraft,
  motionAxisContext: MotionAxisContext | undefined,
): BusinessSuggestionPresentation | undefined {
  const blockType = normalizeBlockType(candidate.name);
  const profile = motionCommandProfileForBlockType(blockType);
  if (!motionAxisContext || !profile) {
    return undefined;
  }
  if (blockType === "MC_STOP") {
    return buildMotionStopAxisPresentation(
      candidate,
      suggestion,
      motionAxisContext,
    );
  }

  const businessNames: Record<string, string> = {
    MC_POWER: "持续使能",
    MC_RESET: "错误复位",
    MC_HOME: "回零命令",
    MC_MOVEABSOLUTE: "绝对定位",
    MC_MOVERELATIVE: "相对定位",
    MC_MOVEVELOCITY: "速度运行",
    MC_HALT: "受控暂停",
  };
  const details: string[] = [];
  details.push(
    profile.triggerModel === "level"
      ? `${candidate.name}.${profile.triggerPort} 是持续保持型使能：该输入保持有效时轴才保持使能，不应当按 Execute 上升沿命令使用`
      : `${candidate.name} 由 ${profile.triggerPort} 上升沿启动一次命令周期，不是持续保持型使能`,
  );

  const configuredCommands = uniqueDisplayNames(
    motionAxisContext.commands.map((command) => command.blockType),
  );
  if (configuredCommands.length > 0) {
    details.push(
      `同一轴已配置 ${formatDisplayList(configuredCommands)}`,
    );
  }
  const completionReferences = uniqueDisplayNames(
    motionAxisContext.commands.flatMap(
      (command) => command.completionReferences,
    ),
  );
  const activeReferences = uniqueDisplayNames(
    motionAxisContext.commands.flatMap((command) => command.activeReferences),
  );
  const busyReferences = uniqueDisplayNames(
    motionAxisContext.commands.flatMap((command) => command.busyReferences),
  );
  const faultReferences = uniqueDisplayNames(
    motionAxisContext.commands.flatMap((command) => command.faultReferences),
  );
  if (completionReferences.length > 0) {
    details.push(`已有完成/到位信号 ${formatDisplayList(completionReferences)}`);
  }
  if (activeReferences.length > 0) {
    details.push(`已有使能/活动状态 ${formatDisplayList(activeReferences)}`);
  }
  if (busyReferences.length > 0) {
    details.push(`已有忙状态 ${formatDisplayList(busyReferences)}`);
  }
  if (faultReferences.length > 0) {
    details.push(`已有故障状态 ${formatDisplayList(faultReferences)}`);
  }
  if (configuredCommands.length > 1) {
    details.push(
      "这些静态同轴证据用于补全说明，仍需由程序互锁或状态机避免运动命令不受控并发，不能据此认定某条命令正在执行",
    );
  }

  return {
    title: `补充 ${motionAxisContext.axisReference} ${businessNames[blockType] ?? candidate.name}`,
    text: `${businessPlacementText(suggestion)}。${details.join("；")}。`,
    ruleId: `${candidate.ruleId}:same-axis-command-profile`,
    confidence:
      configuredCommands.length > 0 ||
      completionReferences.length > 0 ||
      activeReferences.length > 0
        ? 96
        : 90,
  };
}

function buildMotionStopAxisPresentation(
  candidate: BusinessElementCandidate,
  suggestion: LocalSuggestionDraft,
  motionAxisContext: MotionAxisContext | undefined,
): BusinessSuggestionPresentation | undefined {
  if (
    normalizeBlockType(candidate.name) !== "MC_STOP" ||
    !motionAxisContext
  ) {
    return undefined;
  }

  const sameAxisCommands = motionAxisContext.commands.filter(
    (command) => normalizeBlockType(command.blockType) !== "MC_STOP",
  );
  const commandNames = uniqueDisplayNames(
    sameAxisCommands.map((command) => command.blockType),
  );
  const existingStops = motionAxisContext.lockingStops;
  const details: string[] = [];
  if (commandNames.length > 0) {
    details.push(
      `同一轴还配置了 ${formatDisplayList(commandNames)}；MC_Stop 会中止该轴当前运动，并在 Execute 保持有效期间阻止新的运动命令`,
    );
  } else {
    details.push(
      "MC_Stop 会中止该轴当前运动，并在 Execute 保持有效期间阻止新的运动命令",
    );
  }
  if (existingStops.length > 0) {
    const executeReferences = uniqueDisplayNames(
      existingStops.map((command) => command.executeReference).filter(Boolean),
    );
    details.push(
      executeReferences.length > 0
        ? `同一轴已有 MC_Stop，其 Execute 由 ${formatDisplayList(executeReferences)} 驱动；静态图无法确认当前值，停止完成后需释放 Execute 才能解除轴锁定`
        : "同一轴已有 MC_Stop；静态图无法确认其 Execute 当前值，停止完成后需释放 Execute 才能解除轴锁定",
    );
  } else {
    details.push("停止完成后需释放 Execute，轴才能重新接受运动命令");
  }

  return {
    title: `补充 ${motionAxisContext.axisReference} 受控停止`,
    text: `${businessPlacementText(suggestion)}。${details.join("；")}。`,
    ruleId: `${candidate.ruleId}:same-axis-context`,
    confidence: commandNames.length > 0 || existingStops.length > 0 ? 96 : 90,
  };
}

function uniqueDisplayNames(values: string[]): string[] {
  const names = new Map<string, string>();
  for (const value of values) {
    const normalized = String(value ?? "").trim().toUpperCase();
    if (normalized && !names.has(normalized)) {
      names.set(normalized, String(value).trim());
    }
  }
  return [...names.values()];
}

function formatDisplayList(values: string[]): string {
  if (values.length <= 3) {
    return values.join("、");
  }
  return `${values.slice(0, 3).join("、")} 等 ${values.length} 类运动命令`;
}

function renderBusinessPresentation(
  config: BusinessPresentationConfig,
  suggestion: LocalSuggestionDraft,
  input: {
    ruleId: string;
    confidence: number;
    businessName: string;
    reason: string;
    actionName: string;
    groupName?: string;
    candidateName?: string;
    candidateVar?: string;
  },
): BusinessSuggestionPresentation | undefined {
  const values: Record<string, string> = {
    businessName: input.businessName,
    reason: input.reason,
    focusVar: suggestion.placement.anchorNodeVar || "当前节点",
    actionName: input.actionName || "当前回路",
    groupName: input.groupName || "当前回路",
    candidateName:
      input.candidateName || suggestion.addElement.blockType || "待补全节点",
    candidateVar: input.candidateVar || suggestion.addElement.variableName,
    placementAction: businessPlacementAction(suggestion),
    placementText: businessPlacementText(suggestion),
    elementType: businessElementType(suggestion.addElement),
  };
  const title = renderBusinessTemplate(config.titleTemplate, values);
  const text = renderBusinessTemplate(config.textTemplate, values);
  if (!title || !text) {
    return undefined;
  }
  return {
    title,
    text,
    ruleId: input.ruleId,
    confidence: input.confidence,
    reason: input.reason,
  };
}

function evidenceFromRule(
  ruleId: string,
  reason: string,
  confidence: number,
  signatureIds: string[] = [],
): BusinessSuggestionEvidence {
  return {
    ruleIds: [primaryRuleId(ruleId)],
    signatureIds: uniqueStringList(signatureIds),
    reason,
    confidence: normalizeDiagnosticConfidence(confidence),
  };
}

function evidenceFromPresentation(
  presentation: BusinessSuggestionPresentation | undefined,
): BusinessSuggestionEvidence | undefined {
  if (!presentation?.ruleId) {
    return undefined;
  }
  return evidenceFromRule(
    presentation.ruleId,
    presentation.reason || presentation.text,
    presentation.confidence,
  );
}

function mergeBusinessEvidence(
  left: BusinessSuggestionEvidence | undefined,
  right: BusinessSuggestionEvidence | undefined,
): BusinessSuggestionEvidence | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return {
    ruleIds: uniqueStringList([...left.ruleIds, ...right.ruleIds]),
    signatureIds: uniqueStringList([
      ...left.signatureIds,
      ...right.signatureIds,
    ]),
    reason: right.reason || left.reason,
    confidence: Math.max(left.confidence, right.confidence),
  };
}

function primaryRuleId(ruleId: string): string {
  return ruleId.split(":", 1)[0].trim();
}

function normalizeDiagnosticConfidence(confidence: number): number {
  const normalized = confidence > 1 ? confidence / 100 : confidence;
  return Math.max(0, Math.min(1, normalized));
}

function renderBusinessTemplate(
  template: string,
  values: Record<string, string>,
): string | undefined {
  let unsupportedPlaceholder = false;
  const rendered = template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_, key) => {
    if (!(key in values)) {
      unsupportedPlaceholder = true;
      return "";
    }
    return values[key];
  }).trim();
  return unsupportedPlaceholder || !rendered ? undefined : rendered;
}

function businessPlacementAction(suggestion: LocalSuggestionDraft): string {
  switch (suggestion.position ?? inferPosition(suggestion)) {
    case "front":
      return "前串联";
    case "behind":
      return "后串联";
    case "outsideFront":
      return "外侧前串联";
    case "outsideBehind":
      return "外侧后串联";
    case "parallel":
      return "并联";
    case "replace":
      return "替换为";
    default:
      return "补充";
  }
}

function businessPlacementText(suggestion: LocalSuggestionDraft): string {
  const focusName = suggestion.placement.anchorNodeVar || "当前节点";
  const elementType = businessElementType(suggestion.addElement);
  switch (suggestion.position ?? inferPosition(suggestion)) {
    case "front":
      return `建议在 ${focusName} 前串联一个${elementType}`;
    case "behind":
      return `建议在 ${focusName} 后串联一个${elementType}`;
    case "outsideFront":
      return `建议在 ${focusName} 所在分支组前串联一个${elementType}`;
    case "outsideBehind":
      return `建议在 ${focusName} 所在并联结构汇合后串联一个${elementType}`;
    case "parallel":
      return `建议与 ${focusName} 并联一个${elementType}`;
    case "replace":
      return `建议将 ${focusName} 替换为${elementType}`;
    default:
      return `建议补充一个${elementType}`;
  }
}

function businessElementType(addElement: LocalSuggestionAddElement): string {
  switch (addElement.nodeType) {
    case "contact":
      return "常开触点";
    case "negatedContact":
      return "常闭触点";
    case "risingContact":
      return "上升沿触点";
    case "fallingContact":
      return "下降沿触点";
    case "coil":
      return "线圈";
    case "setCoil":
      return "置位线圈";
    case "resetCoil":
      return "复位线圈";
    case "functionBlock":
      return addElement.displayLabel;
    default:
      return addElement.displayLabel || "节点";
  }
}

function formatBusinessGroupName(groupKey: string | undefined): string {
  const value = String(groupKey ?? "").trim();
  const separator = value.indexOf(":");
  return separator >= 0 ? value.slice(separator + 1) || "当前回路" : value;
}

function buildLibraryPorts(
  libraryElement: LibraryElementInfo | undefined,
): LibraryPorts {
  if (!libraryElement) {
    return { portInputs: [], portOutputs: [] };
  }

  const inputs = libraryElement.inputs ?? [];
  const outputs = libraryElement.outputs ?? [];

  const portInputs = inputs
    .filter((port) => !isSystemEnablePort(port, "EN"))
    .map((port) => {
      const suggestedPort = toLibraryPort(port, "VAR_INPUT");
      return hasMatchingLibraryPort(outputs, port)
        ? { ...suggestedPort, scope: "VAR_IN_OUT" }
        : suggestedPort;
    });
  const portOutputs = outputs
    .filter((port) => !isSystemEnablePort(port, "ENO"))
    .filter((port) => !hasMatchingLibraryPort(inputs, port))
    .map((port) => toLibraryPort(port, "VAR_OUTPUT"));

  return {
    portInputs: [createSystemEnablePort("EN"), ...portInputs],
    portOutputs: [createSystemEnablePort("ENO"), ...portOutputs],
  };
}

function isSystemEnablePort(
  [name]: [string, string, string],
  expectedName: "EN" | "ENO",
): boolean {
  return name.trim().toUpperCase() === expectedName;
}

function createSystemEnablePort(name: "EN" | "ENO"): SuggestedPort {
  return { name, value: "", type: "", scope: "" };
}

function hasMatchingLibraryPort(
  ports: Array<[string, string, string]>,
  candidate: [string, string, string],
): boolean {
  const [candidateName, candidateType] = candidate;
  return ports.some(
    ([name, type]) => name === candidateName && type === candidateType,
  );
}

function toLibraryPort(
  [name, type, scope]: [string, string, string],
  defaultScope: string,
): SuggestedPort {
  return {
    name,
    value: name === "EN" || name === "ENO" ? "" : "???",
    type,
    scope: scope && scope !== "none" ? scope : defaultScope,
  };
}

function isFunctionLibraryElement(
  libraryElement: LibraryElementInfo,
): boolean {
  return libraryElement.type === "function";
}

function getLibraryElement(name: string): LibraryElementInfo | undefined {
  const normalized = normalizeBlockType(name);
  if (!normalized) {
    return undefined;
  }

  const data = loadLibraryData();
  return data.get(normalized);
}

let cachedLibraryData: Map<string, LibraryElementInfo> | undefined;

function loadLibraryData(): Map<string, LibraryElementInfo> {
  if (cachedLibraryData) {
    return cachedLibraryData;
  }

  const filePath = path.join(__dirname, "st-library-info-data.json");
  const parsed = readJsonFile(filePath);
  const elements = new Map<string, LibraryElementInfo>();

  for (const category of asArrayRecord(parsed)) {
    const categoryName = asStringConfig(category.name);
    for (const item of asArrayRecord(category.list)) {
      const name = asStringConfig(item.name);
      const type = asStringConfig(item.type);
      if (!name || !type) {
        continue;
      }

      const libraryElement: LibraryElementInfo = {
        name,
        type,
        category: categoryName,
        comment: asStringConfig(item.comment),
        inputs: parseLibraryPorts(item.inputs),
        outputs: parseLibraryPorts(item.outputs),
      };
      const key = normalizeBlockType(name);
      if (!elements.has(key)) {
        elements.set(key, libraryElement);
      }
    }
  }

  cachedLibraryData = elements;
  return elements;
}

function parseLibraryPorts(
  value: unknown,
): Array<[string, string, string]> | undefined {
  const ports = asArrayConfig(value)
    .map((entry) =>
      Array.isArray(entry) && entry.length >= 2
        ? [
            asStringConfig(entry[0]),
            asStringConfig(entry[1]),
            asStringConfig(entry[2]),
          ]
        : undefined,
    )
    .filter((entry): entry is [string, string, string] => Boolean(entry));

  return ports.length > 0 ? ports : undefined;
}

function findNode(
  segment: DiagramSegmentSummary,
  nodeId: string,
): DiagramNodeSummary | undefined {
  return segment.nodes.find((node) => node.id === nodeId);
}

function firstRealNode(
  segment: DiagramSegmentSummary,
  nodeIds: string[] | undefined,
): DiagramNodeSummary | undefined {
  return (nodeIds ?? [])
    .map((nodeId) => findNode(segment, nodeId))
    .find((node): node is DiagramNodeSummary =>
      Boolean(node && isRealGraphElementKind(node.kind)),
    );
}

function analyzeSegment(segment: DiagramSegmentSummary): SegmentGraphState {
  const hasLogicNode = segment.nodes.some((node) => isLogicNodeKind(node.kind));
  const hasOutputNode = segment.nodes.some((node) => isOutputNodeKind(node.kind));

  return {
    hasLogicNode,
    hasOutputNode,
    isPartialGraph: hasLogicNode && !hasOutputNode,
  };
}

function canAddOutputAfterNode(
  segment: DiagramSegmentSummary,
  node: DiagramNodeSummary,
): boolean {
  return (
    !hasDownstreamOutputNode(segment, node.id) &&
    !hasDownstreamLogicNode(segment, node.id)
  );
}

function createOutputCoilPlan(
  segment: DiagramSegmentSummary,
  node: DiagramNodeSummary,
): OutputCoilPlan {
  const directInsertionTargets = directInsertionPointTargetIds(segment, node);
  if (directInsertionTargets.length > 0) {
    const suffix = node.kind === "FBDCompartment" ? "输出端后" : "后";
    return {
      startNodes: directInsertionTargets,
      endNodes: [],
      preserveStartNodes: true,
      position: "behind",
      serialOrParallel: "serial",
      text: (nodeText) => `在${nodeText}${suffix}添加一个线圈`,
      partialText: (nodeText) =>
        `当前回路还没有输出节点，在${nodeText}${suffix}添加一个线圈`,
    };
  }

  const outsideStartNodes = findParallelOutputStartNodeIds(segment, node);
  if (outsideStartNodes.length > 1) {
    return {
      startNodes: outsideStartNodes,
      endNodes: [],
      position: "outsideBehind",
      serialOrParallel: "serial",
      text: (nodeText) =>
        `在${nodeText}所在并联结构汇合后添加一个线圈`,
      partialText: (nodeText) =>
        `当前回路还没有输出节点，在${nodeText}所在并联结构汇合后添加一个线圈`,
    };
  }

  const suffix = node.kind === "FBDCompartment" ? "输出端后" : "后";
  return {
    text: (nodeText) => `在${nodeText}${suffix}添加一个线圈`,
    partialText: (nodeText) =>
      `当前回路还没有输出节点，在${nodeText}${suffix}添加一个线圈`,
  };
}

function findParallelOutputStartNodeIds(
  segment: DiagramSegmentSummary,
  node: DiagramNodeSummary,
): string[] {
  const visited = new Set<string>();
  const queue = [...node.to];
  let bestTailNodes: DiagramNodeSummary[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }

    visited.add(currentId);
    const current = findNode(segment, currentId);
    if (!current) {
      continue;
    }

    const tailNodes = orderBoundaryDisplayNodes(
      collectNearestDisplayNodes(segment, current.from, "backward"),
    );
    if (
      tailNodes.length > 1 &&
      tailNodes.some((tailNode) => tailNode.id === node.id) &&
      tailNodes.length >= bestTailNodes.length
    ) {
      bestTailNodes = tailNodes;
    }

    if (isOutputNodeKind(current.kind)) {
      continue;
    }

    queue.push(...current.to);
  }

  return bestTailNodes.map((tailNode) => tailNode.id);
}

function hasDownstreamOutputNode(
  segment: DiagramSegmentSummary,
  startNodeId: string,
): boolean {
  const visited = new Set<string>();
  const queue = [...(findNode(segment, startNodeId)?.to ?? [])];

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

    if (isOutputNodeKind(node.kind)) {
      return true;
    }

    queue.push(...node.to);
  }

  return false;
}

function hasDownstreamLogicNode(
  segment: DiagramSegmentSummary,
  startNodeId: string,
): boolean {
  const visited = new Set<string>();
  const queue = [...(findNode(segment, startNodeId)?.to ?? [])];

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

    if (isLogicNodeKind(node.kind)) {
      return true;
    }

    queue.push(...node.to);
  }

  return false;
}

function dedupeSuggestions(
  suggestions: LocalSuggestionDraft[],
): LocalSuggestionDraft[] {
  const seen = new Set<string>();
  const result: LocalSuggestionDraft[] = [];

  for (const suggestion of suggestions) {
    const startNodes = normalizeNodeIds(
      suggestion.startNodes ?? inferStartNodes(suggestion),
    ).join(",");
    const endNodes = normalizeNodeIds(
      suggestion.endNodes ?? inferEndNodes(suggestion),
    ).join(",");
    const key = [
      suggestion.mode,
      suggestion.placement.relationToFocus,
      startNodes,
      endNodes,
      suggestion.position ?? inferPosition(suggestion),
      suggestion.serialOrParallel ?? inferSerialOrParallel(suggestion),
      suggestion.placement.parallelToNodeId,
      suggestion.placement.branchFromNodeId,
      suggestion.placement.branchToNodeId,
      suggestion.addElement.nodeType,
      suggestion.addElement.blockType,
      suggestion.addElement.variableName,
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(suggestion);
  }

  return result;
}

function hasExistingFunctionBlockAtInsertionBoundary(
  suggestion: LocalSuggestionDraft,
  segment: DiagramSegmentSummary,
): boolean {
  if (
    suggestion.addElement.nodeType !== "functionBlock" ||
    inferSerialOrParallel(suggestion) !== "serial"
  ) {
    return false;
  }

  const blockType = normalizeBlockType(suggestion.addElement.blockType);
  if (!blockType) {
    return false;
  }

  return [
    suggestion.placement.insertAfterNodeId,
    suggestion.placement.insertBeforeNodeId,
  ].some((nodeId) => {
    const boundaryNode = findNode(segment, nodeId);
    return (
      boundaryNode?.kind === "FBDCompartment" &&
      normalizeBlockType(boundaryNode.blockType) === blockType
    );
  });
}

function hasExistingFunctionBlockInRelatedSegment(
  suggestion: LocalSuggestionDraft,
  context: BusinessSuggestionContext,
  focus: FocusContext,
): boolean {
  if (
    suggestion.addElement.nodeType !== "functionBlock" ||
    inferSerialOrParallel(suggestion) !== "serial" ||
    !focus.node
  ) {
    return false;
  }

  const blockType = normalizeBlockType(suggestion.addElement.blockType);
  const focusReferences = collectNodeReferences(focus.node);
  if (!blockType || focusReferences.size === 0) {
    return false;
  }

  return context.relatedSegments.some((related) => {
    const sharedFocusReferences = intersection(
      focusReferences,
      related.sharedReferences,
    );
    if (sharedFocusReferences.size === 0) {
      return false;
    }

    return related.segment.nodes.some((node) => {
      if (
        node.kind !== "FBDCompartment" ||
        normalizeBlockType(node.blockType) !== blockType
      ) {
        return false;
      }

      return intersection(
        sharedFocusReferences,
        collectNodeReferences(node),
      ).size > 0;
    });
  });
}

function limitRankedSuggestions(
  suggestions: LocalSuggestionDraft[],
  limit: number,
): LocalSuggestionDraft[] {
  if (suggestions.length <= limit) {
    return suggestions;
  }

  const limited = suggestions.slice(0, limit);
  if (limited.some((suggestion) => suggestion.mode === "outputCoil")) {
    return limited;
  }

  const outputCoilSuggestion = suggestions
    .slice(limit)
    .find((suggestion) => suggestion.mode === "outputCoil");
  if (!outputCoilSuggestion || limit <= 0) {
    return limited;
  }

  return [...limited.slice(0, limit - 1), outputCoilSuggestion];
}

function getFocusId(focus: FocusContext): string {
  return focus.node?.id ?? focus.insertionPoint?.id ?? "";
}

function getFocusType(focus: FocusContext): string {
  return focus.node?.kind ?? focus.insertionPoint?.kind ?? "";
}

function getFocusVar(focus: FocusContext): string {
  return focus.node?.var ?? focus.node?.instance ?? "";
}

function getFocusVisualElement(focus: FocusContext): string {
  if (focus.node) {
    return nodeLabelWithSegment(focus.segment, focus.node);
  }

  const insertionPoint = focus.insertionPoint;
  if (!insertionPoint) {
    return "";
  }

  return `${insertionPoint.kind} ${insertionPoint.fromLabels.join(", ") || "start"} -> ${insertionPoint.toLabels.join(", ") || "end"}`;
}

function getFallbackFocusLabel(
  focus: Omit<FocusContext, "source">,
): string {
  if (focus.node) {
    return nodeLabelWithSegment(focus.segment, focus.node);
  }

  if (focus.insertionPoint) {
    return `${focus.insertionPoint.kind} ${focus.insertionPoint.id}`;
  }

  return "the first graph element";
}

function nodeLabel(node: DiagramNodeSummary): string {
  if (node.kind === "FBDCompartment") {
    if (node.isFunction) {
      return `${node.blockType || "FUN"} 函数(${node.id})`;
    }

    const instance = node.instance ? ` ${node.instance}` : "";
    return `${node.blockType || "功能块"}${instance} 功能块`;
  }

  if (isCoilKind(node.kind)) {
    return `${displayNodeName(undefined, node)} ${coilKindLabel(node.kind)}`;
  }

  if (isContactKind(node.kind)) {
    return `${displayNodeName(undefined, node)} ${contactKindLabel(node.kind)}`;
  }

  return node.var || node.instance || node.id;
}

function nodeLabelWithSegment(
  segment: DiagramSegmentSummary,
  node: DiagramNodeSummary,
): string {
  if (node.kind === "FBDCompartment") {
    if (node.isFunction) {
      return `${node.blockType || "FUN"} 函数(${node.id})`;
    }

    const instance = displayNodeName(segment, node);
    return instance ? `${node.blockType || "功能块"} ${instance} 功能块` : `${node.blockType || "功能块"} 功能块`;
  }

  if (isCoilKind(node.kind)) {
    return `${displayNodeName(segment, node)} ${coilKindLabel(node.kind)}`;
  }

  if (isContactKind(node.kind)) {
    return `${displayNodeName(segment, node)} ${contactKindLabel(node.kind)}`;
  }

  return displayNodeName(segment, node);
}

function neighborListText(
  segment: DiagramSegmentSummary,
  nodeIds: string[] | undefined,
  direction: "forward" | "backward",
): string {
  const labels = neighborNodes(segment, nodeIds, direction).map((node) =>
    nodePlacementLabelWithSegment(segment, node),
  );

  if (!labels.length) {
    return "";
  }

  return [...new Set(labels)].join(" / ");
}

function nodePlacementLabelWithSegment(
  segment: DiagramSegmentSummary,
  node: DiagramNodeSummary,
): string {
  const label = nodeLabelWithSegment(segment, node);
  if (label.includes(`(${node.id})`)) {
    return label;
  }

  return `${label}(${node.id})`;
}

function neighborNodes(
  segment: DiagramSegmentSummary,
  nodeIds: string[] | undefined,
  direction: "forward" | "backward",
): DiagramNodeSummary[] {
  const seen = new Set<string>();
  const nodes: DiagramNodeSummary[] = [];

  for (const nodeId of nodeIds ?? []) {
    const node = findNearestDisplayNode(segment, nodeId, direction);
    if (!node || seen.has(node.id)) {
      continue;
    }

    seen.add(node.id);
    nodes.push(node);
  }

  return nodes;
}

function directInsertionPointSourceIds(
  segment: DiagramSegmentSummary,
  node: DiagramNodeSummary,
): string[] {
  return normalizeNodeIds(
    node.from.filter((nodeId) => {
      const sourceNode = findNode(segment, nodeId);
      return Boolean(sourceNode && isInsertionPointKind(sourceNode.kind));
    }),
  );
}

function findLeftRailInsertionPointBeforeNode(
  segment: DiagramSegmentSummary,
  node: DiagramNodeSummary,
): { insertionPointId: string; sourceIds: string[] } | undefined {
  for (const insertionPointId of directInsertionPointSourceIds(segment, node)) {
    const insertionPoint = findNode(segment, insertionPointId);
    if (!insertionPoint) {
      continue;
    }

    const sourceIds = normalizeNodeIds(
      insertionPoint.from.filter((sourceId) => {
        const sourceNode = findNode(segment, sourceId);
        return sourceNode?.kind === "startLine";
      }),
    );
    if (sourceIds.length > 0) {
      return {
        insertionPointId,
        sourceIds,
      };
    }
  }

  return undefined;
}

function getParallelStartNodePlan(
  segment: DiagramSegmentSummary,
  node: DiagramNodeSummary,
): { startNodes: string[]; preserveStartNodes: boolean } {
  const insertionPointSourceIds = directInsertionPointSourceIds(segment, node);
  if (insertionPointSourceIds.length > 0) {
    return {
      startNodes: insertionPointSourceIds,
      preserveStartNodes: true,
    };
  }

  return {
    startNodes: resolveBoundaryNodeIds(segment, node.from, "backward"),
    preserveStartNodes: false,
  };
}

function getParallelEndNodePlan(
  segment: DiagramSegmentSummary,
  node: DiagramNodeSummary,
): { endNodes: string[]; preserveEndNodes: boolean } {
  const insertionPointTargetIds = directInsertionPointTargetIds(segment, node);
  if (insertionPointTargetIds.length > 0) {
    return {
      endNodes: insertionPointTargetIds,
      preserveEndNodes: true,
    };
  }

  return {
    endNodes: resolveBoundaryNodeIds(segment, node.to, "forward"),
    preserveEndNodes: false,
  };
}

function addCoilReplaceSuggestions(
  suggestions: LocalSuggestionDraft[],
  focus: FocusContext,
  nodeText: string,
): void {
  const node = focus.node;
  if (!node) {
    return;
  }

  const replaceTargets: Array<{
    kind: string;
    label: string;
    addElement: LocalSuggestionAddElement;
  }> = [
    {
      kind: "coil",
      label: "普通线圈",
      addElement: coilElement(node.var),
    },
    {
      kind: "setCoil",
      label: "置位线圈",
      addElement: setCoilElement(node.var),
    },
    {
      kind: "resetCoil",
      label: "复位线圈",
      addElement: resetCoilElement(node.var),
    },
  ];

  for (const target of replaceTargets) {
    if (node.kind === target.kind) {
      continue;
    }

    suggestions.push(
      makeSuggestion(focus, {
        mode: "replaceSelected",
        relationToFocus: "replaceSelected",
        text: `将${nodeText}改成${target.label}`,
        addElement: target.addElement,
      }),
    );
  }
}

function directInsertionPointTargetIds(
  segment: DiagramSegmentSummary,
  node: DiagramNodeSummary,
): string[] {
  return normalizeNodeIds(
    node.to.filter((nodeId) => {
      const targetNode = findNode(segment, nodeId);
      return Boolean(targetNode && isInsertionPointKind(targetNode.kind));
    }),
  );
}

function directInsertionPointTargetsBeforeNode(
  segment: DiagramSegmentSummary,
  sourceNode: DiagramNodeSummary,
  rightNode: DiagramNodeSummary,
): string[] {
  return directInsertionPointTargetIds(segment, sourceNode).filter(
    (insertionPointId) =>
      collectNearestDisplayNodes(segment, [insertionPointId], "forward").some(
        (node) => node.id === rightNode.id,
      ),
  );
}

function findOutsideBehindPlan(
  segment: DiagramSegmentSummary,
  anchorNode: DiagramNodeSummary,
): OutsideBehindPlan | undefined {
  const visited = new Set<string>();
  const queue = [...anchorNode.to];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }

    visited.add(currentId);
    const current = findNode(segment, currentId);
    if (!current) {
      continue;
    }

    const branchTailNodes = orderBoundaryDisplayNodes(
      collectNearestDisplayNodes(segment, current.from, "backward"),
    );
    const anchorIsBranchTail = branchTailNodes.some(
      (tailNode) => tailNode.id === anchorNode.id,
    );
    if (branchTailNodes.length > 1 && anchorIsBranchTail) {
      const endNodes =
        isRealGraphElementKind(current.kind) ||
        isBoundaryLineKind(current.kind)
          ? [current.id]
          : resolveBoundaryNodeIds(segment, current.to, "forward");
      if (endNodes.length > 0) {
        const mergeInsertionPoint = isInsertionPointKind(current.kind);
        return {
          startNodes: branchTailNodes.map((tailNode) => tailNode.id),
          endNodes: mergeInsertionPoint ? [current.id] : endNodes,
          preserveEndNodes: mergeInsertionPoint,
        };
      }
    }

    if (!isCoilKind(current.kind)) {
      queue.push(...current.to);
    }
  }

  return undefined;
}

function canReachNode(
  segment: DiagramSegmentSummary,
  startNodeId: string,
  targetNodeId: string,
): boolean {
  const visited = new Set<string>();
  const queue = [startNodeId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }
    if (currentId === targetNodeId) {
      return true;
    }

    visited.add(currentId);
    const current = findNode(segment, currentId);
    if (current) {
      queue.push(...current.to);
    }
  }

  return false;
}

function collectNearestDisplayNodes(
  segment: DiagramSegmentSummary,
  nodeIds: string[] | undefined,
  direction: "forward" | "backward",
): DiagramNodeSummary[] {
  const visited = new Set<string>();
  const resultById = new Map<string, DiagramNodeSummary>();
  const queue = [...(nodeIds ?? [])];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }

    visited.add(currentId);
    const node = findNode(segment, currentId);
    if (!node) {
      continue;
    }

    if (isRealGraphElementKind(node.kind)) {
      resultById.set(node.id, node);
      continue;
    }

    queue.push(...(direction === "forward" ? node.to : node.from));
  }

  return [...resultById.values()];
}

function orderBoundaryDisplayNodes(
  nodes: DiagramNodeSummary[],
): DiagramNodeSummary[] {
  const yValues = nodes
    .map((node) => node.y)
    .filter((value): value is number => typeof value === "number");

  if (new Set(yValues).size > 1) {
    return [...nodes].sort(compareDisplayOrder);
  }

  return nodes;
}

function findNearestDisplayNode(
  segment: DiagramSegmentSummary,
  nodeId: string,
  direction: "forward" | "backward",
): DiagramNodeSummary | undefined {
  const visited = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }

    visited.add(currentId);
    const node = findNode(segment, currentId);
    if (!node) {
      continue;
    }

    if (isRealGraphElementKind(node.kind)) {
      return node;
    }

    queue.push(...(direction === "forward" ? node.to : node.from));
  }

  return undefined;
}

function displayNodeName(
  segment: DiagramSegmentSummary | undefined,
  node: DiagramNodeSummary,
): string {
  const rawName = (node.var || node.instance || "").trim();
  if (rawName && !isUnnamedPlaceholder(rawName)) {
    return rawName;
  }

  if (!segment) {
    return `未命名(${node.id})`;
  }

  const index = unnamedNodeIndex(segment, node);
  const displayName = index > 0 ? `未命名${index}` : "未命名";
  return `${displayName}(${node.id})`;
}

function unnamedNodeIndex(
  segment: DiagramSegmentSummary,
  targetNode: DiagramNodeSummary,
): number {
  const unnamedNodes = segment.nodes
    .filter((node) => isRealGraphElementKind(node.kind))
    .filter((node) => !node.isFunction)
    .filter((node) => isUnnamedPlaceholder(node.var || node.instance || ""))
    .sort(compareDisplayOrder);

  return unnamedNodes.findIndex((node) => node.id === targetNode.id) + 1;
}

function compareDisplayOrder(a: DiagramNodeSummary, b: DiagramNodeSummary): number {
  const ay = a.y ?? Number.POSITIVE_INFINITY;
  const by = b.y ?? Number.POSITIVE_INFINITY;
  if (ay !== by) {
    return ay - by;
  }

  const ax = a.x ?? Number.POSITIVE_INFINITY;
  const bx = b.x ?? Number.POSITIVE_INFINITY;
  if (ax !== bx) {
    return ax - bx;
  }

  return (a.order ?? 0) - (b.order ?? 0);
}

function isUnnamedPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  return !trimmed || trimmed === "???";
}

function contactKindLabel(kind: string): string {
  switch (kind) {
    case "negatedContact":
      return "常闭触点";
    case "risingContact":
      return "上升沿";
    case "fallingContact":
      return "下降沿";
    case "contact":
    default:
      return "常开触点";
  }
}

function coilKindLabel(kind: string): string {
  switch (kind) {
    case "setCoil":
      return "置位线圈";
    case "resetCoil":
      return "复位线圈";
    case "coil":
    default:
      return "线圈";
  }
}

function isContactKind(kind: string): boolean {
  return [
    "contact",
    "negatedContact",
    "risingContact",
    "fallingContact",
  ].includes(kind);
}

function isCoilKind(kind: string): boolean {
  return ["coil", "setCoil", "resetCoil"].includes(kind);
}

function isOutputNodeKind(kind: string): boolean {
  return isCoilKind(kind) || kind === "FBDCompartment";
}

function isLogicNodeKind(kind: string): boolean {
  return isContactKind(kind) || kind === "FBDCompartment";
}

function isRealGraphElementKind(kind: string): boolean {
  return [
    "contact",
    "negatedContact",
    "risingContact",
    "fallingContact",
    "coil",
    "setCoil",
    "resetCoil",
    "FBDCompartment",
  ].includes(kind);
}

function isBoundaryLineKind(kind: string): boolean {
  return kind === "startLine" || kind === "endLine";
}

function isInsertionPointKind(kind: string): boolean {
  return kind === "editRect" || kind === "branchRect";
}

function isInsertionPointId(
  segment: DiagramSegmentSummary,
  nodeId: string,
): boolean {
  const node = findNode(segment, nodeId);
  return Boolean(node && isInsertionPointKind(node.kind));
}

function first(values: string[] | undefined): string {
  return values?.[0] ?? "";
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

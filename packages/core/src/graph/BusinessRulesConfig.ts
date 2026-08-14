import * as fs from "fs";
import * as path from "path";
import {
  BusinessBlockPortRoleRuleConfig,
  BusinessLoopSignatureConfig,
  BusinessPortDirection,
  BusinessVariablePatternsConfig,
  EMPTY_BLOCK_PORT_ROLE_RULES,
  EMPTY_LOOP_SIGNATURES,
  EMPTY_VARIABLE_PATTERNS,
  parseBlockPortRoleRules,
  parseLoopSignatures,
  parseVariablePatterns,
} from "./BusinessLoopSignatures";

export type BusinessTerm = string;

export type BusinessRulePosition =
  | "front"
  | "behind"
  | "outsideFront"
  | "outsideBehind"
  | "parallel"
  | "replace";

export interface BusinessPresentationConfig {
  titleTemplate: string;
  textTemplate: string;
}

export interface BusinessDeviceLoopRuleConfig {
  id: string;
  status: string;
  anchorRolesAny: string[];
  anchorTermsAny: BusinessTerm[];
  candidateRolesAny: string[];
  candidateNodeType: "contact" | "negatedContact";
  allowedPositions: BusinessRulePosition[];
  excludedTerms: BusinessTerm[];
  priority: number;
  businessName: string;
  reason: string;
  presentation?: BusinessPresentationConfig;
  oppositeActionCandidates?: BusinessOppositeActionCandidatesConfig;
}

export interface BusinessOppositeActionPairConfig {
  id: string;
  leftTerms: BusinessTerm[];
  rightTerms: BusinessTerm[];
}

export interface BusinessOppositeActionCandidatesConfig {
  rolesAny: string[];
  pairs: BusinessOppositeActionPairConfig[];
  businessName: string;
  reason: string;
  presentation?: BusinessPresentationConfig;
}

export interface BusinessFaultResponseRuleConfig {
  id: string;
  status: string;
  anchorRolesAny: string[];
  anchorTermsAny: BusinessTerm[];
  candidateRolesAny: string[];
  candidateNodeType: "coil" | "setCoil";
  allowedPositions: BusinessRulePosition[];
  excludedTerms: BusinessTerm[];
  priority: number;
  businessName: string;
  reason: string;
  presentation?: BusinessPresentationConfig;
}

export interface BusinessFaultResetRuleConfig {
  id: string;
  status: string;
  anchorRolesAny: string[];
  candidateRolesAny: string[];
  candidateNodeType: "resetCoil";
  allowedPositions: BusinessRulePosition[];
  excludedTerms: BusinessTerm[];
  priority: number;
  businessName: string;
  reason: string;
  presentation?: BusinessPresentationConfig;
}

export interface BusinessActionLifecycleRuleConfig {
  id: string;
  status: string;
  kind:
    | "selfHold"
    | "stopInterlock"
    | "latchedRelease"
    | "countCompletionOutput"
    | "countCompletionLatch";
  anchorRolesAny: string[];
  candidateRolesAny: string[];
  candidateNodeType:
    | "contact"
    | "negatedContact"
    | "coil"
    | "setCoil"
    | "resetCoil";
  allowedPositions: BusinessRulePosition[];
  excludedTerms: BusinessTerm[];
  priority: number;
  businessName: string;
  reason: string;
  presentation?: BusinessPresentationConfig;
}

export interface BusinessMotionCommandProfileConfig {
  id: string;
  status: string;
  blockTypes: string[];
  triggerModel: "level" | "risingEdge";
  triggerPort: string;
  completionPorts: string[];
  activePorts: string[];
  busyPorts: string[];
  faultPorts: string[];
  abortedPorts: string[];
  locksAxisWhileTriggerTrue: boolean;
}

export interface BusinessChainGuardConfig {
  parallelBypassProtectedRoles: string[];
  relatedCapabilityIdentityRoles: string[];
  identityScopedCapabilityBlockTypes: string[];
  relatedCapabilityMinSharedReferences: number;
}

export interface BusinessDerivedTermConfig {
  term: BusinessTerm;
  whenDataTypesAny: string[];
  whenTypeCapabilitiesAny: string[];
}

export interface BusinessTermImplicationConfig {
  ifMatched: BusinessTerm;
  alsoMatch: BusinessTerm[];
}

export interface BusinessTermPatternConfig {
  term: BusinessTerm;
  literalPatterns: string[];
  regexPatterns: string[];
}

export interface BusinessTermMatcher {
  term: BusinessTerm;
  literalPatterns: string[];
  regexPatterns: RegExp[];
}

export interface BusinessContactPolarityRuleConfig {
  id: string;
  status: string;
  polarity: "normal" | "negated";
  termsAny?: BusinessTerm[];
  termsAll?: BusinessTerm[];
  excludedTerms?: BusinessTerm[];
  excludedAnchorTerms?: BusinessTerm[];
  anchorTermScope: "selectedNode" | "selectedNodeOrDirectNeighbors";
  priority: number;
  reason?: string;
}

export interface BusinessNodeIntentRuleConfig {
  id: string;
  status: string;
  nodeTypes: string[];
  positions: BusinessRulePosition[];
  termsAny: BusinessTerm[];
  termsAll: BusinessTerm[];
  excludedTerms: BusinessTerm[];
  actionRolesAny: string[];
  chainRolesAny: string[];
  requireActionAnchor: boolean;
  minimumEvidenceCount: number;
  priority: number;
  businessName: string;
  reason: string;
  presentation?: BusinessPresentationConfig;
}

export interface BusinessPortRequirementConfig {
  port: string;
  direction: BusinessPortDirection;
  required: boolean;
  acceptedDataTypes: string[];
  allowCreateParameter: boolean;
}

export interface BusinessLibraryRuleConfig {
  id: string;
  status: string;
  termsAny?: BusinessTerm[];
  termsAll?: BusinessTerm[];
  excludedTerms?: BusinessTerm[];
  focusKinds?: string[];
  requiredAnyDataTypes?: string[];
  requiredAllDataTypes?: string[];
  excludedDataTypes?: string[];
  requiredTypeCapabilities?: string[];
  signatureRefsAny?: string[];
  excludedExistingBlockTypes?: string[];
  portRequirements?: BusinessPortRequirementConfig[];
  candidateNames: string[];
  priority: number;
  baseScore?: number;
  allowedModes?: string[];
  allowedPositions?: BusinessRulePosition[];
  preferredModes?: string[];
  preferredPositions?: BusinessRulePosition[];
  reason?: string;
  fallback?: string;
  presentation?: BusinessPresentationConfig;
}

export interface BusinessRankingRuleConfig {
  id: string;
  status: string;
  termsAny?: BusinessTerm[];
  termsAll?: BusinessTerm[];
  excludedTerms?: BusinessTerm[];
  candidateNodeTypes?: string[];
  candidateBlockTypes?: string[];
  modes?: string[];
  positions?: BusinessRulePosition[];
  priority: number;
  baseScore: number;
  termMultiplier: number;
}

export interface BusinessRulesConfig {
  schemaVersion: string;
  enabled: boolean;
  defaultBlocks: string[];
  dataTypeGroups: Record<string, string[]>;
  typeCapabilities: Record<string, string[]>;
  derivedTerms: BusinessDerivedTermConfig[];
  termImplications: BusinessTermImplicationConfig[];
  termPatterns: BusinessTermPatternConfig[];
  variablePatterns: BusinessVariablePatternsConfig;
  blockPortRoleRules: BusinessBlockPortRoleRuleConfig[];
  businessChainGuards: BusinessChainGuardConfig;
  motionCommandProfiles: BusinessMotionCommandProfileConfig[];
  loopSignatures: BusinessLoopSignatureConfig[];
  deviceLoopRules: BusinessDeviceLoopRuleConfig[];
  faultResponseRules: BusinessFaultResponseRuleConfig[];
  faultResetRules: BusinessFaultResetRuleConfig[];
  actionLifecycleRules: BusinessActionLifecycleRuleConfig[];
  contactPolarityRules: BusinessContactPolarityRuleConfig[];
  nodeIntentRules: BusinessNodeIntentRuleConfig[];
  libraryRules: BusinessLibraryRuleConfig[];
  rankingRules: BusinessRankingRuleConfig[];
}

const FALLBACK_COMMON_FUNCTION_BLOCK_TYPES = [
  "TON",
  "TOF",
  "TP",
  "CTU",
  "CTD",
  "SR",
  "RS",
];

const FALLBACK_DATA_TYPE_GROUPS: Record<string, string[]> = {
  NUMERIC: [
    "SINT",
    "USINT",
    "INT",
    "UINT",
    "DINT",
    "UDINT",
    "LINT",
    "ULINT",
    "REAL",
    "LREAL",
  ],
  INTEGER: [
    "SINT",
    "USINT",
    "INT",
    "UINT",
    "DINT",
    "UDINT",
    "LINT",
    "ULINT",
  ],
  FLOAT: ["REAL", "LREAL"],
};

const FALLBACK_TYPE_CAPABILITIES: Record<string, string[]> = {
  MOTION_AXIS_REFERENCE: ["AXIS_REF", "AXIS_REF_SM3"],
};

const FALLBACK_DERIVED_TERMS: BusinessDerivedTermConfig[] = [
  {
    term: "numeric",
    whenDataTypesAny: ["NUMERIC"],
    whenTypeCapabilitiesAny: [],
  },
  {
    term: "string",
    whenDataTypesAny: ["STRING", "WSTRING"],
    whenTypeCapabilitiesAny: [],
  },
  {
    term: "axis",
    whenDataTypesAny: [],
    whenTypeCapabilitiesAny: ["MOTION_AXIS_REFERENCE"],
  },
  {
    term: "motion",
    whenDataTypesAny: [],
    whenTypeCapabilitiesAny: ["MOTION_AXIS_REFERENCE"],
  },
];

const FALLBACK_TERM_IMPLICATIONS: BusinessTermImplicationConfig[] = [
  { ifMatched: "onDelay", alsoMatch: ["timer"] },
  { ifMatched: "offDelay", alsoMatch: ["timer"] },
  { ifMatched: "pulse", alsoMatch: ["timer"] },
  { ifMatched: "countUp", alsoMatch: ["counter"] },
  { ifMatched: "countDown", alsoMatch: ["counter"] },
  { ifMatched: "countBidirectional", alsoMatch: ["counter"] },
  { ifMatched: "motionPower", alsoMatch: ["motion"] },
  { ifMatched: "motionHome", alsoMatch: ["motion"] },
  { ifMatched: "moveAbsolute", alsoMatch: ["motion"] },
  { ifMatched: "moveRelative", alsoMatch: ["motion"] },
  { ifMatched: "moveVelocity", alsoMatch: ["motion"] },
  { ifMatched: "motionHalt", alsoMatch: ["motion"] },
];

const FALLBACK_BUSINESS_CHAIN_GUARDS: BusinessChainGuardConfig = {
  parallelBypassProtectedRoles: [
    "permitSignal",
    "readySignal",
    "runFeedback",
    "completionSignal",
    "faultSignal",
    "inhibitSignal",
    "modeSignal",
  ],
  relatedCapabilityIdentityRoles: ["axisReference", "deviceReference"],
  identityScopedCapabilityBlockTypes: ["MC_Power", "MC_Reset", "MC_Home"],
  relatedCapabilityMinSharedReferences: 2,
};

const FALLBACK_BUSINESS_RULES_CONFIG: BusinessRulesConfig = {
  schemaVersion: "ide-agent.business-rules.v18",
  enabled: true,
  defaultBlocks: FALLBACK_COMMON_FUNCTION_BLOCK_TYPES,
  dataTypeGroups: FALLBACK_DATA_TYPE_GROUPS,
  typeCapabilities: FALLBACK_TYPE_CAPABILITIES,
  derivedTerms: FALLBACK_DERIVED_TERMS,
  termImplications: FALLBACK_TERM_IMPLICATIONS,
  termPatterns: [
    { term: "alarm", literalPatterns: ["alarm", "warning", "报警", "告警"], regexPatterns: [] },
    { term: "axis", literalPatterns: ["axis", "轴"], regexPatterns: ["(?:^|[^a-z0-9])axis[-_.\\s]*ref(?:$|[^a-z0-9])"] },
    { term: "busy", literalPatterns: ["忙"], regexPatterns: ["(?:^|[^a-z0-9])busy(?:$|[^a-z0-9])"] },
    { term: "counter", literalPatterns: ["计数", "计件", "批次"], regexPatterns: ["(?:^|[^a-z0-9])(?:counter|count|ctu|ctd)(?:$|[^a-z0-9])"] },
    { term: "done", literalPatterns: ["完成", "到位"], regexPatterns: ["(?:^|[^a-z0-9])(?:done|complete)(?:$|[^a-z0-9])"] },
    { term: "edge", literalPatterns: ["触发", "边沿"], regexPatterns: ["(?:^|[^a-z0-9])(?:edge|trigger)(?:$|[^a-z0-9])"] },
    { term: "enable", literalPatterns: ["使能", "允许"], regexPatterns: ["(?:^|[^a-z0-9])enabled?(?:$|[^a-z0-9])"] },
    { term: "falling", literalPatterns: ["下降沿"], regexPatterns: ["(?:^|[^a-z0-9])(?:falling|f[-_.\\s]*trig)(?:$|[^a-z0-9])"] },
    { term: "fault", literalPatterns: ["故障", "错误", "异常"], regexPatterns: ["(?:^|[^a-z0-9])(?:fault|error|fail)(?:$|[^a-z0-9])"] },
    { term: "interlock", literalPatterns: ["互锁", "联锁"], regexPatterns: ["(?:^|[^a-z0-9])(?:interlock|lock)(?:$|[^a-z0-9])"] },
    { term: "left", literalPatterns: ["左取", "左侧", "左边"], regexPatterns: ["(?:^|[^a-z0-9])left(?:$|[^a-z0-9])"] },
    { term: "motion", literalPatterns: ["运动", "伺服", "驱动"], regexPatterns: ["(?:^|[^a-z0-9])(?:motion|s?mc[-_.])"] },
    { term: "numeric", literalPatterns: ["数值", "温度", "压力", "流量"], regexPatterns: ["(?:^|[^a-z0-9])(?:real|lreal|int|dint)(?:$|[^a-z0-9])"] },
    { term: "pid", literalPatterns: ["闭环", "调节", "控温", "控压", "控流"], regexPatterns: ["(?:^|[^a-z0-9])pid(?:$|[^a-z0-9])"] },
    { term: "ready", literalPatterns: ["就绪", "准备"], regexPatterns: ["(?:^|[^a-z0-9])ready(?:$|[^a-z0-9])"] },
    { term: "reset", literalPatterns: ["复位", "清除"], regexPatterns: ["(?:^|[^a-z0-9])reset(?:$|[^a-z0-9])"] },
    { term: "rising", literalPatterns: ["上升沿"], regexPatterns: ["(?:^|[^a-z0-9])(?:rising|r[-_.\\s]*trig)(?:$|[^a-z0-9])"] },
    { term: "run", literalPatterns: ["running", "运行"], regexPatterns: ["(?:^|[^a-z0-9])run(?:$|[^a-z0-9])"] },
    { term: "start", literalPatterns: ["启动", "开始"], regexPatterns: ["(?:^|[^a-z0-9])start(?:$|[^a-z0-9])"] },
    { term: "stop", literalPatterns: ["停止", "停机", "急停"], regexPatterns: ["(?:^|[^a-z0-9])stop(?:$|[^a-z0-9])"] },
    { term: "string", literalPatterns: ["字符串", "字符"], regexPatterns: ["(?:^|[^a-z0-9])w?string(?:$|[^a-z0-9])"] },
    { term: "timer", literalPatterns: ["定时", "延时", "计时", "时间", "超时"], regexPatterns: ["(?:^|[^a-z0-9])(?:timer|time|ton|tof|tp)(?:$|[^a-z0-9])"] },
  ],
  variablePatterns: EMPTY_VARIABLE_PATTERNS,
  blockPortRoleRules: EMPTY_BLOCK_PORT_ROLE_RULES,
  businessChainGuards: FALLBACK_BUSINESS_CHAIN_GUARDS,
  motionCommandProfiles: [],
  loopSignatures: EMPTY_LOOP_SIGNATURES,
  deviceLoopRules: [],
  faultResponseRules: [],
  faultResetRules: [],
  actionLifecycleRules: [],
  contactPolarityRules: [],
  nodeIntentRules: [],
  libraryRules: [],
  rankingRules: [],
};

export const BUSINESS_RULES_CONFIG = loadBusinessRulesConfig();

export const COMMON_FUNCTION_BLOCK_TYPES =
  BUSINESS_RULES_CONFIG.defaultBlocks.length > 0
    ? BUSINESS_RULES_CONFIG.defaultBlocks
    : FALLBACK_COMMON_FUNCTION_BLOCK_TYPES;

export const BUSINESS_TERM_MATCHERS = compileBusinessTermMatchers(
  BUSINESS_RULES_CONFIG.termPatterns,
);

function loadBusinessRulesConfig(): BusinessRulesConfig {
  const configPath = path.join(__dirname, "businessRules.json");
  const parsed = readJsonFile(configPath);
  const record = asPlainRecord(parsed);
  if (!record) {
    return FALLBACK_BUSINESS_RULES_CONFIG;
  }

  return {
    schemaVersion:
      asStringConfig(record.schemaVersion) ||
      FALLBACK_BUSINESS_RULES_CONFIG.schemaVersion,
    enabled: asBooleanConfig(
      record.enabled,
      FALLBACK_BUSINESS_RULES_CONFIG.enabled,
    ),
    defaultBlocks: stringList(
      record.defaultBlocks,
      FALLBACK_BUSINESS_RULES_CONFIG.defaultBlocks,
    ),
    dataTypeGroups: parseStringListRecord(
      record.dataTypeGroups,
      FALLBACK_BUSINESS_RULES_CONFIG.dataTypeGroups,
    ),
    typeCapabilities: parseStringListRecord(
      record.typeCapabilities,
      FALLBACK_BUSINESS_RULES_CONFIG.typeCapabilities,
    ),
    derivedTerms: parseDerivedTerms(record.derivedTerms),
    termImplications: parseTermImplications(record.termImplications),
    termPatterns: parseTermPatterns(record.termPatterns),
    variablePatterns: parseVariablePatterns(record.variablePatterns),
    blockPortRoleRules: parseBlockPortRoleRules(record.blockPortRoleRules),
    businessChainGuards: parseBusinessChainGuards(
      record.businessChainGuards,
    ),
    motionCommandProfiles: parseMotionCommandProfiles(
      record.motionCommandProfiles,
    ),
    loopSignatures: parseLoopSignatures(record.loopSignatures),
    deviceLoopRules: parseDeviceLoopRules(record.deviceLoopRules),
    faultResponseRules: parseFaultResponseRules(record.faultResponseRules),
    faultResetRules: parseFaultResetRules(record.faultResetRules),
    actionLifecycleRules: parseActionLifecycleRules(
      record.actionLifecycleRules,
    ),
    contactPolarityRules: parseContactPolarityRules(
      record.contactPolarityRules,
    ),
    nodeIntentRules: parseNodeIntentRules(record.nodeIntentRules),
    libraryRules: parseBusinessRules(record.libraryRules ?? record.rules),
    rankingRules: parseBusinessRankingRules(record.rankingRules),
  };
}

function parseBusinessChainGuards(value: unknown): BusinessChainGuardConfig {
  const record = asPlainRecord(value);
  if (!record) {
    return FALLBACK_BUSINESS_CHAIN_GUARDS;
  }

  const minimumSharedReferences = asOptionalNumberConfig(
    record.relatedCapabilityMinSharedReferences,
  );
  return {
    parallelBypassProtectedRoles: stringList(
      record.parallelBypassProtectedRoles,
      FALLBACK_BUSINESS_CHAIN_GUARDS.parallelBypassProtectedRoles,
    ),
    relatedCapabilityIdentityRoles: stringList(
      record.relatedCapabilityIdentityRoles,
      FALLBACK_BUSINESS_CHAIN_GUARDS.relatedCapabilityIdentityRoles,
    ),
    identityScopedCapabilityBlockTypes: stringList(
      record.identityScopedCapabilityBlockTypes,
      FALLBACK_BUSINESS_CHAIN_GUARDS.identityScopedCapabilityBlockTypes,
    ),
    relatedCapabilityMinSharedReferences:
      minimumSharedReferences !== undefined && minimumSharedReferences >= 1
        ? Math.floor(minimumSharedReferences)
        : FALLBACK_BUSINESS_CHAIN_GUARDS.relatedCapabilityMinSharedReferences,
  };
}

function parseMotionCommandProfiles(
  value: unknown,
): BusinessMotionCommandProfileConfig[] {
  return asArrayRecord(value)
    .map((item) => ({
      id: asStringConfig(item.id),
      status: asStringConfig(item.status) || "active",
      blockTypes: stringList(item.blockTypes),
      triggerModel:
        asStringConfig(item.triggerModel).toLowerCase() === "level"
          ? ("level" as const)
          : ("risingEdge" as const),
      triggerPort: asStringConfig(item.triggerPort),
      completionPorts: stringList(item.completionPorts),
      activePorts: stringList(item.activePorts),
      busyPorts: stringList(item.busyPorts),
      faultPorts: stringList(item.faultPorts),
      abortedPorts: stringList(item.abortedPorts),
      locksAxisWhileTriggerTrue: asBooleanConfig(
        item.locksAxisWhileTriggerTrue,
        false,
      ),
    }))
    .filter(
      (item) =>
        item.status.toLowerCase() === "active" &&
        Boolean(item.id) &&
        item.blockTypes.length > 0 &&
        Boolean(item.triggerPort),
    );
}

function parseDeviceLoopRules(value: unknown): BusinessDeviceLoopRuleConfig[] {
  return asArrayRecord(value)
    .map((item) => ({
      id: asStringConfig(item.id),
      status: asStringConfig(item.status) || "active",
      anchorRolesAny: stringList(item.anchorRolesAny),
      anchorTermsAny: stringList(item.anchorTermsAny),
      candidateRolesAny: stringList(item.candidateRolesAny),
      candidateNodeType: asStringConfig(item.candidateNodeType) as
        | "contact"
        | "negatedContact",
      allowedPositions: stringList(
        item.allowedPositions,
      ) as BusinessRulePosition[],
      excludedTerms: stringList(item.excludedTerms),
      priority: asOptionalNumberConfig(item.priority) ?? 0,
      businessName: asStringConfig(item.businessName),
      reason: asStringConfig(item.reason),
      presentation: parseBusinessPresentation(item.presentation),
      oppositeActionCandidates: parseOppositeActionCandidates(
        item.oppositeActionCandidates,
      ),
    }))
    .filter(
      (item) =>
        item.status.toLowerCase() === "active" &&
        Boolean(item.id) &&
        item.candidateRolesAny.length > 0 &&
        ["contact", "negatedContact"].includes(item.candidateNodeType) &&
        Boolean(item.businessName) &&
        Boolean(item.presentation),
    );
}

function parseOppositeActionCandidates(
  value: unknown,
): BusinessOppositeActionCandidatesConfig | undefined {
  const record = asPlainRecord(value);
  if (!record) {
    return undefined;
  }
  const pairs = asArrayRecord(record.pairs)
    .map((item) => ({
      id: asStringConfig(item.id),
      leftTerms: stringList(item.leftTerms),
      rightTerms: stringList(item.rightTerms),
    }))
    .filter(
      (pair) =>
        Boolean(pair.id) &&
        pair.leftTerms.length > 0 &&
        pair.rightTerms.length > 0,
    );
  const config: BusinessOppositeActionCandidatesConfig = {
    rolesAny: stringList(record.rolesAny),
    pairs,
    businessName: asStringConfig(record.businessName),
    reason: asStringConfig(record.reason),
    presentation: parseBusinessPresentation(record.presentation),
  };
  return config.rolesAny.length > 0 &&
    config.pairs.length > 0 &&
    Boolean(config.businessName) &&
    Boolean(config.presentation)
    ? config
    : undefined;
}

function parseFaultResponseRules(
  value: unknown,
): BusinessFaultResponseRuleConfig[] {
  return asArrayRecord(value)
    .map((item) => ({
      id: asStringConfig(item.id),
      status: asStringConfig(item.status) || "active",
      anchorRolesAny: stringList(item.anchorRolesAny),
      anchorTermsAny: stringList(item.anchorTermsAny),
      candidateRolesAny: stringList(item.candidateRolesAny),
      candidateNodeType: asStringConfig(item.candidateNodeType) as
        | "coil"
        | "setCoil",
      allowedPositions: stringList(
        item.allowedPositions,
      ) as BusinessRulePosition[],
      excludedTerms: stringList(item.excludedTerms),
      priority: asOptionalNumberConfig(item.priority) ?? 0,
      businessName: asStringConfig(item.businessName),
      reason: asStringConfig(item.reason),
      presentation: parseBusinessPresentation(item.presentation),
    }))
    .filter(
      (item) =>
        item.status.toLowerCase() === "active" &&
        Boolean(item.id) &&
        item.anchorRolesAny.length > 0 &&
        item.candidateRolesAny.length > 0 &&
        ["coil", "setCoil"].includes(item.candidateNodeType) &&
        Boolean(item.businessName) &&
        Boolean(item.presentation),
    );
}

function parseFaultResetRules(
  value: unknown,
): BusinessFaultResetRuleConfig[] {
  return asArrayRecord(value)
    .map((item) => ({
      id: asStringConfig(item.id),
      status: asStringConfig(item.status) || "active",
      anchorRolesAny: stringList(item.anchorRolesAny),
      candidateRolesAny: stringList(item.candidateRolesAny),
      candidateNodeType: asStringConfig(item.candidateNodeType) as "resetCoil",
      allowedPositions: stringList(
        item.allowedPositions,
      ) as BusinessRulePosition[],
      excludedTerms: stringList(item.excludedTerms),
      priority: asOptionalNumberConfig(item.priority) ?? 0,
      businessName: asStringConfig(item.businessName),
      reason: asStringConfig(item.reason),
      presentation: parseBusinessPresentation(item.presentation),
    }))
    .filter(
      (item) =>
        item.status.toLowerCase() === "active" &&
        Boolean(item.id) &&
        item.anchorRolesAny.length > 0 &&
        item.candidateRolesAny.length > 0 &&
        item.candidateNodeType === "resetCoil" &&
        Boolean(item.businessName) &&
        Boolean(item.presentation),
    );
}

function parseActionLifecycleRules(
  value: unknown,
): BusinessActionLifecycleRuleConfig[] {
  return asArrayRecord(value)
    .map((item) => ({
      id: asStringConfig(item.id),
      status: asStringConfig(item.status) || "active",
      kind: asStringConfig(
        item.kind,
      ) as BusinessActionLifecycleRuleConfig["kind"],
      anchorRolesAny: stringList(item.anchorRolesAny),
      candidateRolesAny: stringList(item.candidateRolesAny),
      candidateNodeType: asStringConfig(
        item.candidateNodeType,
      ) as BusinessActionLifecycleRuleConfig["candidateNodeType"],
      allowedPositions: stringList(
        item.allowedPositions,
      ) as BusinessRulePosition[],
      excludedTerms: stringList(item.excludedTerms),
      priority: asOptionalNumberConfig(item.priority) ?? 0,
      businessName: asStringConfig(item.businessName),
      reason: asStringConfig(item.reason),
      presentation: parseBusinessPresentation(item.presentation),
    }))
    .filter(
      (item) =>
        item.status.toLowerCase() === "active" &&
        Boolean(item.id) &&
        [
          "selfHold",
          "stopInterlock",
          "latchedRelease",
          "countCompletionOutput",
          "countCompletionLatch",
        ].includes(item.kind) &&
        item.anchorRolesAny.length > 0 &&
        item.candidateRolesAny.length > 0 &&
        ["contact", "negatedContact", "coil", "setCoil", "resetCoil"].includes(
          item.candidateNodeType,
        ) &&
        Boolean(item.businessName) &&
        Boolean(item.presentation),
    );
}

function parseTermPatterns(value: unknown): BusinessTermPatternConfig[] {
  const parsed = asArrayRecord(value)
    .map((item) => ({
      term: asStringConfig(item.term),
      literalPatterns: stringList(item.literalPatterns),
      regexPatterns: stringList(item.regexPatterns),
    }))
    .filter(
      (item) =>
        item.term &&
        (item.literalPatterns.length > 0 || item.regexPatterns.length > 0),
    );

  return parsed.length > 0
    ? parsed
    : FALLBACK_BUSINESS_RULES_CONFIG.termPatterns;
}

function parseDerivedTerms(value: unknown): BusinessDerivedTermConfig[] {
  const parsed = asArrayRecord(value)
    .map((item) => ({
      term: asStringConfig(item.term),
      whenDataTypesAny: stringList(item.whenDataTypesAny),
      whenTypeCapabilitiesAny: stringList(item.whenTypeCapabilitiesAny),
    }))
    .filter(
      (item) =>
        item.term &&
        (item.whenDataTypesAny.length > 0 ||
          item.whenTypeCapabilitiesAny.length > 0),
    );

  return parsed.length > 0
    ? parsed
    : FALLBACK_BUSINESS_RULES_CONFIG.derivedTerms;
}

function parseTermImplications(
  value: unknown,
): BusinessTermImplicationConfig[] {
  const parsed = asArrayRecord(value)
    .map((item) => ({
      ifMatched: asStringConfig(item.ifMatched),
      alsoMatch: stringList(item.alsoMatch),
    }))
    .filter((item) => item.ifMatched && item.alsoMatch.length > 0);
  return parsed.length > 0
    ? parsed
    : FALLBACK_BUSINESS_RULES_CONFIG.termImplications;
}

function parseStringListRecord(
  value: unknown,
  fallback: Record<string, string[]>,
): Record<string, string[]> {
  const record = asPlainRecord(value);
  if (!record) {
    return fallback;
  }

  const parsed = Object.fromEntries(
    Object.entries(record)
      .map(([key, entry]) => [normalizeConfiguredDataType(key), stringList(entry)] as const)
      .filter(([key, entries]) => key && entries.length > 0),
  );
  return { ...fallback, ...parsed };
}

function compileBusinessTermMatchers(
  entries: BusinessTermPatternConfig[],
): BusinessTermMatcher[] {
  return entries.map((entry) => ({
    term: entry.term,
    literalPatterns: entry.literalPatterns.map((pattern) =>
      pattern.trim().toLowerCase(),
    ),
    regexPatterns: entry.regexPatterns.flatMap((pattern) => {
      try {
        return [new RegExp(pattern, "iu")];
      } catch (error) {
        console.warn(
          `[IdeAgent:BusinessRules] ignored invalid regex term=${entry.term} pattern=${JSON.stringify(pattern)} error=${formatUnknownError(error)}`,
        );
        return [];
      }
    }),
  }));
}

function parseContactPolarityRules(
  value: unknown,
): BusinessContactPolarityRuleConfig[] {
  return asArrayRecord(value)
    .map((item) => ({
      id: asStringConfig(item.id),
      status: asStringConfig(item.status) || "active",
      polarity: asStringConfig(item.polarity) as "normal" | "negated",
      termsAny: stringList(item.termsAny),
      termsAll: stringList(item.termsAll),
      excludedTerms: stringList(item.excludedTerms),
      excludedAnchorTerms: stringList(item.excludedAnchorTerms),
      anchorTermScope: (
        asStringConfig(item.anchorTermScope) === "selectedNode"
          ? "selectedNode"
          : "selectedNodeOrDirectNeighbors"
      ) as BusinessContactPolarityRuleConfig["anchorTermScope"],
      priority: asOptionalNumberConfig(item.priority) ?? 0,
      reason: asStringConfig(item.reason),
    }))
    .filter(
      (item) =>
        item.status.toLowerCase() === "active" &&
        Boolean(item.id) &&
        ["normal", "negated"].includes(item.polarity),
    );
}

function parseNodeIntentRules(value: unknown): BusinessNodeIntentRuleConfig[] {
  return asArrayRecord(value)
    .map((item) => ({
      id: asStringConfig(item.id),
      status: asStringConfig(item.status) || "active",
      nodeTypes: stringList(item.nodeTypes),
      positions: stringList(item.positions) as BusinessRulePosition[],
      termsAny: stringList(item.termsAny),
      termsAll: stringList(item.termsAll),
      excludedTerms: stringList(item.excludedTerms),
      actionRolesAny: stringList(item.actionRolesAny),
      chainRolesAny: stringList(item.chainRolesAny),
      requireActionAnchor: asBooleanConfig(item.requireActionAnchor, false),
      minimumEvidenceCount:
        asOptionalNumberConfig(item.minimumEvidenceCount) ?? 2,
      priority: asOptionalNumberConfig(item.priority) ?? 0,
      businessName: asStringConfig(item.businessName),
      reason: asStringConfig(item.reason),
      presentation: parseBusinessPresentation(item.presentation),
    }))
    .filter(
      (item) =>
        item.status.toLowerCase() === "active" &&
        Boolean(item.id) &&
        item.nodeTypes.length > 0 &&
        Boolean(item.businessName) &&
        Boolean(item.presentation),
    );
}

function parseBusinessPresentation(
  value: unknown,
): BusinessPresentationConfig | undefined {
  const record = asPlainRecord(value);
  if (!record) {
    return undefined;
  }

  const titleTemplate = asStringConfig(record.titleTemplate);
  const textTemplate = asStringConfig(record.textTemplate);
  return titleTemplate && textTemplate
    ? { titleTemplate, textTemplate }
    : undefined;
}

function parseBusinessRules(value: unknown): BusinessLibraryRuleConfig[] {
  const parsed = asArrayRecord(value)
    .map((item) => ({
      id: asStringConfig(item.id),
      status: asStringConfig(item.status) || "active",
      termsAny: uniqueStringList([
        ...stringList(item.termsAny),
        ...stringList(item.requiredAnyTerms),
        ...stringList(item.terms),
      ]),
      termsAll: stringList(item.termsAll ?? item.requiredAllTerms),
      excludedTerms: stringList(item.excludedTerms),
      focusKinds: stringList(item.focusKinds),
      requiredAnyDataTypes: stringList(item.requiredAnyDataTypes),
      requiredAllDataTypes: stringList(item.requiredAllDataTypes),
      excludedDataTypes: stringList(item.excludedDataTypes),
      requiredTypeCapabilities: stringList(item.requiredTypeCapabilities),
      signatureRefsAny: stringList(item.signatureRefsAny),
      excludedExistingBlockTypes: stringList(
        item.excludedExistingBlockTypes,
      ),
      portRequirements: parsePortRequirements(item.portRequirements),
      candidateNames: stringList(item.candidateNames),
      priority: asOptionalNumberConfig(item.priority) ?? 0,
      baseScore: asOptionalNumberConfig(item.baseScore),
      allowedModes: stringList(item.allowedModes),
      allowedPositions: stringList(
        item.allowedPositions,
      ) as BusinessRulePosition[],
      preferredModes: stringList(item.preferredModes),
      preferredPositions: stringList(
        item.preferredPositions,
      ) as BusinessRulePosition[],
      reason: asStringConfig(item.reason),
      fallback: asStringConfig(item.fallback),
      presentation: parseBusinessPresentation(item.presentation),
    }))
    .filter(
      (item) =>
        item.status.toLowerCase() === "active" &&
        item.id &&
        item.candidateNames.length > 0,
    );

  return Array.isArray(value) ? parsed : [];
}

function parsePortRequirements(
  value: unknown,
): BusinessPortRequirementConfig[] {
  return asArrayRecord(value)
    .map((item) => ({
      port: asStringConfig(item.port),
      direction: parsePortRequirementDirection(item.direction),
      required: asBooleanConfig(item.required, false),
      acceptedDataTypes: stringList(item.acceptedDataTypes),
      allowCreateParameter: asBooleanConfig(
        item.allowCreateParameter,
        false,
      ),
    }))
    .filter((item) => item.port);
}

function parsePortRequirementDirection(
  value: unknown,
): BusinessPortDirection {
  const normalized = asStringConfig(value).toLowerCase();
  return normalized === "output" || normalized === "any"
    ? normalized
    : "input";
}

function parseBusinessRankingRules(
  value: unknown,
): BusinessRankingRuleConfig[] {
  return asArrayRecord(value)
    .map((item) => ({
      id: asStringConfig(item.id),
      status: asStringConfig(item.status) || "active",
      termsAny: stringList(item.termsAny),
      termsAll: stringList(item.termsAll),
      excludedTerms: stringList(item.excludedTerms),
      candidateNodeTypes: stringList(item.candidateNodeTypes),
      candidateBlockTypes: stringList(item.candidateBlockTypes),
      modes: stringList(item.modes),
      positions: stringList(item.positions) as BusinessRulePosition[],
      priority: asOptionalNumberConfig(item.priority) ?? 0,
      baseScore: asOptionalNumberConfig(item.baseScore) ?? 0,
      termMultiplier: asOptionalNumberConfig(item.termMultiplier) ?? 1,
    }))
    .filter(
      (item) => item.status.toLowerCase() === "active" && Boolean(item.id),
    );
}

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

function stringList(value: unknown, fallback: string[] = []): string[] {
  const values = Array.isArray(value)
    ? value.map(asStringConfig)
    : typeof value === "string"
      ? [asStringConfig(value)]
      : [];
  const filtered = values.filter(Boolean);
  return filtered.length > 0 ? filtered : fallback;
}

function uniqueStringList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function asBooleanConfig(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asOptionalNumberConfig(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeConfiguredDataType(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
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

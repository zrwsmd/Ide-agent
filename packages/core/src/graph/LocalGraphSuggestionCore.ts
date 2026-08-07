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
}

interface LocalSuggestionAddElement {
  nodeType: string;
  displayLabel: string;
  variableSource: string;
  variableName: string;
  dataType: string;
  userInputRequired: boolean;
  blockType: string;
  instanceSource: string;
  instanceName: string;
  isFunction?: boolean;
  portInputs?: SuggestedPort[];
  portOutputs?: SuggestedPort[];
}

type BusinessTerm = string;

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
}

interface BusinessRulesConfig {
  schemaVersion: string;
  enabled: boolean;
  defaultBlocks: string[];
  termPatterns: BusinessTermPatternConfig[];
  contactPolarityRules: BusinessContactPolarityRuleConfig[];
  libraryRules: BusinessLibraryRuleConfig[];
  rankingRules: BusinessRankingRuleConfig[];
}

interface BusinessTermPatternConfig {
  term: BusinessTerm;
  literalPatterns: string[];
  regexPatterns: string[];
}

interface BusinessTermMatcher {
  term: BusinessTerm;
  literalPatterns: string[];
  regexPatterns: RegExp[];
}

interface BusinessContactPolarityRuleConfig {
  id: string;
  status: string;
  polarity: "normal" | "negated";
  termsAny?: BusinessTerm[];
  termsAll?: BusinessTerm[];
  excludedTerms?: BusinessTerm[];
  excludedAnchorTerms?: BusinessTerm[];
  reason?: string;
}

interface BusinessLibraryRuleConfig {
  id: string;
  status: string;
  termsAny?: BusinessTerm[];
  termsAll?: BusinessTerm[];
  excludedTerms?: BusinessTerm[];
  focusKinds?: string[];
  requiredAnyDataTypes?: string[];
  requiredAllDataTypes?: string[];
  excludedDataTypes?: string[];
  candidateNames: string[];
  baseScore?: number;
  allowedModes?: string[];
  allowedPositions?: LocalSuggestionPosition[];
  preferredModes?: string[];
  preferredPositions?: LocalSuggestionPosition[];
  reason?: string;
  fallback?: string;
}

interface BusinessRankingRuleConfig {
  id: string;
  status: string;
  termsAny?: BusinessTerm[];
  termsAll?: BusinessTerm[];
  excludedTerms?: BusinessTerm[];
  candidateNodeTypes?: string[];
  candidateBlockTypes?: string[];
  modes?: string[];
  positions?: LocalSuggestionPosition[];
  baseScore: number;
  termMultiplier: number;
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
  score: number;
  ruleId: string;
  reason?: string;
  libraryElement: LibraryElementInfo;
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
const MAX_RETURNED_SUGGESTIONS = 16;

const FALLBACK_BUSINESS_RULES_CONFIG: BusinessRulesConfig = {
  schemaVersion: "ide-agent.business-rules.v3",
  enabled: true,
  defaultBlocks: FALLBACK_COMMON_FUNCTION_BLOCK_TYPES,
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
  contactPolarityRules: [],
  libraryRules: [],
  rankingRules: [],
};

const BUSINESS_RULES_CONFIG = loadBusinessRulesConfig();
const COMMON_FUNCTION_BLOCK_TYPES =
  BUSINESS_RULES_CONFIG.defaultBlocks.length > 0
    ? BUSINESS_RULES_CONFIG.defaultBlocks
    : FALLBACK_COMMON_FUNCTION_BLOCK_TYPES;
const BUSINESS_TERM_MATCHERS = compileBusinessTermMatchers(
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
    enabled: asBooleanConfig(record.enabled, FALLBACK_BUSINESS_RULES_CONFIG.enabled),
    defaultBlocks: stringList(record.defaultBlocks, FALLBACK_BUSINESS_RULES_CONFIG.defaultBlocks),
    termPatterns: parseTermPatterns(record.termPatterns),
    contactPolarityRules: parseContactPolarityRules(
      record.contactPolarityRules,
    ),
    libraryRules: parseBusinessRules(record.libraryRules ?? record.rules),
    rankingRules: parseBusinessRankingRules(record.rankingRules),
  };
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

  return parsed.length > 0 ? parsed : FALLBACK_BUSINESS_RULES_CONFIG.termPatterns;
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
      reason: asStringConfig(item.reason),
    }))
    .filter(
      (item) =>
        item.status.toLowerCase() === "active" &&
        Boolean(item.id) &&
        ["normal", "negated"].includes(item.polarity),
    );
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
      candidateNames: stringList(item.candidateNames),
      baseScore: asOptionalNumberConfig(item.baseScore),
      allowedModes: stringList(item.allowedModes),
      allowedPositions: stringList(item.allowedPositions) as LocalSuggestionPosition[],
      preferredModes: stringList(item.preferredModes),
      preferredPositions: stringList(item.preferredPositions) as LocalSuggestionPosition[],
      reason: asStringConfig(item.reason),
      fallback: asStringConfig(item.fallback),
    }))
    .filter(
      (item) =>
        item.status.toLowerCase() === "active" &&
        item.id &&
        item.candidateNames.length > 0,
    );

  return Array.isArray(value) ? parsed : [];
}

function parseBusinessRankingRules(value: unknown): BusinessRankingRuleConfig[] {
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
      positions: stringList(item.positions) as LocalSuggestionPosition[],
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

function asArrayConfig(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asBooleanConfig(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asOptionalNumberConfig(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
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
    return suggestions.filter((suggestion) => !isGenericFunctionBlockDraft(suggestion));
  }

  const contactAwareSuggestions = addBusinessContactVariants(
    suggestions,
    context,
  );
  const enhancedSuggestions = applyBusinessLibraryEnhancements(
    contactAwareSuggestions,
    context,
    focus,
  );
  const applicableSuggestions = enhancedSuggestions.filter(
    (suggestion) =>
      !hasExistingFunctionBlockAtInsertionBoundary(suggestion, focus.segment) &&
      !hasExistingFunctionBlockInRelatedSegment(suggestion, context, focus),
  );
  const ranked = applicableSuggestions.map((suggestion, index) => ({
    suggestion,
    index,
    score: scoreBusinessSuggestion(suggestion, context, graphState),
  }));

  if (!ranked.some((item) => item.score > 0)) {
    return applicableSuggestions;
  }

  return ranked
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.suggestion);
}

function addBusinessContactVariants(
  suggestions: LocalSuggestionDraft[],
  context: BusinessSuggestionContext,
): LocalSuggestionDraft[] {
  return suggestions.flatMap((suggestion) => {
    if (suggestion.addElement.nodeType !== "contact") {
      return [suggestion];
    }

    const negatedContact = replaceWithNegatedContact(suggestion);
    if (!matchesContactPolarity("negated", context)) {
      return [suggestion];
    }

    return [suggestion, negatedContact];
  });
}

function matchesContactPolarity(
  polarity: "normal" | "negated",
  context: BusinessSuggestionContext,
): boolean {
  const anchorTerms =
    context.focusTerms.size > 0 ? context.focusTerms : context.nearbyTerms;

  return BUSINESS_RULES_CONFIG.contactPolarityRules.some((rule) => {
    if (rule.polarity !== polarity) {
      return false;
    }
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
    if (rule.excludedAnchorTerms?.some((term) => anchorTerms.has(term))) {
      return false;
    }
    return true;
  });
}

function replaceWithNegatedContact(
  suggestion: LocalSuggestionDraft,
): LocalSuggestionDraft {
  return {
    ...suggestion,
    placement: {
      ...suggestion.placement,
      text: suggestion.placement.text.replaceAll("常开触点", "常闭触点"),
    },
    addElement: negatedContactElement(),
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
      const replacement = replaceFunctionBlockDraft(suggestion, candidate);
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
    if (!current || candidate.score > current.score) {
      deduped.set(candidate.name, candidate);
    }
  }

  return [...deduped.values()].sort((left, right) => right.score - left.score);
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

  const baseScore = rule.baseScore ?? 0;

  return rule.candidateNames.flatMap((candidateName, candidateIndex) => {
    const libraryElement = getLibraryElement(candidateName);
    if (!libraryElement) {
      return [];
    }

    return [
      {
        name: libraryElement.name,
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
      },
    ];
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
  addDataTypeTerms(focusTerms, focusDataTypes);
  addDataTypeTerms(nearbyTerms, nearbyDataTypes);
  addDataTypeTerms(segmentTerms, segmentDataTypes);
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
  const hasLocalBusinessContext =
    focusTerms.size > 0 ||
    nearbyTerms.size > 0 ||
    segmentTerms.size > 0;

  return {
    hasBusinessContext:
      hasLocalBusinessContext ||
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
  };
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
  addDataTypeTerms(terms, dataTypes);

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

function intersection<T>(left: Set<T>, right: Set<T>): Set<T> {
  return new Set([...left].filter((value) => right.has(value)));
}

function scoreBusinessSuggestion(
  suggestion: LocalSuggestionDraft,
  context: BusinessSuggestionContext,
  graphState: SegmentGraphState,
): number {
  const addType = suggestion.addElement.nodeType;
  const addBlockType = normalizeBlockType(suggestion.addElement.blockType);
  const position = suggestion.position ?? inferPosition(suggestion);
  const isBefore = position === "front" || position === "outsideFront";
  const isAfter = position === "behind" || position === "outsideBehind";
  const isParallel = position === "parallel";
  const isContact = isContactNodeType(addType);
  const isFunctionBlock = addType === "functionBlock";
  const isCoil = isCoilNodeType(addType);
  let score = scoreConfiguredRankingRules(suggestion, context);

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
    score += startSignals * (isBefore ? 3 : isParallel ? 2 : 1);
    score += stopSignals * (isBefore ? 2 : isParallel ? 1 : 0);
    score += doneSignals * (isAfter ? 1 : 0);
  }

  if (addType === "negatedContact") {
    score += inhibitSignals * 3;
    score += businessTermWeight(context, "fault") * 2;
  }

  if (addType === "risingContact" || addType === "fallingContact") {
    score += startSignals * 2;
    score += businessTermWeight(context, "enable") * 2;
  }

  if (addType === "setCoil") {
    score += startSignals * 2;
    score += businessTermWeight(context, "done") * 2;
    score += businessTermWeight(context, "alarm") * 2;
    score -= stopSignals;
  }

  if (addType === "resetCoil") {
    const resetSignals = businessTermWeight(context, "reset");
    if (resetSignals > 0) {
      score += resetSignals * 3;
      score += businessTermWeight(context, "fault", "alarm", "latch") * 2;
    }
  }

  if (isCoil) {
    score += doneSignals;
    score += graphState.isPartialGraph ? 3 : 1;
    if (isAfter) {
      score += 2;
    }
  }

  if (isFunctionBlock) {
    score += scoreRelatedFunctionBlockEvidence(addBlockType, context);

    if (isTimerBlockType(addBlockType)) {
      score += timerSignals * 3;
      score += isTimerBlockType(context.focusBlockType) ? 4 : 0;
      score += hasSegmentBlockType(context, isTimerBlockType) ? 1 : 0;
    }

    if (isCounterBlockType(addBlockType)) {
      score += counterSignals * 3;
      score += isCounterBlockType(context.focusBlockType) ? 4 : 0;
      score += hasSegmentBlockType(context, isCounterBlockType) ? 1 : 0;
    }

    if (isLatchBlockType(addBlockType)) {
      score += startSignals + stopSignals;
    }

    if (isMotionBlockType(context.focusBlockType)) {
      score += startSignals * 2;
      score += businessTermWeight(context, "fault", "stop", "reset");
      if (isBefore) {
        score += 4;
      }
      if (isAfter) {
        score -= 2;
      }
    }

    if (isTimerBlockType(context.focusBlockType) && isTimerBlockType(addBlockType)) {
      score += 2;
    }

    if (isCounterBlockType(context.focusBlockType) && isCounterBlockType(addBlockType)) {
      score += 2;
    }
  }

  if (isBefore) {
    score += isContact ? 2 : 0;
    score += isFunctionBlock ? 1 : 0;
  } else if (isAfter) {
    score += isCoil ? 2 : 0;
  } else if (isParallel) {
    score += isContact ? 2 : 1;
  }

  if (context.focusBlockType === "MC_RESET" && isBefore && isContact) {
    score += 4;
  }

  if (context.focusBlockType.startsWith("MC_") && isFunctionBlock && isAfter) {
    score -= 3;
  }

  if (graphState.hasOutputNode && isCoil && isAfter) {
    score -= 1;
  }

  if (graphState.isPartialGraph && isCoil) {
    score += 1;
  }

  return score;
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

  return BUSINESS_RULES_CONFIG.rankingRules.reduce((score, rule) => {
    if (
      rule.candidateNodeTypes?.length &&
      !includesCaseInsensitive(rule.candidateNodeTypes, nodeType)
    ) {
      return score;
    }
    if (
      rule.candidateBlockTypes?.length &&
      !includesCaseInsensitive(rule.candidateBlockTypes, blockType)
    ) {
      return score;
    }
    if (rule.modes?.length && !rule.modes.includes(suggestion.mode)) {
      return score;
    }
    if (rule.positions?.length && !rule.positions.includes(position)) {
      return score;
    }
    if (
      rule.termsAny?.length &&
      !rule.termsAny.some((term) => localBusinessTermWeight(context, term) > 0)
    ) {
      return score;
    }
    if (
      rule.termsAll?.length &&
      !rule.termsAll.every((term) => localBusinessTermWeight(context, term) > 0)
    ) {
      return score;
    }
    if (
      rule.excludedTerms?.some(
        (term) => localBusinessTermWeight(context, term) > 0,
      )
    ) {
      return score;
    }

    const evidenceTerms = [...(rule.termsAny ?? []), ...(rule.termsAll ?? [])];
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
  const normalizedRequired = normalizeDataType(requiredDataType);
  if (!normalizedRequired) {
    return false;
  }

  if (normalizedRequired === "NUMERIC") {
    return [...localDataTypes].some(isNumericDataType);
  }

  return [...localDataTypes].some(
    (dataType) =>
      dataType === normalizedRequired ||
      dataType.startsWith(`${normalizedRequired}(`) ||
      dataType.startsWith(`${normalizedRequired}[`) ||
      dataType.endsWith(`.${normalizedRequired}`),
  );
}

function isNumericDataType(dataType: string): boolean {
  return [
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
  ].includes(normalizeDataType(dataType));
}

function addDataTypeTerms(
  terms: Set<BusinessTerm>,
  dataTypes: Set<string>,
): void {
  if ([...dataTypes].some(isNumericDataType)) {
    terms.add("numeric");
  }
  if (hasAnyDataType(dataTypes, ["STRING", "WSTRING"])) {
    terms.add("string");
  }
  if ([...dataTypes].some((dataType) => dataType.includes("AXIS_REF"))) {
    terms.add("axis");
    terms.add("motion");
  }
}

function includesCaseInsensitive(values: string[], target: string): boolean {
  const normalizedTarget = target.trim().toUpperCase();
  return values.some((value) => value.trim().toUpperCase() === normalizedTarget);
}

function collectBusinessTerms(values: Array<string | undefined>): Set<BusinessTerm> {
  const haystack = compactBusinessTexts(values)
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

  return terms;
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
  return ["CTU", "CTD"].includes(blockType);
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
      const outsideBehindStartNodes = findOutsideBehindStartNodes(
        focus.segment,
        node,
        rightNode,
      );
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

      if (outsideBehindStartNodes.length > 1) {
        suggestions.push(
          makeSuggestion(focus, {
            mode: "seriesAfter",
            relationToFocus: "afterSelected",
            insertAfterNodeId: node.id,
            insertBeforeNodeId: rightNode.id,
            startNodes: outsideBehindStartNodes,
            endNodes: [rightNode.id],
            position: "outsideBehind",
            serialOrParallel: "serial",
            text: `在${nodeText}所在并联结构外侧和${rightText}之间串联一个常开触点`,
            addElement: contactElement(),
          }),
        );
      }
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

  const suggestion: LocalSuggestion = {
    id,
    title: "",
    startNodes,
    endNodes,
    position,
    serialOrParallel,
    text: draft.placement.text,
    addNode,
  };

  return {
    ...suggestion,
    title: suggestionTitle(suggestion, suggestedNodeLabel(suggestion)),
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
      scope: "VAR",
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
  return {
    nodeType: "negatedContact",
    displayLabel: "常闭触点",
    variableSource: "userInput",
    variableName: "",
    dataType: "BOOL",
    userInputRequired: true,
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

  return {
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

function findOutsideBehindStartNodes(
  segment: DiagramSegmentSummary,
  anchorNode: DiagramNodeSummary,
  rightNode: DiagramNodeSummary,
): string[] {
  const branchTailNodes = orderBoundaryDisplayNodes(
    collectNearestDisplayNodes(segment, rightNode.from, "backward"),
  );

  if (
    branchTailNodes.length <= 1 ||
    !branchTailNodes.some((node) => node.id === anchorNode.id)
  ) {
    return [];
  }

  return branchTailNodes.map((node) => node.id);
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

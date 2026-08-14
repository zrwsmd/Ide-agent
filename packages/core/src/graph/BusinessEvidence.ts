import { DiagramNodeSummary } from "../diagram/DiagramSummary";
import {
  BUSINESS_RULES_CONFIG,
  BUSINESS_TERM_MATCHERS,
  BusinessTerm,
} from "./BusinessRulesConfig";
import {
  businessEvidenceTextVariants,
  compactBusinessEvidenceText,
  normalizeBusinessEvidenceText,
} from "./BusinessTextNormalization";

export { splitBusinessIdentifierWords } from "./BusinessTextNormalization";

export function collectNodeDataTypes(
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
      const dataType = variableTypes.get(
        String(reference ?? "").trim().toUpperCase(),
      );
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

export function normalizeDataType(dataType: string | undefined): string {
  return String(dataType ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

export function hasAnyDataType(
  localDataTypes: Set<string>,
  requiredDataTypes: string[],
): boolean {
  return requiredDataTypes.some((dataType) =>
    hasDataType(localDataTypes, dataType),
  );
}

export function hasDataType(
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

export function hasTypeCapability(
  localDataTypes: Set<string>,
  capability: string,
): boolean {
  const mappedDataTypes =
    BUSINESS_RULES_CONFIG.typeCapabilities[normalizeDataType(capability)] ?? [];
  return mappedDataTypes.some((dataType) =>
    hasDataType(localDataTypes, dataType),
  );
}

export function addDerivedTerms(
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

export function includesCaseInsensitive(
  values: string[],
  target: string,
): boolean {
  const normalizedTarget = target.trim().toUpperCase();
  return values.some(
    (value) => value.trim().toUpperCase() === normalizedTarget,
  );
}

export function collectBusinessTerms(
  values: Array<string | undefined>,
): Set<BusinessTerm> {
  const haystack = compactBusinessTexts(values)
    .flatMap(businessEvidenceTextVariants)
    .map((value) => value.toLowerCase())
    .join(" ");
  const terms = new Set<BusinessTerm>();

  if (!haystack) {
    return terms;
  }

  for (const entry of BUSINESS_TERM_MATCHERS) {
    if (
      entry.literalPatterns.some((pattern) => {
        const normalizedPattern = normalizeBusinessEvidenceText(pattern);
        return normalizedPattern && haystack.includes(normalizedPattern);
      }) ||
      entry.regexPatterns.some((pattern) => pattern.test(haystack))
    ) {
      terms.add(entry.term);
    }
  }

  applyTermImplications(terms);
  return terms;
}

export function nodeBusinessTexts(node: DiagramNodeSummary): string[] {
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

export function variableBusinessTexts(
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

function recordBusinessTexts(
  record: Record<string, string> | undefined,
): string[] {
  if (!record) {
    return [];
  }

  return Object.entries(record).flatMap(([key, value]) => [key, value]);
}

function compactBusinessTexts(
  values: Array<string | undefined>,
): string[] {
  return values
    .map(compactBusinessEvidenceText)
    .filter(Boolean);
}

export function normalizeBlockType(value: string | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

export function isBusinessBlockType(blockType: string): boolean {
  return (
    isMotionBlockType(blockType) ||
    isTimerBlockType(blockType) ||
    isCounterBlockType(blockType) ||
    isLatchBlockType(blockType)
  );
}

export function isTimerBlockType(blockType: string): boolean {
  return ["TON", "TOF", "TP"].includes(blockType);
}

export function isCounterBlockType(blockType: string): boolean {
  return ["CTU", "CTD", "CTUD"].includes(blockType);
}

export function isLatchBlockType(blockType: string): boolean {
  return ["SR", "RS"].includes(blockType);
}

export function isMotionBlockType(blockType: string): boolean {
  return blockType.startsWith("MC_") || blockType.startsWith("SMC_");
}

export function normalizeReference(value: string | undefined): string {
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

export function collectNodeReferences(
  node: DiagramNodeSummary,
): Set<string> {
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

export function intersection<T>(left: Set<T>, right: Set<T>): Set<T> {
  return new Set([...left].filter((value) => right.has(value)));
}

export function uniqueDisplayNames(values: string[]): string[] {
  const names = new Map<string, string>();
  for (const value of values) {
    const normalized = String(value ?? "").trim().toUpperCase();
    if (normalized && !names.has(normalized)) {
      names.set(normalized, String(value).trim());
    }
  }
  return [...names.values()];
}

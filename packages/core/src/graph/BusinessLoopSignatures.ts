import { DiagramVariableSummary } from "../diagram/DiagramSummary";

export interface BusinessVariableRolePattern {
  prefix?: string;
  suffix?: string;
  role: string;
  controller?: string;
  acceptedDataTypes: string[];
}

export interface BusinessPhysicalPattern {
  physical: string;
  literalPatterns: string[];
  regexPatterns: string[];
}

export interface BusinessVariablePatternsConfig {
  prefixRoles: BusinessVariableRolePattern[];
  suffixRoles: BusinessVariableRolePattern[];
  physicalTerms: BusinessPhysicalPattern[];
}

export interface BusinessLoopSignatureConfig {
  id: string;
  status: string;
  requiredRolesAll: string[];
  requiredRoleTypes: Record<string, string[]>;
  requiredPhysicalTerms: string[];
  evidenceRolesAny: string[];
  evidenceTermsAny: string[];
}

export interface BusinessLoopSignatureMatch {
  id: string;
  groupKey: string;
  roleVariables: Record<string, string[]>;
}

export const EMPTY_VARIABLE_PATTERNS: BusinessVariablePatternsConfig = {
  prefixRoles: [],
  suffixRoles: [],
  physicalTerms: [],
};

export const EMPTY_LOOP_SIGNATURES: BusinessLoopSignatureConfig[] = [];

export function parseVariablePatterns(
  value: unknown,
): BusinessVariablePatternsConfig {
  const record = asRecord(value);
  if (!record) {
    return EMPTY_VARIABLE_PATTERNS;
  }

  return {
    prefixRoles: parseRolePatterns(record.prefixRoles, "prefix"),
    suffixRoles: parseRolePatterns(record.suffixRoles, "suffix"),
    physicalTerms: parsePhysicalPatterns(record.physicalTerms),
  };
}

export function parseLoopSignatures(
  value: unknown,
): BusinessLoopSignatureConfig[] {
  if (!Array.isArray(value)) {
    return EMPTY_LOOP_SIGNATURES;
  }

  return value
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      id: asString(item.id),
      status: asString(item.status) || "active",
      requiredRolesAll: stringList(item.requiredRolesAll),
      requiredRoleTypes: parseStringListRecord(item.requiredRoleTypes),
      requiredPhysicalTerms: stringList(item.requiredPhysicalTerms),
      evidenceRolesAny: stringList(item.evidenceRolesAny),
      evidenceTermsAny: stringList(item.evidenceTermsAny),
    }))
    .filter(
      (item) =>
        item.id &&
        item.requiredRolesAll.length > 0 &&
        item.status.toLowerCase() === "active",
    );
}

export function evaluateLoopSignatures(
  variablePatterns: BusinessVariablePatternsConfig,
  signatures: BusinessLoopSignatureConfig[],
  variables: DiagramVariableSummary[],
  contextTexts: Array<string | undefined>,
  contextTerms: Set<string>,
): BusinessLoopSignatureMatch[] {
  const evidence = collectRoleEvidence(variablePatterns, variables);
  const contextPhysicalTerms = new Set(
    variablePatterns.physicalTerms
      .filter((pattern) =>
        contextTexts.some((text) =>
          matchesPhysicalPattern(String(text ?? ""), pattern),
        ),
      )
      .map((pattern) => pattern.physical),
  );
  const matches: BusinessLoopSignatureMatch[] = [];

  for (const signature of signatures) {
    const groupKey = findMatchingGroup(
      signature,
      evidence,
      contextPhysicalTerms,
      contextTerms,
    );
    if (!groupKey) {
      continue;
    }

    const roleVariables = Object.fromEntries(
      signature.requiredRolesAll.map((role) => [
        role,
        evidence
          .filter(
            (item) => item.role === role && item.groupKeys.includes(groupKey),
          )
          .map((item) => item.variable.name),
      ]),
    );
    matches.push({ id: signature.id, groupKey, roleVariables });
  }

  return matches;
}

interface RoleEvidence {
  role: string;
  variable: DiagramVariableSummary;
  groupKeys: string[];
  physicalTerms: Set<string>;
}

function collectRoleEvidence(
  variablePatterns: BusinessVariablePatternsConfig,
  variables: DiagramVariableSummary[],
): RoleEvidence[] {
  const evidence: RoleEvidence[] = [];

  for (const variable of variables) {
    const name = variable.name.trim();
    if (!name) {
      continue;
    }

    const matchedPatterns = [
      ...variablePatterns.prefixRoles,
      ...variablePatterns.suffixRoles,
    ].filter((pattern) => matchesRolePattern(name, pattern));
    const physicalTerms = new Set(
      variablePatterns.physicalTerms
        .filter((pattern) => matchesPhysicalPattern(name, pattern))
        .map((pattern) => pattern.physical),
    );

    for (const pattern of matchedPatterns) {
      if (
        pattern.acceptedDataTypes.length > 0 &&
        !hasAcceptedDataType(variable.type, pattern.acceptedDataTypes)
      ) {
        continue;
      }

      const groupKeys = groupKeysForPattern(name, pattern);
      const duplicate = evidence.some(
        (item) =>
          item.role === pattern.role &&
          item.variable.name.toUpperCase() === name.toUpperCase(),
      );
      if (!duplicate) {
        evidence.push({ role: pattern.role, variable, groupKeys, physicalTerms });
      }
    }
  }

  return evidence;
}

function findMatchingGroup(
  signature: BusinessLoopSignatureConfig,
  evidence: RoleEvidence[],
  contextPhysicalTerms: Set<string>,
  contextTerms: Set<string>,
): string | undefined {
  const candidateGroups = new Set(
    evidence.flatMap((item) => item.groupKeys),
  );

  const matchingGroups = [...candidateGroups].filter((groupKey) => {
    for (const role of signature.requiredRolesAll) {
      const roleEvidence = evidence.filter(
        (item) => item.role === role && item.groupKeys.includes(groupKey),
      );
      if (!roleEvidence.length) {
        return false;
      }

      const acceptedTypes = signature.requiredRoleTypes[role] ?? [];
      if (
        acceptedTypes.length > 0 &&
        !roleEvidence.some((item) =>
          hasAcceptedDataType(item.variable.type, acceptedTypes),
        )
      ) {
        return false;
      }
    }

    if (
      signature.requiredPhysicalTerms.length > 0 &&
      !signature.requiredPhysicalTerms.every((physical) =>
        hasPhysicalEvidence(
          physical,
          groupKey,
          evidence,
          contextPhysicalTerms,
        ),
      )
    ) {
      return false;
    }

    if (
      signature.evidenceRolesAny.length > 0 &&
      !signature.evidenceRolesAny.some((role) =>
        evidence.some((item) => item.role === role),
      )
    ) {
      return false;
    }

    if (
      signature.evidenceTermsAny.length > 0 &&
      !signature.evidenceTermsAny.some((term) => contextTerms.has(term))
    ) {
      return false;
    }

    return true;
  });

  return matchingGroups.sort((left, right) => right.length - left.length)[0];
}

function hasPhysicalEvidence(
  physical: string,
  groupKey: string,
  evidence: RoleEvidence[],
  contextPhysicalTerms: Set<string>,
): boolean {
  if (
    evidence.some(
      (item) =>
        item.groupKeys.includes(groupKey) && item.physicalTerms.has(physical),
    )
  ) {
    return true;
  }

  return contextPhysicalTerms.has(physical);
}

function matchesRolePattern(
  name: string,
  pattern: BusinessVariableRolePattern,
): boolean {
  const normalizedName = normalizeText(name);
  if (pattern.prefix && !normalizedName.startsWith(normalizeText(pattern.prefix))) {
    return false;
  }
  if (pattern.suffix && !normalizedName.endsWith(normalizeText(pattern.suffix))) {
    return false;
  }
  return Boolean(pattern.prefix || pattern.suffix);
}

function groupKeysForPattern(
  name: string,
  pattern: BusinessVariableRolePattern,
): string[] {
  let stem = name.trim();
  if (pattern.prefix) {
    stem = stem.slice(pattern.prefix.length);
  }
  if (pattern.suffix) {
    stem = stem.slice(0, -pattern.suffix.length);
  }

  const tokens = identifierTokens(stem);
  const keys = new Set<string>();
  for (let length = 1; length <= tokens.length; length += 1) {
    keys.add(tokens.slice(0, length).join("_"));
  }
  return [...keys];
}

function matchesPhysicalPattern(
  name: string,
  pattern: BusinessPhysicalPattern,
): boolean {
  const normalizedName = normalizeText(name);
  if (
    pattern.literalPatterns.some((literal) =>
      normalizedName.includes(normalizeText(literal)),
    )
  ) {
    return true;
  }

  return pattern.regexPatterns.some((source) => {
    try {
      return new RegExp(source, "iu").test(name);
    } catch {
      return false;
    }
  });
}

function parseRolePatterns(
  value: unknown,
  kind: "prefix" | "suffix",
): BusinessVariableRolePattern[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item): BusinessVariableRolePattern => ({
      prefix: kind === "prefix" ? asString(item.prefix) : undefined,
      suffix: kind === "suffix" ? asString(item.suffix) : undefined,
      role: asString(item.role),
      controller: asString(item.controller),
      acceptedDataTypes: stringList(item.acceptedDataTypes),
    }))
    .filter((item) => Boolean(item.role && (item.prefix || item.suffix)));
}

function parsePhysicalPatterns(value: unknown): BusinessPhysicalPattern[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      physical: asString(item.physical),
      literalPatterns: stringList(item.literalPatterns ?? item.patterns),
      regexPatterns: stringList(item.regexPatterns),
    }))
    .filter(
      (item) =>
        item.physical &&
        (item.literalPatterns.length > 0 || item.regexPatterns.length > 0),
    );
}

function parseStringListRecord(value: unknown): Record<string, string[]> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(record)
      .map(([key, entry]) => [key, stringList(entry)])
      .filter(([key, entries]) => key && entries.length > 0),
  );
}

function hasAcceptedDataType(type: string, acceptedTypes: string[]): boolean {
  const normalizedType = normalizeText(type).toUpperCase();
  return acceptedTypes.some(
    (acceptedType) =>
      normalizeText(acceptedType).toUpperCase() === normalizedType,
  );
}

function identifierTokens(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[^a-zA-Z0-9\u0080-\uFFFF]+/u)
    .map((token) => normalizeText(token))
    .filter(Boolean);
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
}

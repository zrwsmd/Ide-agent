import {
  DiagramPortSummary,
  DiagramSegmentSummary,
  DiagramVariableSummary,
} from "../diagram/DiagramSummary";
import {
  businessEvidenceTextVariants,
  normalizeBusinessEvidenceText,
} from "./BusinessTextNormalization";

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

export type BusinessVariableEvidenceSource =
  | "name"
  | "label"
  | "note"
  | "comment"
  | "port";

type BusinessVariableTextEvidenceSource = Exclude<
  BusinessVariableEvidenceSource,
  "port"
>;

export type BusinessPortDirection = "input" | "output" | "any";

export type BusinessGroupStrategy =
  | "groupId"
  | "deviceId"
  | "namePrefix"
  | "fbInstancePorts";

export interface BusinessBlockPortRoleConfig {
  port: string;
  direction: BusinessPortDirection;
  roles: string[];
  acceptedDataTypes: string[];
  score: number;
}

export interface BusinessBlockPortRoleRuleConfig {
  id: string;
  status: string;
  blockTypes: string[];
  ports: BusinessBlockPortRoleConfig[];
}

export interface BusinessBlockInstanceSummary {
  groupKey: string;
  nodeId: string;
  segmentId: string;
  pouName: string;
  blockType: string;
  instance: string;
  isFunction: boolean;
  ports: DiagramPortSummary[];
}

export interface BusinessVariableRoleEvidenceSourceConfig {
  source: BusinessVariableTextEvidenceSource;
  literalPatterns: string[];
  regexPatterns: string[];
  score: number;
}

export interface BusinessVariableRoleEvidenceRule {
  id: string;
  status: string;
  role: string;
  acceptedDataTypes: string[];
  minScore: number;
  sources: BusinessVariableRoleEvidenceSourceConfig[];
}

export interface BusinessVariablePatternsConfig {
  prefixRoles: BusinessVariableRolePattern[];
  suffixRoles: BusinessVariableRolePattern[];
  roleEvidenceRules: BusinessVariableRoleEvidenceRule[];
  physicalTerms: BusinessPhysicalPattern[];
}

export interface BusinessLoopSignatureConfig {
  id: string;
  status: string;
  kind: "completion" | "observed";
  groupStrategies: BusinessGroupStrategy[];
  requiredRolesAll: string[];
  requiredRoleTypes: Record<string, string[]>;
  requiredPhysicalTerms: string[];
  requiredPhysicalTermsAny: string[];
  evidenceRolesAny: string[];
  missingRolesAny: string[];
  evidenceTermsAny: string[];
  evidenceBlockTypesAny: string[];
  targetBlockTypes: string[];
}

export interface BusinessLoopSignatureMatch {
  id: string;
  kind: BusinessLoopSignatureConfig["kind"];
  groupKey: string;
  groupStrategy: BusinessGroupStrategy;
  roleVariables: Record<string, string[]>;
  blockType?: string;
  blockInstance?: string;
  blockNodeId?: string;
  blockSegmentId?: string;
  targetBlockTypes: string[];
  missingRoles: string[];
}

export interface BusinessVariableRoleMatch {
  variableName: string;
  dataType: string;
  role: string;
  score: number;
  matchedSources: BusinessVariableEvidenceSource[];
  groupKeys: string[];
}

export const EMPTY_VARIABLE_PATTERNS: BusinessVariablePatternsConfig = {
  prefixRoles: [],
  suffixRoles: [],
  roleEvidenceRules: [],
  physicalTerms: [],
};

export const EMPTY_LOOP_SIGNATURES: BusinessLoopSignatureConfig[] = [];
export const EMPTY_BLOCK_PORT_ROLE_RULES: BusinessBlockPortRoleRuleConfig[] = [];

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
    roleEvidenceRules: parseRoleEvidenceRules(record.roleEvidenceRules),
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
      kind: parseSignatureKind(item.kind),
      groupStrategies: parseGroupStrategies(
        item.groupStrategies ?? item.groupBy,
      ),
      requiredRolesAll: stringList(item.requiredRolesAll),
      requiredRoleTypes: parseStringListRecord(item.requiredRoleTypes),
      requiredPhysicalTerms: stringList(item.requiredPhysicalTerms),
      requiredPhysicalTermsAny: stringList(item.requiredPhysicalTermsAny),
      evidenceRolesAny: stringList(item.evidenceRolesAny),
      missingRolesAny: stringList(item.missingRolesAny),
      evidenceTermsAny: stringList(item.evidenceTermsAny),
      evidenceBlockTypesAny: stringList(item.evidenceBlockTypesAny),
      targetBlockTypes: stringList(item.targetBlockTypes),
    }))
    .filter(
      (item) =>
        item.id &&
        item.requiredRolesAll.length > 0 &&
        item.status.toLowerCase() === "active",
    );
}

export function parseBlockPortRoleRules(
  value: unknown,
): BusinessBlockPortRoleRuleConfig[] {
  if (!Array.isArray(value)) {
    return EMPTY_BLOCK_PORT_ROLE_RULES;
  }

  return value
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item): BusinessBlockPortRoleRuleConfig => ({
      id: asString(item.id),
      status: asString(item.status) || "active",
      blockTypes: stringList(item.blockTypes),
      ports: parseBlockPortRoles(item.ports),
    }))
    .filter(
      (item) =>
        item.id &&
        item.status.toLowerCase() === "active" &&
        item.blockTypes.length > 0 &&
        item.ports.length > 0,
    );
}

export function collectBlockInstances(
  segments: DiagramSegmentSummary[],
): BusinessBlockInstanceSummary[] {
  return segments.flatMap((segment) =>
    segment.nodes.flatMap((node) => {
      const blockType = String(node.blockType ?? "").trim();
      if (node.kind !== "FBDCompartment" || !blockType) {
        return [];
      }

      const inputPorts = node.inputPorts ?? portsFromValues(node.inputs, "input");
      const outputPorts = node.outputPorts ?? portsFromValues(node.outputs, "output");
      return [
        {
          groupKey: blockInstanceGroupKey(segment, node.id),
          nodeId: node.id,
          segmentId: segment.segmentId,
          pouName: String(segment.pouName ?? ""),
          blockType,
          instance: String(node.instance ?? ""),
          isFunction: Boolean(node.isFunction),
          ports: [...inputPorts, ...outputPorts],
        },
      ];
    }),
  );
}

export function evaluateLoopSignatures(
  variablePatterns: BusinessVariablePatternsConfig,
  signatures: BusinessLoopSignatureConfig[],
  variables: DiagramVariableSummary[],
  contextTexts: Array<string | undefined>,
  contextTerms: Set<string>,
  blockPortRoleRules: BusinessBlockPortRoleRuleConfig[] = [],
  blockInstances: BusinessBlockInstanceSummary[] = [],
  focusVariableNames: string[] = [],
): BusinessLoopSignatureMatch[] {
  const evidence = collectRoleEvidence(
    variablePatterns,
    variables,
    blockPortRoleRules,
    blockInstances,
  );
  const blockInstancesByGroup = indexBlockInstancesByGroup(
    blockInstances,
    variables,
  );
  const focusGroupKeys = collectFocusGroupKeys(
    variables,
    focusVariableNames,
  );
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
    const groupKeys = findMatchingGroups(
      signature,
      evidence,
      contextPhysicalTerms,
      contextTerms,
      blockInstancesByGroup,
      focusGroupKeys,
    );
    for (const groupKey of groupKeys) {
      const groupBlockInstances = blockInstancesByGroup.get(groupKey) ?? [];
      const blockInstance = groupBlockInstances.find((instance) =>
        signature.evidenceBlockTypesAny.some(
          (candidate) =>
            normalizeIdentifier(candidate) ===
            normalizeIdentifier(instance.blockType),
        ),
      ) ?? groupBlockInstances[0];
      const roleVariables = Object.fromEntries(
        signature.requiredRolesAll.map((role) => [
          role,
          uniqueStrings(
            evidence
              .filter(
                (item) =>
                  item.role === role && item.groupKeys.includes(groupKey),
              )
              .map((item) => item.variable.name),
          ),
        ]),
      );
      matches.push({
        id: signature.id,
        kind: signature.kind,
        groupKey,
        groupStrategy: groupStrategyForKey(groupKey),
        roleVariables,
        blockType: blockInstance?.blockType,
        blockInstance: blockInstance?.instance,
        blockNodeId: blockInstance?.nodeId,
        blockSegmentId: blockInstance?.segmentId,
        targetBlockTypes: [...signature.targetBlockTypes],
        missingRoles: signature.missingRolesAny.filter(
          (role) =>
            !evidence.some(
              (item) =>
                item.role === role && item.groupKeys.includes(groupKey),
            ),
        ),
      });
    }
  }

  return matches;
}

export function evaluateVariableRoles(
  variablePatterns: BusinessVariablePatternsConfig,
  variables: DiagramVariableSummary[],
  blockPortRoleRules: BusinessBlockPortRoleRuleConfig[] = [],
  blockInstances: BusinessBlockInstanceSummary[] = [],
): BusinessVariableRoleMatch[] {
  return collectRoleEvidence(
    variablePatterns,
    variables,
    blockPortRoleRules,
    blockInstances,
  ).map((item) => ({
    variableName: item.variable.name,
    dataType: item.variable.type,
    role: item.role,
    score: item.score,
    matchedSources: [...item.matchedSources].sort(),
    groupKeys: [...item.groupKeys],
  }));
}

interface RoleEvidence {
  role: string;
  variable: DiagramVariableSummary;
  groupKeys: string[];
  physicalTerms: Set<string>;
  score: number;
  matchedSources: Set<BusinessVariableEvidenceSource>;
}

function indexBlockInstancesByGroup(
  instances: BusinessBlockInstanceSummary[],
  variables: DiagramVariableSummary[],
): Map<string, BusinessBlockInstanceSummary[]> {
  const result = new Map<string, BusinessBlockInstanceSummary[]>();
  const variablesByName = new Map(
    variables.map((variable) => [normalizeIdentifier(variable.name), variable]),
  );

  for (const instance of instances) {
    const groupKeys = new Set([instance.groupKey]);
    for (const port of instance.ports) {
      if (!isVariableReference(port.value)) {
        continue;
      }
      const variable =
        variablesByName.get(normalizeIdentifier(port.value)) ??
        variableFromPort(port);
      for (const groupKey of groupKeysForVariable(variable)) {
        groupKeys.add(groupKey);
      }
    }
    for (const groupKey of groupKeys) {
      const current = result.get(groupKey) ?? [];
      if (!current.some((item) => item.nodeId === instance.nodeId)) {
        current.push(instance);
      }
      result.set(groupKey, current);
    }
  }

  return result;
}

function collectFocusGroupKeys(
  variables: DiagramVariableSummary[],
  focusVariableNames: string[],
): Set<string> {
  const focusNames = new Set(
    focusVariableNames.map(normalizeIdentifier).filter(Boolean),
  );
  return new Set(
    variables
      .filter((variable) => focusNames.has(normalizeIdentifier(variable.name)))
      .flatMap(groupKeysForVariable),
  );
}

function groupKeysForVariable(variable: DiagramVariableSummary): string[] {
  return uniqueStrings([
    ...explicitGroupKeysForVariable(variable),
    ...groupKeysForVariableName(variable.name),
  ]);
}

function collectRoleEvidence(
  variablePatterns: BusinessVariablePatternsConfig,
  variables: DiagramVariableSummary[],
  blockPortRoleRules: BusinessBlockPortRoleRuleConfig[] = [],
  blockInstances: BusinessBlockInstanceSummary[] = [],
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

      const groupKeys = uniqueStrings([
        ...explicitGroupKeysForVariable(variable),
        ...groupKeysForPattern(name, pattern),
      ]);
      addRoleEvidence(evidence, {
        role: pattern.role,
        variable,
        groupKeys,
        physicalTerms,
        score: 1,
        matchedSources: new Set(["name"]),
      });
    }

    for (const rule of variablePatterns.roleEvidenceRules) {
      const match = matchRoleEvidenceRule(variable, rule);
      if (!match) {
        continue;
      }

      addRoleEvidence(evidence, {
        role: rule.role,
        variable,
        groupKeys: uniqueStrings([
          ...explicitGroupKeysForVariable(variable),
          ...groupKeysForVariableName(name),
        ]),
        physicalTerms,
        score: match.score,
        matchedSources: new Set(match.matchedSources),
      });
    }
  }

  addBlockPortRoleEvidence(
    evidence,
    variablePatterns,
    variables,
    blockPortRoleRules,
    blockInstances,
  );

  return evidence;
}

function addBlockPortRoleEvidence(
  evidence: RoleEvidence[],
  variablePatterns: BusinessVariablePatternsConfig,
  variables: DiagramVariableSummary[],
  rules: BusinessBlockPortRoleRuleConfig[],
  instances: BusinessBlockInstanceSummary[],
): void {
  const variablesByName = new Map(
    variables.map((variable) => [normalizeIdentifier(variable.name), variable]),
  );

  for (const instance of instances) {
    const matchingRules = rules.filter((rule) =>
      rule.blockTypes.some(
        (blockType) =>
          normalizeIdentifier(blockType) ===
          normalizeIdentifier(instance.blockType),
      ),
    );
    for (const rule of matchingRules) {
      for (const portRule of rule.ports) {
        const ports = instance.ports.filter(
          (port) =>
            normalizeIdentifier(port.name) ===
              normalizeIdentifier(portRule.port) &&
            (portRule.direction === "any" ||
              port.direction === portRule.direction),
        );
        for (const port of ports) {
          if (!isVariableReference(port.value)) {
            continue;
          }

          const declaredVariable = variablesByName.get(
            normalizeIdentifier(port.value),
          );
          const variable = declaredVariable
            ? {
                ...declaredVariable,
                type: declaredVariable.type || port.type,
                scope: declaredVariable.scope || port.scope || "VAR",
              }
            : variableFromPort(port);
          const dataType = variable.type;
          if (
            portRule.acceptedDataTypes.length > 0 &&
            !hasAcceptedDataType(dataType, portRule.acceptedDataTypes)
          ) {
            continue;
          }

          const physicalTerms = physicalTermsForVariable(
            variablePatterns,
            variable,
          );
          for (const role of portRule.roles) {
            addRoleEvidence(evidence, {
              role,
              variable,
              groupKeys: uniqueStrings([
                instance.groupKey,
                ...explicitGroupKeysForVariable(variable),
              ]),
              physicalTerms,
              score: portRule.score,
              matchedSources: new Set(["port"]),
            });
          }
        }
      }
    }
  }
}

function addRoleEvidence(
  evidence: RoleEvidence[],
  candidate: RoleEvidence,
): void {
  const existing = evidence.find(
    (item) =>
      item.role === candidate.role &&
      item.variable.name.toUpperCase() ===
        candidate.variable.name.toUpperCase(),
  );
  if (!existing) {
    evidence.push(candidate);
    return;
  }

  existing.groupKeys = uniqueStrings([
    ...existing.groupKeys,
    ...candidate.groupKeys,
  ]);
  existing.physicalTerms = new Set([
    ...existing.physicalTerms,
    ...candidate.physicalTerms,
  ]);
  existing.score = Math.max(existing.score, candidate.score);
  existing.matchedSources = new Set([
    ...existing.matchedSources,
    ...candidate.matchedSources,
  ]);
}

function matchRoleEvidenceRule(
  variable: DiagramVariableSummary,
  rule: BusinessVariableRoleEvidenceRule,
):
  | { score: number; matchedSources: BusinessVariableEvidenceSource[] }
  | undefined {
  if (
    rule.acceptedDataTypes.length > 0 &&
    !hasAcceptedDataType(variable.type, rule.acceptedDataTypes)
  ) {
    return undefined;
  }

  const scoreBySource = new Map<BusinessVariableEvidenceSource, number>();
  for (const source of rule.sources) {
    const text = String(variable[source.source] ?? "");
    if (
      !matchesTextPatterns(
        text,
        source.literalPatterns,
        source.regexPatterns,
      )
    ) {
      continue;
    }
    scoreBySource.set(
      source.source,
      Math.max(scoreBySource.get(source.source) ?? 0, source.score),
    );
  }

  const score = [...scoreBySource.values()].reduce(
    (total, value) => total + value,
    0,
  );
  if (score < rule.minScore) {
    return undefined;
  }

  return { score, matchedSources: [...scoreBySource.keys()] };
}

function findMatchingGroups(
  signature: BusinessLoopSignatureConfig,
  evidence: RoleEvidence[],
  contextPhysicalTerms: Set<string>,
  contextTerms: Set<string>,
  blockInstancesByGroup: Map<string, BusinessBlockInstanceSummary[]>,
  focusGroupKeys: Set<string>,
): string[] {
  const candidateGroups = new Set(
    evidence
      .flatMap((item) => item.groupKeys)
      .filter((groupKey) =>
        signature.groupStrategies.includes(groupStrategyForKey(groupKey)),
      ),
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
      signature.requiredPhysicalTermsAny.length > 0 &&
      !signature.requiredPhysicalTermsAny.some((physical) =>
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
        evidence.some(
          (item) => item.role === role && item.groupKeys.includes(groupKey),
        ),
      )
    ) {
      return false;
    }

    if (
      signature.kind === "completion" &&
      signature.missingRolesAny.length > 0 &&
      !signature.missingRolesAny.some(
        (role) =>
          !evidence.some(
            (item) =>
              item.role === role && item.groupKeys.includes(groupKey),
          ),
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

    if (signature.evidenceBlockTypesAny.length > 0) {
      const blockInstances = blockInstancesByGroup.get(groupKey) ?? [];
      if (!blockInstances.some((instance) =>
        signature.evidenceBlockTypesAny.some(
          (candidate) =>
            normalizeIdentifier(candidate) ===
            normalizeIdentifier(instance.blockType),
        ),
      )) {
        return false;
      }
    }

    if (
      signature.kind === "completion" &&
      signature.targetBlockTypes.length > 0 &&
      (blockInstancesByGroup.get(groupKey) ?? []).some((instance) =>
        signature.targetBlockTypes.some(
          (targetBlockType) =>
            normalizeIdentifier(targetBlockType) ===
            normalizeIdentifier(instance.blockType),
        ),
      )
    ) {
      return false;
    }

    return true;
  });

  for (const strategy of signature.groupStrategies) {
    const strategyMatches = matchingGroups
      .filter((groupKey) => groupStrategyForKey(groupKey) === strategy)
      .sort((left, right) => left.localeCompare(right));
    const focusKeysForStrategy = new Set(
      [...focusGroupKeys].filter(
        (groupKey) => groupStrategyForKey(groupKey) === strategy,
      ),
    );
    const focusedMatches = strategyMatches.filter((groupKey) =>
      focusKeysForStrategy.has(groupKey),
    );
    if (focusedMatches.length > 0) {
      return focusedMatches;
    }
    if (
      focusKeysForStrategy.size > 0 &&
      strategyMatches.length > 0 &&
      (strategy === "groupId" || strategy === "deviceId")
    ) {
      return [];
    }
    if (strategyMatches.length > 0) {
      return strategyMatches;
    }
    if (
      (strategy === "groupId" || strategy === "deviceId") &&
      hasConflictingRequiredRoleGroups(signature, evidence, strategy)
    ) {
      return [];
    }
  }

  return [];
}

function hasConflictingRequiredRoleGroups(
  signature: BusinessLoopSignatureConfig,
  evidence: RoleEvidence[],
  strategy: "groupId" | "deviceId",
): boolean {
  const groupsByRole = signature.requiredRolesAll.map((role) =>
    new Set(
      evidence
        .filter((item) => item.role === role)
        .flatMap((item) => item.groupKeys)
        .filter((groupKey) => groupStrategyForKey(groupKey) === strategy),
    ),
  );
  if (groupsByRole.some((groups) => groups.size === 0)) {
    return false;
  }

  const [firstGroups, ...remainingGroups] = groupsByRole;
  return ![...firstGroups].some((groupKey) =>
    remainingGroups.every((groups) => groups.has(groupKey)),
  );
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

  return groupKeysForStem(stem);
}

function groupKeysForVariableName(name: string): string[] {
  return groupKeysForStem(name);
}

function explicitGroupKeysForVariable(
  variable: DiagramVariableSummary,
): string[] {
  const deviceId = normalizeOptionalGroupComponent(variable.deviceId);
  const groupId = normalizeOptionalGroupComponent(variable.groupId);
  const keys: string[] = [];

  if (groupId) {
    keys.push(
      deviceId
        ? `group:device:${deviceId}:id:${groupId}`
        : `group:id:${groupId}`,
    );
  }
  if (deviceId) {
    keys.push(`device:id:${deviceId}`);
  }
  return keys;
}

function groupKeysForStem(stem: string): string[] {
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
  return matchesTextPatterns(
    name,
    pattern.literalPatterns,
    pattern.regexPatterns,
  );
}

function matchesTextPatterns(
  text: string,
  literalPatterns: string[],
  regexPatterns: string[],
): boolean {
  const textVariants = businessEvidenceTextVariants(text);
  const normalizedTextVariants = textVariants
    .map(normalizeBusinessEvidenceText)
    .filter(Boolean);
  if (
    literalPatterns.some((literal) => {
      const normalizedLiteral = normalizeBusinessEvidenceText(literal);
      return (
        normalizedLiteral.length > 0 &&
        normalizedTextVariants.some((variant) =>
          variant.includes(normalizedLiteral),
        )
      );
    })
  ) {
    return true;
  }

  return regexPatterns.some((source) => {
    try {
      const pattern = new RegExp(source, "iu");
      return textVariants.some((variant) => pattern.test(variant));
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

function parseRoleEvidenceRules(
  value: unknown,
): BusinessVariableRoleEvidenceRule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item): BusinessVariableRoleEvidenceRule => ({
      id: asString(item.id),
      status: asString(item.status) || "active",
      role: asString(item.role),
      acceptedDataTypes: stringList(item.acceptedDataTypes),
      minScore: asPositiveNumber(item.minScore, 1),
      sources: parseRoleEvidenceSources(item.sources),
    }))
    .filter(
      (item) =>
        item.id &&
        item.role &&
        item.status.toLowerCase() === "active" &&
        item.sources.length > 0,
    );
}

function parseRoleEvidenceSources(
  value: unknown,
): BusinessVariableRoleEvidenceSourceConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      source: asString(item.source),
      literalPatterns: stringList(item.literalPatterns),
      regexPatterns: stringList(item.regexPatterns),
      score: asPositiveNumber(item.score, 1),
    }))
    .filter(
      (item): item is BusinessVariableRoleEvidenceSourceConfig =>
        isVariableEvidenceSource(item.source) &&
        (item.literalPatterns.length > 0 || item.regexPatterns.length > 0),
    );
}

function isVariableEvidenceSource(
  value: string,
): value is BusinessVariableTextEvidenceSource {
  return ["name", "label", "note", "comment"].includes(value);
}

function parseBlockPortRoles(value: unknown): BusinessBlockPortRoleConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item): BusinessBlockPortRoleConfig => ({
      port: asString(item.port),
      direction: parsePortDirection(item.direction),
      roles: uniqueStrings([
        ...stringList(item.roles),
        ...stringList(
          typeof item.role === "string" ? [item.role] : undefined,
        ),
      ]),
      acceptedDataTypes: stringList(item.acceptedDataTypes),
      score: asPositiveNumber(item.score, 100),
    }))
    .filter((item) => item.port && item.roles.length > 0);
}

function parsePortDirection(value: unknown): BusinessPortDirection {
  const normalized = asString(value).toLowerCase();
  return normalized === "input" || normalized === "output"
    ? normalized
    : "any";
}

function parseSignatureKind(
  value: unknown,
): BusinessLoopSignatureConfig["kind"] {
  return asString(value).toLowerCase() === "observed"
    ? "observed"
    : "completion";
}

function parseGroupStrategies(
  value: unknown,
): BusinessLoopSignatureConfig["groupStrategies"] {
  const rawValues = Array.isArray(value)
    ? stringList(value)
    : typeof value === "string"
      ? [value.trim()]
      : [];
  const parsed = rawValues.flatMap((item) => {
    switch (item.trim().toLowerCase()) {
      case "fbinstanceports":
        return ["fbInstancePorts" as const];
      case "any":
        return [
          "fbInstancePorts" as const,
          "groupId" as const,
          "deviceId" as const,
          "namePrefix" as const,
        ];
      case "explicitid":
        return ["groupId" as const, "deviceId" as const];
      case "groupid":
        return ["groupId" as const];
      case "deviceid":
        return ["deviceId" as const];
      case "nameprefix":
        return ["namePrefix" as const];
      default:
        return [];
    }
  });
  return parsed.length > 0 ? [...new Set(parsed)] : ["namePrefix"];
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

function portsFromValues(
  values: Record<string, string> | undefined,
  direction: DiagramPortSummary["direction"],
): DiagramPortSummary[] {
  return Object.entries(values ?? {}).map(([name, value]) => ({
    name,
    value,
    type: "",
    scope: "",
    direction,
  }));
}

function blockInstanceGroupKey(
  segment: DiagramSegmentSummary,
  nodeId: string,
): string {
  return [
    "fb",
    normalizeGroupComponent(segment.pouName || "pou"),
    normalizeGroupComponent(segment.segmentId),
    normalizeGroupComponent(nodeId),
  ].join(":");
}

function normalizeGroupComponent(value: string): string {
  return normalizeText(value)
    .replace(/[^a-z0-9\u0080-\uFFFF]+/gu, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
}

function normalizeOptionalGroupComponent(value: unknown): string {
  const normalized = normalizeText(value)
    .replace(/[^a-z0-9\u0080-\uFFFF]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  return normalized;
}

function groupStrategyForKey(
  groupKey: string,
): BusinessGroupStrategy {
  if (groupKey.startsWith("group:")) {
    return "groupId";
  }
  if (groupKey.startsWith("device:")) {
    return "deviceId";
  }
  return groupKey.startsWith("fb:") ? "fbInstancePorts" : "namePrefix";
}

function normalizeIdentifier(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function isVariableReference(value: string): boolean {
  const trimmed = value.trim();
  return (
    Boolean(trimmed) &&
    trimmed !== "???" &&
    /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(trimmed) &&
    !["TRUE", "FALSE", "NULL"].includes(trimmed.toUpperCase())
  );
}

function variableFromPort(port: DiagramPortSummary): DiagramVariableSummary {
  return {
    name: port.value.trim(),
    type: port.type,
    scope: port.scope || "VAR",
  };
}

function physicalTermsForVariable(
  variablePatterns: BusinessVariablePatternsConfig,
  variable: DiagramVariableSummary,
): Set<string> {
  const texts = [
    variable.name,
    variable.label,
    variable.note,
    variable.comment,
  ].map((value) => String(value ?? ""));
  return new Set(
    variablePatterns.physicalTerms
      .filter((pattern) =>
        texts.some((text) => matchesPhysicalPattern(text, pattern)),
      )
      .map((pattern) => pattern.physical),
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

function asPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

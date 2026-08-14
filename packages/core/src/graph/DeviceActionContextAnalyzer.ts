import {
  DiagramNodeSummary,
  DiagramSegmentSummary,
  DiagramSummary,
  DiagramVariableSummary,
} from "../diagram/DiagramSummary";
import { BusinessVariableRoleMatch } from "./BusinessLoopSignatures";
import {
  BUSINESS_RULES_CONFIG,
  BusinessOppositeActionPairConfig,
  BusinessTerm,
} from "./BusinessRulesConfig";
import {
  ActionLifecycleCandidate,
  ActionLifecycleContext,
  DeviceLoopContext,
  DeviceLoopRoleCandidate,
  FaultResetContext,
  FaultResponseContext,
  FocusContext,
} from "./BusinessContextTypes";
import {
  collectBusinessTerms,
  collectNodeReferences,
  isCounterBlockType,
  nodeBusinessTexts,
  normalizeBlockType,
  normalizeDataType,
  normalizeReference,
  splitBusinessIdentifierWords,
  uniqueDisplayNames,
  variableBusinessTexts,
} from "./BusinessEvidence";

function findNode(
  segment: DiagramSegmentSummary,
  nodeId: string,
): DiagramNodeSummary | undefined {
  return segment.nodes.find((node) => node.id === nodeId);
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

export function analyzeDeviceLoopContext(
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

export function analyzeFaultResponseContext(
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

export function analyzeFaultResetContext(
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

export function analyzeActionLifecycleContext(
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


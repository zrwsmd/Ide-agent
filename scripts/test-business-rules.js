#!/usr/bin/env node

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const {
  getLocalGraphSuggestions,
  loadDiagramSummary,
} = require("../dist/node_modules/@ide-agent/core");
const {
  evaluateVariableRoles,
  parseVariablePatterns,
} = require("../packages/core/dist/graph/BusinessLoopSignatures");

const rootDir = path.resolve(__dirname, "..");
const fixturePath = path.join(
  rootDir,
  "src",
  "test",
  "fixtures",
  "local-business-suggestion-fixture.json",
);
const loopSignatureFixturePath = path.join(
  rootDir,
  "src",
  "test",
  "fixtures",
  "loop-signature-business-suggestion-fixture.json",
);
const rulesPath = path.join(
  rootDir,
  "packages",
  "core",
  "src",
  "graph",
  "businessRules.json",
);
const libraryData = require("st-library-info/data");
const libraryElements = new Map(
  libraryData.flatMap((category) =>
    (category.list ?? []).map((element) => [
      String(element.name).toUpperCase(),
      element,
    ]),
  ),
);

async function main() {
  assertActiveRuleCandidatesExistInLibrary();
  assertVariableRoleEvidenceCases();
  await assertStableBusinessCases();
  await assertLoopSignatureCases();
  await assertTimestampDiagramWhenAvailable();
  console.log("[test-business-rules] passed");
}

function assertActiveRuleCandidatesExistInLibrary() {
  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  assert.equal(rules.schemaVersion, "ide-agent.business-rules.v5");
  assert.ok(rules.dataTypeGroups.NUMERIC.includes("LREAL"));
  assert.ok(rules.dataTypeGroups.INTEGER.includes("UDINT"));
  assert.ok(
    rules.typeCapabilities.MOTION_AXIS_REFERENCE.includes("AXIS_REF"),
  );
  assert.ok(
    rules.derivedTerms.some(
      (rule) =>
        rule.term === "numeric" &&
        rule.whenDataTypesAny.includes("NUMERIC"),
    ),
  );
  assert.ok(
    rules.termImplications.some(
      (rule) =>
        rule.ifMatched === "onDelay" &&
        rule.alsoMatch.includes("timer"),
    ),
  );
  const definedRoles = new Set([
    ...(rules.variablePatterns?.prefixRoles ?? []).map((entry) => entry.role),
    ...(rules.variablePatterns?.suffixRoles ?? []).map((entry) => entry.role),
    ...(rules.variablePatterns?.roleEvidenceRules ?? []).map(
      (entry) => entry.role,
    ),
  ]);
  const signatureIds = new Set(
    (rules.loopSignatures ?? []).map((signature) => signature.id),
  );
  assert.ok(definedRoles.has("processValue"));
  assert.ok(definedRoles.has("setpoint"));
  assert.ok(definedRoles.has("manipulatedValue"));
  assert.ok(signatureIds.has("LS01-temperature-pid"));
  for (const signature of rules.loopSignatures ?? []) {
    for (const role of [
      ...(signature.requiredRolesAll ?? []),
      ...(signature.evidenceRolesAny ?? []),
      ...Object.keys(signature.requiredRoleTypes ?? {}),
    ]) {
      assert.ok(
        definedRoles.has(role),
        `${signature.id} references undefined variable role: ${role}`,
      );
    }
  }
  const definedTerms = new Set([
    ...rules.termPatterns.map((entry) => entry.term),
    ...rules.derivedTerms.map((entry) => entry.term),
  ]);
  for (const implication of rules.termImplications) {
    assert.ok(
      definedTerms.has(implication.ifMatched),
      `term implication source is undefined: ${implication.ifMatched}`,
    );
    for (const impliedTerm of implication.alsoMatch) {
      assert.ok(
        definedTerms.has(impliedTerm),
        `term implication target is undefined: ${impliedTerm}`,
      );
    }
  }
  for (const rule of [
    ...(rules.contactPolarityRules ?? []),
    ...(rules.libraryRules ?? []),
    ...(rules.rankingRules ?? []),
  ]) {
    for (const term of [
      ...(rule.termsAny ?? []),
      ...(rule.termsAll ?? []),
      ...(rule.excludedTerms ?? []),
      ...(rule.excludedAnchorTerms ?? []),
    ]) {
      assert.ok(
        definedTerms.has(term),
        `${rule.id} references undefined term: ${term}`,
      );
    }
  }

  assert.ok(rules.termPatterns.length > 0, "termPatterns must not be empty");
  for (const entry of rules.termPatterns) {
    assert.ok(
      !Object.hasOwn(entry, "patterns"),
      `${entry.term} must use literalPatterns/regexPatterns instead of patterns`,
    );
    assert.ok(Array.isArray(entry.literalPatterns));
    assert.ok(Array.isArray(entry.regexPatterns));
    assert.ok(
      entry.literalPatterns.length > 0 || entry.regexPatterns.length > 0,
      `${entry.term} must define at least one matcher`,
    );
    for (const pattern of entry.regexPatterns) {
      assert.doesNotThrow(
        () => new RegExp(pattern, "iu"),
        `${entry.term} has invalid regex: ${pattern}`,
      );
    }
  }
  const allowedVariableSources = new Set([
    "name",
    "label",
    "note",
    "comment",
  ]);
  assert.ok(
    rules.variablePatterns.roleEvidenceRules.length > 0,
    "roleEvidenceRules must define generic variable-role evidence",
  );
  for (const rule of rules.variablePatterns.roleEvidenceRules) {
    assert.ok(rule.id, "variable role evidence rule must define id");
    assert.ok(rule.role, `${rule.id} must define role`);
    assert.ok(
      Number.isFinite(rule.minScore) && rule.minScore > 0,
      `${rule.id} must define a positive minScore`,
    );
    assert.ok(
      rule.acceptedDataTypes?.length > 0,
      `${rule.id} must define acceptedDataTypes as a hard type constraint`,
    );
    assert.ok(rule.sources?.length > 0, `${rule.id} must define sources`);
    for (const source of rule.sources) {
      assert.ok(
        allowedVariableSources.has(source.source),
        `${rule.id} has unsupported variable source: ${source.source}`,
      );
      assert.ok(
        Number.isFinite(source.score) && source.score > 0,
        `${rule.id}/${source.source} must define a positive score`,
      );
      assert.ok(
        source.literalPatterns?.length > 0 ||
          source.regexPatterns?.length > 0,
        `${rule.id}/${source.source} must define at least one matcher`,
      );
      for (const pattern of source.regexPatterns ?? []) {
        assert.doesNotThrow(
          () => new RegExp(pattern, "iu"),
          `${rule.id}/${source.source} has invalid regex: ${pattern}`,
        );
      }
    }
  }
  const negatedPolarityRule = rules.contactPolarityRules?.find(
    (rule) => rule.id === "P01-permissive-inhibit-negated",
  );
  assert.equal(negatedPolarityRule?.polarity, "negated");
  assert.equal(negatedPolarityRule?.priority, 80);
  assert.equal(
    negatedPolarityRule?.anchorTermScope,
    "selectedNodeOrDirectNeighbors",
  );
  assert.ok(negatedPolarityRule?.excludedTerms?.includes("safety"));
  assert.ok(negatedPolarityRule?.excludedAnchorTerms?.includes("healthy"));
  assert.ok(
    rules.contactPolarityRules.some(
      (rule) =>
        rule.id === "P02-healthy-permissive-normal" &&
        rule.priority > negatedPolarityRule.priority,
    ),
  );

  for (const rule of rules.libraryRules ?? []) {
    if (String(rule.status).toLowerCase() !== "active") {
      continue;
    }
    assert.ok(
      Number.isFinite(rule.priority),
      `${rule.id} must define a rule priority`,
    );
    for (const signatureId of rule.signatureRefsAny ?? []) {
      assert.ok(
        signatureIds.has(signatureId),
        `${rule.id} references undefined loop signature: ${signatureId}`,
      );
    }
    if (rule.id.startsWith("MC")) {
      assert.deepStrictEqual(rule.requiredTypeCapabilities, [
        "MOTION_AXIS_REFERENCE",
      ]);
      assert.equal(rule.requiredAnyDataTypes, undefined);
    }
    for (const candidateName of rule.candidateNames ?? []) {
      const libraryElement = libraryElements.get(
        String(candidateName).toUpperCase(),
      );
      assert.ok(
        libraryElement,
        `${rule.id} references missing st-library-info element: ${candidateName}`,
      );
      for (const portRequirement of rule.portRequirements ?? []) {
        if (portRequirement.required) {
          assert.ok(
            portRequirement.acceptedDataTypes?.length > 0,
            `${rule.id}/${portRequirement.port} must define accepted data types`,
          );
        }
        const libraryPort = (libraryElement.inputs ?? []).find(
          ([name]) =>
            String(name).toUpperCase() ===
            String(portRequirement.port).toUpperCase(),
        );
        if (portRequirement.required) {
          assert.ok(
            libraryPort,
            `${rule.id}/${candidateName} requires missing input port ${portRequirement.port}`,
          );
        }
      }
    }
  }
  for (const rule of rules.rankingRules ?? []) {
    if (String(rule.status).toLowerCase() !== "active") {
      continue;
    }
    assert.ok(
      Number.isFinite(rule.priority),
      `${rule.id} must define a ranking rule priority`,
    );
  }
}

function assertVariableRoleEvidenceCases() {
  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  const config = parseVariablePatterns(rules.variablePatterns);
  const matches = evaluateVariableRoles(config, [
    {
      name: "TIC101_IN",
      type: "REAL",
      scope: "VAR",
      comment: "炉温实际值",
    },
    {
      name: "TIC101_REF",
      type: "REAL",
      scope: "VAR",
      label: "炉温目标值",
    },
    {
      name: "TIC101_OUT",
      type: "REAL",
      scope: "VAR",
      note: "加热阀门输出",
    },
    {
      name: "X101",
      type: "BOOL",
      scope: "VAR",
      label: "1号电机启动命令",
      comment: "设备控制命令",
    },
    {
      name: "X102",
      type: "BOOL",
      scope: "VAR",
      note: "1号电机运行反馈和运行状态",
    },
    {
      name: "X103",
      type: "BOOL",
      scope: "VAR",
      comment: "1号电机故障信号",
    },
    {
      name: "AxisData",
      type: "AXIS_REF",
      scope: "VAR",
      comment: "送料轴引用",
    },
    {
      name: "Wrong_Run_Feedback",
      type: "REAL",
      scope: "VAR",
      comment: "1号电机运行反馈",
    },
    {
      name: "Wrong_PV",
      type: "BOOL",
      scope: "VAR",
    },
  ]);

  const hasRole = (variableName, role) =>
    matches.some(
      (match) =>
        match.variableName === variableName && match.role === role,
    );
  assert.ok(hasRole("TIC101_IN", "processValue"));
  assert.ok(hasRole("TIC101_REF", "setpoint"));
  assert.ok(hasRole("TIC101_OUT", "manipulatedValue"));
  assert.ok(hasRole("X101", "commandSignal"));
  assert.ok(hasRole("X102", "runFeedback"));
  assert.ok(hasRole("X103", "faultSignal"));
  assert.ok(hasRole("AxisData", "axisReference"));
  assert.ok(
    !hasRole("Wrong_Run_Feedback", "runFeedback"),
    "REAL must not be accepted as a BOOL run-feedback signal",
  );
  assert.ok(
    !hasRole("Wrong_PV", "processValue"),
    "legacy suffix matching must keep its REAL/LREAL type constraint",
  );

  const commentMatch = matches.find(
    (match) =>
      match.variableName === "TIC101_IN" &&
      match.role === "processValue",
  );
  assert.deepStrictEqual(commentMatch?.matchedSources, ["comment"]);
  assert.equal(commentMatch?.score, 5);
  assert.ok(commentMatch?.groupKeys.includes("tic101"));

  const multiSourceMatch = matches.find(
    (match) =>
      match.variableName === "X101" && match.role === "commandSignal",
  );
  assert.deepStrictEqual(multiSourceMatch?.matchedSources, ["comment", "label"]);
  assert.equal(
    multiSourceMatch?.score,
    10,
    "independent variable fields should contribute separate evidence",
  );

  const singleSourceMatch = matches.find(
    (match) =>
      match.variableName === "X102" && match.role === "runFeedback",
  );
  assert.deepStrictEqual(singleSourceMatch?.matchedSources, ["note"]);
  assert.equal(
    singleSourceMatch?.score,
    5,
    "multiple synonyms in the same field must not stack evidence",
  );
}

async function assertLoopSignatureCases() {
  const completeSuggestions = await suggestionsFor(
    loopSignatureFixturePath,
    "segment-temperature-pid-complete",
    "temperature-pid-contact",
  );
  assert.ok(
    functionBlockTypes(completeSuggestions).includes("PID"),
    "complete temperature PID signature should recommend PID",
  );

  const commentRoleSuggestions = await suggestionsFor(
    loopSignatureFixturePath,
    "segment-temperature-pid-comment-roles",
    "temperature-pid-comment-contact",
  );
  assert.ok(
    functionBlockTypes(commentRoleSuggestions).includes("PID"),
    "variable comments/labels/notes should satisfy the same loop signature without PV/SP/MV suffixes",
  );

  const unrelatedSegmentSuggestions = await suggestionsFor(
    loopSignatureFixturePath,
    "segment-temperature-pid-unrelated",
    "temperature-pid-unrelated-contact",
  );
  assert.ok(
    !functionBlockTypes(unrelatedSegmentSuggestions).includes("PID"),
    "complete POU-level PID variables must not trigger PID in an unrelated segment",
  );

  const missingRoleSuggestions = await suggestionsFor(
    loopSignatureFixturePath,
    "segment-temperature-pid-missing-sp",
    "temperature-pid-missing-contact",
  );
  assert.ok(
    !functionBlockTypes(missingRoleSuggestions).includes("PID"),
    "temperature PID signature without SP must not recommend PID",
  );

  const crossGroupSuggestions = await suggestionsFor(
    loopSignatureFixturePath,
    "segment-temperature-pid-cross-group",
    "temperature-pid-cross-contact",
  );
  assert.ok(
    !functionBlockTypes(crossGroupSuggestions).includes("PID"),
    "PV/SP/MV from different inferred groups must not recommend PID",
  );

  const wrongTypeSuggestions = await suggestionsFor(
    loopSignatureFixturePath,
    "segment-temperature-pid-wrong-output",
    "temperature-pid-wrong-contact",
  );
  assert.ok(
    !functionBlockTypes(wrongTypeSuggestions).includes("PID"),
    "temperature PID signature with a BOOL manipulated value must not recommend PID",
  );

  const falsePhysicalSuggestions = await suggestionsFor(
    loopSignatureFixturePath,
    "segment-temperature-pid-false-physical",
    "temperature-pid-false-contact",
  );
  assert.ok(
    !functionBlockTypes(falsePhysicalSuggestions).includes("PID"),
    "temp must use an identifier boundary and must not match Attempt",
  );

  const legacySuggestions = await suggestionsFor(
    loopSignatureFixturePath,
    "segment-legacy-pid-terms",
    "legacy-pid-contact",
  );
  assert.ok(
    functionBlockTypes(legacySuggestions).includes("PID"),
    "legacy term-based PID rule must remain available",
  );

  for (const suggestion of [
    ...completeSuggestions,
    ...commentRoleSuggestions,
    ...legacySuggestions,
  ]) {
    assertSuggestionUsesLibraryElement(suggestion);
  }
}

async function assertStableBusinessCases() {
  const tonSuggestions = await suggestionsFor(
    fixturePath,
    "segment-ton",
    "ton-contact",
  );
  const tonBlocks = functionBlockTypes(tonSuggestions);
  assert.ok(tonBlocks.length > 0, "TON case should return a function block");
  assert.deepStrictEqual([...new Set(tonBlocks)], ["TON"]);

  const regexTonSuggestions = await suggestionsFor(
    fixturePath,
    "segment-ton-regex",
    "ton-regex-contact",
  );
  assert.deepStrictEqual(
    [...new Set(functionBlockTypes(regexTonSuggestions))],
    ["TON"],
    "onDelay should imply timer without treating TP inside Stop as a pulse",
  );

  const ordinaryResetSuggestions = await suggestionsFor(
    fixturePath,
    "segment-ordinary-reset",
    "reset-contact",
  );
  assert.ok(
    !functionBlockTypes(ordinaryResetSuggestions).includes("MC_RESET"),
    "ordinary reset without AXIS_REF must not return MC_Reset",
  );

  const axisResetSuggestions = await suggestionsFor(
    fixturePath,
    "segment-axis-reset",
    "axis-reset-contact",
  );
  assert.ok(
    functionBlockTypes(axisResetSuggestions).includes("MC_RESET"),
    "axis reset with local AXIS_REF should return MC_Reset",
  );
  const axisResetSuggestion = findFunctionBlockSuggestion(
    axisResetSuggestions,
    "MC_RESET",
  );
  assert.ok(axisResetSuggestion, "MC_Reset suggestion should be available");
  const axisResetNode = firstAddedNode(axisResetSuggestion);
  const axisInput = axisResetNode.childrenNode.portInputs.find(
    (port) => port.name === "Axis",
  );
  assert.equal(axisInput?.scope, "VAR_IN_OUT");
  assert.ok(
    !axisResetNode.childrenNode.portOutputs.some(
      (port) => port.name === "Axis",
    ),
    "MC_Reset Axis must not be duplicated in portOutputs",
  );

  const limitSuggestions = await suggestionsFor(
    fixturePath,
    "segment-limit",
    "limit-contact",
  );
  assert.ok(
    functionBlockTypes(limitSuggestions).includes("LIMIT"),
    "numeric limit case should return LIMIT function",
  );

  const stringLeftSuggestions = await suggestionsFor(
    fixturePath,
    "segment-string-left",
    "string-left-contact",
  );
  assert.deepStrictEqual(
    [...new Set(functionBlockTypes(stringLeftSuggestions))],
    ["LEFT"],
    "STRING data type should derive the string term without a text keyword dependency",
  );

  const duplicateStopSuggestions = await suggestionsFor(
    fixturePath,
    "segment-existing-stop",
    "existing-stop-contact",
  );
  assert.ok(
    !functionBlockTypes(duplicateStopSuggestions).includes("MC_STOP"),
    "existing adjacent MC_Stop must not be suggested again",
  );

  const bidirectionalCounterSuggestions = await suggestionsFor(
    fixturePath,
    "segment-bidirectional-counter",
    "bidirectional-contact",
  );
  assert.deepStrictEqual(
    [...new Set(functionBlockTypes(bidirectionalCounterSuggestions))],
    ["CTUD"],
    "explicit bidirectional counting should return CTUD without separate up/down terms",
  );

  const genericLatchSuggestions = await suggestionsFor(
    fixturePath,
    "segment-latch-generic",
    "latch-generic-contact",
  );
  assert.ok(
    !functionBlockTypes(genericLatchSuggestions).some((blockType) =>
      ["SR", "RS"].includes(blockType),
    ),
    "latch context without an explicit priority must not choose SR or RS",
  );

  const setDominantSuggestions = await suggestionsFor(
    fixturePath,
    "segment-latch-set-dominant",
    "latch-set-contact",
  );
  assert.deepStrictEqual(
    [...new Set(functionBlockTypes(setDominantSuggestions))],
    ["SR"],
    "set-dominant latch should return SR",
  );

  const resetDominantSuggestions = await suggestionsFor(
    fixturePath,
    "segment-latch-reset-dominant",
    "latch-reset-contact",
  );
  assert.deepStrictEqual(
    [...new Set(functionBlockTypes(resetDominantSuggestions))],
    ["RS"],
    "reset-dominant latch should return RS",
  );

  const motionStopSuggestions = await suggestionsFor(
    fixturePath,
    "segment-motion-stop",
    "motion-stop-contact",
  );
  assert.ok(functionBlockTypes(motionStopSuggestions).includes("MC_STOP"));
  assert.ok(!functionBlockTypes(motionStopSuggestions).includes("MC_HALT"));
  assert.ok(
    !suggestedNodeTypes(motionStopSuggestions).includes("negatedContact"),
    "MC_Stop command triggering must keep a normal contact",
  );

  const motionHaltSuggestions = await suggestionsFor(
    fixturePath,
    "segment-motion-halt",
    "motion-halt-contact",
  );
  assert.ok(functionBlockTypes(motionHaltSuggestions).includes("MC_HALT"));
  assert.ok(!functionBlockTypes(motionHaltSuggestions).includes("MC_STOP"));

  const faultPermissiveSuggestions = await suggestionsFor(
    fixturePath,
    "segment-fault-permissive",
    "fault-permissive-contact",
  );
  const faultPermissiveTypes = suggestedNodeTypes(
    faultPermissiveSuggestions,
  );
  assert.equal(
    faultPermissiveTypes[0],
    "negatedContact",
    "fault/stop inhibition in a run permissive should prefer a negated contact",
  );
  assert.ok(faultPermissiveTypes.includes("contact"));
  assert.ok(faultPermissiveTypes.includes("negatedContact"));
  assert.ok(
    faultPermissiveSuggestions.length > 6,
    "business-rich contexts should not be truncated to six suggestions before ranking",
  );

  const estopOkSuggestions = await suggestionsFor(
    fixturePath,
    "segment-estop-ok-permissive",
    "estop-ok-contact",
  );
  assert.ok(suggestedNodeTypes(estopOkSuggestions).includes("contact"));
  assert.ok(
    !suggestedNodeTypes(estopOkSuggestions).includes("negatedContact"),
    "positive-logic EStop_OK must not be inverted just because its name contains stop",
  );

  const guardClosedSuggestions = await suggestionsFor(
    fixturePath,
    "segment-guard-closed-permissive",
    "guard-closed-contact",
  );
  assert.ok(suggestedNodeTypes(guardClosedSuggestions).includes("contact"));
  assert.ok(
    !suggestedNodeTypes(guardClosedSuggestions).includes("negatedContact"),
    "CamelCase GuardInterlockClosed must be recognized as a positive-logic permissive",
  );

  const faultOnlyCoilSuggestions = await suggestionsFor(
    fixturePath,
    "segment-fault-only-coil",
    "fault-coil",
  );
  assert.notEqual(
    firstAddedNode(faultOnlyCoilSuggestions[0])?.type,
    "resetCoil",
    "fault without reset intent must not rank resetCoil first",
  );
  assert.ok(
    !suggestedNodeTypes(faultOnlyCoilSuggestions).includes("negatedContact"),
    "fault alarm output activation is not a permissive and should keep a normal contact",
  );

  const resetCoilSuggestions = await suggestionsFor(
    fixturePath,
    "segment-reset-coil",
    "reset-coil",
  );
  assert.equal(
    firstAddedNode(resetCoilSuggestions[0])?.type,
    "resetCoil",
    "explicit reset intent should rank resetCoil first",
  );

  const crossSegmentStopSuggestions = await suggestionsFor(
    fixturePath,
    "segment-cross-stop-focus",
    "cross-stop-focus-contact",
  );
  assert.ok(
    !functionBlockTypes(crossSegmentStopSuggestions).includes("MC_STOP"),
    "non-adjacent related segment with the same request and axis should suppress duplicate MC_Stop",
  );

  const otherAxisStopSuggestions = await suggestionsFor(
    fixturePath,
    "segment-cross-stop-other-axis",
    "cross-stop-other-contact",
  );
  assert.ok(
    functionBlockTypes(otherAxisStopSuggestions).includes("MC_STOP"),
    "MC_Stop in another segment must not suppress a suggestion for a different axis and request",
  );

  const unrelatedAdjacentSuggestions = await suggestionsFor(
    fixturePath,
    "segment-cross-unrelated",
    "cross-unrelated-contact",
  );
  assert.ok(
    !functionBlockTypes(unrelatedAdjacentSuggestions).includes("TON"),
    "related-segment timer terms must not trigger TON without local timer intent",
  );

  for (const suggestion of [
    ...tonSuggestions,
    ...regexTonSuggestions,
    ...ordinaryResetSuggestions,
    ...axisResetSuggestions,
    ...limitSuggestions,
    ...stringLeftSuggestions,
    ...bidirectionalCounterSuggestions,
    ...genericLatchSuggestions,
    ...setDominantSuggestions,
    ...resetDominantSuggestions,
    ...motionStopSuggestions,
    ...motionHaltSuggestions,
    ...faultPermissiveSuggestions,
    ...estopOkSuggestions,
    ...guardClosedSuggestions,
    ...crossSegmentStopSuggestions,
    ...otherAxisStopSuggestions,
    ...unrelatedAdjacentSuggestions,
  ]) {
    assertSuggestionUsesLibraryElement(suggestion);
  }
}

async function assertTimestampDiagramWhenAvailable() {
  const diagramPath = findLatestTimestampDiagram();
  if (!diagramPath) {
    console.log("[test-business-rules] timestamp diagram not found; sample check skipped");
    return;
  }

  const summary = await loadDiagramSummary(diagramPath);
  const timeoutSegment = summary.segments.find((segment) =>
    String(segment.label).includes("主仓上料最大时间检测"),
  );
  if (timeoutSegment) {
    const focus = timeoutSegment.nodes.find((node) => node.var === "Valve_Main");
    if (focus) {
      const suggestions = await suggestionsFor(
        diagramPath,
        timeoutSegment.segmentId,
        focus.id,
      );
      const blocks = functionBlockTypes(suggestions);
      assert.ok(blocks.length > 0, "real timeout segment should suggest TON");
      assert.deepStrictEqual([...new Set(blocks)], ["TON"]);
    }
  }

  const resetSegment = summary.segments.find((segment) =>
    String(segment.label).includes("故障确认复位"),
  );
  if (resetSegment) {
    const focus = resetSegment.nodes.find((node) => node.var === "Reset_Button");
    if (focus) {
      const suggestions = await suggestionsFor(
        diagramPath,
        resetSegment.segmentId,
        focus.id,
      );
      assert.ok(
        !functionBlockTypes(suggestions).includes("MC_RESET"),
        "real ordinary reset segment must not suggest MC_Reset",
      );
    }
  }
}

async function suggestionsFor(diagramPath, segmentId, selectedNodeId) {
  const result = await getLocalGraphSuggestions({
    diagramPath,
    segmentId,
    selectedNodeId,
  });
  return result?.payload?.suggestions ?? [];
}

function functionBlockTypes(suggestions) {
  return suggestions
    .map(firstAddedNode)
    .filter((node) => node?.type === "FBDCompartment")
    .map((node) => String(node.childrenNode?.type ?? "").toUpperCase());
}

function suggestedNodeTypes(suggestions) {
  return suggestions
    .map(firstAddedNode)
    .filter(Boolean)
    .map((node) => String(node.type ?? ""));
}

function assertSuggestionUsesLibraryElement(suggestion) {
  const node = firstAddedNode(suggestion);
  if (node?.type !== "FBDCompartment") {
    return;
  }

  const blockType = String(node.childrenNode?.type ?? "").toUpperCase();
  const libraryElement = libraryElements.get(blockType);
  assert.ok(libraryElement, `suggestion returned missing library element: ${blockType}`);
  assert.equal(
    Boolean(node.childrenNode?.isFunction),
    libraryElement.type === "function",
    `${blockType} function/functionBlock type must match st-library-info-data.json`,
  );
  const expectedPorts = expectedLibraryPorts(libraryElement);
  assert.deepStrictEqual(
    node.childrenNode?.portInputs,
    expectedPorts.portInputs,
    `${blockType} input ports must match normalized library ports`,
  );
  assert.deepStrictEqual(
    node.childrenNode?.portOutputs,
    expectedPorts.portOutputs,
    `${blockType} output ports must match normalized library ports`,
  );
}

function expectedLibraryPorts(libraryElement) {
  const inputs = libraryElement.inputs ?? [];
  const outputs = libraryElement.outputs ?? [];

  return {
    portInputs: [
      { name: "EN", value: "", type: "", scope: "" },
      ...inputs
        .filter(([name]) => String(name).toUpperCase() !== "EN")
        .map((port) => {
          const expectedPort = expectedLibraryPort(port, "VAR_INPUT");
          return hasMatchingLibraryPort(outputs, port)
            ? { ...expectedPort, scope: "VAR_IN_OUT" }
            : expectedPort;
        }),
    ],
    portOutputs: [
      { name: "ENO", value: "", type: "", scope: "" },
      ...outputs
        .filter(([name]) => String(name).toUpperCase() !== "ENO")
        .filter((port) => !hasMatchingLibraryPort(inputs, port))
        .map((port) => expectedLibraryPort(port, "VAR_OUTPUT")),
    ],
  };
}

function hasMatchingLibraryPort(ports, [candidateName, candidateType]) {
  return ports.some(
    ([name, type]) => name === candidateName && type === candidateType,
  );
}

function expectedLibraryPort([name, type, scope], defaultScope) {
  return {
    name,
    value: name === "EN" || name === "ENO" ? "" : "???",
    type,
    scope: scope && scope !== "none" ? scope : defaultScope,
  };
}

function findFunctionBlockSuggestion(suggestions, blockType) {
  return suggestions.find((suggestion) => {
    const node = firstAddedNode(suggestion);
    return (
      node?.type === "FBDCompartment" &&
      String(node.childrenNode?.type ?? "").toUpperCase() === blockType
    );
  });
}

function firstAddedNode(suggestion) {
  return Object.values(suggestion?.addNode ?? {})[0];
}

function findLatestTimestampDiagram() {
  const extensionDir =
    process.env.IDE_AGENT_TIMESTAMP_DIAGRAM_DIR ||
    "C:\\Users\\Administrator\\.vscode\\extensions\\ytak.devuni-ide-vscode-1.0.21";
  if (!fs.existsSync(extensionDir)) {
    return undefined;
  }

  return fs
    .readdirSync(extensionDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d+\.txt$/.test(entry.name))
    .map((entry) => path.join(extensionDir, entry.name))
    .sort(
      (left, right) =>
        fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs,
    )[0];
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

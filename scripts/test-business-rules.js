#!/usr/bin/env node

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  getLocalGraphSuggestions,
  loadDiagramSummary,
  summarizeDiagramJson,
} = require("../dist/node_modules/@ide-agent/core");
const {
  collectBlockInstances,
  evaluateLoopSignatures,
  evaluateVariableRoles,
  parseBlockPortRoleRules,
  parseLoopSignatures,
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
  assertExplicitIdGroupingCases();
  assertGenericMissingTargetCases();
  assertBlockPortRoleCases();
  await assertExpandedBusinessCoverageCases();
  await assertStableBusinessCases();
  await assertLoopSignatureCases();
  await assertTimestampDiagramWhenAvailable();
  console.log("[test-business-rules] passed");
}

function assertActiveRuleCandidatesExistInLibrary() {
  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  assert.equal(rules.schemaVersion, "ide-agent.business-rules.v9");
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
    ...(rules.blockPortRoleRules ?? []).flatMap((rule) =>
      (rule.ports ?? []).flatMap((port) => [
        ...(port.role ? [port.role] : []),
        ...(port.roles ?? []),
      ]),
    ),
  ]);
  const signatureIds = new Set(
    (rules.loopSignatures ?? []).map((signature) => signature.id),
  );
  const signaturesById = new Map(
    (rules.loopSignatures ?? []).map((signature) => [signature.id, signature]),
  );
  for (const rule of rules.blockPortRoleRules ?? []) {
    assert.ok(rule.id, "block port role rule must define id");
    assert.ok(rule.blockTypes?.length > 0, `${rule.id} must define blockTypes`);
    assert.ok(rule.ports?.length > 0, `${rule.id} must define ports`);
    const ruleLibraryElements = rule.blockTypes.map((blockType) => {
      const element = libraryElements.get(
        String(blockType).toUpperCase(),
      );
      assert.ok(
        element,
        `${rule.id} references missing st-library-info element: ${blockType}`,
      );
      return element;
    });
    for (const portRule of rule.ports) {
      const direction = String(portRule.direction ?? "any").toLowerCase();
      assert.ok(
        ruleLibraryElements.some((libraryElement) => {
          const candidatePorts = [
            ...(direction === "output" ? [] : libraryElement.inputs ?? []),
            ...(direction === "input" ? [] : libraryElement.outputs ?? []),
          ];
          return candidatePorts.some(
            ([name]) =>
              String(name).toUpperCase() ===
              String(portRule.port).toUpperCase(),
          );
        }),
        `${rule.id} references missing ${direction} port ${portRule.port}`,
      );
      assert.ok(
        portRule.role || portRule.roles?.length > 0,
        `${rule.id}/${portRule.port} must define a role`,
      );
    }
  }
  assert.ok(definedRoles.has("processValue"));
  assert.ok(definedRoles.has("setpoint"));
  assert.ok(definedRoles.has("manipulatedValue"));
  assert.ok(signatureIds.has("LS05-temperature-pid-missing-controller"));
  for (const signature of rules.loopSignatures ?? []) {
    if ((signature.kind ?? "completion") === "completion") {
      assert.ok(
        signature.targetBlockTypes?.length > 0,
        `${signature.id} completion signature must define targetBlockTypes`,
      );
    }
    for (const targetBlockType of signature.targetBlockTypes ?? []) {
      assert.ok(
        libraryElements.has(String(targetBlockType).toUpperCase()),
        `${signature.id} references missing target block: ${targetBlockType}`,
      );
    }
    for (const role of [
      ...(signature.requiredRolesAll ?? []),
      ...(signature.evidenceRolesAny ?? []),
      ...(signature.missingRolesAny ?? []),
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
    ...(rules.nodeIntentRules ?? []),
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

  const allowedNodeIntentTypes = new Set([
    "contact",
    "negatedContact",
    "risingContact",
    "fallingContact",
    "coil",
    "setCoil",
    "resetCoil",
  ]);
  const allowedPositions = new Set([
    "front",
    "behind",
    "outsideFront",
    "outsideBehind",
    "parallel",
    "replace",
  ]);
  assert.ok(
    rules.nodeIntentRules?.length > 0,
    "nodeIntentRules must define business presentations for graph nodes",
  );
  for (const rule of rules.nodeIntentRules ?? []) {
    assert.ok(rule.businessName, `${rule.id} must define businessName`);
    assert.ok(
      Number.isFinite(rule.minimumEvidenceCount) &&
        rule.minimumEvidenceCount >= 2,
      `${rule.id} must use the shared strict evidence threshold`,
    );
    for (const nodeType of rule.nodeTypes ?? []) {
      assert.ok(
        allowedNodeIntentTypes.has(nodeType),
        `${rule.id} references unsupported node type: ${nodeType}`,
      );
    }
    for (const position of rule.positions ?? []) {
      assert.ok(
        allowedPositions.has(position),
        `${rule.id} references unsupported position: ${position}`,
      );
    }
    for (const role of [
      ...(rule.actionRolesAny ?? []),
      ...(rule.chainRolesAny ?? []),
    ]) {
      assert.ok(
        definedRoles.has(role),
        `${rule.id} references undefined variable role: ${role}`,
      );
    }
    assertBusinessPresentation(rule.id, rule.presentation);
  }

  for (const rule of rules.libraryRules ?? []) {
    if (String(rule.status).toLowerCase() !== "active") {
      continue;
    }
    if (rule.presentation) {
      assertBusinessPresentation(rule.id, rule.presentation);
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
      assert.equal(
        signaturesById.get(signatureId)?.kind ?? "completion",
        "completion",
        `${rule.id} must not use observed signature ${signatureId} as a recommendation gate`,
      );
    }
    if (rule.signatureRefsAny?.length > 0) {
      const referencedTargets = new Set(
        rule.signatureRefsAny.flatMap(
          (signatureId) =>
            signaturesById.get(signatureId)?.targetBlockTypes ?? [],
        ).map((target) => String(target).toUpperCase()),
      );
      for (const candidateName of rule.candidateNames ?? []) {
        assert.ok(
          referencedTargets.has(String(candidateName).toUpperCase()),
          `${rule.id} candidate ${candidateName} is not a target of its completion signatures`,
        );
      }
    }
    for (const blockType of rule.excludedExistingBlockTypes ?? []) {
      assert.ok(
        libraryElements.has(String(blockType).toUpperCase()),
        `${rule.id} excludes missing st-library-info element: ${blockType}`,
      );
    }
    if (rule.id.startsWith("MC") && !(rule.signatureRefsAny?.length > 0)) {
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

function assertExplicitIdGroupingCases() {
  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  const variablePatterns = parseVariablePatterns(rules.variablePatterns);
  const loopSignatures = parseLoopSignatures(rules.loopSignatures);
  const explicitVariables = [
    {
      name: "Actual_Reading",
      type: "REAL",
      scope: "VAR",
      deviceId: "Tank-01",
      groupId: "Temperature-Control",
      comment: "temperature actual value",
    },
    {
      name: "Target_Command",
      type: "REAL",
      scope: "VAR",
      deviceId: "Tank-01",
      groupId: "Temperature-Control",
      comment: "temperature target value",
    },
    {
      name: "Valve_Demand",
      type: "REAL",
      scope: "VAR",
      deviceId: "Tank-01",
      groupId: "Temperature-Control",
      comment: "temperature control output",
    },
    {
      name: "Controller_Kp",
      type: "REAL",
      scope: "VAR",
      deviceId: "Tank-01",
      groupId: "Temperature-Control",
      comment: "PID gain",
    },
  ];
  const summary = summarizeDiagramJson(
    [
      {
        pouName: "EXPLICIT_GROUP_TEST",
        pouType: "PROGRAM",
        variableList: explicitVariables,
        segmentList: [],
      },
    ],
    "memory://explicit-group-test",
  );
  const variables = summary.variablesByPou.EXPLICIT_GROUP_TEST;
  assert.equal(variables[0].deviceId, "Tank-01");
  assert.equal(variables[0].groupId, "Temperature-Control");

  const expectedGroupKey =
    "group:device:tank_01:id:temperature_control";
  const expectedDeviceKey = "device:id:tank_01";
  const roleMatches = evaluateVariableRoles(variablePatterns, variables);
  for (const variableName of [
    "Actual_Reading",
    "Target_Command",
    "Valve_Demand",
    "Controller_Kp",
  ]) {
    assert.ok(
      roleMatches
        .filter((match) => match.variableName === variableName)
        .some(
          (match) =>
            match.groupKeys.includes(expectedGroupKey) &&
            match.groupKeys.includes(expectedDeviceKey),
        ),
      `${variableName} should retain separate device and loop groups`,
    );
  }

  const explicitMatches = evaluateLoopSignatures(
    variablePatterns,
    loopSignatures,
    variables,
    ["Tank temperature PID loop"],
    new Set(["pid"]),
  ).filter(
    (match) => match.id === "LS05-temperature-pid-missing-controller",
  );
  assert.equal(explicitMatches.length, 1);
  assert.equal(explicitMatches[0].groupStrategy, "groupId");
  assert.equal(explicitMatches[0].groupKey, expectedGroupKey);

  const sharedPrefixNames = [
    "Shared_Loop_PV",
    "Shared_Loop_SP",
    "Shared_Loop_MV",
    "Shared_Loop_Kp",
  ];
  const splitGroupVariables = explicitVariables.map((variable, index) => ({
    ...variable,
    name: sharedPrefixNames[index],
    groupId: index === 1 ? "Temperature-Control-B" : variable.groupId,
  }));
  const splitGroupMatches = evaluateLoopSignatures(
    variablePatterns,
    loopSignatures,
    splitGroupVariables,
    ["Tank temperature PID loop"],
    new Set(["pid"]),
  ).filter(
    (match) => match.id === "LS05-temperature-pid-missing-controller",
  );
  assert.equal(
    splitGroupMatches.length,
    0,
    "conflicting groupId values must override a shared name prefix",
  );
}

function assertGenericMissingTargetCases() {
  const variablePatterns = parseVariablePatterns({
    suffixRoles: [
      {
        suffix: "_Condition",
        role: "conditionSignal",
        acceptedDataTypes: ["BOOL"],
      },
      {
        suffix: "_Delay",
        role: "presetDuration",
        acceptedDataTypes: ["TIME"],
      },
    ],
  });
  const signatures = parseLoopSignatures([
    {
      id: "TEST-missing-timer",
      kind: "completion",
      status: "active",
      groupStrategies: ["groupId", "namePrefix"],
      requiredRolesAll: ["conditionSignal", "presetDuration"],
      requiredRoleTypes: {
        conditionSignal: ["BOOL"],
        presetDuration: ["TIME"],
      },
      targetBlockTypes: ["TON"],
    },
  ]);
  const variables = [
    {
      name: "A_Start_Condition",
      type: "BOOL",
      scope: "VAR",
      deviceId: "Conveyor-A",
      groupId: "Start-Delay",
    },
    {
      name: "A_Start_Delay",
      type: "TIME",
      scope: "VAR",
      deviceId: "Conveyor-A",
      groupId: "Start-Delay",
    },
    {
      name: "B_Start_Condition",
      type: "BOOL",
      scope: "VAR",
      deviceId: "Conveyor-B",
      groupId: "Start-Delay",
    },
    {
      name: "B_Start_Delay",
      type: "TIME",
      scope: "VAR",
      deviceId: "Conveyor-B",
      groupId: "Start-Delay",
    },
  ];
  const timerInstances = collectBlockInstances([
    summarizeDiagramJson(
      [
        {
          pouName: "GENERIC_TARGET_TEST",
          pouType: "PROGRAM",
          variableList: variables,
          segmentList: [
            blockRoleTestSegment(
              "segment-existing-ton-a",
              "Conveyor A start delay",
              "ton-a",
              "TON",
              "Timer_A",
              [
                testPort(
                  "IN",
                  "A_Start_Condition",
                  "BOOL",
                  "VAR_INPUT",
                ),
                testPort("PT", "A_Start_Delay", "TIME", "VAR_INPUT"),
              ],
              [],
            ),
          ],
        },
      ],
      "memory://generic-target-test",
    ).segments[0],
  ]);

  const matches = (focusVariableName) =>
    evaluateLoopSignatures(
      variablePatterns,
      signatures,
      variables,
      [],
      new Set(),
      [],
      timerInstances,
      [focusVariableName],
    );
  assert.equal(
    matches("A_Start_Condition").length,
    0,
    "an existing TON must suppress completion only for conveyor A",
  );
  const conveyorBMatches = matches("B_Start_Condition");
  assert.equal(conveyorBMatches.length, 1);
  assert.equal(conveyorBMatches[0].groupStrategy, "groupId");
  assert.deepStrictEqual(conveyorBMatches[0].targetBlockTypes, ["TON"]);

  const nameFallbackMatches = evaluateLoopSignatures(
    variablePatterns,
    signatures,
    [
      { name: "Conveyor_Condition", type: "BOOL", scope: "VAR" },
      { name: "Conveyor_Delay", type: "TIME", scope: "VAR" },
    ],
    [],
    new Set(),
  );
  assert.equal(nameFallbackMatches.length, 1);
  assert.equal(nameFallbackMatches[0].groupStrategy, "namePrefix");

  const partialIdMatches = evaluateLoopSignatures(
    variablePatterns,
    signatures,
    [
      {
        name: "Conveyor_Condition",
        type: "BOOL",
        scope: "VAR",
        deviceId: "Conveyor-01",
        groupId: "Start-Delay",
      },
      { name: "Conveyor_Delay", type: "TIME", scope: "VAR" },
    ],
    [],
    new Set(),
    [],
    [],
    ["Conveyor_Condition"],
  );
  assert.equal(partialIdMatches.length, 1);
  assert.equal(
    partialIdMatches[0].groupStrategy,
    "namePrefix",
    "partial explicit metadata must still allow name-prefix fallback",
  );

  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  const configuredVariablePatterns = parseVariablePatterns(
    rules.variablePatterns,
  );
  const configuredSignatures = parseLoopSignatures(rules.loopSignatures);
  const configuredPortRules = parseBlockPortRoleRules(
    rules.blockPortRoleRules,
  );
  const motionVariables = [
    {
      name: "Feed_Axis",
      type: "AXIS_REF",
      scope: "VAR",
      deviceId: "Feed-Axis-01",
      groupId: "Controlled-Stop",
    },
    {
      name: "Feed_Stop_Request",
      type: "BOOL",
      scope: "VAR",
      deviceId: "Feed-Axis-01",
      groupId: "Controlled-Stop",
    },
    {
      name: "Feed_Stop_Deceleration",
      type: "LREAL",
      scope: "VAR",
      deviceId: "Feed-Axis-01",
      groupId: "Controlled-Stop",
    },
  ];
  const motionCompletionMatches = evaluateLoopSignatures(
    configuredVariablePatterns,
    configuredSignatures,
    motionVariables,
    ["Feed axis controlled stop"],
    new Set(["motion", "axis", "stop"]),
    configuredPortRules,
    [],
    ["Feed_Stop_Request"],
  ).filter((match) => match.id === "LS09-motion-stop-missing-block");
  assert.equal(motionCompletionMatches.length, 1);
  assert.deepStrictEqual(motionCompletionMatches[0].targetBlockTypes, [
    "MC_Stop",
  ]);
}

function assertBlockPortRoleCases() {
  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  const variablePatterns = parseVariablePatterns(rules.variablePatterns);
  const blockPortRoleRules = parseBlockPortRoleRules(
    rules.blockPortRoleRules,
  );
  const loopSignatures = parseLoopSignatures(rules.loopSignatures);
  const summary = summarizeDiagramJson(
    [
      {
        pouName: "PORT_ROLE_TEST",
        pouType: "PROGRAM",
        variableList: [
          { name: "Pid_Tank_Temp", type: "PID", scope: "VAR" },
          { name: "Tank_Temp_PV", type: "REAL", scope: "VAR", comment: "实际温度" },
          { name: "Temp_SP", type: "REAL", scope: "VAR", comment: "温度设定值" },
          { name: "Pid_Xout", type: "REAL", scope: "VAR", comment: "PID输出" },
          { name: "Pid_Kp", type: "REAL", scope: "VAR" },
          { name: "Axis_1", type: "AXIS_REF", scope: "VAR" },
          { name: "Stop_Request_1", type: "BOOL", scope: "VAR" },
          { name: "Stop_Done_1", type: "BOOL", scope: "VAR" },
          { name: "Axis_2", type: "AXIS_REF", scope: "VAR" },
          { name: "Stop_Request_2", type: "BOOL", scope: "VAR" },
          { name: "Stop_Done_2", type: "BOOL", scope: "VAR" },
          { name: "Delay_Enable", type: "BOOL", scope: "VAR" },
          { name: "Delay_Time", type: "TIME", scope: "VAR" },
          { name: "Delay_Done", type: "BOOL", scope: "VAR" },
          { name: "Raw_Value", type: "REAL", scope: "VAR" },
          { name: "Low_Limit", type: "REAL", scope: "VAR" },
          { name: "High_Limit", type: "REAL", scope: "VAR" },
          { name: "Limited_Value", type: "REAL", scope: "VAR" },
        ],
        segmentList: [
          blockRoleTestSegment(
            "segment-port-role-pid",
            "Temperature PID control",
            "pid-node",
            "PID",
            "Pid_Tank_Temp",
            [
              testPort("PV", "Tank_Temp_PV", "REAL", "VAR_INPUT"),
              testPort("SP", "Temp_SP", "REAL", "VAR_INPUT"),
              testPort("KP", "Pid_Kp", "REAL", "VAR_INPUT"),
            ],
            [testPort("XOUT", "Pid_Xout", "REAL", "VAR_OUTPUT")],
          ),
          blockRoleTestSegment(
            "segment-port-role-stop-1",
            "Axis 1 controlled stop",
            "stop-node-1",
            "MC_Stop",
            "Stop_Axis_1",
            [
              testPort("Axis", "Axis_1", "AXIS_REF", "VAR_IN_OUT"),
              testPort("Execute", "Stop_Request_1", "BOOL", "VAR_INPUT"),
            ],
            [
              testPort("Axis", "Axis_1", "AXIS_REF", "VAR_IN_OUT"),
              testPort("Done", "Stop_Done_1", "BOOL", "VAR_OUTPUT"),
            ],
          ),
          blockRoleTestSegment(
            "segment-port-role-stop-2",
            "Axis 2 controlled stop",
            "stop-node-2",
            "MC_Stop",
            "Stop_Axis_2",
            [
              testPort("Axis", "Axis_2", "AXIS_REF", "VAR_IN_OUT"),
              testPort("Execute", "Stop_Request_2", "BOOL", "VAR_INPUT"),
            ],
            [
              testPort("Axis", "Axis_2", "AXIS_REF", "VAR_IN_OUT"),
              testPort("Done", "Stop_Done_2", "BOOL", "VAR_OUTPUT"),
            ],
          ),
          blockRoleTestSegment(
            "segment-port-role-ton",
            "Start delay",
            "ton-node",
            "TON",
            "Delay_Timer",
            [
              testPort("IN", "Delay_Enable", "BOOL", "VAR_INPUT"),
              testPort("PT", "Delay_Time", "TIME", "VAR_INPUT"),
            ],
            [testPort("Q", "Delay_Done", "BOOL", "VAR_OUTPUT")],
          ),
          blockRoleTestSegment(
            "segment-port-role-limit",
            "Limit process value",
            "limit-node",
            "LIMIT",
            "",
            [
              testPort("MN", "Low_Limit", "REAL", "VAR_INPUT"),
              testPort("IN", "Raw_Value", "REAL", "VAR_INPUT"),
              testPort("MX", "High_Limit", "REAL", "VAR_INPUT"),
            ],
            [testPort("OUT", "Limited_Value", "REAL", "VAR_OUTPUT")],
            true,
          ),
        ],
      },
    ],
    "memory://port-role-test",
  );
  const instances = collectBlockInstances(summary.segments);
  const matches = evaluateVariableRoles(
    variablePatterns,
    summary.variablesByPou.PORT_ROLE_TEST,
    blockPortRoleRules,
    instances,
  );
  const roleMatch = (variableName, role) =>
    matches.find(
      (match) =>
        match.variableName === variableName && match.role === role,
    );

  const pidOutput = roleMatch("Pid_Xout", "controllerOutput");
  assert.ok(pidOutput, "PID.XOUT must provide controllerOutput role evidence");
  assert.ok(pidOutput.matchedSources.includes("port"));
  assert.ok(roleMatch("Pid_Kp", "controllerParameter"));
  assert.ok(
    !roleMatch("Pid_Kp", "pidController"),
    "REAL PID parameters must not be classified as PID block instances",
  );
  assert.ok(roleMatch("Axis_1", "axisReference")?.matchedSources.includes("port"));
  assert.ok(roleMatch("Stop_Request_1", "commandSignal")?.matchedSources.includes("port"));
  assert.ok(roleMatch("Stop_Done_1", "completionSignal")?.matchedSources.includes("port"));
  assert.ok(roleMatch("Delay_Time", "presetDuration"));
  assert.ok(roleMatch("Limited_Value", "resultValue"));

  const stop1Group = roleMatch("Stop_Request_1", "commandSignal")?.groupKeys.find(
    (groupKey) => groupKey.startsWith("fb:"),
  );
  const stop2Group = roleMatch("Stop_Request_2", "commandSignal")?.groupKeys.find(
    (groupKey) => groupKey.startsWith("fb:"),
  );
  assert.ok(stop1Group && stop2Group && stop1Group !== stop2Group);
  assert.ok(
    roleMatch("Stop_Done_1", "completionSignal")?.groupKeys.includes(stop1Group),
  );
  assert.ok(
    !roleMatch("Stop_Done_2", "completionSignal")?.groupKeys.includes(stop1Group),
    "two MC_Stop instances must not share a port-derived business group",
  );

  const signatureMatches = evaluateLoopSignatures(
    variablePatterns,
    loopSignatures,
    summary.variablesByPou.PORT_ROLE_TEST,
    summary.segments.flatMap((segment) => [segment.label, segment.note]),
    new Set(["pid", "timer", "motion", "motionStop"]),
    blockPortRoleRules,
    instances,
  );
  const observedPid = signatureMatches.find(
    (match) => match.id === "LS02-observed-temperature-controller",
  );
  assert.ok(observedPid, "PID port bindings must match the observed controller signature");
  assert.deepStrictEqual(observedPid.roleVariables.processValue, ["Tank_Temp_PV"]);
  assert.deepStrictEqual(observedPid.roleVariables.setpoint, ["Temp_SP"]);
  assert.deepStrictEqual(observedPid.roleVariables.controllerOutput, ["Pid_Xout"]);

  const observedTimers = signatureMatches.filter(
    (match) => match.id === "LS03-observed-timer",
  );
  assert.equal(observedTimers.length, 1);
  const observedStops = signatureMatches.filter(
    (match) => match.id === "LS04-observed-motion-command",
  );
  assert.equal(observedStops.length, 2);
  for (const match of observedStops) {
    const axes = match.roleVariables.axisReference;
    const commands = match.roleVariables.commandSignal;
    const completions = match.roleVariables.completionSignal;
    assert.equal(axes.length, 1);
    assert.equal(commands.length, 1);
    assert.equal(completions.length, 1);
    assert.equal(axes[0].slice(-1), commands[0].slice(-1));
    assert.equal(axes[0].slice(-1), completions[0].slice(-1));
  }
}

function blockRoleTestSegment(
  id,
  label,
  nodeId,
  blockType,
  instanceName,
  portInputs,
  portOutputs,
  isFunction = false,
) {
  return {
    id,
    label,
    nodesObj: {
      [nodeId]: {
        id: nodeId,
        type: "FBDCompartment",
        sourceIds: [],
        targetIds: [],
        childrenNode: {
          type: blockType,
          isFunction,
          varName: {
            value: instanceName,
            type: blockType,
            scope: "VAR",
          },
          portInputs,
          portOutputs,
        },
      },
    },
  };
}

function testPort(name, value, type, scope) {
  return { name, value, type, scope };
}

async function assertExpandedBusinessCoverageCases() {
  const commonIds = {
    deviceId: "Coverage-Device",
    groupId: "Coverage-Group",
  };
  const diagram = [
    coveragePou(
      "COVERAGE_RAMP",
      "segment-coverage-ramp",
      "输送机速度平滑变化，避免水锤和机械冲击",
      [
        { name: "Ramp_Enable", type: "BOOL", scope: "VAR" },
        { name: "Conveyor_Speed_Actual", type: "REAL", scope: "VAR" },
      ],
    ),
    coveragePou(
      "COVERAGE_HYSTERESIS",
      "segment-coverage-hysteresis",
      "压力在设定值附近小幅波动时避免频繁启停",
      [
        { name: "Pressure_Enable", type: "BOOL", scope: "VAR" },
        { name: "Pressure_Actual", type: "REAL", scope: "VAR" },
        { name: "Pressure_Target", type: "REAL", scope: "VAR" },
      ],
    ),
    coveragePou(
      "COVERAGE_MUX",
      "segment-coverage-mux",
      "按整数索引进行多路选择",
      [
        { name: "Channel_Index", type: "INT", scope: "VAR" },
        { name: "Channel_A", type: "INT", scope: "VAR" },
        { name: "Channel_B", type: "INT", scope: "VAR" },
      ],
    ),
    coveragePou(
      "COVERAGE_LEN",
      "segment-coverage-len",
      "计算完整追溯编号的字符串长度",
      [{ name: "Trace_Code", type: "STRING", scope: "VAR" }],
    ),
    coveragePou(
      "COVERAGE_PROCESS_PID",
      "segment-coverage-process-pid",
      "恒压供水：根据实际压力与目标压力调节水泵速度",
      [
        { name: "Press01_Enable", type: "BOOL", scope: "VAR", ...commonIds },
        { name: "Press01_PV", type: "REAL", scope: "VAR", ...commonIds },
        { name: "Press01_SP", type: "REAL", scope: "VAR", ...commonIds },
        { name: "Press01_Output", type: "REAL", scope: "VAR", ...commonIds },
      ],
    ),
    coveragePou(
      "COVERAGE_FEEDBACK_TIMEOUT",
      "segment-coverage-feedback-timeout",
      "1号泵启动后未收到运行确认则反馈超时报警",
      [
        { name: "Pump1_Start_Request", type: "BOOL", scope: "VAR", ...commonIds },
        { name: "Pump1_Run_Feedback", type: "BOOL", scope: "VAR", ...commonIds },
        { name: "Pump1_Start_Timeout", type: "TIME", scope: "VAR", ...commonIds },
        { name: "Pump1_Start_Fault", type: "BOOL", scope: "VAR", ...commonIds, nodeType: "coil" },
      ],
    ),
    coveragePou(
      "COVERAGE_COMPLETION_TIMEOUT",
      "segment-coverage-completion-timeout",
      "自动门发出开门命令后未到位则动作超时报警",
      [
        { name: "Door_Open_Request", type: "BOOL", scope: "VAR", ...commonIds },
        { name: "Door_Open_Done", type: "BOOL", scope: "VAR", ...commonIds },
        { name: "Door_Open_Timeout", type: "TIME", scope: "VAR", ...commonIds },
      ],
    ),
    coveragePou(
      "COVERAGE_MODE_SELECTION",
      "segment-coverage-mode-selection",
      "轨道小车自动模式与手动给定速度选择",
      [
        { name: "Cart_Auto_Mode", type: "BOOL", scope: "VAR", ...commonIds },
        { name: "Cart_Speed_Select", type: "BOOL", scope: "VAR", ...commonIds },
        { name: "Cart_Auto_Speed", type: "REAL", scope: "VAR", ...commonIds },
        { name: "Cart_Manual_Speed", type: "REAL", scope: "VAR", ...commonIds },
      ],
    ),
    coveragePou(
      "COVERAGE_TIMEOUT_CROSS_GROUP",
      "segment-coverage-timeout-cross-group",
      "设备启动反馈超时监控",
      [
        {
          name: "PumpA_Start_Request",
          type: "BOOL",
          scope: "VAR",
          deviceId: "Pump-A",
          groupId: "Start-Monitor",
        },
        {
          name: "PumpB_Run_Feedback",
          type: "BOOL",
          scope: "VAR",
          deviceId: "Pump-B",
          groupId: "Start-Monitor",
        },
        {
          name: "PumpA_Start_Timeout",
          type: "TIME",
          scope: "VAR",
          deviceId: "Pump-A",
          groupId: "Start-Monitor",
        },
      ],
    ),
    coveragePou(
      "COVERAGE_RAMP_WRONG_TYPE",
      "segment-coverage-ramp-wrong-type",
      "输送机速度平滑变化",
      [{ name: "Ramp_Enable_Only", type: "BOOL", scope: "VAR" }],
    ),
    coveragePou(
      "COVERAGE_COUNT_EDGE",
      "segment-coverage-count-edge",
      "产品完成计数使用上升沿单次触发",
      [{ name: "Product_Detected", type: "BOOL", scope: "VAR" }],
    ),
    coveragePou(
      "COVERAGE_EXISTING_EDGE_ONLY",
      "segment-coverage-existing-edge-only",
      "产品检测",
      [
        {
          name: "Existing_Product_Edge",
          type: "BOOL",
          scope: "VAR",
          nodeType: "risingContact",
        },
      ],
    ),
  ];

  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "ide-agent-business-coverage-"),
  );
  const diagramPath = path.join(tempDir, "coverage.json");
  fs.writeFileSync(diagramPath, JSON.stringify(diagram, null, 2), "utf8");

  try {
    const cases = [
      ["segment-coverage-ramp", "RAMP", "补充平滑变化 RAMP"],
      ["segment-coverage-hysteresis", "HYSTERESIS", "补充回差防抖 HYSTERESIS"],
      ["segment-coverage-mux", "MUX", "补充多路选择 MUX"],
      ["segment-coverage-len", "LEN", "补充字符串长度 LEN"],
      ["segment-coverage-process-pid", "PID", "补充过程 PID 调节"],
      ["segment-coverage-feedback-timeout", "TON", "补充反馈超时监控"],
      ["segment-coverage-completion-timeout", "TON", "补充反馈超时监控"],
      ["segment-coverage-mode-selection", "SEL", "补充模式选择 SEL"],
    ];
    const collectedSuggestions = [];
    for (const [segmentId, blockType, expectedTitle] of cases) {
      const suggestions = await suggestionsFor(
        diagramPath,
        segmentId,
        `${segmentId}-node-0`,
      );
      collectedSuggestions.push(...suggestions);
      assert.ok(
        functionBlockTypes(suggestions).includes(blockType),
        `${segmentId} should recommend ${blockType}`,
      );
      assert.equal(
        suggestionForBlockType(suggestions, blockType)?.title,
        expectedTitle,
      );
    }

    const timeoutSuggestions = await suggestionsFor(
      diagramPath,
      "segment-coverage-feedback-timeout",
      "segment-coverage-feedback-timeout-node-0",
    );
    assert.ok(
      timeoutSuggestions.some(
        (suggestion) =>
          firstAddedNode(suggestion)?.type === "contact" &&
          suggestion.title.includes("反馈确认常开触点"),
      ),
      "feedback timeout chain should use business copy for contact suggestions",
    );

    const modeSuggestions = await suggestionsFor(
      diagramPath,
      "segment-coverage-mode-selection",
      "segment-coverage-mode-selection-node-0",
    );
    assert.ok(
      modeSuggestions.some(
        (suggestion) =>
          firstAddedNode(suggestion)?.type === "contact" &&
          suggestion.title.includes("模式许可常开触点"),
      ),
      "mode-selection chain should use business copy for contact suggestions",
    );

    const crossGroupSuggestions = await suggestionsFor(
      diagramPath,
      "segment-coverage-timeout-cross-group",
      "segment-coverage-timeout-cross-group-node-0",
    );
    assert.ok(
      crossGroupSuggestions.every(
        (suggestion) => suggestion.title !== "补充反馈超时监控",
      ),
      "command and feedback from different devices must not satisfy the timeout signature",
    );

    const wrongTypeSuggestions = await suggestionsFor(
      diagramPath,
      "segment-coverage-ramp-wrong-type",
      "segment-coverage-ramp-wrong-type-node-0",
    );
    assert.ok(
      !functionBlockTypes(wrongTypeSuggestions).includes("RAMP"),
      "RAMP must not be recommended without a local floating-point value",
    );

    const countEdgeSuggestions = await suggestionsFor(
      diagramPath,
      "segment-coverage-count-edge",
      "segment-coverage-count-edge-node-0",
    );
    assert.ok(
      countEdgeSuggestions.some(
        (suggestion) =>
          firstAddedNode(suggestion)?.type === "risingContact" &&
          suggestion.title.includes("计数脉冲上升沿"),
      ),
      "explicit count-edge context should add a business-labelled rising-edge candidate",
    );

    const existingEdgeOnlySuggestions = await suggestionsFor(
      diagramPath,
      "segment-coverage-existing-edge-only",
      "segment-coverage-existing-edge-only-node-0",
    );
    assert.ok(
      !suggestedNodeTypes(existingEdgeOnlySuggestions).includes("risingContact"),
      "selecting an existing edge without descriptor evidence must not cascade another edge",
    );

    assert.ok(
      !functionBlockTypes(modeSuggestions).includes("MUX"),
      "two-way mode selection must not be confused with indexed multiplexing",
    );

    for (const suggestion of collectedSuggestions) {
      assertSuggestionUsesLibraryElement(suggestion);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function coveragePou(pouName, segmentId, label, variables) {
  const nodesObj = {};
  const startId = `${segmentId}-start`;
  const endId = `${segmentId}-end`;
  const nodeIds = variables.map((_, index) => `${segmentId}-node-${index}`);
  nodesObj[startId] = {
    id: startId,
    type: "startLine",
    sourceIds: [],
    targetIds: [nodeIds[0]],
  };
  variables.forEach((variable, index) => {
    const nodeId = nodeIds[index];
    nodesObj[nodeId] = {
      id: nodeId,
      type: variable.nodeType ?? "contact",
      sourceIds: [index === 0 ? startId : nodeIds[index - 1]],
      targetIds: [index === variables.length - 1 ? endId : nodeIds[index + 1]],
      varName: {
        value: variable.name,
        type: variable.type,
        scope: variable.scope,
      },
    };
  });
  nodesObj[endId] = {
    id: endId,
    type: "endLine",
    sourceIds: [nodeIds[nodeIds.length - 1]],
    targetIds: [],
  };
  return {
    pouName,
    pouType: "PROGRAM",
    variableList: variables.map(({ nodeType, ...variable }) => variable),
    segmentList: [{ id: segmentId, label, note: "", nodesObj }],
  };
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
  const completePidSuggestion = suggestionForBlockType(
    completeSuggestions,
    "PID",
  );
  assert.equal(completePidSuggestion?.title, "补充温度 PID 调节");
  assert.match(completePidSuggestion?.text ?? "", /实际值、设定值和控制输出/);
  assert.ok(
    !completePidSuggestion?.text.includes("temperature-pid-contact"),
    "business presentation must not expose raw node ids",
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
  assert.ok(
    !legacySuggestions.some((suggestion) =>
      suggestion.title.includes("补充温度 PID 调节"),
    ),
    "term-only PID evidence must keep the structural fallback title",
  );

  const existingPidSuggestions = await suggestionsFor(
    loopSignatureFixturePath,
    "segment-temperature-pid-existing",
    "temperature-existing-contact",
  );
  assert.ok(
    !functionBlockTypes(existingPidSuggestions).includes("PID"),
    "an existing PID in the same business segment must suppress another PID even when it is not the insertion boundary",
  );

  const existingLoopSuggestions = await suggestionsFor(
    loopSignatureFixturePath,
    "segment-temperature-pid-loop-a-existing",
    "loop-a-contact",
  );
  assert.ok(
    !functionBlockTypes(existingLoopSuggestions).includes("PID"),
    "Tank A must not receive another PID when its own group already has one",
  );

  const missingLoopSuggestions = await suggestionsFor(
    loopSignatureFixturePath,
    "segment-temperature-pid-loop-b-missing",
    "loop-b-contact",
  );
  assert.ok(
    functionBlockTypes(missingLoopSuggestions).includes("PID"),
    "Tank A's PID must not suppress the missing PID in Tank B's group",
  );

  const missingTimerSuggestions = await suggestionsFor(
    loopSignatureFixturePath,
    "segment-timer-completion-missing-ton",
    "timer-completion-contact",
  );
  assert.ok(
    functionBlockTypes(missingTimerSuggestions).includes("TON"),
    "the generic completion mechanism must also recommend a missing TON",
  );
  const missingTonSuggestion = suggestionForBlockType(
    missingTimerSuggestions,
    "TON",
  );
  assert.equal(missingTonSuggestion?.title, "补充通电延时功能块");
  assert.match(missingTonSuggestion?.text ?? "", /启动条件和预置时间齐全/);
  assert.ok(
    !missingTonSuggestion?.text.includes("timer-completion-contact"),
    "completion presentation must use a human-readable placement",
  );
  assert.ok(missingTonSuggestion?.startNodes.length > 0);
  assert.ok(missingTonSuggestion?.endNodes.length > 0);
  assert.ok(
    !missingTonSuggestion?.startNodes.some((nodeId) =>
      missingTonSuggestion.endNodes.includes(nodeId),
    ),
    "business presentation must not alter valid topology boundaries",
  );

  for (const suggestion of [
    ...completeSuggestions,
    ...commentRoleSuggestions,
    ...legacySuggestions,
    ...existingPidSuggestions,
    ...existingLoopSuggestions,
    ...missingLoopSuggestions,
    ...missingTimerSuggestions,
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
  const serialFaultInterlock = faultPermissiveSuggestions.find(
    (suggestion) =>
      firstAddedNode(suggestion)?.type === "negatedContact" &&
      suggestion.position === "front",
  );
  assert.equal(
    serialFaultInterlock?.title,
    "前串联 故障联锁常闭触点",
  );
  assert.match(serialFaultInterlock?.text ?? "", /切断许可/);
  assert.ok(
    !serialFaultInterlock?.text.includes("fault-permissive-contact"),
    "node intent presentation must not expose raw node ids",
  );
  assert.deepStrictEqual(serialFaultInterlock?.startNodes, [
    "fault-permissive-start",
  ]);
  assert.deepStrictEqual(serialFaultInterlock?.endNodes, [
    "fault-permissive-contact",
  ]);
  const parallelFaultContact = faultPermissiveSuggestions.find(
    (suggestion) =>
      firstAddedNode(suggestion)?.type === "negatedContact" &&
      suggestion.position === "parallel",
  );
  assert.equal(
    parallelFaultContact?.title,
    "并联 常闭触点",
    "parallel fault alternatives must not claim to cut a serial permissive",
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
  assert.ok(
    estopOkSuggestions.every(
      (suggestion) => !suggestion.title.includes("运行许可"),
    ),
    "safety-sensitive evidence must keep structural fallback copy",
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
  const faultOutputCoil = faultOnlyCoilSuggestions.find(
    (suggestion) => firstAddedNode(suggestion)?.type === "coil",
  );
  assert.equal(faultOutputCoil?.title, "并联 故障报警输出线圈");
  assert.match(faultOutputCoil?.text ?? "", /Fault_Output/);
  const faultLatchCoil = faultOnlyCoilSuggestions.find(
    (suggestion) => firstAddedNode(suggestion)?.type === "setCoil",
  );
  assert.equal(faultLatchCoil?.title, "替换为 故障锁存置位线圈");
  assert.match(faultLatchCoil?.text ?? "", /独立复位条件/);

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
  assert.equal(resetCoilSuggestions[0]?.title, "替换为 状态复位线圈");
  assert.match(resetCoilSuggestions[0]?.text ?? "", /清除已保持的状态/);

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

function assertBusinessPresentation(ruleId, presentation) {
  assert.ok(presentation, `${ruleId} must define presentation`);
  assert.ok(
    String(presentation.titleTemplate ?? "").trim(),
    `${ruleId} must define titleTemplate`,
  );
  assert.ok(
    String(presentation.textTemplate ?? "").trim(),
    `${ruleId} must define textTemplate`,
  );
  const supportedPlaceholders = new Set([
    "businessName",
    "reason",
    "focusVar",
    "actionName",
    "groupName",
    "candidateName",
    "placementAction",
    "placementText",
    "elementType",
  ]);
  for (const template of [
    presentation.titleTemplate,
    presentation.textTemplate,
  ]) {
    for (const match of String(template).matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)) {
      assert.ok(
        supportedPlaceholders.has(match[1]),
        `${ruleId} uses unsupported presentation placeholder: ${match[1]}`,
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

function suggestionForBlockType(suggestions, blockType) {
  const normalized = String(blockType).toUpperCase();
  return suggestions.find((suggestion) => {
    const node = firstAddedNode(suggestion);
    return (
      node?.type === "FBDCompartment" &&
      String(node.childrenNode?.type ?? "").toUpperCase() === normalized
    );
  });
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

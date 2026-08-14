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
const {
  collectBusinessTerms,
} = require("../packages/core/dist/graph/BusinessEvidence");
const {
  businessEvidenceTextVariants,
  normalizeBusinessEvidenceText,
} = require("../packages/core/dist/graph/BusinessTextNormalization");
const {
  filterBusinessChainGuardedSuggestions,
} = require("../packages/core/dist/graph/BusinessChainSuggestionGuard");

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
const motionAxisContextFixturePath = path.join(
  rootDir,
  "src",
  "test",
  "fixtures",
  "motion-axis-context-fixture.json",
);
const deviceLoopCompletionFixturePath = path.join(
  rootDir,
  "src",
  "test",
  "fixtures",
  "device-loop-completion-fixture.json",
);
const oppositeActionInterlockFixturePath = path.join(
  rootDir,
  "src",
  "test",
  "fixtures",
  "opposite-action-interlock-fixture.json",
);
const faultResponseCompletionFixturePath = path.join(
  rootDir,
  "src",
  "test",
  "fixtures",
  "fault-response-completion-fixture.json",
);
const faultResetCompletionFixturePath = path.join(
  rootDir,
  "src",
  "test",
  "fixtures",
  "fault-reset-completion-fixture.json",
);
const actionLifecycleCompletionFixturePath = path.join(
  rootDir,
  "src",
  "test",
  "fixtures",
  "action-lifecycle-completion-fixture.json",
);
const counterCompletionLifecycleFixturePath = path.join(
  rootDir,
  "src",
  "test",
  "fixtures",
  "counter-completion-lifecycle-fixture.json",
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
  assertBusinessEvidenceNormalizationCases();
  assertExplicitIdGroupingCases();
  assertGenericMissingTargetCases();
  assertBlockPortRoleCases();
  await assertExpandedBusinessCoverageCases();
  await assertStableBusinessCases();
  await assertLoopSignatureCases();
  await assertDeviceLoopCompletionCases();
  await assertOppositeActionInterlockCases();
  await assertFaultResponseCompletionCases();
  await assertFaultResetCompletionCases();
  await assertActionLifecycleCompletionCases();
  await assertCounterCompletionLifecycleCases();
  await assertBusinessChainContextCases();
  assertBusinessChainSuggestionGuardCases();
  await assertTimestampDiagramWhenAvailable();
  console.log("[test-business-rules] passed");
}

function assertActiveRuleCandidatesExistInLibrary() {
  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  assert.equal(rules.schemaVersion, "ide-agent.business-rules.v19");
  assert.deepStrictEqual(
    rules.businessChainGuards.relatedCapabilityIdentityRoles,
    ["axisReference", "deviceReference"],
  );
  assert.deepStrictEqual(
    rules.businessChainGuards.identityScopedCapabilityBlockTypes,
    ["MC_Power", "MC_Reset", "MC_Home"],
  );
  assert.equal(
    rules.businessChainGuards.relatedCapabilityMinSharedReferences,
    2,
  );
  assert.deepStrictEqual(rules.businessChainEnhancement, {
    resolvedPresentationScore: 6,
    partialPresentationScore: 2,
    resolvedEvidenceScore: 4,
    partialEvidenceScore: 1,
    highConfidenceRoleBonus: 2,
    nodeIntentTitleTemplate: "{placementAction} {businessName}{elementType}",
    nodeIntentTextTemplate:
      "在“{chainName}”业务链中，最终动作是 {actionName}；{baseText}",
  });
  assertBusinessPresentation(
    "businessChainEnhancement",
    {
      titleTemplate:
        rules.businessChainEnhancement.nodeIntentTitleTemplate,
      textTemplate:
        rules.businessChainEnhancement.nodeIntentTextTemplate,
    },
    [
      "chainName",
      "selectedName",
      "actionType",
      "baseTitle",
      "baseText",
    ],
  );
  const motionCommandProfiles = rules.motionCommandProfiles ?? [];
  const powerProfile = motionCommandProfiles.find(
    (profile) => profile.id === "MCP01-power-level",
  );
  assert.equal(powerProfile?.triggerModel, "level");
  assert.equal(powerProfile?.triggerPort, "Enable");
  assert.deepStrictEqual(powerProfile?.blockTypes, ["MC_Power"]);
  const executionProfiles = motionCommandProfiles.filter(
    (profile) => profile.triggerModel === "risingEdge",
  );
  assert.ok(
    executionProfiles.some((profile) => profile.blockTypes.includes("MC_Home")),
    "motion profiles must describe Execute-driven command cycles",
  );
  assert.ok(
    executionProfiles.every(
      (profile) => !profile.blockTypes.includes("MC_Power"),
    ),
    "MC_Power must not be classified as an Execute-driven command",
  );
  for (const profile of motionCommandProfiles) {
    for (const blockType of profile.blockTypes) {
      const libraryElement = libraryElements.get(blockType.toUpperCase());
      assert.ok(libraryElement, `${profile.id} references missing ${blockType}`);
      const inputPorts = libraryElement.inputs ?? [];
      assert.ok(
        inputPorts.some(
          (port) =>
            String(port[0]).toUpperCase() ===
            String(profile.triggerPort).toUpperCase(),
        ),
        `${profile.id} trigger port ${profile.triggerPort} is missing on ${blockType}`,
      );
    }
  }
  assert.ok(
    (rules.deviceLoopRules ?? []).length >= 2,
    "deviceLoopRules must define generic ready and fault completion",
  );
  assert.ok(
    (rules.faultResponseRules ?? []).some(
      (rule) => rule.id === "FR01-fault-alarm-output",
    ),
    "fault response rules must define generic alarm output completion",
  );
  assert.ok(
    (rules.faultResponseRules ?? []).some(
      (rule) => rule.id === "FR02-fault-latch-output",
    ),
    "fault response rules must define generic fault latch completion",
  );
  assert.ok(
    (rules.faultResetRules ?? []).some(
      (rule) => rule.id === "FRS01-latched-fault-reset",
    ),
    "fault reset rules must bind an existing latch to a reset coil",
  );
  assert.ok(
    (rules.actionLifecycleRules ?? []).length >= 5,
    "action lifecycle rules must also define counter completion output and latch",
  );
  assert.ok(
    rules.variablePatterns.roleEvidenceRules.some(
      (rule) => rule.role === "batchCompletionOutput",
    ),
    "variable patterns must recognize batch completion outputs",
  );
  assert.ok(
    (rules.actionLifecycleRules ?? []).some(
      (rule) => rule.id === "AL04-count-completion-output",
    ),
    "action lifecycle rules must reuse the lifecycle mechanism for counter completion",
  );
  assert.ok(
    rules.variablePatterns.suffixRoles.some(
      (rule) => rule.suffix === "_Permit" && rule.role === "permitSignal",
    ),
    "variable patterns must recognize explicit action permits",
  );
  assert.ok(
    rules.variablePatterns.roleEvidenceRules.some(
      (rule) => rule.role === "inhibitSignal",
    ),
    "variable patterns must recognize generic blocking conditions",
  );
  assert.ok(
    (rules.deviceLoopRules ?? []).some(
      (rule) => rule.id === "DL05-material-presence-condition",
    ),
    "device loop rules must support material or workpiece presence",
  );
  assert.ok(
    rules.termPatterns
      .find((rule) => rule.term === "safety")
      ?.literalPatterns.includes("light curtain"),
    "ordinary business completion must recognize common safety-device names",
  );
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
  for (const rule of rules.deviceLoopRules ?? []) {
    assert.ok(rule.id, "device loop rule must define id");
    assert.ok(
      rule.anchorRolesAny?.length > 0,
      `${rule.id} must define anchorRolesAny`,
    );
    assert.ok(
      rule.anchorRolesAny.every((role) => definedRoles.has(role)),
      `${rule.id} anchorRolesAny must reference defined roles`,
    );
    assert.ok(
      rule.candidateRolesAny?.length > 0,
      `${rule.id} must define candidateRolesAny`,
    );
    assert.ok(
      rule.candidateRolesAny.every((role) => definedRoles.has(role)),
      `${rule.id} candidateRolesAny must reference defined roles`,
    );
    assert.ok(
      ["contact", "negatedContact"].includes(rule.candidateNodeType),
      `${rule.id} must use a supported contact node type`,
    );
    assertBusinessPresentation(rule.id, rule.presentation, ["candidateVar"]);
    if (rule.oppositeActionCandidates) {
      const opposite = rule.oppositeActionCandidates;
      assert.ok(
        opposite.rolesAny?.length > 0 &&
          opposite.rolesAny.every((role) => definedRoles.has(role)),
        `${rule.id} opposite-action roles must reference defined roles`,
      );
      assert.ok(
        opposite.pairs?.length > 0 &&
          opposite.pairs.every(
            (pair) =>
              pair.id && pair.leftTerms?.length > 0 && pair.rightTerms?.length > 0,
          ),
        `${rule.id} must define complete opposite-action pairs`,
      );
      assertBusinessPresentation(
        `${rule.id}.oppositeActionCandidates`,
        opposite.presentation,
        ["candidateVar"],
      );
    }
  }
  for (const rule of rules.faultResponseRules ?? []) {
    assert.ok(rule.id, "fault response rule must define id");
    assert.ok(
      rule.anchorRolesAny?.length > 0 &&
        rule.anchorRolesAny.every((role) => definedRoles.has(role)),
      `${rule.id} anchorRolesAny must reference defined roles`,
    );
    assert.ok(
      rule.candidateRolesAny?.length > 0 &&
        rule.candidateRolesAny.every((role) => definedRoles.has(role)),
      `${rule.id} candidateRolesAny must reference defined roles`,
    );
    assert.ok(
      ["coil", "setCoil"].includes(rule.candidateNodeType),
      `${rule.id} must use a supported output node type`,
    );
    assertBusinessPresentation(rule.id, rule.presentation, ["candidateVar"]);
  }
  for (const rule of rules.faultResetRules ?? []) {
    assert.ok(rule.id, "fault reset rule must define id");
    assert.ok(
      rule.anchorRolesAny?.length > 0 &&
        rule.anchorRolesAny.every((role) => definedRoles.has(role)),
      `${rule.id} anchorRolesAny must reference defined roles`,
    );
    assert.ok(
      rule.candidateRolesAny?.length > 0 &&
        rule.candidateRolesAny.every((role) => definedRoles.has(role)),
      `${rule.id} candidateRolesAny must reference defined roles`,
    );
    assert.equal(
      rule.candidateNodeType,
      "resetCoil",
      `${rule.id} must use resetCoil`,
    );
    assertBusinessPresentation(rule.id, rule.presentation, ["candidateVar"]);
  }
  for (const rule of rules.actionLifecycleRules ?? []) {
    assert.ok(rule.id, "action lifecycle rule must define id");
    assert.ok(
      [
        "selfHold",
        "stopInterlock",
        "latchedRelease",
        "countCompletionOutput",
        "countCompletionLatch",
      ].includes(rule.kind),
      `${rule.id} must use a supported lifecycle kind`,
    );
    assert.ok(
      rule.anchorRolesAny?.length > 0 &&
        rule.anchorRolesAny.every((role) => definedRoles.has(role)),
      `${rule.id} anchorRolesAny must reference defined roles`,
    );
    assert.ok(
      rule.candidateRolesAny?.length > 0 &&
        rule.candidateRolesAny.every((role) => definedRoles.has(role)),
      `${rule.id} candidateRolesAny must reference defined roles`,
    );
    assertBusinessPresentation(rule.id, rule.presentation, ["candidateVar"]);
  }
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
  assert.ok(signatureIds.has("LS14-command-run-feedback-timeout-generic"));
  assert.ok(signatureIds.has("LS15-command-completion-timeout-generic"));
  const feedbackTimeoutRule = (rules.libraryRules ?? []).find(
    (rule) => rule.id === "T07-feedback-timeout-completion",
  );
  assert.ok(
    feedbackTimeoutRule?.signatureRefsAny?.includes(
      "LS14-command-run-feedback-timeout-generic",
    ),
    "T07 must include the generic run-feedback timeout signature",
  );
  assert.ok(
    feedbackTimeoutRule?.signatureRefsAny?.includes(
      "LS15-command-completion-timeout-generic",
    ),
    "T07 must include the generic completion timeout signature",
  );
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
  for (const rule of rules.deviceLoopRules ?? []) {
    for (const pair of rule.oppositeActionCandidates?.pairs ?? []) {
      for (const term of [...pair.leftTerms, ...pair.rightTerms]) {
        assert.ok(
          definedTerms.has(term),
          `${rule.id}/${pair.id} references undefined opposite-action term: ${term}`,
        );
      }
    }
  }
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
    ...(rules.faultResponseRules ?? []),
    ...(rules.faultResetRules ?? []),
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
    const requiredOutputRequirements = (rule.portRequirements ?? []).filter(
      (requirement) =>
        requirement.required && requirement.direction === "output",
    );
    assert.ok(
      requiredOutputRequirements.length > 0,
      `${rule.id} must define its required business-result output ports`,
    );
    for (const requirement of requiredOutputRequirements) {
      assert.notEqual(
        requirement.allowCreateParameter,
        true,
        `${rule.id}/${requirement.port} output must not use allowCreateParameter`,
      );
    }
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
        const direction = String(
          portRequirement.direction ?? "input",
        ).toLowerCase();
        assert.ok(
          ["input", "output", "any"].includes(direction),
          `${rule.id}/${portRequirement.port} has unsupported direction ${direction}`,
        );
        if (portRequirement.required) {
          assert.ok(
            portRequirement.acceptedDataTypes?.length > 0,
            `${rule.id}/${portRequirement.port} must define accepted data types`,
          );
        }
        const candidatePorts =
          direction === "input"
            ? libraryElement.inputs ?? []
            : direction === "output"
              ? libraryElement.outputs ?? []
              : [
                  ...(libraryElement.inputs ?? []),
                  ...(libraryElement.outputs ?? []),
                ];
        const libraryPort = candidatePorts.find(
          ([name]) =>
            String(name).toUpperCase() ===
            String(portRequirement.port).toUpperCase(),
        );
        if (portRequirement.required) {
          assert.ok(
            libraryPort,
            `${rule.id}/${candidateName} requires missing ${direction} port ${portRequirement.port}`,
          );
          assert.ok(
            portRequirement.acceptedDataTypes.some((acceptedDataType) =>
              libraryDataTypeMatches(
                libraryPort[1],
                acceptedDataType,
                rules.dataTypeGroups,
              ),
            ),
            `${rule.id}/${candidateName}/${portRequirement.port} has incompatible type ${libraryPort[1]}`,
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

function libraryDataTypeMatches(
  actualDataType,
  requiredDataType,
  dataTypeGroups,
  visitedGroups = new Set(),
) {
  const actual = String(actualDataType ?? "").trim().toUpperCase();
  const required = String(requiredDataType ?? "").trim().toUpperCase();
  if (!actual || !required) {
    return false;
  }
  if (actual === required) {
    return true;
  }
  if (visitedGroups.has(required)) {
    return false;
  }
  const members = dataTypeGroups?.[required] ?? [];
  if (members.length === 0) {
    return false;
  }
  const nextVisitedGroups = new Set(visitedGroups);
  nextVisitedGroups.add(required);
  return members.some((member) =>
    libraryDataTypeMatches(actual, member, dataTypeGroups, nextVisitedGroups),
  );
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
    {
      name: "PE_Main",
      type: "BOOL",
      scope: "VAR",
      comment: "主输送段光电检测",
    },
    {
      name: "PE_Count",
      type: "DINT",
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
  assert.ok(hasRole("PE_Main", "presenceSignal"));
  assert.ok(
    !hasRole("PE_Count", "presenceSignal"),
    "PE shorthand must still respect the BOOL type constraint",
  );
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

function assertBusinessEvidenceNormalizationCases() {
  assert.equal(
    normalizeBusinessEvidenceText("  Ｐｕｍｐ－０１__StartCmd \n"),
    "pump 01 start cmd",
  );
  for (const placeholder of ["???", "N/A", "N.A.", "FALSE", "123"]) {
    assert.deepStrictEqual(
      businessEvidenceTextVariants(placeholder),
      [],
      `${placeholder} must not become business evidence`,
    );
  }

  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  const config = parseVariablePatterns(rules.variablePatterns);
  const matches = evaluateVariableRoles(config, [
    { name: "Pump01StartCmd", type: "BOOL", scope: "VAR" },
    { name: "Pump－02StopCmd", type: "BOOL", scope: "VAR" },
    {
      name: "X201",
      type: "BOOL",
      scope: "VAR",
      label: "ＲＵＮＮＩＮＧ　ＦＥＥＤＢＡＣＫ",
    },
    { name: "Pump03StartCmd", type: "REAL", scope: "VAR" },
    {
      name: "UnclassifiedSignal",
      type: "BOOL",
      scope: "VAR",
      label: "N/A",
      note: "???",
      comment: "FALSE",
    },
  ]);
  const hasRole = (variableName, role) =>
    matches.some(
      (match) =>
        match.variableName === variableName && match.role === role,
    );

  assert.ok(hasRole("Pump01StartCmd", "commandSignal"));
  assert.ok(hasRole("Pump01StartCmd", "startCommand"));
  assert.ok(hasRole("Pump－02StopCmd", "commandSignal"));
  assert.ok(hasRole("Pump－02StopCmd", "stopCommand"));
  assert.ok(hasRole("X201", "runFeedback"));
  assert.equal(
    hasRole("Pump03StartCmd", "commandSignal"),
    false,
    "normalization must not bypass variable data-type constraints",
  );
  assert.equal(
    matches.some((match) => match.variableName === "UnclassifiedSignal"),
    false,
    "placeholder fields must not create variable-role evidence",
  );

  assert.ok(
    collectBusinessTerms(["ＭＣ－Ｈａｌｔ"]).has("motionHalt"),
    "full-width motion terms must match after evidence normalization",
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
          { name: "Power_Enable", type: "BOOL", scope: "VAR" },
          { name: "Power_Status", type: "BOOL", scope: "VAR" },
          { name: "Power_Busy", type: "BOOL", scope: "VAR" },
          { name: "Power_Error", type: "BOOL", scope: "VAR" },
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
            "segment-port-role-power",
            "Axis 1 power enable",
            "power-node",
            "MC_Power",
            "Power_Axis_1",
            [
              testPort("Axis", "Axis_1", "AXIS_REF", "VAR_IN_OUT"),
              testPort("Enable", "Power_Enable", "BOOL", "VAR_INPUT"),
            ],
            [
              testPort("Status", "Power_Status", "BOOL", "VAR_OUTPUT"),
              testPort("Busy", "Power_Busy", "BOOL", "VAR_OUTPUT"),
              testPort("Error", "Power_Error", "BOOL", "VAR_OUTPUT"),
            ],
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
  assert.ok(roleMatch("Delay_Enable", "conditionSignal"));
  assert.ok(
    !roleMatch("Axis_1", "commandSignal"),
    "an Axis reference must not become a motion command signal",
  );
  assert.ok(roleMatch("Stop_Request_1", "commandSignal")?.matchedSources.includes("port"));
  assert.ok(roleMatch("Stop_Done_1", "completionSignal")?.matchedSources.includes("port"));
  assert.ok(roleMatch("Power_Enable", "enableSignal")?.matchedSources.includes("port"));
  assert.ok(
    !roleMatch("Power_Enable", "commandSignal")?.matchedSources.includes("port"),
    "MC_Power.Enable must not provide Execute-style command evidence",
  );
  assert.ok(roleMatch("Power_Status", "runFeedback"));
  assert.ok(roleMatch("Power_Busy", "busySignal"));
  assert.ok(roleMatch("Power_Error", "faultSignal"));
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
      "COVERAGE_GENERIC_ACTION_TIMEOUT",
      "segment-coverage-generic-action-timeout",
      "generic action monitoring",
      [
        { name: "Valve01_Open_Cmd", type: "BOOL", scope: "VAR", ...commonIds },
        { name: "Valve01_Run_FB", type: "BOOL", scope: "VAR", ...commonIds },
        { name: "Valve01_Preset_Time", type: "TIME", scope: "VAR", ...commonIds },
      ],
    ),
    coveragePou(
      "COVERAGE_GENERIC_ACTION_TIMEOUT_MISSING_FEEDBACK",
      "segment-coverage-generic-action-timeout-missing-feedback",
      "generic action timing parameter",
      [
        { name: "Valve02_Open_Cmd", type: "BOOL", scope: "VAR", ...commonIds },
        { name: "Valve02_Preset_Time", type: "TIME", scope: "VAR", ...commonIds },
      ],
    ),
    coveragePou(
      "COVERAGE_GENERIC_ACTION_TIMEOUT_CROSS_GROUP",
      "segment-coverage-generic-action-timeout-cross-group",
      "generic action monitoring",
      [
        { name: "Valve03_Open_Cmd", type: "BOOL", scope: "VAR", deviceId: "Valve-03", groupId: "Open-03" },
        { name: "Valve03_Run_FB", type: "BOOL", scope: "VAR", deviceId: "Valve-04", groupId: "Open-04" },
        { name: "Valve03_Preset_Time", type: "TIME", scope: "VAR", deviceId: "Valve-03", groupId: "Open-03" },
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
    coveragePou(
      "COVERAGE_EXISTING_RISING_EDGE_DESCRIPTOR",
      "segment-coverage-existing-rising-edge-descriptor",
      "产品完成计数使用上升沿单次触发",
      [
        {
          name: "Existing_Product_Rising_Edge",
          type: "BOOL",
          scope: "VAR",
          nodeType: "risingContact",
        },
      ],
    ),
    coveragePou(
      "COVERAGE_EXISTING_FALLING_EDGE_DESCRIPTOR",
      "segment-coverage-existing-falling-edge-descriptor",
      "许可信号下降沿失效瞬间触发",
      [
        {
          name: "Existing_Permit_Falling_Edge",
          type: "BOOL",
          scope: "VAR",
          nodeType: "fallingContact",
        },
      ],
    ),
    coverageEdgeFunctionBlockPou(
      "COVERAGE_EXISTING_R_TRIG_DESCRIPTOR",
      "segment-coverage-existing-r-trig-descriptor",
      "产品完成计数使用上升沿单次触发",
      "R_TRIG",
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
      ["segment-coverage-generic-action-timeout", "TON", "补充反馈超时监控"],
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

    const genericMissingFeedbackSuggestions = await suggestionsFor(
      diagramPath,
      "segment-coverage-generic-action-timeout-missing-feedback",
      "segment-coverage-generic-action-timeout-missing-feedback-node-0",
    );
    assert.ok(
      genericMissingFeedbackSuggestions.every(
        (suggestion) => suggestion.title !== "补充反馈超时监控",
      ),
      "a command and TIME parameter without feedback must not satisfy generic timeout completion",
    );

    const genericCrossGroupSuggestions = await suggestionsFor(
      diagramPath,
      "segment-coverage-generic-action-timeout-cross-group",
      "segment-coverage-generic-action-timeout-cross-group-node-0",
    );
    assert.ok(
      genericCrossGroupSuggestions.every(
        (suggestion) => suggestion.title !== "补充反馈超时监控",
      ),
      "generic timeout completion must not mix feedback from another device or action group",
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

    const existingRisingEdgeSuggestions = await suggestionsFor(
      diagramPath,
      "segment-coverage-existing-rising-edge-descriptor",
      "segment-coverage-existing-rising-edge-descriptor-node-0",
    );
    assert.ok(
      !suggestedNodeTypes(existingRisingEdgeSuggestions).includes(
        "risingContact",
      ),
      "an existing rising-edge contact must satisfy explicit rising-edge intent",
    );
    assert.ok(
      !functionBlockTypes(existingRisingEdgeSuggestions).includes("R_TRIG"),
      "an existing rising-edge contact must not be followed by equivalent R_TRIG detection",
    );

    const existingFallingEdgeSuggestions = await suggestionsFor(
      diagramPath,
      "segment-coverage-existing-falling-edge-descriptor",
      "segment-coverage-existing-falling-edge-descriptor-node-0",
    );
    assert.ok(
      !suggestedNodeTypes(existingFallingEdgeSuggestions).includes(
        "fallingContact",
      ),
      "an existing falling-edge contact must satisfy explicit falling-edge intent",
    );
    assert.ok(
      !functionBlockTypes(existingFallingEdgeSuggestions).includes("F_TRIG"),
      "an existing falling-edge contact must not be followed by equivalent F_TRIG detection",
    );

    const existingRTrigSuggestions = await suggestionsFor(
      diagramPath,
      "segment-coverage-existing-r-trig-descriptor",
      "segment-coverage-existing-r-trig-descriptor-node-0",
    );
    assert.ok(
      !suggestedNodeTypes(existingRTrigSuggestions).includes("risingContact"),
      "an existing R_TRIG must satisfy equivalent rising-contact intent",
    );
    assert.ok(
      !functionBlockTypes(existingRTrigSuggestions).includes("R_TRIG"),
      "an existing R_TRIG must not cascade another R_TRIG",
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

function coverageEdgeFunctionBlockPou(pouName, segmentId, label, blockType) {
  const startId = `${segmentId}-start`;
  const nodeId = `${segmentId}-node-0`;
  const endId = `${segmentId}-end`;
  return {
    pouName,
    pouType: "PROGRAM",
    variableList: [
      { name: `${blockType}_Instance`, type: blockType, scope: "VAR" },
      { name: `${blockType}_Input`, type: "BOOL", scope: "VAR" },
      { name: `${blockType}_Output`, type: "BOOL", scope: "VAR" },
    ],
    segmentList: [
      {
        id: segmentId,
        label,
        note: "",
        nodesObj: {
          [startId]: {
            id: startId,
            type: "startLine",
            sourceIds: [],
            targetIds: [nodeId],
          },
          [nodeId]: {
            id: nodeId,
            type: "FBDCompartment",
            sourceIds: [startId],
            targetIds: [endId],
            childrenNode: {
              type: blockType,
              isFunction: false,
              varName: {
                name: "",
                value: `${blockType}_Instance`,
                type: blockType,
                scope: "VAR",
              },
              portInputs: [
                {
                  name: "CLK",
                  value: `${blockType}_Input`,
                  type: "BOOL",
                  scope: "VAR",
                },
              ],
              portOutputs: [
                {
                  name: "Q",
                  value: `${blockType}_Output`,
                  type: "BOOL",
                  scope: "VAR",
                },
              ],
            },
          },
          [endId]: {
            id: endId,
            type: "endLine",
            sourceIds: [nodeId],
            targetIds: [],
          },
        },
      },
    ],
  };
}

async function assertBusinessChainContextCases() {
  const diagram = businessChainContextDiagram();
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "ide-agent-business-chain-context-"),
  );
  const diagramPath = path.join(tempDir, "business-chain-context.json");
  fs.writeFileSync(diagramPath, JSON.stringify(diagram, null, 2), "utf8");

  try {
    const result = await getLocalGraphSuggestions({
      diagramPath,
      segmentId: "segment-random-name-positioning",
      selectedNodeId: "random-power-status-contact",
    });
    const chain = result?.payload?.recognizedFocus?.businessChainContext;
    assert.equal(
      chain?.schemaVersion,
      "ide-agent.business-chain-context.v1",
    );
    assert.equal(chain?.resolution, "resolved");
    assert.equal(chain?.focusNodeId, "random-power-status-contact");
    assert.equal(chain?.primaryActionNodeId, "random-position-action");

    const powerStatus = chain?.nodes.find(
      (node) => node.nodeId === "random-power-status-contact",
    );
    assert.equal(powerStatus?.selected, true);
    assert.equal(powerStatus?.chainRole, "condition");
    assert.ok(
      powerStatus?.roles.some(
        (role) =>
          role.role === "runFeedback" &&
          role.strength === "high" &&
          role.sources.includes("port"),
      ),
      "an arbitrary variable name bound to MC_Power.Status must retain strong port-role evidence",
    );

    const unknownCondition = chain?.nodes.find(
      (node) => node.nodeId === "random-unknown-condition",
    );
    assert.equal(unknownCondition?.chainRole, "condition");
    assert.deepStrictEqual(
      unknownCondition?.roles,
      [],
      "an arbitrary unbound variable must not receive a fabricated business role",
    );
    assert.ok(
      chain?.evidenceSummary.unresolvedConditionNodeIds.includes(
        "random-unknown-condition",
      ),
    );

    const requestTrigger = chain?.nodes.find(
      (node) => node.nodeId === "random-position-trigger",
    );
    assert.equal(requestTrigger?.chainRole, "trigger");
    assert.equal(requestTrigger?.edgeDirection, "rising");
    assert.ok(
      requestTrigger?.roles.some(
        (role) =>
          role.role === "commandSignal" && role.sources.includes("port"),
      ),
    );
    assert.ok(
      chain?.localCapabilities.some(
        (capability) => capability.capability === "edge:rising",
      ),
    );
    assert.ok(
      chain?.localCapabilities.some(
        (capability) =>
          capability.capability === "functionBlock:MC_MOVEABSOLUTE",
      ),
    );
    const relatedPower = chain?.relatedCapabilities.find(
      (capability) => capability.capability === "functionBlock:MC_POWER",
    );
    assert.ok(relatedPower?.sharedReferences.includes("X1"));
    assert.ok(relatedPower?.sharedReferences.includes("Feed_Axis"));
    assert.ok(
      chain?.relatedCapabilities.some(
        (capability) =>
          capability.capability === "functionBlock:MC_HOME" &&
          capability.sharedReferences.includes("Feed_Axis"),
      ),
    );
    assert.ok(
      (result?.payload?.suggestions ?? []).every(
        (suggestion) => !("businessChainContext" in suggestion),
      ),
      "business-chain diagnostics must not mutate individual suggestions",
    );
    const guardedSuggestions = result?.payload?.suggestions ?? [];
    assert.ok(
      !suggestedNodeTypes(guardedSuggestions).includes("risingContact") &&
        !functionBlockTypes(guardedSuggestions).includes("R_TRIG"),
      "a chain that already has rising-edge capability must not suggest another placeholder rising edge",
    );
    assert.ok(
      guardedSuggestions.every(
        (suggestion) => suggestion.serialOrParallel !== "parallel",
      ),
      "a parallel branch must not bypass a high-confidence run-feedback condition",
    );
    assert.ok(
      !functionBlockTypes(guardedSuggestions).includes("MC_MOVEABSOLUTE"),
      "an existing stateful function block in the same chain must not be suggested again",
    );
    assert.ok(
      !functionBlockTypes(guardedSuggestions).includes("MC_HOME"),
      "an identity-scoped function block already present for the same axis must not be suggested again",
    );
    const chainPresentedSuggestions = guardedSuggestions.filter(
      (suggestion) =>
        suggestion.diagnostics?.ruleIds.includes(
          "NI09-feedback-confirmation-contact",
        ),
    );
    assert.ok(
      chainPresentedSuggestions.length > 0,
      "the resolved chain should retain at least one feedback-confirmation suggestion",
    );
    for (const suggestion of chainPresentedSuggestions) {
      assert.match(suggestion.title, /^(前串联|后串联) 反馈确认/);
      assert.match(
        suggestion.text,
        /最终动作是 MC_MoveAbsolute \(Mc_Move_Absolute_Feed\)/,
      );
      assert.ok(
        !suggestion.text.includes("random-position-action"),
        "chain presentation must not expose raw node ids",
      );
      assert.equal(
        suggestion.diagnostics.score.businessChain,
        8,
        "resolved presentation plus a high-confidence selected role should receive the configured chain score",
      );
    }

    const unresolvedResult = await getLocalGraphSuggestions({
      diagramPath,
      segmentId: "segment-random-name-positioning",
      selectedNodeId: "random-unknown-condition",
    });
    assert.ok(
      (unresolvedResult?.payload?.suggestions ?? []).some(
        (suggestion) => suggestion.serialOrParallel === "parallel",
      ),
      "an unresolved condition must retain the existing parallel topology suggestion",
    );

    const timerResult = await getLocalGraphSuggestions({
      diagramPath,
      segmentId: "segment-timer-output-chain",
      selectedNodeId: "timer-enable-contact",
    });
    const timerChain =
      timerResult?.payload?.recognizedFocus?.businessChainContext;
    assert.equal(timerChain?.primaryActionNodeId, "timer-output-coil");
    assert.equal(
      timerChain?.nodes.find((node) => node.nodeId === "timer-block")
        ?.chainRole,
      "functionBlock",
      "an inline processing block must not hide the downstream output action",
    );
    assert.ok(
      timerChain?.localCapabilities.some(
        (capability) => capability.capability === "functionBlock:TON",
      ),
    );
    assert.ok(
      timerChain?.localCapabilities.some(
        (capability) => capability.capability === "output:coil",
      ),
    );

    const noEvidenceResult = await getLocalGraphSuggestions({
      diagramPath,
      segmentId: "segment-no-evidence-chain",
      selectedNodeId: "no-evidence-contact",
    });
    const noEvidenceChain =
      noEvidenceResult?.payload?.recognizedFocus?.businessChainContext;
    assert.notEqual(noEvidenceChain?.resolution, "resolved");
    assert.equal(noEvidenceChain?.evidenceSummary.high, 0);
    assert.ok(
      (noEvidenceResult?.payload?.suggestions ?? []).every(
        (suggestion) =>
          !suggestion.title.includes("无业务证据链：") &&
          (suggestion.diagnostics?.score.businessChain ?? 0) === 0,
      ),
      "a chain without reliable evidence must keep the original presentation and ranking",
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function assertBusinessChainSuggestionGuardCases() {
  const selectedNode = {
    id: "selected-condition",
    kind: "contact",
    var: "Selected_Status",
    from: ["start"],
    to: ["action"],
  };
  const focus = {
    segment: {
      segmentId: "segment-guard",
      label: "",
      note: "",
      nodes: [selectedNode],
      insertionPoints: [],
    },
    node: selectedNode,
    source: "selectedNodeId",
  };
  const role = (name, strength = "high") => ({
    role: name,
    score: strength === "high" ? 10 : 1,
    strength,
    sources: strength === "high" ? ["port"] : ["name"],
    groupKeys: [],
  });
  const context = {
    schemaVersion: "ide-agent.business-chain-context.v1",
    resolution: "resolved",
    segmentId: "segment-guard",
    segmentLabel: "",
    segmentNote: "",
    focusNodeId: selectedNode.id,
    primaryActionNodeId: "action",
    actionNodeIds: ["action"],
    nodes: [
      {
        nodeId: selectedNode.id,
        nodeType: "contact",
        selected: true,
        chainRole: "condition",
        variableName: "Selected_Status",
        dataType: "BOOL",
        blockType: "",
        instanceName: "",
        references: ["Selected_Status"],
        roles: [role("runFeedback")],
        ports: [],
      },
      {
        nodeId: "action",
        nodeType: "FBDCompartment",
        selected: false,
        chainRole: "action",
        variableName: "",
        dataType: "",
        blockType: "MC_MoveAbsolute",
        instanceName: "Move_Fb",
        references: ["Feed_Axis", "Move_Request"],
        roles: [],
        ports: [
          {
            port: "Axis",
            direction: "input",
            reference: "Feed_Axis",
            dataType: "AXIS_REF",
            roles: [role("axisReference")],
          },
          {
            port: "Execute",
            direction: "input",
            reference: "Move_Request",
            dataType: "BOOL",
            roles: [role("commandSignal")],
          },
        ],
      },
    ],
    localCapabilities: [
      {
        capability: "edge:rising",
        scope: "localChain",
        segmentId: "segment-guard",
        providerNodeId: "existing-edge",
        reference: "Move_Request",
        sharedReferences: [],
      },
    ],
    relatedCapabilities: [],
    evidenceSummary: {
      high: 3,
      medium: 0,
      low: 0,
      unresolvedConditionNodeIds: [],
    },
  };
  const suggestion = ({
    nodeType = "contact",
    blockType = "",
    variableName = "???",
    relationToFocus = "afterSelected",
    isFunction = false,
  } = {}) => ({
    id: "guard-candidate",
    mode:
      relationToFocus === "parallelWithSelected"
        ? "parallelBranch"
        : "functionBlockAfter",
    confidence: 1,
    placement: {
      relationToFocus,
      anchorNodeId: selectedNode.id,
      anchorNodeVar: selectedNode.var,
      insertAfterNodeId: selectedNode.id,
      insertBeforeNodeId: "action",
      parallelToNodeId:
        relationToFocus === "parallelWithSelected" ? selectedNode.id : "",
      branchFromNodeId: "start",
      branchToNodeId: "action",
      portName: "",
      text: "",
    },
    addElement: {
      nodeType,
      displayLabel: "",
      variableSource: "placeholder",
      variableName,
      dataType: "BOOL",
      userInputRequired: true,
      blockType,
      instanceSource: "placeholder",
      instanceName: "???",
      isFunction,
    },
  });

  assert.deepStrictEqual(
    filterBusinessChainGuardedSuggestions(
      [suggestion({ nodeType: "risingContact" })],
      focus,
      context,
    ),
    [],
    "an existing rising edge elsewhere in the resolved chain must satisfy a placeholder edge suggestion",
  );
  assert.equal(
    filterBusinessChainGuardedSuggestions(
      [
        suggestion({
          nodeType: "risingContact",
          variableName: "Different_Request",
        }),
      ],
      focus,
      context,
    ).length,
    1,
    "an explicitly different edge variable must remain available",
  );
  assert.deepStrictEqual(
    filterBusinessChainGuardedSuggestions(
      [suggestion({ relationToFocus: "parallelWithSelected" })],
      focus,
      context,
    ),
    [],
    "parallel insertion must not bypass a high-confidence protected condition",
  );

  const lowEvidenceContext = {
    ...context,
    nodes: [
      {
        ...context.nodes[0],
        roles: [role("runFeedback", "low")],
      },
      context.nodes[1],
    ],
  };
  assert.equal(
    filterBusinessChainGuardedSuggestions(
      [suggestion({ relationToFocus: "parallelWithSelected" })],
      focus,
      lowEvidenceContext,
    ).length,
    1,
    "name-only role evidence must not remove an existing topology suggestion",
  );

  const stopSuggestion = suggestion({
    nodeType: "functionBlock",
    blockType: "MC_Stop",
  });
  const sameAxisOnlyContext = {
    ...context,
    relatedCapabilities: [
      {
        capability: "functionBlock:MC_STOP",
        scope: "relatedSegment",
        segmentId: "other-segment",
        providerNodeId: "other-stop",
        blockType: "MC_Stop",
        sharedReferences: ["Feed_Axis"],
      },
    ],
  };
  assert.equal(
    filterBusinessChainGuardedSuggestions(
      [stopSuggestion],
      focus,
      sameAxisOnlyContext,
    ).length,
    1,
    "the same axis alone must not suppress a distinct motion command request",
  );

  const homeSuggestion = suggestion({
    nodeType: "functionBlock",
    blockType: "MC_Home",
  });
  assert.deepStrictEqual(
    filterBusinessChainGuardedSuggestions(
      [homeSuggestion],
      focus,
      {
        ...context,
        relatedCapabilities: [
          {
            capability: "functionBlock:MC_HOME",
            scope: "relatedSegment",
            segmentId: "home-segment",
            providerNodeId: "existing-home",
            blockType: "MC_Home",
            sharedReferences: ["Feed_Axis"],
          },
        ],
      },
    ),
    [],
    "an identity-scoped block already present for the same high-confidence axis must be suppressed",
  );

  const sameCommandContext = {
    ...sameAxisOnlyContext,
    relatedCapabilities: [
      {
        ...sameAxisOnlyContext.relatedCapabilities[0],
        sharedReferences: ["Feed_Axis", "Move_Request"],
      },
    ],
  };
  assert.deepStrictEqual(
    filterBusinessChainGuardedSuggestions(
      [stopSuggestion],
      focus,
      sameCommandContext,
    ),
    [],
    "the same motion capability, axis identity, and command context must be treated as already present",
  );

  const pureFunctionSuggestion = suggestion({
    nodeType: "functionBlock",
    blockType: "LIMIT",
    isFunction: true,
  });
  assert.equal(
    filterBusinessChainGuardedSuggestions(
      [pureFunctionSuggestion],
      focus,
      {
        ...context,
        localCapabilities: [
          {
            capability: "function:LIMIT",
            scope: "localChain",
            segmentId: "segment-guard",
            providerNodeId: "existing-limit",
            sharedReferences: [],
          },
        ],
      },
    ).length,
    1,
    "stateless IEC functions may be used more than once in the same chain",
  );
}

function businessChainContextDiagram() {
  const variable = (name, type, scope = "VAR") => ({ name, type, scope });
  const port = (name, value, type, scope) => ({ name, value, type, scope });
  return {
    pouName: "BUSINESS_CHAIN_RANDOM_NAMES",
    pouType: "PROGRAM",
    variableList: [
      variable("X1", "BOOL"),
      variable("X2", "BOOL"),
      variable("Feed_Axis", "AXIS_REF"),
      variable("Feed_Power_Enable", "BOOL"),
      variable("Feed_Home_Request", "BOOL"),
      variable("Feed_Home_Done", "BOOL"),
      variable("Axis_Home_Complete", "BOOL"),
      variable("Feed_Request", "BOOL"),
      variable("Feed_Move_Done", "BOOL"),
      variable("Mc_Power_Feed", "MC_Power"),
      variable("Mc_Home_Feed", "MC_Home"),
      variable("Mc_Move_Absolute_Feed", "MC_MoveAbsolute"),
      variable("Delay_Enable", "BOOL"),
      variable("Delay_Done", "BOOL"),
      variable("Delay_Timer", "TON"),
      variable("Plain_Input", "BOOL"),
      variable("Plain_Output", "BOOL"),
    ],
    segmentList: [
      {
        id: "segment-random-name-power",
        label: "送料轴上电",
        note: "X1 名称不包含业务语义，但由 Status 端口提供角色证据。",
        nodesObj: {
          "random-power-start": {
            id: "random-power-start",
            type: "startLine",
            sourceIds: [],
            targetIds: ["random-power-block"],
          },
          "random-power-block": {
            id: "random-power-block",
            type: "FBDCompartment",
            sourceIds: ["random-power-start"],
            targetIds: ["random-power-end"],
            childrenNode: {
              type: "MC_Power",
              isFunction: false,
              varName: port("", "Mc_Power_Feed", "MC_Power", "VAR"),
              portInputs: [
                port("EN", "", "", ""),
                port("Axis", "Feed_Axis", "AXIS_REF", "VAR_IN_OUT"),
                port("Enable", "Feed_Power_Enable", "BOOL", "VAR_INPUT"),
                port("bRegulatorOn", "TRUE", "BOOL", "VAR_INPUT"),
                port("bDriveStart", "TRUE", "BOOL", "VAR_INPUT"),
              ],
              portOutputs: [
                port("ENO", "", "", ""),
                port("Status", "X1", "BOOL", "VAR_OUTPUT"),
                port("bRegulatorRealState", "", "BOOL", "VAR_OUTPUT"),
                port("bDriveStartRealState", "", "BOOL", "VAR_OUTPUT"),
                port("Busy", "", "BOOL", "VAR_OUTPUT"),
                port("Error", "", "BOOL", "VAR_OUTPUT"),
                port("ErrorID", "", "SMC_ERROR", "VAR_OUTPUT"),
              ],
            },
          },
          "random-power-end": {
            id: "random-power-end",
            type: "endLine",
            sourceIds: ["random-power-block"],
            targetIds: [],
          },
        },
      },
      {
        id: "segment-random-name-home",
        label: "送料轴回零",
        note: "同一轴已存在回零命令。",
        nodesObj: {
          "random-home-start": {
            id: "random-home-start",
            type: "startLine",
            sourceIds: [],
            targetIds: ["random-home-block"],
          },
          "random-home-block": {
            id: "random-home-block",
            type: "FBDCompartment",
            sourceIds: ["random-home-start"],
            targetIds: ["random-home-end"],
            childrenNode: {
              type: "MC_Home",
              isFunction: false,
              varName: port("", "Mc_Home_Feed", "MC_Home", "VAR"),
              portInputs: [
                port("EN", "", "", ""),
                port("Axis", "Feed_Axis", "AXIS_REF", "VAR_IN_OUT"),
                port("Execute", "Feed_Home_Request", "BOOL", "VAR_INPUT"),
                port("Position", "0.0", "LREAL", "VAR_INPUT"),
              ],
              portOutputs: [
                port("ENO", "", "", ""),
                port("Done", "Feed_Home_Done", "BOOL", "VAR_OUTPUT"),
                port("Busy", "", "BOOL", "VAR_OUTPUT"),
                port("CommandAborted", "", "BOOL", "VAR_OUTPUT"),
                port("Error", "", "BOOL", "VAR_OUTPUT"),
                port("ErrorID", "", "SMC_ERROR", "VAR_OUTPUT"),
              ],
            },
          },
          "random-home-end": {
            id: "random-home-end",
            type: "endLine",
            sourceIds: ["random-home-block"],
            targetIds: [],
          },
        },
      },
      {
        id: "segment-random-name-positioning",
        label: "送料轴绝对定位",
        note: "未知条件、轴上电、回零完成和请求沿共同触发定位。",
        nodesObj: {
          "random-position-start": {
            id: "random-position-start",
            type: "startLine",
            sourceIds: [],
            targetIds: ["random-unknown-condition"],
          },
          "random-unknown-condition": {
            id: "random-unknown-condition",
            type: "contact",
            sourceIds: ["random-position-start"],
            targetIds: ["random-power-status-contact"],
            varName: port("", "X2", "BOOL", "VAR"),
          },
          "random-power-status-contact": {
            id: "random-power-status-contact",
            type: "contact",
            sourceIds: ["random-unknown-condition"],
            targetIds: ["random-home-complete-contact"],
            varName: port("", "X1", "BOOL", "VAR"),
          },
          "random-home-complete-contact": {
            id: "random-home-complete-contact",
            type: "contact",
            sourceIds: ["random-power-status-contact"],
            targetIds: ["random-position-trigger"],
            varName: port("", "Axis_Home_Complete", "BOOL", "VAR"),
          },
          "random-position-trigger": {
            id: "random-position-trigger",
            type: "risingContact",
            sourceIds: ["random-home-complete-contact"],
            targetIds: ["random-position-action"],
            varName: port("", "Feed_Request", "BOOL", "VAR"),
          },
          "random-position-action": {
            id: "random-position-action",
            type: "FBDCompartment",
            sourceIds: ["random-position-trigger"],
            targetIds: ["random-position-end"],
            childrenNode: {
              type: "MC_MoveAbsolute",
              isFunction: false,
              varName: port(
                "",
                "Mc_Move_Absolute_Feed",
                "MC_MoveAbsolute",
                "VAR",
              ),
              portInputs: [
                port("EN", "", "", ""),
                port("Axis", "Feed_Axis", "AXIS_REF", "VAR_IN_OUT"),
                port("Execute", "Feed_Request", "BOOL", "VAR_INPUT"),
                port("Position", "0.0", "LREAL", "VAR_INPUT"),
                port("Velocity", "1.0", "LREAL", "VAR_INPUT"),
                port("Acceleration", "1.0", "LREAL", "VAR_INPUT"),
                port("Deceleration", "1.0", "LREAL", "VAR_INPUT"),
                port("Jerk", "0.0", "LREAL", "VAR_INPUT"),
                port("Direction", "0", "MC_Direction", "VAR_INPUT"),
                port("BufferMode", "0", "MC_BUFFER_MODE", "VAR_INPUT"),
              ],
              portOutputs: [
                port("ENO", "", "", ""),
                port("Done", "Feed_Move_Done", "BOOL", "VAR_OUTPUT"),
                port("Busy", "", "BOOL", "VAR_OUTPUT"),
                port("Active", "", "BOOL", "VAR_OUTPUT"),
                port("CommandAborted", "", "BOOL", "VAR_OUTPUT"),
                port("Error", "", "BOOL", "VAR_OUTPUT"),
                port("ErrorID", "", "SMC_ERROR", "VAR_OUTPUT"),
              ],
            },
          },
          "random-position-end": {
            id: "random-position-end",
            type: "endLine",
            sourceIds: ["random-position-action"],
            targetIds: [],
          },
        },
      },
      {
        id: "segment-timer-output-chain",
        label: "延时完成输出",
        note: "TON 是处理中间块，最终动作是输出线圈。",
        nodesObj: {
          "timer-chain-start": {
            id: "timer-chain-start",
            type: "startLine",
            sourceIds: [],
            targetIds: ["timer-enable-contact"],
          },
          "timer-enable-contact": {
            id: "timer-enable-contact",
            type: "contact",
            sourceIds: ["timer-chain-start"],
            targetIds: ["timer-block"],
            varName: port("", "Delay_Enable", "BOOL", "VAR"),
          },
          "timer-block": {
            id: "timer-block",
            type: "FBDCompartment",
            sourceIds: ["timer-enable-contact"],
            targetIds: ["timer-output-coil"],
            childrenNode: {
              type: "TON",
              isFunction: false,
              varName: port("", "Delay_Timer", "TON", "VAR"),
              portInputs: [
                port("EN", "", "", ""),
                port("IN", "Delay_Enable", "BOOL", "VAR_INPUT"),
                port("PT", "T#1s", "TIME", "VAR_INPUT"),
              ],
              portOutputs: [
                port("ENO", "", "", ""),
                port("Q", "Delay_Done", "BOOL", "VAR_OUTPUT"),
                port("ET", "", "TIME", "VAR_OUTPUT"),
              ],
            },
          },
          "timer-output-coil": {
            id: "timer-output-coil",
            type: "coil",
            sourceIds: ["timer-block"],
            targetIds: ["timer-chain-end"],
            varName: port("", "Delay_Done", "BOOL", "VAR"),
          },
          "timer-chain-end": {
            id: "timer-chain-end",
            type: "endLine",
            sourceIds: ["timer-output-coil"],
            targetIds: [],
          },
        },
      },
      {
        id: "segment-no-evidence-chain",
        label: "无业务证据链",
        note: "",
        nodesObj: {
          "no-evidence-start": {
            id: "no-evidence-start",
            type: "startLine",
            sourceIds: [],
            targetIds: ["no-evidence-contact"],
          },
          "no-evidence-contact": {
            id: "no-evidence-contact",
            type: "contact",
            sourceIds: ["no-evidence-start"],
            targetIds: ["no-evidence-coil"],
            varName: port("", "Plain_Input", "BOOL", "VAR"),
          },
          "no-evidence-coil": {
            id: "no-evidence-coil",
            type: "coil",
            sourceIds: ["no-evidence-contact"],
            targetIds: ["no-evidence-end"],
            varName: port("", "Plain_Output", "BOOL", "VAR"),
          },
          "no-evidence-end": {
            id: "no-evidence-end",
            type: "endLine",
            sourceIds: ["no-evidence-coil"],
            targetIds: [],
          },
        },
      },
    ],
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
  assert.equal(missingTonSuggestion?.diagnostics?.source, "businessRules");
  assert.ok(
    missingTonSuggestion?.diagnostics?.ruleIds.includes("T04-ton-completion"),
    "the returned TON suggestion should expose the rule that recommended it",
  );
  assert.ok(
    missingTonSuggestion?.diagnostics?.signatureIds.includes(
      "LS06-on-delay-missing-timer",
    ),
    "the returned TON suggestion should expose the matched loop signature",
  );
  assert.match(
    missingTonSuggestion?.diagnostics?.reason ?? "",
    /\S/,
    "the returned TON suggestion should explain why it was recommended",
  );
  assert.ok(
    (missingTonSuggestion?.diagnostics?.confidence ?? 0) > 0 &&
      (missingTonSuggestion?.diagnostics?.confidence ?? 0) <= 1,
    "diagnostic confidence should use the public 0..1 range",
  );
  const missingTonScore = missingTonSuggestion?.diagnostics?.score;
  assert.equal(
    missingTonScore?.total,
    (missingTonScore?.topology ?? 0) +
      (missingTonScore?.rankingRules ?? 0) +
      (missingTonScore?.businessEvidence ?? 0) +
      (missingTonScore?.businessChain ?? 0),
    "diagnostic score total should equal its component scores",
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

  const sameAxisResult = await getLocalGraphSuggestions({
    diagramPath: motionAxisContextFixturePath,
    segmentId: "segment-stop-focus",
    selectedNodeId: "stop-focus-contact",
  });
  const sameAxisSuggestions = sameAxisResult?.payload?.suggestions ?? [];
  const sameAxisStopSuggestion = findFunctionBlockSuggestion(
    sameAxisSuggestions,
    "MC_STOP",
  );
  assert.ok(
    sameAxisStopSuggestion,
    "same-axis context must not suppress an otherwise valid MC_Stop suggestion",
  );
  assert.equal(
    sameAxisStopSuggestion.title,
    "补充 Feed_Axis 受控停止",
  );
  assert.match(sameAxisStopSuggestion.text, /MC_MoveVelocity/);
  assert.doesNotMatch(sameAxisStopSuggestion.text, /MC_MoveAbsolute/);
  assert.match(sameAxisStopSuggestion.text, /Feed_Stop_Lock_Request/);
  assert.match(sameAxisStopSuggestion.text, /释放 Execute/);
  assert.deepStrictEqual(sameAxisStopSuggestion.startNodes, [
    "stop-focus-contact",
  ]);
  assert.deepStrictEqual(sameAxisStopSuggestion.endNodes, ["stop-focus-end"]);
  assert.equal(sameAxisStopSuggestion.position, "behind");
  assert.equal(sameAxisStopSuggestion.serialOrParallel, "serial");
  const sameAxisContext =
    sameAxisResult?.payload?.recognizedFocus?.motionAxisContext;
  assert.equal(sameAxisContext?.axisReference, "Feed_Axis");
  assert.equal(sameAxisContext?.resolution, "neighborPort");
  assert.equal(sameAxisContext?.runtimeStateKnown, false);
  assert.ok(
    sameAxisContext?.commands.some(
      (command) => command.blockType === "MC_MoveVelocity",
    ),
  );
  const sameAxisPower = sameAxisContext?.commands.find(
    (command) => command.blockType === "MC_Power",
  );
  assert.equal(sameAxisPower?.triggerModel, "level");
  assert.equal(sameAxisPower?.triggerPort, "Enable");
  assert.equal(sameAxisPower?.triggerReference, "Feed_Power_Enable");
  assert.equal(sameAxisPower?.executeReference, "");
  assert.deepStrictEqual(sameAxisPower?.activeReferences, [
    "Feed_Power_Status",
  ]);
  assert.deepStrictEqual(sameAxisPower?.busyReferences, ["Feed_Power_Busy"]);
  assert.deepStrictEqual(sameAxisPower?.faultReferences, [
    "Feed_Power_Error",
  ]);
  const sameAxisMove = sameAxisContext?.commands.find(
    (command) => command.blockType === "MC_MoveVelocity",
  );
  assert.equal(sameAxisMove?.triggerModel, "risingEdge");
  assert.equal(sameAxisMove?.triggerPort, "Execute");
  assert.equal(sameAxisMove?.triggerReference, "Feed_Move_Request");
  assert.deepStrictEqual(sameAxisMove?.completionReferences, [
    "Feed_In_Velocity",
  ]);
  assert.deepStrictEqual(sameAxisMove?.activeReferences, [
    "Feed_Move_Active",
  ]);
  assert.deepStrictEqual(sameAxisMove?.busyReferences, ["Feed_Move_Busy"]);
  assert.deepStrictEqual(sameAxisMove?.faultReferences, ["Feed_Move_Error"]);
  assert.ok(
    !sameAxisContext?.commands.some(
      (command) => command.blockType === "MC_MoveAbsolute",
    ),
    "a command bound to another AXIS_REF must not enter the same-axis context",
  );
  assert.ok(
    sameAxisContext?.lockingStops.some(
      (stop) =>
        stop.executeReference === "Feed_Stop_Lock_Request" &&
        stop.requiresExecuteRelease === true,
    ),
  );

  const homeResult = await getLocalGraphSuggestions({
    diagramPath: motionAxisContextFixturePath,
    segmentId: "segment-home-focus",
    selectedNodeId: "home-focus-contact",
  });
  const homeSuggestion = findFunctionBlockSuggestion(
    homeResult?.payload?.suggestions ?? [],
    "MC_HOME",
  );
  assert.ok(homeSuggestion, "same-axis home intent should suggest MC_Home");
  assert.equal(homeSuggestion.title, "补充 Feed_Axis 回零命令");
  assert.match(homeSuggestion.text, /Execute 上升沿/);
  assert.match(homeSuggestion.text, /Feed_In_Velocity/);
  assert.match(homeSuggestion.text, /MC_Power/);
  assert.match(homeSuggestion.text, /状态机/);

  const existingPowerResult = await getLocalGraphSuggestions({
    diagramPath: motionAxisContextFixturePath,
    segmentId: "segment-power-focus",
    selectedNodeId: "power-focus-contact",
  });
  assert.ok(
    !findFunctionBlockSuggestion(
      existingPowerResult?.payload?.suggestions ?? [],
      "MC_POWER",
    ),
    "the same axis, block type and Enable reference must not suggest duplicate MC_Power",
  );
  const existingPowerContext =
    existingPowerResult?.payload?.recognizedFocus?.motionAxisContext;
  assert.ok(
    existingPowerContext?.commands.some(
      (command) =>
        command.blockType === "MC_Power" &&
        command.triggerModel === "level" &&
        command.triggerPort === "Enable" &&
        command.triggerReference === "Feed_Power_Enable",
    ),
  );

  const unboundAxisResult = await getLocalGraphSuggestions({
    diagramPath: motionAxisContextFixturePath,
    segmentId: "segment-unbound-stop",
    selectedNodeId: "unbound-stop-contact",
  });
  assert.equal(
    unboundAxisResult?.payload?.recognizedFocus?.motionAxisContext,
    undefined,
    "an unbound Axis port must not produce guessed same-axis context",
  );
  const unboundStopSuggestion = findFunctionBlockSuggestion(
    unboundAxisResult?.payload?.suggestions ?? [],
    "MC_STOP",
  );
  if (unboundStopSuggestion) {
    assert.notEqual(
      unboundStopSuggestion.title,
      "补充 ??? 受控停止",
      "unbound Axis must keep the existing fallback presentation",
    );
  }

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
  const estopOkContactSuggestion = estopOkSuggestions.find(
    (suggestion) => firstAddedNode(suggestion)?.type === "contact",
  );
  assert.ok(
    estopOkContactSuggestion?.diagnostics?.ruleIds.includes(
      "P02-healthy-permissive-normal",
    ),
    "a positive-logic permissive suggestion should expose its normal-contact rule",
  );
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

async function assertDeviceLoopCompletionCases() {
  const pumpSuggestions = await suggestionsFor(
    deviceLoopCompletionFixturePath,
    "segment-pump-start",
    "pump-start-coil",
  );
  const pumpReady = suggestionForVariable(
    pumpSuggestions,
    "Pump1_Ready",
    "contact",
  );
  const pumpFault = suggestionForVariable(
    pumpSuggestions,
    "Pump1_Fault",
    "negatedContact",
  );
  assert.ok(pumpReady, "a pump action loop should suggest its ready permissive");
  assert.ok(pumpFault, "a pump action loop should suggest its fault interlock");
  assert.match(pumpReady.title, /Pump1_Ready.*就绪许可/);
  assert.match(pumpFault.title, /Pump1_Fault.*故障联锁/);
  assert.match(pumpReady.text, /Pump1_Start/);
  assert.match(pumpFault.text, /故障有效时切断动作许可/);
  assert.equal(firstAddedNode(pumpReady)?.varName?.scope, "VAR");
  assert.ok(pumpReady.startNodes.length > 0 && pumpReady.endNodes.length > 0);
  assert.ok(
    !pumpReady.startNodes.some((nodeId) => pumpReady.endNodes.includes(nodeId)),
    "device-loop copy and binding must not alter topology boundaries",
  );
  assert.ok(
    !suggestionForVariable(pumpSuggestions, "Pump1_Run_Feedback"),
    "run feedback must not be inserted as a start permissive",
  );

  const existingReadySuggestions = await suggestionsFor(
    deviceLoopCompletionFixturePath,
    "segment-pump-existing-ready",
    "pump2-command",
  );
  assert.ok(
    !suggestionForVariable(existingReadySuggestions, "Pump2_Ready"),
    "a ready signal already present upstream must not be suggested again",
  );
  assert.ok(
    suggestionForVariable(
      existingReadySuggestions,
      "Pump2_Fault",
      "negatedContact",
    ),
    "a different missing condition in the same device loop should remain available",
  );

  const commentSuggestions = await suggestionsFor(
    deviceLoopCompletionFixturePath,
    "segment-fan-comment",
    "fan-command",
  );
  assert.ok(
    suggestionForVariable(commentSuggestions, "X17", "contact"),
    "comments should associate a non-semantic ready variable with its device command",
  );
  assert.ok(
    suggestionForVariable(commentSuggestions, "X18", "negatedContact"),
    "comments should associate a non-semantic fault variable with its device command",
  );

  const valveSuggestions = await suggestionsFor(
    deviceLoopCompletionFixturePath,
    "segment-valve-open",
    "valve-command",
  );
  assert.ok(
    suggestionForVariable(valveSuggestions, "Valve01_Ready", "contact"),
    "the generic loop mechanism should support valve open commands",
  );
  assert.ok(
    suggestionForVariable(
      valveSuggestions,
      "Valve01_Fault",
      "negatedContact",
    ),
    "the generic loop mechanism should support valve fault interlocks",
  );

  const crossDeviceSuggestions = await suggestionsFor(
    deviceLoopCompletionFixturePath,
    "segment-cross-device",
    "cross-command",
  );
  assert.ok(
    !suggestionForVariable(crossDeviceSuggestions, "Pump_Ready"),
    "conflicting explicit device ids must override a shared name stem",
  );
  assert.ok(
    !suggestionForVariable(crossDeviceSuggestions, "Pump_Fault"),
    "fault signals from another explicit device must not be mixed into the action loop",
  );

  const conveyorSuggestions = await suggestionsFor(
    deviceLoopCompletionFixturePath,
    "segment-conveyor-section",
    "conveyor-command",
  );
  assert.ok(
    suggestionForVariable(conveyorSuggestions, "ConveyorA_Run_Permit", "contact"),
    "a conveyor section should suggest its same-device run permit",
  );
  assert.ok(
    suggestionForVariable(conveyorSuggestions, "ConveyorA_Jam", "negatedContact"),
    "a conveyor section should suggest a normally-closed jam interlock",
  );
  assert.ok(
    suggestionForVariable(conveyorSuggestions, "ConveyorA_Occupied", "contact"),
    "a conveyor section should recognize material-presence conditions",
  );
  assert.ok(
    !suggestionForVariable(conveyorSuggestions, "ConveyorA_Run_FB", "contact"),
    "a conveyor run feedback must not be inserted before its run command",
  );

  const stationSuggestions = await suggestionsFor(
    deviceLoopCompletionFixturePath,
    "segment-station-action",
    "station-command",
  );
  assert.ok(
    suggestionForVariable(stationSuggestions, "Station01_Clamp_Permit", "contact"),
    "a station action should suggest its same-device action permit",
  );
  assert.ok(
    suggestionForVariable(stationSuggestions, "Station01_Clamp_Ready", "contact"),
    "a clamp action should suggest its same-device ready permissive",
  );
  assert.ok(
    suggestionForVariable(stationSuggestions, "Station01_Clamp_Fault", "negatedContact"),
    "a clamp action should suggest its same-device fault interlock",
  );
  assert.ok(
    suggestionForVariable(stationSuggestions, "Station01_Clamp_Block", "negatedContact"),
    "a station action should suggest a normally-closed action block",
  );
  assert.equal(
    suggestionForVariable(stationSuggestions, "Station01_Push_Permit", "contact"),
    undefined,
    "same-station conditions for a different action must not be mixed into the selected action",
  );
  const stationRequestSuggestions = await suggestionsFor(
    deviceLoopCompletionFixturePath,
    "segment-station-action",
    "station-request",
  );
  assert.ok(
    stationRequestSuggestions.some(
      (suggestion) =>
        firstAddedNode(suggestion)?.type === "FBDCompartment" &&
        String(firstAddedNode(suggestion)?.childrenNode?.type ?? "").toUpperCase() === "TON",
    ),
    "an action with completion feedback and timeout should retain the generic TON recommendation",
  );
}

async function assertOppositeActionInterlockCases() {
  const valveSuggestions = await suggestionsFor(
    oppositeActionInterlockFixturePath,
    "segment-valve-open-close",
    "valve-open-command",
  );
  const closeInterlock = suggestionForVariable(
    valveSuggestions,
    "Valve01_Close_Cmd",
    "negatedContact",
  );
  assert.ok(closeInterlock, "an open command should suggest the same valve close command as a normally-closed interlock");
  assert.match(closeInterlock.title, /Valve01_Close_Cmd.*相反动作互锁/);
  assert.match(closeInterlock.text, /Valve01_Open_Cmd.*Valve01_Close_Cmd.*避免两个方向同时输出/);

  const motorSuggestions = await suggestionsFor(
    oppositeActionInterlockFixturePath,
    "segment-motor-forward-reverse",
    "motor-forward-command",
  );
  assert.ok(
    suggestionForVariable(motorSuggestions, "Motor01_Reverse_Cmd", "negatedContact"),
    "forward and reverse commands should associate through a stable name stem without explicit ids",
  );

  const existingSuggestions = await suggestionsFor(
    oppositeActionInterlockFixturePath,
    "segment-existing-opposite",
    "existing-open-command",
  );
  assert.ok(
    !suggestionForVariable(existingSuggestions, "Valve02_Close_Cmd", "negatedContact"),
    "an opposite command already present upstream must not be suggested again",
  );

  const feedbackSuggestions = await suggestionsFor(
    oppositeActionInterlockFixturePath,
    "segment-feedback-not-command",
    "feedback-command",
  );
  assert.ok(
    !suggestionForVariable(feedbackSuggestions, "Cylinder01_Retract_Done", "negatedContact"),
    "an opposite-position feedback must not be treated as an opposite command",
  );

  const crossDeviceSuggestions = await suggestionsFor(
    oppositeActionInterlockFixturePath,
    "segment-cross-device-opposite",
    "cross-open-command",
  );
  assert.ok(
    !suggestionForVariable(crossDeviceSuggestions, "Shared_Close_Cmd", "negatedContact"),
    "opposite actions with conflicting explicit device ids must not be paired",
  );

  const nonOppositeSuggestions = await suggestionsFor(
    oppositeActionInterlockFixturePath,
    "segment-non-opposite",
    "non-opposite-command",
  );
  assert.ok(
    !suggestionForVariable(nonOppositeSuggestions, "Station01_Push_Cmd", "negatedContact"),
    "same-device actions not declared as opposites must not be interlocked",
  );

  const safetySuggestions = await suggestionsFor(
    oppositeActionInterlockFixturePath,
    "segment-safety-opposite",
    "safety-open-command",
  );
  assert.ok(
    !suggestionForVariable(safetySuggestions, "SafetyGate_Close_Cmd", "negatedContact"),
    "ordinary opposite-action completion must not generate safety logic",
  );
}

async function assertFaultResponseCompletionCases() {
  const faultSuggestions = await suggestionsFor(
    faultResponseCompletionFixturePath,
    "segment-fault-response",
    "fault-response-contact",
  );
  const alarmSuggestion = suggestionForVariable(
    faultSuggestions,
    "Pump01_Alarm",
    "coil",
  );
  const latchSuggestion = suggestionForVariable(
    faultSuggestions,
    "Pump01_Fault_Latched",
    "setCoil",
  );
  assert.ok(alarmSuggestion, "a device fault should suggest its same-group alarm output");
  assert.ok(latchSuggestion, "a device fault should suggest its same-group fault latch");
  assert.match(alarmSuggestion.title, /Pump01_Alarm.*报警线圈/);
  assert.match(latchSuggestion.title, /Pump01_Fault_Latched.*故障锁存/);
  assert.match(latchSuggestion.text, /独立复位路径/);
  assert.ok(
    !suggestionForVariable(faultSuggestions, "Pump02_Alarm", "coil"),
    "an alarm output from another device must not be mixed into the fault response",
  );
  assert.ok(
    !suggestionForVariable(faultSuggestions, "Pump01_Stop_Alarm", "coil"),
    "an alarm output from another explicit action group must not be mixed into the fault response",
  );

  const timeoutSuggestions = await suggestionsFor(
    faultResponseCompletionFixturePath,
    "segment-timeout-response",
    "timeout-response-contact",
  );
  assert.ok(
    suggestionForVariable(timeoutSuggestions, "Valve01_Open_Alarm", "coil"),
    "a BOOL timeout result should suggest its same-action alarm output",
  );

  const timerOutputSuggestions = await suggestionsFor(
    faultResponseCompletionFixturePath,
    "segment-timer-output-response",
    "timer-output-ton",
  );
  assert.ok(
    suggestionForVariable(timerOutputSuggestions, "Conveyor01_Run_Alarm", "coil"),
    "a TON with a bound BOOL timeout output should suggest its same-group alarm output",
  );

  const existingOutputSuggestions = await suggestionsFor(
    faultResponseCompletionFixturePath,
    "segment-existing-fault-output",
    "existing-fault-contact",
  );
  assert.ok(
    !suggestionForVariable(existingOutputSuggestions, "Fan01_Alarm", "coil"),
    "an alarm output already present downstream must not be suggested again",
  );

  const actionConflictSuggestions = await suggestionsFor(
    faultResponseCompletionFixturePath,
    "segment-fault-action-conflict",
    "action-conflict-contact",
  );
  assert.ok(
    !suggestionForVariable(actionConflictSuggestions, "Valve02_Close_Alarm", "coil"),
    "an alarm output for a different action on the same device must not be suggested",
  );

  const safetySuggestions = await suggestionsFor(
    faultResponseCompletionFixturePath,
    "segment-safety-fault-response",
    "safety-fault-contact",
  );
  assert.ok(
    !suggestionForVariable(safetySuggestions, "Safety_Gate_Alarm", "coil"),
    "safety fault logic must not receive ordinary business alarm completion",
  );
}

async function assertFaultResetCompletionCases() {
  const resetSuggestions = await suggestionsFor(
    faultResetCompletionFixturePath,
    "segment-pump01-fault-reset",
    "pump01-reset-contact",
  );
  const resetSuggestion = suggestionForVariable(
    resetSuggestions,
    "Pump01_Fault_Latched",
    "resetCoil",
  );
  assert.ok(
    resetSuggestion,
    "an independent reset command should reset its existing same-group fault latch",
  );
  assert.match(resetSuggestion.title, /Pump01_Fault_Latched.*故障复位/);
  assert.match(resetSuggestion.text, /另一独立回路.*置位线圈/);
  assert.deepStrictEqual(resetSuggestion.startNodes, ["pump01-reset-contact"]);
  assert.deepStrictEqual(resetSuggestion.endNodes, ["pump01-reset-end"]);
  assert.ok(
    !suggestionForVariable(
      resetSuggestions,
      "Pump02_Fault_Latched",
      "resetCoil",
    ),
    "a reset command must not reset another device's latch",
  );

  const existingResetSuggestions = await suggestionsFor(
    faultResetCompletionFixturePath,
    "segment-fan01-duplicate-reset",
    "fan01-duplicate-contact",
  );
  assert.ok(
    !suggestionForVariable(
      existingResetSuggestions,
      "Fan01_Fault_Latched",
      "resetCoil",
    ),
    "an existing reset coil must suppress duplicate reset completion",
  );

  const groupConflictSuggestions = await suggestionsFor(
    faultResetCompletionFixturePath,
    "segment-valve01-reset",
    "valve01-reset-contact",
  );
  assert.ok(
    !suggestionForVariable(
      groupConflictSuggestions,
      "Valve01_Fault_Latched",
      "resetCoil",
    ),
    "different explicit action groups on one device must not be mixed",
  );

  const noSetCoilSuggestions = await suggestionsFor(
    faultResetCompletionFixturePath,
    "segment-motor01-reset",
    "motor01-reset-contact",
  );
  assert.ok(
    !suggestionForVariable(
      noSetCoilSuggestions,
      "Motor01_Fault_Latched",
      "resetCoil",
    ),
    "a declared latch variable without an existing set coil is insufficient",
  );

  const safetyResetSuggestions = await suggestionsFor(
    faultResetCompletionFixturePath,
    "segment-safety-reset",
    "safety-reset-contact",
  );
  assert.ok(
    !suggestionForVariable(
      safetyResetSuggestions,
      "SafetyGate_Fault_Latched",
      "resetCoil",
    ),
    "ordinary business rules must not complete a safety reset path",
  );

  const nameFallbackSuggestions = await suggestionsFor(
    faultResetCompletionFixturePath,
    "segment-conveyor03-reset",
    "conveyor03-reset-contact",
  );
  assert.ok(
    suggestionForVariable(
      nameFallbackSuggestions,
      "Conveyor03_Fault_Latched",
      "resetCoil",
    ),
    "stable variable-name stems should support projects without explicit IDs",
  );

  const nameActionConflictSuggestions = await suggestionsFor(
    faultResetCompletionFixturePath,
    "segment-gate01-open-reset",
    "gate01-open-reset-contact",
  );
  assert.ok(
    !suggestionForVariable(
      nameActionConflictSuggestions,
      "Gate01_Close_Fault_Latched",
      "resetCoil",
    ),
    "name fallback must not mix different actions on one device",
  );
}

async function assertActionLifecycleCompletionCases() {
  const startSuggestions = await suggestionsFor(
    actionLifecycleCompletionFixturePath,
    "segment-pump01-start",
    "pump01-start-contact",
  );
  const selfHold = suggestionForVariable(
    startSuggestions,
    "Pump01_Run",
    "contact",
  );
  assert.ok(selfHold, "a start condition with an action output should suggest self-hold");
  assert.equal(selfHold.position, "parallel");
  assert.equal(selfHold.serialOrParallel, "parallel");
  assert.match(selfHold.title, /Pump01_Run.*自保持/);
  assert.match(selfHold.text, /启动按钮释放后动作仍保持/);
  assert.deepStrictEqual(selfHold.startNodes, ["pump01-start-rail"]);
  assert.deepStrictEqual(selfHold.endNodes, ["pump01-run-coil"]);

  const stopSuggestions = await suggestionsFor(
    actionLifecycleCompletionFixturePath,
    "segment-pump01-start",
    "pump01-start-contact",
  );
  const stopInterlock = suggestionForVariable(
    stopSuggestions,
    "Pump01_Stop",
    "negatedContact",
  );
  assert.ok(stopInterlock, "a same-group stop command should suggest a normally-closed release condition");
  assert.match(stopInterlock.title, /Pump01_Stop.*停止释放/);
  assert.deepStrictEqual(stopInterlock.startNodes, ["pump01-start-rail"]);
  assert.deepStrictEqual(stopInterlock.endNodes, ["pump01-start-contact"]);

  const latchedReleaseSuggestions = await suggestionsFor(
    actionLifecycleCompletionFixturePath,
    "segment-valve01-stop",
    "valve01-stop-contact",
  );
  const latchedRelease = suggestionForVariable(
    latchedReleaseSuggestions,
    "Valve01_Run",
    "resetCoil",
  );
  assert.ok(latchedRelease, "a stop command should release an existing same-group latched action");
  assert.match(latchedRelease.title, /Valve01_Run.*停止复位/);

  const existingHoldSuggestions = await suggestionsFor(
    actionLifecycleCompletionFixturePath,
    "segment-fan01-existing-hold",
    "fan01-start-contact",
  );
  assert.ok(
    !suggestionForVariable(existingHoldSuggestions, "Fan01_Run", "contact"),
    "an existing same-variable hold branch must suppress duplicate self-hold",
  );

  const noOutputSuggestions = await suggestionsFor(
    actionLifecycleCompletionFixturePath,
    "segment-motor01-buttons",
    "motor01-start",
  );
  assert.ok(
    !suggestionForVariable(noOutputSuggestions, "Motor01_Run", "contact"),
    "start and stop context without a real action output must not infer self-hold",
  );

  const safetySuggestions = await suggestionsFor(
    actionLifecycleCompletionFixturePath,
    "segment-safety-start",
    "safety-start",
  );
  assert.ok(
    !suggestionForVariable(safetySuggestions, "SafetyGate_Run", "contact"),
    "safety action logic must not receive ordinary self-hold completion",
  );
}

async function assertCounterCompletionLifecycleCases() {
  const completionSuggestions = await suggestionsFor(
    counterCompletionLifecycleFixturePath,
    "segment-pack01-counter-completion",
    "pack01-counter",
  );
  const completionOutput = suggestionForVariable(
    completionSuggestions,
    "Pack01_Batch_Done",
    "coil",
  );
  assert.ok(
    completionOutput,
    "a real counter completion output should suggest its same-group batch completion coil",
  );
  assert.match(completionOutput.title, /Pack01_Batch_Done.*批次完成线圈/);
  assert.match(completionOutput.text, /Pack01_Count_Q.*计数达到目标/);
  assert.deepStrictEqual(completionOutput.startNodes, ["pack01-counter"]);
  assert.deepStrictEqual(completionOutput.endNodes, ["pack01-counter-end"]);
  assert.equal(firstAddedNode(completionOutput)?.varName?.scope, "VAR");
  assert.ok(
    !suggestionForVariable(
      completionSuggestions,
      "Pack02_Batch_Done",
      "coil",
    ),
    "counter completion must not bind another device or batch",
  );

  const latchSuggestions = await suggestionsFor(
    counterCompletionLifecycleFixturePath,
    "segment-carton-counter-latch",
    "carton-counter",
  );
  const completionLatch = suggestionForVariable(
    latchSuggestions,
    "Carton_Batch_Done_Latched",
    "setCoil",
  );
  assert.ok(
    completionLatch,
    "an explicitly latched batch completion variable should use a set coil",
  );
  assert.match(completionLatch.title, /Carton_Batch_Done_Latched.*批次完成锁存/);
  assert.match(completionLatch.text, /独立复位路径/);

  const existingOutputSuggestions = await suggestionsFor(
    counterCompletionLifecycleFixturePath,
    "segment-case-existing-output",
    "case-counter",
  );
  assert.ok(
    !suggestionForVariable(
      existingOutputSuggestions,
      "Case_Batch_Done",
      "coil",
    ),
    "an existing batch completion output must suppress duplicate completion",
  );

  const crossGroupSuggestions = await suggestionsFor(
    counterCompletionLifecycleFixturePath,
    "segment-counter-cross-group",
    "cross-counter",
  );
  assert.ok(
    !suggestionForVariable(
      crossGroupSuggestions,
      "LineB_Batch_Done",
      "coil",
    ),
    "a counter must not emit another group's batch completion output",
  );

  const noCounterSuggestions = await suggestionsFor(
    counterCompletionLifecycleFixturePath,
    "segment-no-real-counter",
    "manual-done-contact",
  );
  assert.ok(
    !suggestionForVariable(noCounterSuggestions, "Manual_Batch_Done", "coil"),
    "a completion-like contact without a real counter must not trigger counter completion",
  );

  const unboundSuggestions = await suggestionsFor(
    counterCompletionLifecycleFixturePath,
    "segment-counter-unbound-q",
    "unbound-counter",
  );
  assert.ok(
    !suggestionForVariable(unboundSuggestions, "Loose_Batch_Done", "coil"),
    "an unbound counter completion port must not infer a batch completion output",
  );

  const nameFallbackSuggestions = await suggestionsFor(
    counterCompletionLifecycleFixturePath,
    "segment-counter-name-fallback",
    "line03-counter",
  );
  assert.ok(
    suggestionForVariable(
      nameFallbackSuggestions,
      "Line03_Batch_Done",
      "coil",
    ),
    "stable variable-name stems should provide same-group fallback when explicit IDs are absent",
  );

  const safetySuggestions = await suggestionsFor(
    counterCompletionLifecycleFixturePath,
    "segment-safety-counter-completion",
    "safety-counter",
  );
  assert.ok(
    !suggestionForVariable(safetySuggestions, "Safety_Batch_Done", "coil"),
    "ordinary counter lifecycle rules must not complete safety logic",
  );
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

function assertBusinessPresentation(
  ruleId,
  presentation,
  additionalPlaceholders = [],
) {
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
    ...additionalPlaceholders,
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

function suggestionForVariable(suggestions, variableName, nodeType) {
  const normalized = String(variableName).toUpperCase();
  return suggestions.find((suggestion) => {
    const node = firstAddedNode(suggestion);
    return (
      (!nodeType || node?.type === nodeType) &&
      String(node?.varName?.value ?? "").toUpperCase() === normalized
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

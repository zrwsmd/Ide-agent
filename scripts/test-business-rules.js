#!/usr/bin/env node

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const {
  getLocalGraphSuggestions,
  loadDiagramSummary,
} = require("../dist/node_modules/@ide-agent/core");

const rootDir = path.resolve(__dirname, "..");
const fixturePath = path.join(
  rootDir,
  "src",
  "test",
  "fixtures",
  "local-business-suggestion-fixture.json",
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
  await assertStableBusinessCases();
  await assertTimestampDiagramWhenAvailable();
  console.log("[test-business-rules] passed");
}

function assertActiveRuleCandidatesExistInLibrary() {
  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  assert.equal(rules.schemaVersion, "ide-agent.business-rules.v2");

  for (const rule of rules.libraryRules ?? []) {
    if (String(rule.status).toLowerCase() !== "active") {
      continue;
    }
    for (const candidateName of rule.candidateNames ?? []) {
      assert.ok(
        libraryElements.has(String(candidateName).toUpperCase()),
        `${rule.id} references missing st-library-info element: ${candidateName}`,
      );
    }
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

  const duplicateStopSuggestions = await suggestionsFor(
    fixturePath,
    "segment-existing-stop",
    "existing-stop-contact",
  );
  assert.ok(
    !functionBlockTypes(duplicateStopSuggestions).includes("MC_STOP"),
    "existing adjacent MC_Stop must not be suggested again",
  );

  for (const suggestion of [
    ...tonSuggestions,
    ...ordinaryResetSuggestions,
    ...axisResetSuggestions,
    ...limitSuggestions,
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

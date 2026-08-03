#!/usr/bin/env node

const assert = require("assert/strict");
const path = require("path");
const { getLocalGraphSuggestions } = require("../dist/node_modules/@ide-agent/core");

const fixturePath = path.resolve(
  __dirname,
  "..",
  "src",
  "test",
  "fixtures",
  "edit-rect-boundaries.json",
);

async function main() {
  await assertDirectTargetEditRectSuggestions();
  await assertDirectSourceEditRectFrontSuggestion();
  await assertLeftRailEditRectFrontSuggestions();

  console.log("[test-edit-rect-suggestions] passed");
}

async function assertDirectTargetEditRectSuggestions() {
  const result = await getLocalGraphSuggestions({
    diagramPath: fixturePath,
    segmentId: "segment-edit-target",
    selectedNodeId: "contact-a1",
  });
  const suggestions = result?.payload?.suggestions ?? [];

  const afterContact = findSuggestion(suggestions, {
    position: "behind",
    serialOrParallel: "serial",
    addType: "contact",
  });
  assertSuggestionBoundary(afterContact, {
    startNodes: ["contact-a1"],
    endNodes: ["edit-node-rect"],
    sourceIds: ["contact-a1"],
    targetIds: ["edit-node-rect"],
  });

  const afterFunctionBlock = findSuggestion(suggestions, {
    position: "behind",
    serialOrParallel: "serial",
    addType: "FBDCompartment",
  });
  assertSuggestionBoundary(afterFunctionBlock, {
    startNodes: ["contact-a1"],
    endNodes: ["edit-node-rect"],
    sourceIds: ["contact-a1"],
    targetIds: ["edit-node-rect"],
  });

  const parallelContact = findSuggestion(suggestions, {
    position: "parallel",
    serialOrParallel: "parallel",
    addType: "contact",
  });
  assertSuggestionBoundary(parallelContact, {
    startNodes: ["start-node-line"],
    endNodes: ["edit-node-rect"],
    sourceIds: ["start-node-line"],
    targetIds: ["edit-node-rect"],
  });

  const outputCoil = findSuggestion(suggestions, {
    position: "behind",
    serialOrParallel: "serial",
    addType: "coil",
  });
  assertSuggestionBoundary(outputCoil, {
    startNodes: ["edit-node-rect"],
    endNodes: [],
    sourceIds: ["edit-node-rect"],
    targetIds: [],
  });
}

async function assertDirectSourceEditRectFrontSuggestion() {
  const result = await getLocalGraphSuggestions({
    diagramPath: fixturePath,
    segmentId: "segment-edit-source",
    selectedNodeId: "coil-out",
  });
  const suggestions = result?.payload?.suggestions ?? [];

  const frontContact = findSuggestion(suggestions, {
    position: "front",
    serialOrParallel: "serial",
    addType: "contact",
  });
  assertSuggestionBoundary(frontContact, {
    startNodes: ["contact-left"],
    endNodes: ["edit-node-rect"],
    sourceIds: ["contact-left"],
    targetIds: ["edit-node-rect"],
  });
}

async function assertLeftRailEditRectFrontSuggestions() {
  const result = await getLocalGraphSuggestions({
    diagramPath: fixturePath,
    segmentId: "segment-left-rail-edit-source",
    selectedNodeId: "coil-left-rail",
  });
  const suggestions = result?.payload?.suggestions ?? [];

  const branchInternalFront = findSuggestion(suggestions, {
    position: "front",
    serialOrParallel: "serial",
    addType: "contact",
    startNodes: ["edit-node-rect"],
    endNodes: ["coil-left-rail"],
  });
  assertSuggestionBoundary(branchInternalFront, {
    startNodes: ["edit-node-rect"],
    endNodes: ["coil-left-rail"],
    sourceIds: ["edit-node-rect"],
    targetIds: ["coil-left-rail"],
  });

  const outsideFront = findSuggestion(suggestions, {
    position: "outsideFront",
    serialOrParallel: "serial",
    addType: "contact",
  });
  assertSuggestionBoundary(outsideFront, {
    startNodes: ["start-node-line"],
    endNodes: ["edit-node-rect"],
    sourceIds: ["start-node-line"],
    targetIds: ["edit-node-rect"],
  });
}

function findSuggestion(suggestions, criteria) {
  return suggestions.find((suggestion) => {
    const node = firstAddNode(suggestion);
    return (
      (!criteria.position || suggestion.position === criteria.position) &&
      (!criteria.serialOrParallel ||
        suggestion.serialOrParallel === criteria.serialOrParallel) &&
      (!criteria.addType || node?.type === criteria.addType) &&
      (!criteria.startNodes ||
        sameArray(suggestion.startNodes, criteria.startNodes)) &&
      (!criteria.endNodes || sameArray(suggestion.endNodes, criteria.endNodes))
    );
  });
}

function assertSuggestionBoundary(suggestion, expected) {
  assert.ok(suggestion, "expected suggestion to exist");
  const node = firstAddNode(suggestion);
  assert.ok(node, "expected addNode to contain one node");
  assert.deepStrictEqual(suggestion.startNodes, expected.startNodes);
  assert.deepStrictEqual(suggestion.endNodes, expected.endNodes);
  assert.deepStrictEqual(node.sourceIds, expected.sourceIds);
  assert.deepStrictEqual(node.targetIds, expected.targetIds);
}

function firstAddNode(suggestion) {
  return Object.values(suggestion?.addNode ?? {})[0];
}

function sameArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((item, index) => item === expected[index])
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

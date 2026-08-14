#!/usr/bin/env node

const assert = require("assert/strict");
const path = require("path");
const { getLocalGraphSuggestions } = require("../dist/node_modules/@ide-agent/core");
const {
  createSuggestionDedupeKey,
} = require("../packages/core/dist/graph/SuggestionDedupeKey");

const fixturePath = path.resolve(
  __dirname,
  "..",
  "src",
  "test",
  "fixtures",
  "edit-rect-boundaries.json",
);

async function main() {
  assertStructuredSuggestionDedupeKeys();
  await assertDirectTargetEditRectSuggestions();
  await assertDirectSourceEditRectFrontSuggestion();
  await assertLeftRailEditRectFrontSuggestions();
  await assertParallelBranchExitSuggestions();

  console.log("[test-edit-rect-suggestions] passed");
}

function assertStructuredSuggestionDedupeKeys() {
  const base = {
    mode: "serial",
    relationToFocus: "beforeSelected",
    startNodes: ["start-node-line"],
    endNodes: ["contact-a1"],
    position: "front",
    serialOrParallel: "serial",
    parallelToNodeId: "",
    branchFromNodeId: "",
    branchToNodeId: "",
    nodeType: "contact",
    blockType: "",
    variableName: "Permit",
  };

  assert.equal(
    createSuggestionDedupeKey(base),
    createSuggestionDedupeKey({ ...base, startNodes: [...base.startNodes] }),
    "equivalent suggestion fields must produce the same dedupe key",
  );
  assert.notEqual(
    createSuggestionDedupeKey({
      ...base,
      mode: "serial|beforeSelected",
      relationToFocus: "focus",
    }),
    createSuggestionDedupeKey({
      ...base,
      mode: "serial",
      relationToFocus: "beforeSelected|focus",
    }),
    "pipe characters in adjacent fields must not collide",
  );
  assert.notEqual(
    createSuggestionDedupeKey({ ...base, startNodes: ["left,right"] }),
    createSuggestionDedupeKey({ ...base, startNodes: ["left", "right"] }),
    "one node id containing a comma must differ from two node ids",
  );
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

  assert.equal(
    suggestions.some(
      (suggestion) => firstAddNode(suggestion)?.type === "FBDCompartment",
    ),
    false,
    "a generic function-block slot without business evidence must not be returned",
  );

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
  assert.equal(
    suggestions.some((suggestion) => suggestion.position === "outsideBehind"),
    false,
    "a non-parallel editRect must not create an outside-behind suggestion",
  );
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

async function assertParallelBranchExitSuggestions() {
  const tailResult = await getLocalGraphSuggestions({
    diagramPath: fixturePath,
    segmentId: "segment-parallel-exit",
    selectedNodeId: "parallel-lower-tail",
  });
  const tailSuggestions = tailResult?.payload?.suggestions ?? [];
  const branchInternalBehind = findSuggestion(tailSuggestions, {
    position: "behind",
    serialOrParallel: "serial",
    addType: "contact",
    startNodes: ["parallel-lower-tail"],
    endNodes: ["parallel-merge"],
  });
  assertSuggestionBoundary(branchInternalBehind, {
    startNodes: ["parallel-lower-tail"],
    endNodes: ["parallel-merge"],
    sourceIds: ["parallel-lower-tail"],
    targetIds: ["parallel-merge"],
  });

  const outsideBehind = findSuggestion(tailSuggestions, {
    position: "outsideBehind",
    serialOrParallel: "serial",
    addType: "contact",
  });
  assertSuggestionBoundary(outsideBehind, {
    startNodes: ["parallel-upper", "parallel-lower-tail"],
    endNodes: ["parallel-merge"],
    sourceIds: ["parallel-upper", "parallel-lower-tail"],
    targetIds: ["parallel-merge"],
  });
  assert.ok(
    tailSuggestions.indexOf(outsideBehind) <
      tailSuggestions.indexOf(branchInternalBehind),
    "outside-behind should rank above branch-internal behind without business evidence",
  );

  const internalResult = await getLocalGraphSuggestions({
    diagramPath: fixturePath,
    segmentId: "segment-parallel-exit",
    selectedNodeId: "parallel-lower-head",
  });
  const internalSuggestions = internalResult?.payload?.suggestions ?? [];
  const internalBehind = findSuggestion(internalSuggestions, {
    position: "behind",
    serialOrParallel: "serial",
    addType: "contact",
    startNodes: ["parallel-lower-head"],
    endNodes: ["parallel-lower-tail"],
  });
  assertSuggestionBoundary(internalBehind, {
    startNodes: ["parallel-lower-head"],
    endNodes: ["parallel-lower-tail"],
    sourceIds: ["parallel-lower-head"],
    targetIds: ["parallel-lower-tail"],
  });
  assert.equal(
    internalSuggestions.some(
      (suggestion) => suggestion.position === "outsideBehind",
    ),
    false,
    "a branch-internal node before the tail must not create an outside-behind suggestion",
  );

  const commonPrefixResult = await getLocalGraphSuggestions({
    diagramPath: fixturePath,
    segmentId: "segment-parallel-exit",
    selectedNodeId: "parallel-common",
  });
  assert.equal(
    (commonPrefixResult?.payload?.suggestions ?? []).some(
      (suggestion) => suggestion.position === "outsideBehind",
    ),
    false,
    "a common prefix that reaches multiple branch tails must not be treated as branch-internal",
  );

  const beforeCoilResult = await getLocalGraphSuggestions({
    diagramPath: fixturePath,
    segmentId: "segment-parallel-exit-before-coil",
    selectedNodeId: "parallel-coil-lower",
  });
  const beforeCoilSuggestions = beforeCoilResult?.payload?.suggestions ?? [];
  const beforeCoilOutsideBehind = findSuggestion(beforeCoilSuggestions, {
    position: "outsideBehind",
    serialOrParallel: "serial",
    addType: "contact",
  });
  assertSuggestionBoundary(beforeCoilOutsideBehind, {
    startNodes: ["parallel-coil-upper", "parallel-coil-lower"],
    endNodes: ["parallel-coil-merge"],
    sourceIds: ["parallel-coil-upper", "parallel-coil-lower"],
    targetIds: ["parallel-coil-merge"],
  });
  assertDisjointBoundaries(beforeCoilSuggestions);
}

function assertDisjointBoundaries(suggestions) {
  for (const suggestion of suggestions) {
    const endNodeIds = new Set(suggestion.endNodes);
    assert.equal(
      suggestion.startNodes.some((nodeId) => endNodeIds.has(nodeId)),
      false,
      `${suggestion.title} must not create a self-loop`,
    );
  }
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

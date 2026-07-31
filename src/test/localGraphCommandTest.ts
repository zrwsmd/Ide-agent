import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { loadDiagramSummary } from "../diagram/DiagramSummary";

const DIAGRAM_PATH =
  "C:\\Users\\Administrator\\.vscode\\extensions\\ytak.devuni-ide-vscode-1.0.21\\tool\\iec-runtime-gen-run\\.depworkspace\\transLd.txt";
const SUGGESTABLE_NODE_KINDS = new Set([
  "contact",
  "negatedContact",
  "risingContact",
  "fallingContact",
  "coil",
  "setCoil",
  "resetCoil",
  "FBDCompartment",
]);

export async function run(): Promise<void> {
  console.log("[localGraphCommandTest] starting");

  const extension = vscode.extensions.getExtension("ide-agent.ide-agent");
  assert.ok(extension, "expected Ide Agent extension to be available");
  await extension.activate();

  const summary = await loadDiagramSummary(DIAGRAM_PATH);
  const auxiliaryBoundaryIds = new Set(
    summary.segments.flatMap((segment) =>
      segment.nodes
        .filter(
          (node) =>
            !SUGGESTABLE_NODE_KINDS.has(node.kind) &&
            node.kind !== "startLine" &&
            node.kind !== "endLine",
        )
        .map((node) => node.id),
    ),
  );
  const assertNoAuxiliaryBoundaryIds = (
    suggestions: unknown[] | undefined,
    label: string,
  ): void => {
    for (const suggestion of suggestions ?? []) {
      const record = suggestion as Record<string, unknown>;
      const startNodes = Array.isArray(record.startNodes)
        ? record.startNodes
        : [];
      const endNodes = Array.isArray(record.endNodes) ? record.endNodes : [];
      const leakedIds = [...startNodes, ...endNodes].filter(
        (id): id is string =>
          typeof id === "string" && auxiliaryBoundaryIds.has(id),
      );
      assert.deepStrictEqual(
        leakedIds,
        [],
        `${label} should not expose auxiliary boundary ids`,
      );
    }
  };
  const selectedNodeEntry = summary.segments
    .flatMap((segment) =>
      segment.nodes.map((node) => ({
        segment,
        node,
      })),
    )
    .find((entry) => SUGGESTABLE_NODE_KINDS.has(entry.node.kind));
  assert.ok(
    selectedNodeEntry,
    "expected at least one suggestable graph node in diagram JSON",
  );
  const selectedNode = selectedNodeEntry.node;
  const selectedSegment = selectedNodeEntry.segment;

  const byNode = await vscode.commands.executeCommand<{
    payload?: {
      recognizedFocus?: Record<string, unknown>;
      anchorNodeId?: string;
      anchorNodeVar?: string;
      suggestions?: unknown[];
    };
    diagramPath?: string;
  }>("ide-agent.getLocalGraphSuggestions", {
    diagramPath: DIAGRAM_PATH,
    segmentId: selectedSegment.segmentId,
    selectedNodeId: selectedNode.id,
  });

  assert.ok(byNode, "expected command result for selectedNodeId");
  assert.strictEqual(byNode.diagramPath, DIAGRAM_PATH);
  assert.ok(byNode.payload, "expected payload for selectedNodeId");
  assert.strictEqual(
    byNode.payload?.recognizedFocus?.matchedNodeId,
    selectedNode.id,
  );
  assert.strictEqual(byNode.payload?.anchorNodeId, selectedNode.id);
  assert.strictEqual(
    byNode.payload?.anchorNodeVar,
    selectedNode.var || selectedNode.instance || "",
  );
  assert.ok(
    (byNode.payload?.suggestions?.length ?? 0) > 0,
    "expected suggestions for selectedNodeId",
  );
  assert.strictEqual(
    (byNode as { summary?: unknown }).summary,
    undefined,
    "expected no summary field in local graph result",
  );
  const firstSuggestion = byNode.payload?.suggestions?.[0] as
    | Record<string, unknown>
    | undefined;
  assert.ok(firstSuggestion, "expected first suggestion");
  assert.strictEqual(
    typeof firstSuggestion.title,
    "string",
    "expected short title in suggestion",
  );
  assert.ok(
    String(firstSuggestion.title ?? "").length > 0,
    "expected non-empty suggestion title",
  );
  assert.ok(
    Array.isArray(firstSuggestion.startNodes),
    "expected startNodes array in suggestion",
  );
  assert.ok(
    Array.isArray(firstSuggestion.endNodes),
    "expected endNodes array in suggestion",
  );
  assert.strictEqual(
    typeof firstSuggestion.position,
    "string",
    "expected position in suggestion",
  );
  assert.strictEqual(
    typeof firstSuggestion.serialOrParallel,
    "string",
    "expected serialOrParallel in suggestion",
  );
  assert.strictEqual(
    typeof firstSuggestion.text,
    "string",
    "expected text in suggestion",
  );
  assert.ok(
    firstSuggestion.addNode &&
      typeof firstSuggestion.addNode === "object" &&
      Object.keys(firstSuggestion.addNode as Record<string, unknown>).length > 0,
    "expected addNode map in suggestion",
  );
  assert.ok(
    !("placement" in firstSuggestion),
    "suggestion should not expose old placement field",
  );
  assert.ok(
    !("addElement" in firstSuggestion),
    "suggestion should not expose old addElement field",
  );
  assert.ok(
    !("anchorNodeId" in firstSuggestion),
    "suggestion should not repeat payload anchorNodeId",
  );
  assert.ok(
    !("anchorNodeVar" in firstSuggestion),
    "suggestion should not repeat payload anchorNodeVar",
  );
  assertFunctionBlockSuggestionVarName(byNode.payload?.suggestions);
  assertNoAuxiliaryBoundaryIds(
    byNode.payload?.suggestions,
    "selectedNodeId suggestions",
  );

  const coilWithAuxiliaryInput = summary.segments
    .flatMap((segment) =>
      segment.nodes.map((node) => ({
        segment,
        node,
      })),
    )
    .find(
      (entry) =>
        ["coil", "setCoil", "resetCoil"].includes(entry.node.kind) &&
        entry.node.from.some((id) => auxiliaryBoundaryIds.has(id)),
    );
  if (coilWithAuxiliaryInput) {
    const byCoil = await vscode.commands.executeCommand<{
      payload?: {
        suggestions?: unknown[];
      };
    }>("ide-agent.getLocalGraphSuggestions", {
      diagramPath: DIAGRAM_PATH,
      segmentId: coilWithAuxiliaryInput.segment.segmentId,
      selectedNodeId: coilWithAuxiliaryInput.node.id,
    });
    assert.ok(byCoil, "expected command result for coil with auxiliary input");
    assertNoAuxiliaryBoundaryIds(
      byCoil.payload?.suggestions,
      "coil suggestions",
    );
  }

  const multiTargetNodeEntries = summary.segments
    .flatMap((segment) =>
      segment.nodes.map((node) => ({
        segment,
        node,
      })),
    )
    .filter(
      (entry) =>
        SUGGESTABLE_NODE_KINDS.has(entry.node.kind) &&
        entry.node.to.filter((id) => {
          const target = entry.segment.nodes.find((node) => node.id === id);
          return target && SUGGESTABLE_NODE_KINDS.has(target.kind);
        }).length > 1,
    );

  let checkedMultiTargetParallel = false;
  for (const entry of multiTargetNodeEntries) {
    const byMultiTarget = await vscode.commands.executeCommand<{
      payload?: {
        suggestions?: unknown[];
      };
    }>("ide-agent.getLocalGraphSuggestions", {
      diagramPath: DIAGRAM_PATH,
      segmentId: entry.segment.segmentId,
      selectedNodeId: entry.node.id,
    });
    const parallelSuggestion = byMultiTarget?.payload?.suggestions?.find(
      (suggestion) => {
        const record = suggestion as Record<string, unknown>;
        return (
          record.position === "parallel" &&
          record.serialOrParallel === "parallel"
        );
      },
    ) as Record<string, unknown> | undefined;
    if (!parallelSuggestion) {
      continue;
    }

    assert.ok(
      Array.isArray(parallelSuggestion.endNodes) &&
        parallelSuggestion.endNodes.length > 1,
      "parallel suggestion should keep all real target branch entries",
    );
    checkedMultiTargetParallel = true;
    break;
  }

  if (multiTargetNodeEntries.length > 0) {
    assert.ok(
      checkedMultiTargetParallel,
      "expected at least one multi-target node with parallel suggestion",
    );
  }

  const branchOutputCandidate = summary.segments
    .flatMap((segment) =>
      segment.nodes.map((node) => ({
        segment,
        node,
      })),
    )
    .find((entry) =>
      findBranchOutputStartNodes(entry.segment, entry.node).length > 1,
    );
  if (branchOutputCandidate) {
    const byBranchOutput = await vscode.commands.executeCommand<{
      payload?: {
        suggestions?: unknown[];
      };
    }>("ide-agent.getLocalGraphSuggestions", {
      diagramPath: DIAGRAM_PATH,
      segmentId: branchOutputCandidate.segment.segmentId,
      selectedNodeId: branchOutputCandidate.node.id,
    });
    const outputCoilSuggestion = byBranchOutput?.payload?.suggestions?.find(
      (suggestion) => {
        const record = suggestion as Record<string, unknown>;
        return getSuggestedNodeType(record) === "coil";
      },
    ) as Record<string, unknown> | undefined;

    assert.ok(
      outputCoilSuggestion,
      "expected output coil suggestion for branch output candidate",
    );
    assert.strictEqual(
      outputCoilSuggestion.position,
      "outsideBehind",
      "branch output coil should be placed outside the selected branch",
    );
    assert.ok(
      Array.isArray(outputCoilSuggestion.startNodes) &&
        outputCoilSuggestion.startNodes.length > 1,
      "branch output coil should use all branch tail nodes as startNodes",
    );
  }

  const downstreamLogicCandidate = summary.segments
    .flatMap((segment) =>
      segment.nodes.map((node) => ({
        segment,
        node,
      })),
    )
    .find(
      (entry) =>
        SUGGESTABLE_NODE_KINDS.has(entry.node.kind) &&
        hasDownstreamLogicNode(entry.segment, entry.node.id),
    );
  if (downstreamLogicCandidate) {
    const byDownstreamLogic = await vscode.commands.executeCommand<{
      payload?: {
        suggestions?: unknown[];
      };
    }>("ide-agent.getLocalGraphSuggestions", {
      diagramPath: DIAGRAM_PATH,
      segmentId: downstreamLogicCandidate.segment.segmentId,
      selectedNodeId: downstreamLogicCandidate.node.id,
    });

    const outputCoilSuggestion = byDownstreamLogic?.payload?.suggestions?.find(
      (suggestion) => {
        const record = suggestion as Record<string, unknown>;
        return getSuggestedNodeType(record) === "coil";
      },
    );

    assert.strictEqual(
      outputCoilSuggestion,
      undefined,
      "node with downstream logic should not suggest inserting an output coil",
    );
  }

  const terminalOutputCandidate = summary.segments
    .flatMap((segment) =>
      segment.nodes.map((node) => ({
        segment,
        node,
      })),
    )
    .find(
      (entry) =>
        isOutputCoilSourceKind(entry.node.kind) &&
        !hasDownstreamLogicNode(entry.segment, entry.node.id) &&
        !hasDownstreamOutputNode(entry.segment, entry.node.id),
    );
  if (terminalOutputCandidate) {
    const byTerminalOutput = await vscode.commands.executeCommand<{
      payload?: {
        suggestions?: unknown[];
      };
    }>("ide-agent.getLocalGraphSuggestions", {
      diagramPath: DIAGRAM_PATH,
      segmentId: terminalOutputCandidate.segment.segmentId,
      selectedNodeId: terminalOutputCandidate.node.id,
    });

    const outputCoilSuggestion = byTerminalOutput?.payload?.suggestions?.find(
      (suggestion) => {
        const record = suggestion as Record<string, unknown>;
        return getSuggestedNodeType(record) === "coil";
      },
    );

    assert.ok(
      outputCoilSuggestion,
      "terminal contact/function block should keep output coil suggestion within the returned limit",
    );
  }

  const selectedInsertionPoint = summary.segments
    .flatMap((segment) =>
      segment.insertionPoints.map((insertionPoint) => ({
        segment,
        insertionPoint,
      })),
    )
    .find(Boolean);
  const byInsertionPoint = selectedInsertionPoint
    ? await vscode.commands.executeCommand<{
        payload?: {
          recognizedFocus?: Record<string, unknown>;
          suggestions?: unknown[];
        };
      }>("ide-agent.getLocalGraphSuggestions", {
        diagramPath: DIAGRAM_PATH,
        segmentId: selectedInsertionPoint.segment.segmentId,
        selectedInsertionPointId: selectedInsertionPoint.insertionPoint.id,
      })
    : undefined;

  if (selectedInsertionPoint) {
    assert.ok(
      byInsertionPoint,
      "expected command result for selectedInsertionPointId",
    );
    assert.strictEqual(
      byInsertionPoint?.payload?.recognizedFocus?.matchedNodeId,
      selectedInsertionPoint.insertionPoint.id,
    );
  }

  const resultPath = process.env.IDE_AGENT_LOCAL_GRAPH_TEST_RESULT;
  if (resultPath) {
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(resultPath, JSON.stringify(byNode, null, 2), "utf8");
  }

  console.log("[localGraphCommandTest] passed");
}

function findBranchOutputStartNodes(
  segment: Awaited<ReturnType<typeof loadDiagramSummary>>["segments"][number],
  node: Awaited<ReturnType<typeof loadDiagramSummary>>["segments"][number]["nodes"][number],
): string[] {
  const visited = new Set<string>();
  const queue = [...node.to];
  let bestStartNodes: string[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }

    visited.add(currentId);
    const current = segment.nodes.find((item) => item.id === currentId);
    if (!current) {
      continue;
    }

    const tailNodeIds = collectNearestSuggestableNodes(
      segment,
      current.from,
      "backward",
    );
    if (
      tailNodeIds.length > 1 &&
      tailNodeIds.includes(node.id) &&
      tailNodeIds.length >= bestStartNodes.length
    ) {
      bestStartNodes = tailNodeIds;
    }

    queue.push(...current.to);
  }

  return bestStartNodes;
}

function hasDownstreamLogicNode(
  segment: Awaited<ReturnType<typeof loadDiagramSummary>>["segments"][number],
  startNodeId: string,
): boolean {
  const visited = new Set<string>();
  const startNode = segment.nodes.find((node) => node.id === startNodeId);
  const queue = [...(startNode?.to ?? [])];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }

    visited.add(currentId);
    const current = segment.nodes.find((node) => node.id === currentId);
    if (!current) {
      continue;
    }

    if (
      ["contact", "negatedContact", "risingContact", "fallingContact"].includes(
        current.kind,
      ) ||
      current.kind === "FBDCompartment"
    ) {
      return true;
    }

    queue.push(...current.to);
  }

  return false;
}

function hasDownstreamOutputNode(
  segment: Awaited<ReturnType<typeof loadDiagramSummary>>["segments"][number],
  startNodeId: string,
): boolean {
  const visited = new Set<string>();
  const startNode = segment.nodes.find((node) => node.id === startNodeId);
  const queue = [...(startNode?.to ?? [])];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }

    visited.add(currentId);
    const current = segment.nodes.find((node) => node.id === currentId);
    if (!current) {
      continue;
    }

    if (
      ["coil", "setCoil", "resetCoil", "FBDCompartment"].includes(current.kind)
    ) {
      return true;
    }

    queue.push(...current.to);
  }

  return false;
}

function isOutputCoilSourceKind(kind: string): boolean {
  return [
    "contact",
    "negatedContact",
    "risingContact",
    "fallingContact",
    "FBDCompartment",
  ].includes(kind);
}

function collectNearestSuggestableNodes(
  segment: Awaited<ReturnType<typeof loadDiagramSummary>>["segments"][number],
  nodeIds: string[],
  direction: "forward" | "backward",
): string[] {
  const visited = new Set<string>();
  const result = new Set<string>();
  const queue = [...nodeIds];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }

    visited.add(currentId);
    const current = segment.nodes.find((node) => node.id === currentId);
    if (!current) {
      continue;
    }

    if (SUGGESTABLE_NODE_KINDS.has(current.kind)) {
      result.add(current.id);
      continue;
    }

    queue.push(...(direction === "forward" ? current.to : current.from));
  }

  return [...result];
}

function getSuggestedNodeType(suggestion: Record<string, unknown>): string {
  const addNode = suggestion.addNode as Record<string, unknown> | undefined;
  const firstNode = addNode ? Object.values(addNode)[0] : undefined;
  return typeof firstNode === "object" && firstNode !== null
    ? String((firstNode as Record<string, unknown>).type ?? "")
    : "";
}

function assertFunctionBlockSuggestionVarName(
  suggestions: unknown[] | undefined,
): void {
  const functionBlockSuggestion = suggestions
    ?.map((suggestion) => suggestion as Record<string, unknown>)
    .find((suggestion) => getSuggestedNodeType(suggestion) === "FBDCompartment");

  if (!functionBlockSuggestion) {
    return;
  }

  const addNode = functionBlockSuggestion.addNode as
    | Record<string, unknown>
    | undefined;
  const functionBlockNode = addNode
    ? (Object.values(addNode)[0] as Record<string, unknown> | undefined)
    : undefined;
  const childrenNode = functionBlockNode?.childrenNode as
    | Record<string, unknown>
    | undefined;
  const varName = childrenNode?.varName as
    | Record<string, unknown>
    | undefined;

  assert.ok(varName, "expected function block suggestion childrenNode.varName");
  assert.strictEqual(
    typeof varName.value,
    "string",
    "expected function block instance value",
  );
  assert.ok(
    String(varName.value ?? "").length > 0,
    "expected non-empty function block instance placeholder",
  );
}

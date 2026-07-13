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
  assert.ok(
    (byNode.payload?.suggestions?.length ?? 0) > 0,
    "expected suggestions for selectedNodeId",
  );
  const firstSuggestion = byNode.payload?.suggestions?.[0] as
    | Record<string, unknown>
    | undefined;
  assert.ok(firstSuggestion, "expected first suggestion");
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
    !("placement" in firstSuggestion),
    "suggestion should not expose old placement field",
  );
  assert.ok(
    !("addElement" in firstSuggestion),
    "suggestion should not expose old addElement field",
  );

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

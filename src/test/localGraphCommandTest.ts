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
  const selectedNode = summary.segments
    .flatMap((item) => item.nodes)
    .find((node) => SUGGESTABLE_NODE_KINDS.has(node.kind));
  assert.ok(
    selectedNode,
    "expected at least one suggestable graph node in diagram JSON",
  );

  const byNode = await vscode.commands.executeCommand<{
    payload?: {
      recognizedFocus?: Record<string, unknown>;
      suggestions?: unknown[];
    };
    diagramPath?: string;
    jsonText?: string;
  }>("ide-agent.getLocalGraphSuggestions", {
    diagramPath: DIAGRAM_PATH,
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
  assert.ok(byNode.jsonText?.includes("suggestions"));

  const selectedInsertionPoint = summary.segments
    .flatMap((item) => item.insertionPoints)
    .find(Boolean);
  const byInsertionPoint = selectedInsertionPoint
    ? await vscode.commands.executeCommand<{
        payload?: {
          recognizedFocus?: Record<string, unknown>;
          suggestions?: unknown[];
        };
      }>("ide-agent.getLocalGraphSuggestions", {
        diagramPath: DIAGRAM_PATH,
        selectedInsertionPointId: selectedInsertionPoint.id,
      })
    : undefined;

  if (selectedInsertionPoint) {
    assert.ok(
      byInsertionPoint,
      "expected command result for selectedInsertionPointId",
    );
    assert.strictEqual(
      byInsertionPoint?.payload?.recognizedFocus?.matchedNodeId,
      selectedInsertionPoint.id,
    );
  }

  const resultPath = process.env.IDE_AGENT_LOCAL_GRAPH_TEST_RESULT;
  if (resultPath) {
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(
      resultPath,
      JSON.stringify(
        {
          selectedNodeId: selectedNode.id,
          byNode: pickPrintableResult(byNode),
          selectedInsertionPointId: selectedInsertionPoint?.id ?? "",
          byInsertionPoint: pickPrintableResult(byInsertionPoint),
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  console.log("[localGraphCommandTest] passed");
}

function pickPrintableResult(result: unknown): unknown {
  if (!result || typeof result !== "object") {
    return result;
  }

  const record = result as {
    diagramPath?: string;
    jsonText?: string;
    payload?: unknown;
  };

  return {
    diagramPath: record.diagramPath,
    payload: record.payload,
    jsonText: record.jsonText,
  };
}

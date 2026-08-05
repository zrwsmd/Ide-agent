#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const { getLocalGraphSuggestions } = require("../dist/node_modules/@ide-agent/core");

const DIAGRAM_PATH =
  process.env.DIAGRAM_PATH ||
  path.join(
    __dirname,
    "..",
    "example",
    "business-label-note-compare",
    "1785898854769.txt",
  );
const SEGMENT_ID =
  process.env.SEGMENT_ID || "segment-64905094-1785458990723";
const SELECTED_NODE_ID =
  process.env.SELECTED_NODE_ID || "contact-66327725-1785458990720";
const TMP_PATH = path.join(
  __dirname,
  "..",
  "tmp",
  "business-label-note-compare-stripped.json",
);

async function main() {
  const rawResult = await getLocalGraphSuggestions({
    diagramPath: DIAGRAM_PATH,
    segmentId: SEGMENT_ID,
    selectedNodeId: SELECTED_NODE_ID,
  });

  const strippedPath = stripTargetSegmentLabelNote(DIAGRAM_PATH, SEGMENT_ID);
  const strippedResult = await getLocalGraphSuggestions({
    diagramPath: strippedPath,
    segmentId: SEGMENT_ID,
    selectedNodeId: SELECTED_NODE_ID,
  });

  const rawSuggestions = rawResult?.payload?.suggestions ?? [];
  const strippedSuggestions = strippedResult?.payload?.suggestions ?? [];

  console.log(`diagramPath=${DIAGRAM_PATH}`);
  console.log(`segmentId=${SEGMENT_ID}`);
  console.log(`selectedNodeId=${SELECTED_NODE_ID}`);
  console.log("");

  printRanking("RAW", rawSuggestions);
  console.log("");
  printRanking("STRIPPED label/note", strippedSuggestions);
  console.log("");
  printDiff(rawSuggestions, strippedSuggestions);

  try {
    fs.unlinkSync(strippedPath);
  } catch {
    // ignore
  }
}

function stripTargetSegmentLabelNote(sourcePath, targetSegmentId) {
  const parsed = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const roots = Array.isArray(parsed) ? parsed : [parsed];
  const cloned = roots.map((root) => {
    if (!root || typeof root !== "object" || !Array.isArray(root.segmentList)) {
      return root;
    }
    return {
      ...root,
      segmentList: root.segmentList.map((segment) => {
        if (!segment || typeof segment !== "object" || segment.id !== targetSegmentId) {
          return segment;
        }
        return {
          ...segment,
          label: "",
          note: "",
        };
      }),
    };
  });
  fs.mkdirSync(path.dirname(TMP_PATH), { recursive: true });
  fs.writeFileSync(TMP_PATH, JSON.stringify(cloned, null, 2), "utf8");
  return TMP_PATH;
}

function printRanking(title, suggestions) {
  console.log(`=== ${title} ===`);
  suggestions.forEach((suggestion, index) => {
    console.log(`${index + 1}. ${suggestion.title} | ${suggestion.text}`);
  });
}

function printDiff(rawSuggestions, strippedSuggestions) {
  console.log("=== DIFF ===");
  const maxLength = Math.max(rawSuggestions.length, strippedSuggestions.length);
  for (let index = 0; index < maxLength; index += 1) {
    const raw = rawSuggestions[index];
    const stripped = strippedSuggestions[index];
    const rawTitle = raw ? raw.title : "(none)";
    const strippedTitle = stripped ? stripped.title : "(none)";
    const marker = rawTitle === strippedTitle ? "=" : "!=";
    console.log(`${index + 1}. ${marker} RAW: ${rawTitle}  |  STRIPPED: ${strippedTitle}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

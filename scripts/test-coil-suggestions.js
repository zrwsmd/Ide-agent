#!/usr/bin/env node

const fs = require("fs");

const [, , diagramPath, selectedToken = "t"] = process.argv;

if (!diagramPath) {
  console.error(
    "Usage: node scripts/test-coil-suggestions.js <diagram-json-path> [coil-node-id-or-var]",
  );
  process.exit(1);
}

const summary = loadSummary(diagramPath);
const focus = findNodeByToken(summary, selectedToken, isCoilKind);

if (!focus) {
  console.error(`Coil not found: ${selectedToken}`);
  console.error("Available coils:");
  for (const item of listNodes(summary, isCoilKind)) {
    console.error(`- ${nodeLabel(item.segment, item.node)}  ${item.node.id}`);
  }
  process.exit(2);
}

const result = buildCoilTestResult(summary, focus.segment, focus.node);
console.log(JSON.stringify(result, null, 2));

function buildCoilTestResult(summary, segment, node) {
  const leftNeighbors = neighborNodes(segment, node.from, "backward");
  const rightNeighbors = neighborNodes(segment, node.to, "forward");
  const nodeText = nodeLabel(segment, node);
  const insertAfterNodeId = first(node.from);
  const insertBeforeNodeId = node.id;
  const suggestions = [
    {
      mode: "seriesBefore",
      placement: {
        relationToFocus: "beforeSelected",
        insertAfterNodeId,
        insertBeforeNodeId,
        text: `在${nodeText}前串联一个常开触点`,
      },
      addElement: contactElement(),
    },
    {
      mode: "parallelBranch",
      placement: {
        relationToFocus: "parallelWithSelected",
        parallelToNodeId: node.id,
        branchFromNodeId: first(node.from),
        branchToNodeId: first(node.to),
        text: `与${nodeText}并联一个线圈`,
      },
      addElement: coilElement(),
    },
    {
      mode: "replaceSelected",
      placement: {
        relationToFocus: "replaceSelected",
        text: `将${nodeText}改成置位线圈`,
      },
      addElement: setCoilElement(node.var),
    },
    {
      mode: "seriesBefore",
      placement: {
        relationToFocus: "beforeSelected",
        insertAfterNodeId,
        insertBeforeNodeId,
        text: `在${nodeText}前插入一个功能块`,
      },
      addElement: functionBlockElement(),
    },
  ];

  return {
    sourcePath: summary.sourcePath,
    pouName: summary.pouName,
    segmentId: segment.segmentId,
    selectedCoil: nodeSummary(segment, node),
    graphContext: {
      leftNeighbors: leftNeighbors.map((item) => nodeSummary(segment, item)),
      rightNeighbors: rightNeighbors.map((item) => nodeSummary(segment, item)),
    },
    ruleExplanation: [
      "线圈固定生成 1 条：在线圈前串联一个常开触点。",
      "线圈固定生成 1 条：与当前线圈并联一个线圈。",
      "线圈固定生成 1 条：将当前线圈改成置位线圈。",
      "线圈固定生成 1 条：在线圈前插入一个功能块。",
    ],
    suggestionCount: suggestions.length,
    suggestions: suggestions.map((suggestion, index) => ({
      id: `coil-case-${index + 1}`,
      ...suggestion,
    })),
  };
}

function loadSummary(sourcePath) {
  const parsed = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const root = Array.isArray(parsed) ? parsed[0] : parsed;
  const segments = asArray(root.segmentList).map((segment) => {
    const nodesObj = asRecord(segment.nodesObj) || {};
    const nodes = Object.entries(nodesObj).map(([nodeId, node], index) =>
      summarizeNode(nodeId, asRecord(node), index),
    );
    return { segmentId: asString(segment.id), nodes };
  });

  return { sourcePath, pouName: asString(root.pouName), segments };
}

function summarizeNode(nodeId, node, index) {
  const varName = asRecord(node.varName);
  const child = asRecord(node.childrenNode);
  const childVarName = child ? asRecord(child.varName) : undefined;

  return {
    id: asString(node.id) || nodeId,
    kind: asString(node.type) || "unknown",
    order: index,
    var: varName ? asString(varName.value) : "",
    blockType: child ? asString(child.type) : "",
    instance: childVarName ? asString(childVarName.value) : "",
    from: stringArray(node.sourceIds),
    to: stringArray(node.targetIds),
  };
}

function findNodeByToken(summary, token, kindPredicate) {
  const normalized = token.trim().toLowerCase();
  for (const segment of summary.segments) {
    for (const node of segment.nodes) {
      if (!kindPredicate(node.kind)) {
        continue;
      }
      const candidates = [node.id, node.var, node.instance].map((value) =>
        String(value || "").trim().toLowerCase(),
      );
      if (candidates.includes(normalized)) {
        return { segment, node };
      }
    }
  }
  return undefined;
}

function listNodes(summary, kindPredicate) {
  return summary.segments.flatMap((segment) =>
    segment.nodes
      .filter((node) => kindPredicate(node.kind))
      .map((node) => ({ segment, node })),
  );
}

function neighborNodes(segment, nodeIds, direction) {
  const seen = new Set();
  const nodes = [];
  for (const nodeId of nodeIds || []) {
    const node = findNearestDisplayNode(segment, nodeId, direction);
    if (!node || seen.has(node.id)) {
      continue;
    }
    seen.add(node.id);
    nodes.push(node);
  }
  return nodes;
}

function findNearestDisplayNode(segment, nodeId, direction) {
  const visited = new Set();
  const queue = [nodeId];
  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);
    const node = findNode(segment, currentId);
    if (!node) {
      continue;
    }
    if (isRealGraphElementKind(node.kind)) {
      return node;
    }
    queue.push(...(direction === "forward" ? node.to : node.from));
  }
  return undefined;
}

function nodeSummary(segment, node) {
  return {
    id: node.id,
    kind: node.kind,
    var: node.var || node.instance || "",
    label: nodeLabel(segment, node),
  };
}

function nodeLabel(segment, node) {
  if (node.kind === "FBDCompartment") {
    const name = displayNodeName(segment, node);
    return `${node.blockType || "功能块"} ${name} 功能块`;
  }
  if (isCoilKind(node.kind)) {
    return `${displayNodeName(segment, node)} ${coilKindLabel(node.kind)}`;
  }
  if (isContactKind(node.kind)) {
    return `${displayNodeName(segment, node)} ${contactKindLabel(node.kind)}`;
  }
  return displayNodeName(segment, node);
}

function displayNodeName(segment, node) {
  const rawName = String(node.var || node.instance || "").trim();
  if (rawName && rawName !== "???") {
    return rawName;
  }
  const unnamedNodes = segment.nodes
    .filter((item) => isRealGraphElementKind(item.kind))
    .filter((item) => {
      const name = String(item.var || item.instance || "").trim();
      return !name || name === "???";
    })
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const index = unnamedNodes.findIndex((item) => item.id === node.id) + 1;
  const displayName = index > 0 ? `未命名${index}` : "未命名";
  return `${displayName}(${node.id})`;
}

function contactElement() {
  return { nodeType: "contact", displayLabel: "常开触点" };
}

function coilElement() {
  return { nodeType: "coil", displayLabel: "线圈" };
}

function setCoilElement(variableName) {
  return {
    nodeType: "setCoil",
    displayLabel: "置位线圈",
    variableSource: variableName ? "existingVariable" : "userInput",
    variableName: variableName || "",
  };
}

function functionBlockElement() {
  return { nodeType: "functionBlock", displayLabel: "功能块" };
}

function contactKindLabel(kind) {
  switch (kind) {
    case "negatedContact":
      return "常闭触点";
    case "risingContact":
      return "上升沿";
    case "fallingContact":
      return "下降沿";
    case "contact":
    default:
      return "常开触点";
  }
}

function coilKindLabel(kind) {
  switch (kind) {
    case "setCoil":
      return "置位线圈";
    case "resetCoil":
      return "复位线圈";
    case "coil":
    default:
      return "线圈";
  }
}

function findNode(segment, nodeId) {
  return segment.nodes.find((node) => node.id === nodeId);
}

function isContactKind(kind) {
  return [
    "contact",
    "negatedContact",
    "risingContact",
    "fallingContact",
  ].includes(kind);
}

function isCoilKind(kind) {
  return ["coil", "setCoil", "resetCoil"].includes(kind);
}

function isRealGraphElementKind(kind) {
  return [
    "contact",
    "negatedContact",
    "risingContact",
    "fallingContact",
    "coil",
    "setCoil",
    "resetCoil",
    "FBDCompartment",
  ].includes(kind);
}

function first(values) {
  return values && values.length ? values[0] : "";
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : undefined;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value) {
  return asArray(value).filter((item) => typeof item === "string");
}

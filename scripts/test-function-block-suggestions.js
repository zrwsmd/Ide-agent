#!/usr/bin/env node

const fs = require("fs");

const [, , diagramPath, selectedToken] = process.argv;

if (!diagramPath || !selectedToken) {
  console.error(
    "Usage: node scripts/test-function-block-suggestions.js <diagram-json-path> <function-block-node-id-or-instance>",
  );
  process.exit(1);
}

const rawText = fs.readFileSync(diagramPath, "utf8");
const parsed = JSON.parse(rawText);
const summary = summarizeDiagramJson(parsed, diagramPath);
const focus = findFunctionBlock(summary, selectedToken);

if (!focus) {
  console.error(`Function block not found: ${selectedToken}`);
  console.error("Available function blocks:");
  for (const block of listFunctionBlocks(summary)) {
    console.error(`- ${nodeLabel(block.segment, block.node)}  ${block.node.id}`);
  }
  process.exit(2);
}

const result = buildFunctionBlockTestResult(summary, focus.segment, focus.node);
console.log(JSON.stringify(result, null, 2));

function buildFunctionBlockTestResult(summary, segment, node) {
  const leftNeighbors = neighborNodes(segment, node.from, "backward");
  const rightNeighbors = neighborNodes(segment, node.to, "forward");
  const downstreamOutput = hasDownstreamOutputNode(segment, node.id);
  const suggestions = buildFunctionBlockSuggestions(
    segment,
    node,
    leftNeighbors,
    rightNeighbors,
    downstreamOutput,
  );

  return {
    sourcePath: summary.sourcePath,
    pouName: summary.pouName,
    segmentId: segment.segmentId,
    selectedFunctionBlock: {
      id: node.id,
      instance: node.instance || "",
      blockType: node.blockType || "",
      label: nodeLabel(segment, node),
    },
    graphContext: {
      leftNeighbors: leftNeighbors.map((item) => nodeSummary(segment, item)),
      rightNeighbors: rightNeighbors.map((item) => nodeSummary(segment, item)),
      hasDownstreamOutputNode: downstreamOutput,
    },
    ruleExplanation: [
      "每个左邻节点各生成 1 条：在左邻和当前功能块之间串联一个常开触点。",
      "每个右邻节点各生成 1 条：在当前功能块和右邻之间串联一个常开触点。",
      "如果当前功能块后面没有下游输出节点，额外生成 1 条：在功能块输出端后添加线圈。",
    ],
    suggestionCount: suggestions.length,
    suggestions,
  };
}

function buildFunctionBlockSuggestions(
  segment,
  node,
  leftNeighbors,
  rightNeighbors,
  downstreamOutput,
) {
  const nodeText = nodeLabel(segment, node);
  const suggestions = [];

  if (leftNeighbors.length) {
    for (const leftNode of leftNeighbors) {
      suggestions.push({
        mode: "seriesBefore",
        placement: {
          relationToFocus: "beforeSelected",
          insertAfterNodeId: leftNode.id,
          insertBeforeNodeId: node.id,
          text: `在${nodeLabel(segment, leftNode)}和${nodeText}之间串联一个常开触点`,
        },
        addElement: {
          nodeType: "contact",
          displayLabel: "常开触点",
        },
      });
    }
  } else {
    suggestions.push({
      mode: "seriesBefore",
      placement: {
        relationToFocus: "beforeSelected",
        insertAfterNodeId: first(node.from),
        insertBeforeNodeId: node.id,
        text: `在${nodeText}前串联一个常开触点`,
      },
      addElement: {
        nodeType: "contact",
        displayLabel: "常开触点",
      },
    });
  }

  if (!downstreamOutput) {
    suggestions.push({
      mode: "outputCoil",
      placement: {
        relationToFocus: "afterSelected",
        insertAfterNodeId: node.id,
        insertBeforeNodeId: first(node.to),
        text: `在${nodeText}输出端后添加一个线圈`,
      },
      addElement: {
        nodeType: "coil",
        displayLabel: "线圈",
      },
    });
  }

  if (rightNeighbors.length) {
    for (const rightNode of rightNeighbors) {
      suggestions.push({
        mode: "seriesAfter",
        placement: {
          relationToFocus: "afterSelected",
          insertAfterNodeId: node.id,
          insertBeforeNodeId: rightNode.id,
          text: `在${nodeText}和${nodeLabel(segment, rightNode)}之间串联一个常开触点`,
        },
        addElement: {
          nodeType: "contact",
          displayLabel: "常开触点",
        },
      });
    }
  } else {
    suggestions.push({
      mode: "seriesAfter",
      placement: {
        relationToFocus: "afterSelected",
        insertAfterNodeId: node.id,
        insertBeforeNodeId: first(node.to),
        text: `在${nodeText}输出端后添加一个常开触点`,
      },
      addElement: {
        nodeType: "contact",
        displayLabel: "常开触点",
      },
    });
  }

  return suggestions.map((suggestion, index) => ({
    id: `function-block-case-${index + 1}`,
    ...suggestion,
  }));
}

function summarizeDiagramJson(parsed, sourcePath) {
  const roots = Array.isArray(parsed) ? parsed : [parsed];
  const root = asRecord(roots[0]) || {};

  return {
    sourcePath,
    pouName: asString(root.pouName),
    segments: asArray(root.segmentList).map(summarizeSegment),
  };
}

function summarizeSegment(segment) {
  const nodesObj = asRecord(segment.nodesObj) || {};
  const nodes = Object.entries(nodesObj).map(([nodeId, node], index) =>
    summarizeNode(nodeId, asRecord(node), index),
  );

  return {
    segmentId: asString(segment.id),
    nodes,
  };
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
    dataType: varName ? asString(varName.type) : "",
    blockType: child ? asString(child.type) : "",
    instance: childVarName ? asString(childVarName.value) : "",
    from: stringArray(node.sourceIds),
    to: stringArray(node.targetIds),
  };
}

function findFunctionBlock(summary, token) {
  const normalized = token.trim().toLowerCase();

  for (const segment of summary.segments) {
    for (const node of segment.nodes) {
      if (node.kind !== "FBDCompartment") {
        continue;
      }

      const candidates = [node.id, node.instance, node.var].map((value) =>
        String(value || "").trim().toLowerCase(),
      );
      if (candidates.includes(normalized)) {
        return { segment, node };
      }
    }
  }

  return undefined;
}

function listFunctionBlocks(summary) {
  return summary.segments.flatMap((segment) =>
    segment.nodes
      .filter((node) => node.kind === "FBDCompartment")
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

function hasDownstreamOutputNode(segment, startNodeId) {
  const visited = new Set();
  const startNode = findNode(segment, startNodeId);
  const queue = [...(startNode ? startNode.to : [])];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) {
      continue;
    }

    visited.add(nodeId);
    const node = findNode(segment, nodeId);
    if (!node) {
      continue;
    }

    if (isOutputNodeKind(node.kind)) {
      return true;
    }

    queue.push(...node.to);
  }

  return false;
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
    const instance = displayNodeName(segment, node);
    return instance
      ? `${node.blockType || "功能块"} ${instance} 功能块`
      : `${node.blockType || "功能块"} 功能块`;
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

function isOutputNodeKind(kind) {
  return isCoilKind(kind) || kind === "FBDCompartment";
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

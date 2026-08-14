#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
  getLocalGraphSuggestions,
  loadDiagramSummary,
} = require("../packages/core/dist");
const {
  getLibraryElement,
} = require("../packages/core/dist/graph/LibraryElementCatalog");
const {
  buildLibraryPorts,
} = require("../packages/core/dist/graph/SuggestedNodeFactory");

const ROOT_DIR = path.resolve(__dirname, "..");
const FIXTURE_DIR = path.join(ROOT_DIR, "src", "test", "fixtures");
const DEFAULT_OUTPUT_PATH = path.join(
  ROOT_DIR,
  "tmp",
  "business-suggestion-coverage.json",
);
const REAL_GRAPH_NODE_KINDS = new Set([
  "contact",
  "negatedContact",
  "risingContact",
  "fallingContact",
  "coil",
  "setCoil",
  "resetCoil",
  "FBDCompartment",
]);

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const inputs = collectInputs(options);
  if (inputs.length === 0) {
    throw new Error("No diagram files were found for analysis.");
  }

  const fileReports = [];
  for (const [index, input] of inputs.entries()) {
    console.log(
      `[business-coverage] analyzing ${index + 1}/${inputs.length}: ${displayPath(input.filePath)}`,
    );
    fileReports.push(await analyzeFile(input, options));
  }

  const report = {
    schemaVersion: "ide-agent.business-suggestion-coverage.v1",
    generatedAt: new Date().toISOString(),
    configuration: {
      fixtureDirectory: options.includeFixtures
        ? displayPath(FIXTURE_DIR)
        : undefined,
      additionalInputs: options.inputPaths.map(displayPath),
      focusScope: options.includeInsertionPoints
        ? "realGraphNodesAndInsertionPoints"
        : "realGraphNodes",
      businessPresentationDefinition:
        "Suggestion title differs from Core's structural fallback title; diagnostics evidence is reported separately.",
      concurrency: options.concurrency,
    },
    summary: summarizeFiles(fileReports),
    files: fileReports,
  };

  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(
    options.outputPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  printSummary(report.summary, options.outputPath);
}

function parseArguments(args) {
  const options = {
    concurrency: 4,
    help: false,
    includeFixtures: true,
    includeInsertionPoints: false,
    inputPaths: [],
    outputPath: DEFAULT_OUTPUT_PATH,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--no-fixtures") {
      options.includeFixtures = false;
    } else if (arg === "--include-insertion-points") {
      options.includeInsertionPoints = true;
    } else if (arg === "--output" || arg === "-o") {
      options.outputPath = resolveRequiredValue(args, ++index, arg);
    } else if (arg === "--concurrency") {
      const value = Number(resolveRequiredValue(args, ++index, arg));
      if (!Number.isInteger(value) || value < 1 || value > 16) {
        throw new Error("--concurrency must be an integer from 1 to 16.");
      }
      options.concurrency = value;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.inputPaths.push(path.resolve(arg));
    }
  }

  options.outputPath = path.resolve(options.outputPath);
  return options;
}

function resolveRequiredValue(args, index, optionName) {
  const value = args[index];
  if (!value) {
    throw new Error(`${optionName} requires a value.`);
  }
  return value;
}

function collectInputs(options) {
  const inputsByPath = new Map();
  if (options.includeFixtures) {
    for (const filePath of collectDiagramFiles(FIXTURE_DIR)) {
      inputsByPath.set(normalizeFileKey(filePath), {
        filePath,
        source: "fixture",
      });
    }
  }

  for (const inputPath of options.inputPaths) {
    for (const filePath of collectDiagramFiles(inputPath)) {
      const key = normalizeFileKey(filePath);
      const existing = inputsByPath.get(key);
      inputsByPath.set(key, {
        filePath,
        source: existing ? `${existing.source}+additional` : "additional",
      });
    }
  }

  return [...inputsByPath.values()].sort((left, right) =>
    left.filePath.localeCompare(right.filePath),
  );
}

function collectDiagramFiles(inputPath) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input path does not exist: ${inputPath}`);
  }

  const stat = fs.statSync(inputPath);
  if (stat.isFile()) {
    return isDiagramFile(inputPath) ? [path.resolve(inputPath)] : [];
  }
  if (!stat.isDirectory()) {
    return [];
  }

  return fs
    .readdirSync(inputPath, { withFileTypes: true })
    .flatMap((entry) =>
      collectDiagramFiles(path.join(inputPath, entry.name)),
    );
}

function isDiagramFile(filePath) {
  return [".json", ".txt"].includes(path.extname(filePath).toLowerCase());
}

async function analyzeFile(input, options) {
  const startedAt = Date.now();
  let summary;
  try {
    summary = await loadDiagramSummary(input.filePath);
  } catch (error) {
    return {
      path: displayPath(input.filePath),
      source: input.source,
      status: "error",
      error: formatError(error),
      durationMs: Date.now() - startedAt,
    };
  }

  const focusInputs = collectFocusInputs(
    summary,
    options.includeInsertionPoints,
  );
  let completed = 0;
  const progressInterval = Math.max(10, Math.ceil(focusInputs.length / 4));
  const focuses = await mapWithConcurrency(
    focusInputs,
    options.concurrency,
    async (focusInput) => {
      const result = await analyzeFocus(input.filePath, focusInput);
      completed += 1;
      if (
        focusInputs.length >= 40 &&
        (completed % progressInterval === 0 || completed === focusInputs.length)
      ) {
        console.log(
          `[business-coverage] ${displayPath(input.filePath)} ${completed}/${focusInputs.length} focuses`,
        );
      }
      return result;
    },
  );

  return {
    path: displayPath(input.filePath),
    source: input.source,
    status: "analyzed",
    pouNames: splitNonEmpty(summary.pouName),
    pouTypes: splitNonEmpty(summary.pouType),
    variableCount: summary.variableCount,
    segmentCount: summary.segments.length,
    metrics: summarizeFocuses(focuses),
    ruleHits: collectDiagnosticHits(focuses, "ruleIds"),
    signatureHits: collectDiagnosticHits(focuses, "signatureIds"),
    coverageByFocusKind: coverageByFocusKind(focuses),
    structuralTitleHits: collectStructuralTitleHits(focuses),
    focuses,
    durationMs: Date.now() - startedAt,
  };
}

function collectFocusInputs(summary, includeInsertionPoints) {
  const focuses = [];
  for (const segment of summary.segments) {
    for (const node of segment.nodes) {
      if (!REAL_GRAPH_NODE_KINDS.has(node.kind)) {
        continue;
      }
      focuses.push({
        focusType: "node",
        pouName: segment.pouName || "",
        segmentId: segment.segmentId,
        segmentLabel: segment.label || "",
        nodeId: node.id,
        nodeKind: node.kind,
        nodeVariable: node.var || node.instance || "",
        blockType: node.blockType || "",
      });
    }

    if (includeInsertionPoints) {
      for (const insertionPoint of segment.insertionPoints) {
        focuses.push({
          focusType: "insertionPoint",
          pouName: segment.pouName || "",
          segmentId: segment.segmentId,
          segmentLabel: segment.label || "",
          nodeId: insertionPoint.id,
          nodeKind: insertionPoint.kind,
          nodeVariable: "",
          blockType: "",
        });
      }
    }
  }
  return focuses;
}

async function analyzeFocus(diagramPath, focusInput) {
  const request = {
    diagramPath,
    segmentId: focusInput.segmentId,
  };
  if (focusInput.focusType === "insertionPoint") {
    request.selectedInsertionPointId = focusInput.nodeId;
  } else {
    request.selectedNodeId = focusInput.nodeId;
  }

  try {
    const result = await getLocalGraphSuggestions(request);
    if (!result) {
      return {
        ...focusInput,
        status: "unresolved",
        suggestionCount: 0,
        businessSuggestionCount: 0,
        evidenceBackedSuggestionCount: 0,
        structuralSuggestionCount: 0,
        suggestions: [],
        validationIssues: [],
      };
    }

    const suggestions = result.payload.suggestions.map(summarizeSuggestion);
    const validationIssues = [
      ...findDuplicateSuggestionIssues(result.payload.suggestions),
      ...result.payload.suggestions.flatMap(validateLibrarySuggestion),
    ];
    const businessSuggestionCount = suggestions.filter(
      (suggestion) => suggestion.classification === "business",
    ).length;
    const evidenceBackedSuggestionCount = suggestions.filter(
      (suggestion) => suggestion.evidenceBacked,
    ).length;

    return {
      ...focusInput,
      status: "analyzed",
      suggestionCount: suggestions.length,
      businessSuggestionCount,
      evidenceBackedSuggestionCount,
      structuralSuggestionCount:
        suggestions.length - businessSuggestionCount,
      suggestions,
      validationIssues,
    };
  } catch (error) {
    return {
      ...focusInput,
      status: "error",
      error: formatError(error),
      suggestionCount: 0,
      businessSuggestionCount: 0,
      evidenceBackedSuggestionCount: 0,
      structuralSuggestionCount: 0,
      suggestions: [],
      validationIssues: [],
    };
  }
}

function summarizeSuggestion(suggestion) {
  const diagnostics = suggestion.diagnostics;
  const business = hasBusinessPresentation(suggestion);
  return {
    id: suggestion.id,
    title: suggestion.title,
    classification: business ? "business" : "structural",
    evidenceBacked: diagnostics?.source === "businessRules",
    position: suggestion.position,
    serialOrParallel: suggestion.serialOrParallel,
    element: describeAddedElement(suggestion),
    ruleIds: diagnostics?.ruleIds ?? [],
    signatureIds: diagnostics?.signatureIds ?? [],
    reason: diagnostics?.reason ?? "",
    confidence: diagnostics?.confidence,
    score: diagnostics?.score,
  };
}

function hasBusinessPresentation(suggestion) {
  return suggestion.title !== structuralSuggestionTitle(suggestion);
}

function structuralSuggestionTitle(suggestion) {
  const node = Object.values(suggestion.addNode ?? {})[0];
  const label = suggestedNodeLabel(node);
  if (suggestion.serialOrParallel === "parallel") {
    return `并联 ${label}`;
  }
  if (suggestion.position === "replace") {
    return `替换为 ${label}`;
  }
  if (suggestion.position === "front") {
    return `前串联 ${label}`;
  }
  if (suggestion.position === "outsideFront") {
    return `外侧前串联 ${label}`;
  }
  if (suggestion.position === "outsideBehind") {
    return `外侧后串联 ${label}`;
  }
  if (["coil", "setCoil", "resetCoil"].includes(node?.type)) {
    return `添加 ${label}`;
  }
  if (node?.type === "FBDCompartment") {
    return `后插入 ${label}`;
  }
  return `后串联 ${label}`;
}

function suggestedNodeLabel(node) {
  if (!node) {
    return "";
  }
  if (node.type === "FBDCompartment") {
    return `${node.childrenNode?.type || "FB"} ${
      node.childrenNode?.isFunction ? "函数" : "功能块"
    }`;
  }
  return (
    {
      contact: "常开触点",
      negatedContact: "常闭触点",
      risingContact: "上升沿",
      fallingContact: "下降沿",
      coil: "线圈",
      setCoil: "置位线圈",
      resetCoil: "复位线圈",
    }[node.type] ?? node.type
  );
}

function describeAddedElement(suggestion) {
  const nodes = Object.values(suggestion.addNode ?? {});
  if (nodes.length === 0) {
    return { nodeType: "", blockType: "", variableName: "" };
  }
  const node = nodes[0];
  return {
    nodeType: node.type,
    blockType: node.childrenNode?.type ?? "",
    variableName:
      node.childrenNode?.varName?.value ?? node.varName?.value ?? "",
  };
}

function findDuplicateSuggestionIssues(suggestions) {
  const seen = new Map();
  const issues = [];
  for (const suggestion of suggestions) {
    const key = publicSuggestionKey(suggestion);
    const existingId = seen.get(key);
    if (existingId) {
      issues.push({
        kind: "duplicate-suggestion",
        suggestionId: suggestion.id,
        duplicateOf: existingId,
      });
    } else {
      seen.set(key, suggestion.id);
    }
  }
  return issues;
}

function publicSuggestionKey(suggestion) {
  const element = describeAddedElement(suggestion);
  return JSON.stringify({
    startNodes: suggestion.startNodes,
    endNodes: suggestion.endNodes,
    position: suggestion.position,
    serialOrParallel: suggestion.serialOrParallel,
    nodeType: element.nodeType,
    blockType: element.blockType,
    variableName: element.variableName,
  });
}

function validateLibrarySuggestion(suggestion) {
  const issues = [];
  for (const node of Object.values(suggestion.addNode ?? {})) {
    if (node.type !== "FBDCompartment") {
      continue;
    }

    const blockType = node.childrenNode?.type ?? "";
    const libraryElement = getLibraryElement(blockType);
    if (!libraryElement) {
      issues.push({
        kind: "missing-library-element",
        suggestionId: suggestion.id,
        blockType,
      });
      continue;
    }

    const expectedPorts = buildLibraryPorts(libraryElement);
    const expected = {
      portInputs: portDescriptors(expectedPorts.portInputs),
      portOutputs: portDescriptors(expectedPorts.portOutputs),
    };
    const actual = {
      portInputs: portDescriptors(node.childrenNode?.portInputs ?? []),
      portOutputs: portDescriptors(node.childrenNode?.portOutputs ?? []),
    };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      issues.push({
        kind: "library-port-mismatch",
        suggestionId: suggestion.id,
        blockType,
        expected,
        actual,
      });
    }
  }
  return issues;
}

function portDescriptors(ports) {
  return ports.map((port) => ({
    name: port.name,
    type: port.type,
    scope: port.scope,
  }));
}

function summarizeFocuses(focuses) {
  const analyzedFocuses = focuses.filter(
    (focus) => focus.status === "analyzed",
  );
  const focusCount = focuses.length;
  const totalSuggestions = sum(focuses, "suggestionCount");
  const businessSuggestions = sum(focuses, "businessSuggestionCount");
  const evidenceBackedSuggestions = sum(
    focuses,
    "evidenceBackedSuggestionCount",
  );
  const focusesWithBusinessSuggestions = focuses.filter(
    (focus) => focus.businessSuggestionCount > 0,
  ).length;
  const focusesWithSuggestions = focuses.filter(
    (focus) => focus.suggestionCount > 0,
  ).length;
  const focusesWithEvidence = focuses.filter(
    (focus) => focus.evidenceBackedSuggestionCount > 0,
  ).length;

  return {
    focusCount,
    analyzedFocusCount: analyzedFocuses.length,
    unresolvedFocusCount: focuses.filter(
      (focus) => focus.status === "unresolved",
    ).length,
    errorFocusCount: focuses.filter((focus) => focus.status === "error").length,
    focusesWithSuggestions,
    focusesWithoutSuggestions: focusCount - focusesWithSuggestions,
    focusesWithBusinessSuggestions,
    focusesWithEvidence,
    structuralOnlyFocuses: focuses.filter(
      (focus) =>
        focus.suggestionCount > 0 && focus.businessSuggestionCount === 0,
    ).length,
    totalSuggestions,
    businessSuggestions,
    evidenceBackedSuggestions,
    structuralSuggestions: totalSuggestions - businessSuggestions,
    businessFocusCoveragePercent: percentage(
      focusesWithBusinessSuggestions,
      focusCount,
    ),
    businessSuggestionPercent: percentage(
      businessSuggestions,
      totalSuggestions,
    ),
    evidenceFocusCoveragePercent: percentage(focusesWithEvidence, focusCount),
    evidenceSuggestionPercent: percentage(
      evidenceBackedSuggestions,
      totalSuggestions,
    ),
    duplicateSuggestionCount: countIssues(focuses, "duplicate-suggestion"),
    libraryValidationIssueCount:
      countIssues(focuses, "missing-library-element") +
      countIssues(focuses, "library-port-mismatch"),
  };
}

function summarizeFiles(fileReports) {
  const analyzedFiles = fileReports.filter(
    (report) => report.status === "analyzed",
  );
  const metrics = analyzedFiles.map((report) => report.metrics);
  const focusCount = sum(metrics, "focusCount");
  const totalSuggestions = sum(metrics, "totalSuggestions");
  const businessSuggestions = sum(metrics, "businessSuggestions");
  const evidenceBackedSuggestions = sum(metrics, "evidenceBackedSuggestions");
  const focusesWithBusinessSuggestions = sum(
    metrics,
    "focusesWithBusinessSuggestions",
  );
  const focusesWithEvidence = sum(metrics, "focusesWithEvidence");

  return {
    fileCount: fileReports.length,
    analyzedFileCount: analyzedFiles.length,
    errorFileCount: fileReports.length - analyzedFiles.length,
    variableCount: sum(analyzedFiles, "variableCount"),
    segmentCount: sum(analyzedFiles, "segmentCount"),
    focusCount,
    analyzedFocusCount: sum(metrics, "analyzedFocusCount"),
    unresolvedFocusCount: sum(metrics, "unresolvedFocusCount"),
    errorFocusCount: sum(metrics, "errorFocusCount"),
    focusesWithSuggestions: sum(metrics, "focusesWithSuggestions"),
    focusesWithoutSuggestions: sum(metrics, "focusesWithoutSuggestions"),
    focusesWithBusinessSuggestions,
    focusesWithEvidence,
    structuralOnlyFocuses: sum(metrics, "structuralOnlyFocuses"),
    totalSuggestions,
    businessSuggestions,
    evidenceBackedSuggestions,
    structuralSuggestions: totalSuggestions - businessSuggestions,
    businessFocusCoveragePercent: percentage(
      focusesWithBusinessSuggestions,
      focusCount,
    ),
    businessSuggestionPercent: percentage(
      businessSuggestions,
      totalSuggestions,
    ),
    evidenceFocusCoveragePercent: percentage(focusesWithEvidence, focusCount),
    evidenceSuggestionPercent: percentage(
      evidenceBackedSuggestions,
      totalSuggestions,
    ),
    duplicateSuggestionCount: sum(metrics, "duplicateSuggestionCount"),
    libraryValidationIssueCount: sum(
      metrics,
      "libraryValidationIssueCount",
    ),
    ruleHits: mergeHits(analyzedFiles.flatMap((report) => report.ruleHits)),
    signatureHits: mergeHits(
      analyzedFiles.flatMap((report) => report.signatureHits),
    ),
    coverageByFocusKind: mergeCoverageByFocusKind(
      analyzedFiles.flatMap((report) => report.coverageByFocusKind),
    ),
    structuralTitleHits: mergeHits(
      analyzedFiles.flatMap((report) => report.structuralTitleHits),
    ),
  };
}

function coverageByFocusKind(focuses) {
  const groups = new Map();
  for (const focus of focuses) {
    const key = focus.blockType
      ? `${focus.nodeKind}:${focus.blockType}`
      : focus.nodeKind;
    const current = groups.get(key) ?? {
      key,
      focusCount: 0,
      focusesWithBusinessSuggestions: 0,
      totalSuggestions: 0,
      businessSuggestions: 0,
    };
    current.focusCount += 1;
    current.focusesWithBusinessSuggestions +=
      focus.businessSuggestionCount > 0 ? 1 : 0;
    current.totalSuggestions += focus.suggestionCount;
    current.businessSuggestions += focus.businessSuggestionCount;
    groups.set(key, current);
  }
  return finalizeCoverageGroups([...groups.values()]);
}

function mergeCoverageByFocusKind(groups) {
  const merged = new Map();
  for (const group of groups) {
    const current = merged.get(group.key) ?? {
      key: group.key,
      focusCount: 0,
      focusesWithBusinessSuggestions: 0,
      totalSuggestions: 0,
      businessSuggestions: 0,
    };
    current.focusCount += group.focusCount;
    current.focusesWithBusinessSuggestions +=
      group.focusesWithBusinessSuggestions;
    current.totalSuggestions += group.totalSuggestions;
    current.businessSuggestions += group.businessSuggestions;
    merged.set(group.key, current);
  }
  return finalizeCoverageGroups([...merged.values()]);
}

function finalizeCoverageGroups(groups) {
  return groups
    .map((group) => ({
      ...group,
      businessFocusCoveragePercent: percentage(
        group.focusesWithBusinessSuggestions,
        group.focusCount,
      ),
      businessSuggestionPercent: percentage(
        group.businessSuggestions,
        group.totalSuggestions,
      ),
    }))
    .sort(
      (left, right) =>
        right.focusCount - left.focusCount || left.key.localeCompare(right.key),
    );
}

function collectDiagnosticHits(focuses, property) {
  const values = focuses.flatMap((focus) =>
    focus.suggestions.flatMap((suggestion) => suggestion[property] ?? []),
  );
  return hitsFromValues(values);
}

function collectStructuralTitleHits(focuses) {
  return hitsFromValues(
    focuses.flatMap((focus) =>
      focus.suggestions
        .filter((suggestion) => suggestion.classification === "structural")
        .map((suggestion) => suggestion.title),
    ),
  );
}

function hitsFromValues(values) {
  const counts = new Map();
  for (const value of values) {
    if (value) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.id.localeCompare(right.id),
    );
}

function mergeHits(hits) {
  const counts = new Map();
  for (const hit of hits) {
    counts.set(hit.id, (counts.get(hit.id) ?? 0) + hit.count);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.id.localeCompare(right.id),
    );
}

function countIssues(focuses, kind) {
  return focuses.reduce(
    (total, focus) =>
      total + focus.validationIssues.filter((issue) => issue.kind === kind).length,
    0,
  );
}

function sum(items, property) {
  return items.reduce(
    (total, item) => total + Number(item?.[property] ?? 0),
    0,
  );
}

function percentage(numerator, denominator) {
  return denominator > 0
    ? Number(((numerator / denominator) * 100).toFixed(2))
    : 0;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function splitNonEmpty(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeFileKey(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function displayPath(filePath) {
  const resolved = path.resolve(filePath);
  const relative = path.relative(ROOT_DIR, resolved);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative.replace(/\\/g, "/")
    : resolved;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function printSummary(summary, outputPath) {
  console.log("");
  console.log(
    `[business-coverage] files=${summary.analyzedFileCount}/${summary.fileCount} segments=${summary.segmentCount} focuses=${summary.focusCount}`,
  );
  console.log(
    `[business-coverage] suggestions=${summary.totalSuggestions} business presentation=${summary.businessSuggestions} structural=${summary.structuralSuggestions}`,
  );
  console.log(
    `[business-coverage] business presentation focus coverage=${summary.businessFocusCoveragePercent}% suggestion share=${summary.businessSuggestionPercent}%`,
  );
  console.log(
    `[business-coverage] evidence focus coverage=${summary.evidenceFocusCoveragePercent}% evidence suggestion share=${summary.evidenceSuggestionPercent}%`,
  );
  console.log(
    `[business-coverage] duplicates=${summary.duplicateSuggestionCount} library issues=${summary.libraryValidationIssueCount}`,
  );
  console.log(`[business-coverage] report=${displayPath(outputPath)}`);
}

function printUsage() {
  console.log(`Usage:
  npm run analyze:business-coverage -- [options] [diagram files/directories]

Options:
  --no-fixtures                 Do not scan src/test/fixtures.
  --include-insertion-points    Include editRect/branchRect focuses.
  --concurrency <1-16>          Concurrent focus requests. Default: 4.
  --output, -o <path>           Report path. Default: tmp/business-suggestion-coverage.json.
  --help, -h                    Show this help.`);
}

main().catch((error) => {
  console.error(`[business-coverage] failed: ${formatError(error)}`);
  process.exitCode = 1;
});

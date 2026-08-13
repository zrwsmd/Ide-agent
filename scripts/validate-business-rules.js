const fs = require("fs");
const path = require("path");
const Ajv2020 = require("ajv/dist/2020");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_RULES_PATH = path.join(
  ROOT_DIR,
  "packages",
  "core",
  "src",
  "graph",
  "businessRules.json",
);
const SCHEMA_PATH = path.join(
  ROOT_DIR,
  "packages",
  "core",
  "src",
  "graph",
  "businessRules.schema.json",
);

function validateBusinessRules(rulesPath = DEFAULT_RULES_PATH) {
  const rules = readJson(rulesPath);
  const schema = readJson(SCHEMA_PATH);
  // The rule definitions use draft-2020-12 `unevaluatedProperties` across
  // composed schemas; keep strict validation of values while allowing AJV to
  // compile that composition without treating the keyword as a schema error.
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const valid = validate(rules);
  const errors = [];

  if (!valid) {
    errors.push(...(validate.errors ?? []).map(formatAjvError));
  }

  if (valid) {
    errors.push(...validateSemanticRules(rules));
  }

  if (errors.length > 0) {
    const error = new Error(
      `businessRules validation failed for ${rulesPath}:\n${errors
        .map((item) => `  - ${item}`)
        .join("\n")}`,
    );
    error.validationErrors = errors;
    throw error;
  }

  return rules;
}

function validateSemanticRules(rules) {
  const errors = [];
  const ruleCollections = [
    "blockPortRoleRules",
    "motionCommandProfiles",
    "loopSignatures",
    "deviceLoopRules",
    "faultResponseRules",
    "faultResetRules",
    "actionLifecycleRules",
    "contactPolarityRules",
    "nodeIntentRules",
    "libraryRules",
    "rankingRules",
    "plannedRules",
    "variablePatterns.roleEvidenceRules",
  ];

  for (const collectionPath of ruleCollections) {
    const collection = getPath(rules, collectionPath);
    if (!Array.isArray(collection)) {
      continue;
    }

    const seen = new Map();
    collection.forEach((entry, index) => {
      const id = entry?.id;
      if (!id) {
        return;
      }
      const previousIndex = seen.get(id);
      if (previousIndex !== undefined) {
        errors.push(
          `${collectionPath}[${index}].id duplicates ${collectionPath}[${previousIndex}].id (${JSON.stringify(id)})`,
        );
      } else {
        seen.set(id, index);
      }
    });
  }

  const termNames = new Set([
    ...(rules.termPatterns ?? []).map((entry) => entry.term),
    ...(rules.derivedTerms ?? []).map((entry) => entry.term),
  ]);
  for (const [index, entry] of (rules.derivedTerms ?? []).entries()) {
    if (
      !(entry.whenDataTypesAny?.length > 0) &&
      !(entry.whenTypeCapabilitiesAny?.length > 0)
    ) {
      errors.push(
        `derivedTerms[${index}] must define whenDataTypesAny or whenTypeCapabilitiesAny`,
      );
    }
  }
  for (const [index, entry] of (rules.termPatterns ?? []).entries()) {
    for (const pattern of entry.regexPatterns ?? []) {
      try {
        new RegExp(pattern, "iu");
      } catch (error) {
        errors.push(
          `termPatterns[${index}].regexPatterns contains invalid regex ${JSON.stringify(pattern)}: ${error.message}`,
        );
      }
    }
  }

  for (const [index, entry] of (rules.termImplications ?? []).entries()) {
    if (!termNames.has(entry.ifMatched)) {
      errors.push(
        `termImplications[${index}].ifMatched references unknown term ${JSON.stringify(entry.ifMatched)}`,
      );
    }
    for (const [termIndex, term] of (entry.alsoMatch ?? []).entries()) {
      if (!termNames.has(term)) {
        errors.push(
          `termImplications[${index}].alsoMatch[${termIndex}] references unknown term ${JSON.stringify(term)}`,
        );
      }
    }
  }

  const signatureIds = new Set(
    (rules.loopSignatures ?? []).map((entry) => entry.id),
  );
  for (const [index, rule] of (rules.libraryRules ?? []).entries()) {
    for (const [refIndex, reference] of (rule.signatureRefsAny ?? []).entries()) {
      if (!signatureIds.has(reference)) {
        errors.push(
          `libraryRules[${index}].signatureRefsAny[${refIndex}] references unknown loop signature ${JSON.stringify(reference)}`,
        );
      }
    }
  }

  const capabilityNames = new Set(Object.keys(rules.typeCapabilities ?? {}));
  for (const [index, rule] of (rules.libraryRules ?? []).entries()) {
    for (const [capabilityIndex, capability] of (
      rule.requiredTypeCapabilities ?? []
    ).entries()) {
      if (!capabilityNames.has(capability)) {
        errors.push(
          `libraryRules[${index}].requiredTypeCapabilities[${capabilityIndex}] references unknown type capability ${JSON.stringify(capability)}`,
        );
      }
    }
  }

  validateRegexSources(rules.variablePatterns, "variablePatterns", errors);
  return errors;
}

function validateRegexSources(variablePatterns, prefix, errors) {
  const sources = [
    ...(variablePatterns?.roleEvidenceRules ?? []).flatMap((rule, ruleIndex) =>
      (rule.sources ?? []).map((source, sourceIndex) => ({
        path: `${prefix}.roleEvidenceRules[${ruleIndex}].sources[${sourceIndex}]`,
        patterns: source.regexPatterns ?? [],
      })),
    ),
    ...(variablePatterns?.physicalTerms ?? []).map((entry, index) => ({
      path: `${prefix}.physicalTerms[${index}]`,
      patterns: entry.regexPatterns ?? [],
    })),
  ];

  for (const source of sources) {
    for (const pattern of source.patterns) {
      try {
        new RegExp(pattern, "iu");
      } catch (error) {
        errors.push(
          `${source.path}.regexPatterns contains invalid regex ${JSON.stringify(pattern)}: ${error.message}`,
        );
      }
    }
  }
}

function getPath(value, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => current?.[key], value);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`cannot read JSON ${filePath}: ${error.message}`);
  }
}

function formatAjvError(error) {
  const pathText = error.instancePath || "(root)";
  const unexpectedProperty =
    error.params?.additionalProperty ?? error.params?.unevaluatedProperty;
  const detail = unexpectedProperty
    ? `unexpected property ${JSON.stringify(unexpectedProperty)}`
    : error.message;
  return `${pathText}: ${detail}`;
}

if (require.main === module) {
  try {
    validateBusinessRules(process.argv[2] || DEFAULT_RULES_PATH);
    console.log(`[business-rules-schema] valid: ${process.argv[2] || DEFAULT_RULES_PATH}`);
  } catch (error) {
    console.error(`[business-rules-schema] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  validateBusinessRules,
};

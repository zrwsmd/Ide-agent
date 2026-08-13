const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { validateBusinessRules } = require("./validate-business-rules");

const rulesPath = path.resolve(
  __dirname,
  "..",
  "packages",
  "core",
  "src",
  "graph",
  "businessRules.json",
);
const source = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
validateBusinessRules(rulesPath);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ide-agent-business-rules-"));
try {
  const malformed = structuredClone(source);
  malformed.libraryRules[0].unexpectedTypo = true;
  const malformedPath = path.join(tempDir, "malformed.json");
  fs.writeFileSync(malformedPath, JSON.stringify(malformed), "utf8");

  assert.throws(
    () => validateBusinessRules(malformedPath),
    /unexpected property.*unexpectedTypo/,
    "schema validation should reject unknown rule fields",
  );

  const brokenReference = structuredClone(source);
  brokenReference.libraryRules[0].signatureRefsAny = ["missing-signature"];
  const brokenReferencePath = path.join(tempDir, "broken-reference.json");
  fs.writeFileSync(brokenReferencePath, JSON.stringify(brokenReference), "utf8");
  assert.throws(
    () => validateBusinessRules(brokenReferencePath),
    /unknown loop signature.*missing-signature/,
    "semantic validation should reject unknown signature references",
  );
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log("[test-business-rules-schema] passed");

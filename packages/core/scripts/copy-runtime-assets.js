const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const distGraphDir = path.join(rootDir, "dist", "graph");
const businessRulesSource = path.join(rootDir, "src", "graph", "businessRules.json");
const businessRulesTarget = path.join(distGraphDir, "businessRules.json");
const businessRulesSchemaSource = path.join(rootDir, "src", "graph", "businessRules.schema.json");
const businessRulesSchemaTarget = path.join(distGraphDir, "businessRules.schema.json");
const libraryDataTarget = path.join(distGraphDir, "st-library-info-data.json");

if (!fs.existsSync(distGraphDir)) {
  throw new Error(`Core graph dist directory does not exist: ${distGraphDir}`);
}

fs.copyFileSync(businessRulesSource, businessRulesTarget);
console.log(`[copy-runtime-assets] copied ${businessRulesTarget}`);
fs.copyFileSync(businessRulesSchemaSource, businessRulesSchemaTarget);
console.log(`[copy-runtime-assets] copied ${businessRulesSchemaTarget}`);

try {
  const libraryDataSource = require.resolve("st-library-info/data", {
    paths: [rootDir],
  });
  fs.copyFileSync(libraryDataSource, libraryDataTarget);
  console.log(`[copy-runtime-assets] copied ${libraryDataTarget}`);
} catch (error) {
  console.warn(
    `[copy-runtime-assets] st-library-info data not found; special business FB/function suggestions will be skipped. ${error.message}`,
  );
}

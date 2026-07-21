const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const coreDir = path.join(rootDir, "packages", "core");
const sourceDist = path.join(coreDir, "dist");
const targetDir = path.join(
  rootDir,
  "dist",
  "node_modules",
  "@ide-agent",
  "core",
);
const targetDist = path.join(targetDir, "dist");

if (!fs.existsSync(sourceDist)) {
  throw new Error(`Core dist does not exist: ${sourceDist}`);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });
fs.cpSync(sourceDist, targetDist, { recursive: true });

const packageJson = JSON.parse(
  fs.readFileSync(path.join(coreDir, "package.json"), "utf8"),
);
const runtimePackageJson = {
  name: packageJson.name,
  version: packageJson.version,
  license: packageJson.license,
  main: packageJson.main,
  types: packageJson.types,
};

fs.writeFileSync(
  path.join(targetDir, "package.json"),
  `${JSON.stringify(runtimePackageJson, null, 2)}\n`,
);

console.log(`[copy-core-runtime] copied @ide-agent/core runtime to ${targetDir}`);

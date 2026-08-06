const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const nestedCoreNodeModules = path.resolve(
  rootDir,
  "packages",
  "core",
  "node_modules",
);
const expectedSuffix = path.join("packages", "core", "node_modules");

function removeDirectoryIfPresent(targetPath) {
  const relative = path.relative(rootDir, targetPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to remove path outside repository: ${targetPath}`);
  }

  if (!targetPath.endsWith(expectedSuffix)) {
    throw new Error(`Refusing to remove unexpected path: ${targetPath}`);
  }

  if (!fs.existsSync(targetPath)) {
    console.log(`[clean-package-artifacts] nothing to remove: ${relative}`);
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
  console.log(`[clean-package-artifacts] removed ${relative}`);
}

removeDirectoryIfPresent(nestedCoreNodeModules);

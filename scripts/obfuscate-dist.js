#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const terser = require("terser");

const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");

main().catch((error) => {
  console.error("[obfuscate-dist] failed");
  console.error(error);
  process.exit(1);
});

async function main() {
  const files = await listJavaScriptFiles(distDir);

  for (const file of files) {
    const input = await fs.readFile(file, "utf8");
    const result = await terser.minify(input, {
      module: false,
      sourceMap: false,
      compress: {
        defaults: true,
        passes: 2,
        unsafe: false,
        unsafe_arrows: false,
        unsafe_comps: false,
        unsafe_Function: false,
        unsafe_math: false,
        unsafe_symbols: false,
        unsafe_methods: false,
        unsafe_proto: false,
        unsafe_regexp: false,
        unsafe_undefined: false,
      },
      mangle: {
        toplevel: true,
        keep_classnames: true,
        keep_fnames: true,
      },
      format: {
        comments: false,
      },
    });

    if (!result.code) {
      throw new Error(`Terser returned empty output for ${file}`);
    }

    await fs.writeFile(file, `${result.code}\n`, "utf8");
  }

  await removeSourceMaps(distDir);
  console.log(`[obfuscate-dist] obfuscated ${files.length} JavaScript files`);
}

async function listJavaScriptFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJavaScriptFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function removeSourceMaps(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await removeSourceMaps(fullPath);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".map")) {
      await fs.rm(fullPath, { force: true });
    }
  }
}

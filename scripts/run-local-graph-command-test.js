#!/usr/bin/env node

const path = require("path");
const fs = require("fs");
const { runTests } = require("@vscode/test-electron");

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "..");
  const extensionTestsPath = path.resolve(
    __dirname,
    "..",
    "dist",
    "test",
    "localGraphCommandTest.js",
  );
  const installedCodePath = "D:\\Microsoft VS Code\\Code.exe";
  const resultPath = path.resolve(
    extensionDevelopmentPath,
    "tmp",
    "local-graph-command-result.json",
  );

  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  if (fs.existsSync(resultPath)) {
    fs.unlinkSync(resultPath);
  }

  const options = {
    extensionDevelopmentPath,
    extensionTestsPath,
    extensionTestsEnv: {
      IDE_AGENT_LOCAL_GRAPH_TEST_RESULT: resultPath,
    },
  };

  if (fs.existsSync(installedCodePath)) {
    options.vscodeExecutablePath = installedCodePath;
  } else {
    options.version = "1.85.0";
  }

  delete process.env.ELECTRON_RUN_AS_NODE;

  await runTests(options);

  if (!fs.existsSync(resultPath)) {
    throw new Error(`Test passed but result file was not written: ${resultPath}`);
  }

  const resultText = fs.readFileSync(resultPath, "utf8");
  console.log("\n=== ide-agent.getLocalGraphSuggestions result ===");
  console.log(resultText);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

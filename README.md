# Ide Agent

Ide Agent is a small VS Code extension for AI inline completion in IEC 61131-3 Structured Text files.

## Features

- Adds an `Ide Agent` activity bar panel.
- Registers Structured Text files (`.st`, `.ST`, `.iecst`).
- Provides inline ghost-text completion from an LLM.
- Predicts a preview LD/FBD graph completion patch from the active ST file and a diagram JSON snapshot.
- Supports SiliconFlow and Anthropic-compatible providers.
- Stores API keys in VS Code Secret Storage.
- Logs completion decisions in the `Ide Agent` output channel.

## Development

```powershell
npm install
npm run compile
```

Open this folder in VS Code and press `F5` to start an Extension Development Host.

## Usage

1. Open the `Ide Agent` activity bar panel.
2. Select `SiliconFlow` or `Anthropic Compatible`.
3. Fill model, base URL, and API key in the panel.
4. Click `Save`.
5. Open a `.st` file and trigger inline suggestions.

Useful commands:

- `Ide Agent: Open Panel`
- `Ide Agent: Trigger ST Completion`
- `Ide Agent: Predict LD/FBD Graph Completion`
- `Ide Agent: Show Logs`

The first graph prediction prototype reads the diagram JSON from:

```text
D:\generate-plc-20250422\src\a.json
```

It sends the active ST file plus a compressed diagram summary to the selected LLM and copies the returned frontend preview patch JSON to the clipboard. The full request/response trace is written to the `Ide Agent` output channel.

## Settings

- `ide-agent.llm.provider`
- `ide-agent.llm.siliconflowModel`
- `ide-agent.llm.siliconflowBaseUrl`
- `ide-agent.llm.anthropicCompatibleModel`
- `ide-agent.llm.anthropicCompatibleBaseUrl`
- `ide-agent.completion.enabled`
- `ide-agent.completion.automatic`
- `ide-agent.completion.debug`
- `ide-agent.completion.maxContextLines`
- `ide-agent.completion.maxAfterLines`
- `ide-agent.completion.maxCompletionLines`
- `ide-agent.completion.requestTimeoutMs`

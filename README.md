# Ide Agent

Ide Agent is a small VS Code extension for AI inline completion in IEC 61131-3 Structured Text files.

## Features

- Adds an `Ide Agent` activity bar panel.
- Registers Structured Text files (`.st`, `.ST`, `.iecst`).
- Provides inline ghost-text completion from an LLM.
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
- `Ide Agent: Show Logs`

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

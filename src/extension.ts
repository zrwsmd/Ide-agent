import * as vscode from 'vscode';
import { ST_DOCUMENT_SELECTOR } from './completion/STContext';
import { STInlineCompletionProvider } from './completion/STInlineCompletionProvider';
import { GraphCompletionService } from './graph/GraphCompletionService';
import { createLLMAdapter, getDefaultBaseUrl } from './llm/LLMFactory';
import { LLMAdapter, LLMConfig, ProviderId } from './llm/types';
import { ConfigPanelProvider } from './ui/ConfigPanelProvider';

const OUTPUT_CHANNEL_NAME = 'Ide Agent';
const SECRET_PREFIX = 'ide-agent.apiKey.';

interface CachedAdapter {
  key: string;
  adapter: LLMAdapter;
}

let outputChannel: vscode.OutputChannel | undefined;
let cachedAdapter: CachedAdapter | undefined;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  outputChannel.appendLine(`[${new Date().toISOString()}] activating Ide Agent`);

  const provider = new STInlineCompletionProvider(
    () => getActiveLLMAdapter(context),
    outputChannel
  );
  const graphCompletionService = new GraphCompletionService(
    () => getActiveLLMAdapter(context),
    outputChannel
  );
  const configPanelProvider = new ConfigPanelProvider(context, {
    onConfigChanged: () => {
      cachedAdapter = undefined;
    },
    onTriggerCompletion: triggerCompletion,
    onTriggerGraphCompletion: () => graphCompletionService.predictFromActiveEditor(),
    onTriggerGraphCompletionWithScreenshot: () => graphCompletionService.predictFromActiveEditor({ includeScreenshot: true }),
    onShowLogs: () => outputChannel?.show(true),
  });

  context.subscriptions.push(
    outputChannel,
    vscode.window.registerWebviewViewProvider(ConfigPanelProvider.viewType, configPanelProvider),
    vscode.languages.registerInlineCompletionItemProvider(ST_DOCUMENT_SELECTOR, provider),
    vscode.commands.registerCommand('ide-agent.openPanel', () => vscode.commands.executeCommand(`${ConfigPanelProvider.viewType}.focus`)),
    vscode.commands.registerCommand('ide-agent.triggerCompletion', triggerCompletion),
    vscode.commands.registerCommand('ide-agent.predictGraphCompletion', () => graphCompletionService.predictFromActiveEditor()),
    vscode.commands.registerCommand('ide-agent.predictGraphCompletionWithScreenshot', () => graphCompletionService.predictFromActiveEditor({ includeScreenshot: true })),
    vscode.commands.registerCommand('ide-agent.showLogs', () => outputChannel?.show(true))
  );

  outputChannel.appendLine(`[${new Date().toISOString()}] UI panel, ST inline completion provider, and graph prediction command registered`);
}

export function deactivate(): void {
  cachedAdapter = undefined;
}

async function getActiveLLMAdapter(context: vscode.ExtensionContext): Promise<LLMAdapter | null> {
  const config = vscode.workspace.getConfiguration('ide-agent');
  const provider = getConfiguredProvider(config);
  const apiKey = await context.secrets.get(secretKey(provider));

  if (!apiKey) {
    outputChannel?.appendLine(
      `[${new Date().toISOString()}] missing API key for provider=${provider}; open the Ide Agent panel and save a key`
    );
    return null;
  }

  const llmConfig = getLLMConfig(config, provider, apiKey);
  const cacheKey = JSON.stringify({
    provider: llmConfig.provider,
    model: llmConfig.model,
    baseUrl: llmConfig.baseUrl || getDefaultBaseUrl(provider),
    apiKeyFingerprint: apiKey.slice(0, 6),
  });

  if (cachedAdapter?.key === cacheKey) {
    return cachedAdapter.adapter;
  }

  try {
    const adapter = createLLMAdapter(llmConfig);
    cachedAdapter = { key: cacheKey, adapter };
    outputChannel?.appendLine(
      `[${new Date().toISOString()}] created LLM adapter provider=${provider} model=${llmConfig.model} baseUrl=${llmConfig.baseUrl || getDefaultBaseUrl(provider)}`
    );
    return adapter;
  } catch (error) {
    outputChannel?.appendLine(`[${new Date().toISOString()}] failed to create LLM adapter: ${formatUnknownError(error)}`);
    return null;
  }
}

async function triggerCompletion(): Promise<void> {
  outputChannel?.appendLine(`[${new Date().toISOString()}] manual ST completion trigger invoked`);
  await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
}

function getConfiguredProvider(config: vscode.WorkspaceConfiguration): ProviderId {
  const value = config.get<string>('llm.provider') || 'siliconflow';
  return value === 'anthropic-compatible' ? 'anthropic-compatible' : 'siliconflow';
}

function getLLMConfig(
  config: vscode.WorkspaceConfiguration,
  provider: ProviderId,
  apiKey: string
): LLMConfig {
  if (provider === 'anthropic-compatible') {
    return {
      provider,
      apiKey,
      model: config.get<string>('llm.anthropicCompatibleModel') || 'MiniMax-M1',
      baseUrl: emptyToUndefined(config.get<string>('llm.anthropicCompatibleBaseUrl')),
    };
  }

  return {
    provider,
    apiKey,
    model: config.get<string>('llm.siliconflowModel') || 'Qwen/Qwen3-Coder-30B-A3B-Instruct',
    baseUrl: emptyToUndefined(config.get<string>('llm.siliconflowBaseUrl')),
  };
}

function secretKey(provider: ProviderId): string {
  return `${SECRET_PREFIX}${provider}`;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

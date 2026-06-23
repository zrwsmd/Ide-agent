import * as vscode from 'vscode';
import { ProviderId } from '../llm/types';

const SECRET_PREFIX = 'ide-agent.apiKey.';

interface PanelState {
  provider: ProviderId;
  siliconflowModel: string;
  siliconflowBaseUrl: string;
  anthropicCompatibleModel: string;
  anthropicCompatibleBaseUrl: string;
  enabled: boolean;
  automatic: boolean;
  debug: boolean;
  maxContextLines: number;
  maxAfterLines: number;
  maxCompletionLines: number;
  requestTimeoutMs: number;
  hasSiliconFlowKey: boolean;
  hasAnthropicCompatibleKey: boolean;
}

interface PanelSavePayload {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
  automatic?: boolean;
  debug?: boolean;
  maxContextLines?: number;
  maxAfterLines?: number;
  maxCompletionLines?: number;
  requestTimeoutMs?: number;
}

type PanelMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'save'; payload: PanelSavePayload }
  | { type: 'clearApiKey'; provider?: string }
  | { type: 'triggerCompletion' }
  | { type: 'triggerGraphCompletion' }
  | { type: 'triggerGraphCompletionWithScreenshot' }
  | { type: 'showLogs' };

interface ConfigPanelCallbacks {
  onConfigChanged: () => void;
  onTriggerCompletion: () => Promise<void>;
  onTriggerGraphCompletion: () => Promise<unknown>;
  onTriggerGraphCompletionWithScreenshot: () => Promise<unknown>;
  onShowLogs: () => void;
}

export class ConfigPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ide-agent.configView';

  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly callbacks: ConfigPanelCallbacks
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: PanelMessage) => {
      void this.handleMessage(message);
    });

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });

    void this.postState();
  }

  async refresh(): Promise<void> {
    await this.postState();
  }

  private async handleMessage(message: PanelMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
      case 'refresh':
        await this.postState();
        return;
      case 'save':
        await this.save(message.payload);
        return;
      case 'clearApiKey':
        await this.clearApiKey(toProviderId(message.provider));
        return;
      case 'triggerCompletion':
        await this.callbacks.onTriggerCompletion();
        return;
      case 'triggerGraphCompletion':
        await this.callbacks.onTriggerGraphCompletion();
        return;
      case 'triggerGraphCompletionWithScreenshot':
        await this.callbacks.onTriggerGraphCompletionWithScreenshot();
        return;
      case 'showLogs':
        this.callbacks.onShowLogs();
        return;
    }
  }

  private async save(payload: PanelSavePayload): Promise<void> {
    const provider = toProviderId(payload.provider);
    const config = vscode.workspace.getConfiguration('ide-agent');
    const target = vscode.ConfigurationTarget.Global;
    const model = normalizeString(payload.model);
    const baseUrl = normalizeString(payload.baseUrl);

    await config.update('llm.provider', provider, target);

    if (provider === 'anthropic-compatible') {
      await config.update('llm.anthropicCompatibleModel', model || 'MiniMax-M1', target);
      await config.update('llm.anthropicCompatibleBaseUrl', baseUrl, target);
    } else {
      await config.update('llm.siliconflowModel', model || 'Qwen/Qwen3-Coder-30B-A3B-Instruct', target);
      await config.update('llm.siliconflowBaseUrl', baseUrl, target);
    }

    await config.update('completion.enabled', payload.enabled ?? true, target);
    await config.update('completion.automatic', payload.automatic ?? true, target);
    await config.update('completion.debug', payload.debug ?? true, target);
    await config.update('completion.maxContextLines', clampNumber(payload.maxContextLines, 30, 800, 140), target);
    await config.update('completion.maxAfterLines', clampNumber(payload.maxAfterLines, 0, 300, 30), target);
    await config.update('completion.maxCompletionLines', clampNumber(payload.maxCompletionLines, 1, 120, 16), target);
    await config.update('completion.requestTimeoutMs', clampNumber(payload.requestTimeoutMs, 3000, 120000, 20000), target);

    const apiKey = normalizeString(payload.apiKey);
    if (apiKey) {
      await this.context.secrets.store(secretKey(provider), apiKey);
    }

    this.callbacks.onConfigChanged();
    await this.postStatus('Saved');
    await this.postState();
  }

  private async clearApiKey(provider: ProviderId): Promise<void> {
    await this.context.secrets.delete(secretKey(provider));
    this.callbacks.onConfigChanged();
    await this.postStatus(`Cleared key for ${providerLabel(provider)}`);
    await this.postState();
  }

  private async postState(): Promise<void> {
    if (!this.view) {
      return;
    }

    const state = await this.getState();
    await this.view.webview.postMessage({ type: 'state', state });
  }

  private async postStatus(text: string): Promise<void> {
    if (!this.view) {
      return;
    }

    await this.view.webview.postMessage({ type: 'status', text });
  }

  private async getState(): Promise<PanelState> {
    const config = vscode.workspace.getConfiguration('ide-agent');
    const provider = toProviderId(config.get<string>('llm.provider'));

    return {
      provider,
      siliconflowModel: config.get<string>('llm.siliconflowModel') || 'Qwen/Qwen3-Coder-30B-A3B-Instruct',
      siliconflowBaseUrl: config.get<string>('llm.siliconflowBaseUrl') || '',
      anthropicCompatibleModel: config.get<string>('llm.anthropicCompatibleModel') || 'MiniMax-M1',
      anthropicCompatibleBaseUrl: config.get<string>('llm.anthropicCompatibleBaseUrl') || '',
      enabled: config.get<boolean>('completion.enabled') ?? true,
      automatic: config.get<boolean>('completion.automatic') ?? true,
      debug: config.get<boolean>('completion.debug') ?? true,
      maxContextLines: config.get<number>('completion.maxContextLines') ?? 140,
      maxAfterLines: config.get<number>('completion.maxAfterLines') ?? 30,
      maxCompletionLines: config.get<number>('completion.maxCompletionLines') ?? 16,
      requestTimeoutMs: config.get<number>('completion.requestTimeoutMs') ?? 20000,
      hasSiliconFlowKey: Boolean(await this.context.secrets.get(secretKey('siliconflow'))),
      hasAnthropicCompatibleKey: Boolean(await this.context.secrets.get(secretKey('anthropic-compatible'))),
    };
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    :root {
      color-scheme: dark light;
    }

    body {
      margin: 0;
      padding: 14px;
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 1.45;
    }

    h1 {
      margin: 0 0 14px;
      font-size: 15px;
      font-weight: 600;
    }

    h2 {
      margin: 18px 0 8px;
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0;
    }

    label {
      display: block;
      margin: 10px 0 4px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    input,
    select {
      width: 100%;
      box-sizing: border-box;
      min-height: 28px;
      padding: 4px 7px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 3px;
      outline: none;
    }

    input:focus,
    select:focus {
      border-color: var(--vscode-focusBorder);
    }

    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .switch {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 10px 0 0;
      color: var(--vscode-foreground);
      font-size: 13px;
    }

    .switch input {
      width: auto;
      min-height: auto;
      margin: 0;
    }

    .status {
      min-height: 20px;
      margin-top: 10px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    .key-state {
      display: inline-block;
      margin-left: 6px;
      color: var(--vscode-testing-iconPassed);
    }

    .key-state.missing {
      color: var(--vscode-testing-iconFailed);
    }

    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 14px;
    }

    .actions button.wide {
      grid-column: 1 / -1;
    }

    button {
      min-height: 30px;
      padding: 5px 9px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: 0;
      border-radius: 3px;
      cursor: pointer;
      font: inherit;
    }

    button:hover {
      background: var(--vscode-button-hoverBackground);
    }

    button.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }

    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
  </style>
</head>
<body>
  <h1>Ide Agent</h1>

  <label for="provider">LLM Provider</label>
  <select id="provider">
    <option value="siliconflow">SiliconFlow</option>
    <option value="anthropic-compatible">Anthropic Compatible</option>
  </select>

  <label for="model">Model</label>
  <input id="model" type="text" spellcheck="false">

  <label for="baseUrl">Base URL</label>
  <input id="baseUrl" type="text" spellcheck="false">

  <label for="apiKey">API Key <span id="keyState" class="key-state"></span></label>
  <input id="apiKey" type="password" autocomplete="off" spellcheck="false">

  <h2>Completion</h2>
  <label class="switch"><input id="enabled" type="checkbox"> Enabled</label>
  <label class="switch"><input id="automatic" type="checkbox"> Automatic</label>
  <label class="switch"><input id="debug" type="checkbox"> Debug Logs</label>

  <div class="row">
    <div>
      <label for="maxContextLines">Context Lines</label>
      <input id="maxContextLines" type="number" min="30" max="800">
    </div>
    <div>
      <label for="maxAfterLines">After Lines</label>
      <input id="maxAfterLines" type="number" min="0" max="300">
    </div>
  </div>

  <div class="row">
    <div>
      <label for="maxCompletionLines">Max Lines</label>
      <input id="maxCompletionLines" type="number" min="1" max="120">
    </div>
    <div>
      <label for="requestTimeoutMs">Timeout</label>
      <input id="requestTimeoutMs" type="number" min="3000" max="120000" step="1000">
    </div>
  </div>

  <div class="actions">
    <button id="save">Save</button>
    <button id="clearKey" class="secondary">Clear Key</button>
    <button id="trigger" class="secondary">Trigger</button>
    <button id="graphPredict" class="secondary wide">Graph Predict</button>
    <button id="graphPredictImage" class="secondary wide">Graph Predict + Image</button>
    <button id="logs" class="secondary">Logs</button>
  </div>

  <div id="status" class="status"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const els = {
      provider: document.getElementById('provider'),
      model: document.getElementById('model'),
      baseUrl: document.getElementById('baseUrl'),
      apiKey: document.getElementById('apiKey'),
      keyState: document.getElementById('keyState'),
      enabled: document.getElementById('enabled'),
      automatic: document.getElementById('automatic'),
      debug: document.getElementById('debug'),
      maxContextLines: document.getElementById('maxContextLines'),
      maxAfterLines: document.getElementById('maxAfterLines'),
      maxCompletionLines: document.getElementById('maxCompletionLines'),
      requestTimeoutMs: document.getElementById('requestTimeoutMs'),
      save: document.getElementById('save'),
      clearKey: document.getElementById('clearKey'),
      trigger: document.getElementById('trigger'),
      graphPredict: document.getElementById('graphPredict'),
      graphPredictImage: document.getElementById('graphPredictImage'),
      logs: document.getElementById('logs'),
      status: document.getElementById('status')
    };

    let state;

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'state') {
        state = message.state;
        render();
      }
      if (message.type === 'status') {
        setStatus(message.text);
      }
    });

    els.provider.addEventListener('change', renderProviderFields);
    els.save.addEventListener('click', () => {
      vscode.postMessage({
        type: 'save',
        payload: {
          provider: els.provider.value,
          model: els.model.value,
          baseUrl: els.baseUrl.value,
          apiKey: els.apiKey.value,
          enabled: els.enabled.checked,
          automatic: els.automatic.checked,
          debug: els.debug.checked,
          maxContextLines: numberValue(els.maxContextLines),
          maxAfterLines: numberValue(els.maxAfterLines),
          maxCompletionLines: numberValue(els.maxCompletionLines),
          requestTimeoutMs: numberValue(els.requestTimeoutMs)
        }
      });
      els.apiKey.value = '';
      setStatus('Saving...');
    });
    els.clearKey.addEventListener('click', () => {
      vscode.postMessage({ type: 'clearApiKey', provider: els.provider.value });
      els.apiKey.value = '';
      setStatus('Clearing...');
    });
    els.trigger.addEventListener('click', () => vscode.postMessage({ type: 'triggerCompletion' }));
    els.graphPredict.addEventListener('click', () => {
      vscode.postMessage({ type: 'triggerGraphCompletion' });
      setStatus('Predicting graph...');
    });
    els.graphPredictImage.addEventListener('click', () => {
      vscode.postMessage({ type: 'triggerGraphCompletionWithScreenshot' });
      setStatus('Selecting image...');
    });
    els.logs.addEventListener('click', () => vscode.postMessage({ type: 'showLogs' }));

    vscode.postMessage({ type: 'ready' });

    function render() {
      if (!state) {
        return;
      }

      els.provider.value = state.provider;
      els.enabled.checked = state.enabled;
      els.automatic.checked = state.automatic;
      els.debug.checked = state.debug;
      els.maxContextLines.value = state.maxContextLines;
      els.maxAfterLines.value = state.maxAfterLines;
      els.maxCompletionLines.value = state.maxCompletionLines;
      els.requestTimeoutMs.value = state.requestTimeoutMs;
      renderProviderFields();
    }

    function renderProviderFields() {
      if (!state) {
        return;
      }

      const provider = els.provider.value;
      const hasKey = provider === 'anthropic-compatible'
        ? state.hasAnthropicCompatibleKey
        : state.hasSiliconFlowKey;

      els.model.value = provider === 'anthropic-compatible'
        ? state.anthropicCompatibleModel
        : state.siliconflowModel;
      els.baseUrl.value = provider === 'anthropic-compatible'
        ? state.anthropicCompatibleBaseUrl
        : state.siliconflowBaseUrl;
      els.apiKey.placeholder = hasKey ? 'Saved, leave blank to keep' : 'Not saved';
      els.keyState.textContent = hasKey ? 'Saved' : 'Missing';
      els.keyState.className = hasKey ? 'key-state' : 'key-state missing';
    }

    function numberValue(input) {
      const value = Number(input.value);
      return Number.isFinite(value) ? value : undefined;
    }

    function setStatus(text) {
      els.status.textContent = text;
      if (text) {
        setTimeout(() => {
          if (els.status.textContent === text) {
            els.status.textContent = '';
          }
        }, 2500);
      }
    }
  </script>
</body>
</html>`;
  }
}

function toProviderId(value: string | undefined): ProviderId {
  return value === 'anthropic-compatible' ? 'anthropic-compatible' : 'siliconflow';
}

function providerLabel(provider: ProviderId): string {
  return provider === 'siliconflow' ? 'SiliconFlow' : 'Anthropic Compatible';
}

function secretKey(provider: ProviderId): string {
  return `${SECRET_PREFIX}${provider}`;
}

function normalizeString(value: string | undefined): string {
  return value?.trim() || '';
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';

  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}

import { AnthropicCompatibleAdapter, ANTHROPIC_COMPATIBLE_BASE_URL } from './AnthropicCompatibleAdapter';
import { SiliconFlowAdapter, SILICONFLOW_BASE_URL } from './SiliconFlowAdapter';
import { LLMAdapter, LLMConfig, ProviderId } from './types';

export function createLLMAdapter(config: LLMConfig): LLMAdapter {
  if (!config.apiKey.trim()) {
    throw new Error('API key is required.');
  }

  if (!config.model.trim()) {
    throw new Error('Model name is required.');
  }

  switch (config.provider) {
    case 'siliconflow':
      return new SiliconFlowAdapter(config);
    case 'anthropic-compatible':
      return new AnthropicCompatibleAdapter(config);
    default:
      return assertNever(config.provider);
  }
}

export function getDefaultBaseUrl(provider: ProviderId): string {
  switch (provider) {
    case 'siliconflow':
      return SILICONFLOW_BASE_URL;
    case 'anthropic-compatible':
      return ANTHROPIC_COMPATIBLE_BASE_URL;
    default:
      return assertNever(provider);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported provider: ${String(value)}`);
}

import { BaseLLMAdapter } from './BaseLLMAdapter';
import { LLMConfig, LLMMessage, LLMOptions } from './types';

export const ANTHROPIC_COMPATIBLE_BASE_URL = 'https://api.minimax.io/anthropic';

type AnthropicRole = 'user' | 'assistant';

interface AnthropicMessage {
  role: AnthropicRole;
  content: string;
}

interface AnthropicCompatibleResponse {
  content?: Array<
    | { type: 'text'; text?: string }
    | { type: string; [key: string]: unknown }
  >;
}

export class AnthropicCompatibleAdapter extends BaseLLMAdapter {
  private readonly apiBaseUrl: string;

  constructor(config: LLMConfig) {
    super(config);
    this.apiBaseUrl = normalizeBaseUrl(config.baseUrl || ANTHROPIC_COMPATIBLE_BASE_URL);
  }

  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');

    const chatMessages = messages
      .filter((message) => message.role !== 'system')
      .map((message): AnthropicMessage => ({
        role: message.role as AnthropicRole,
        content: message.content,
      }));

    const data = await this.fetchJson<AnthropicCompatibleResponse>(
      `${this.apiBaseUrl}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.authHeader(),
          'x-api-key': this.apiKey.trim(),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: options?.maxTokens ?? 900,
          system: system || undefined,
          messages: chatMessages,
          temperature: options?.temperature ?? 0.15,
          stop_sequences: options?.stopSequences,
        }),
      },
      options
    );

    return data.content
      ?.filter((block): block is { type: 'text'; text?: string } => block.type === 'text')
      .map((block) => block.text || '')
      .join('\n') ?? '';
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

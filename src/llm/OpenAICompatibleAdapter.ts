import { BaseLLMAdapter } from './BaseLLMAdapter';
import { LLMConfig, LLMMessage, LLMOptions } from './types';

interface OpenAICompatibleResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

export class OpenAICompatibleAdapter extends BaseLLMAdapter {
  private readonly apiBaseUrl: string;

  constructor(config: LLMConfig, defaultBaseUrl: string) {
    super(config);
    this.apiBaseUrl = normalizeBaseUrl(config.baseUrl || defaultBaseUrl);
  }

  async complete(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    const data = await this.fetchJson<OpenAICompatibleResponse>(
      `${this.apiBaseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.authHeader(),
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: options?.temperature ?? 0.15,
          max_tokens: options?.maxTokens ?? 900,
          stop: options?.stopSequences,
        }),
      },
      options
    );

    return data.choices?.[0]?.message?.content ?? '';
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

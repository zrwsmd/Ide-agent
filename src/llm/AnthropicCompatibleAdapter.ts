import { BaseLLMAdapter } from './BaseLLMAdapter';
import { LLMConfig, LLMContentPart, LLMMessage, LLMOptions } from './types';

export const ANTHROPIC_COMPATIBLE_BASE_URL = 'https://api.minimax.io/anthropic';

type AnthropicRole = 'user' | 'assistant';

interface AnthropicMessage {
  role: AnthropicRole;
  content: string | AnthropicContentPart[];
}

type AnthropicContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: {
        type: 'base64';
        media_type: string;
        data: string;
      };
    };

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
      .map((message) => contentToText(message.content))
      .join('\n\n');

    const chatMessages = messages
      .filter((message) => message.role !== 'system')
      .map((message): AnthropicMessage => ({
        role: message.role as AnthropicRole,
        content: toAnthropicContent(message.content),
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

function contentToText(content: LLMMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function toAnthropicContent(content: LLMMessage['content']): string | AnthropicContentPart[] {
  if (typeof content === 'string') {
    return content;
  }

  return content.map((part) => toAnthropicPart(part));
}

function toAnthropicPart(part: LLMContentPart): AnthropicContentPart {
  if (part.type === 'text') {
    return {
      type: 'text',
      text: part.text,
    };
  }

  const parsed = parseDataImageUrl(part.image_url.url);
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: parsed.mediaType,
      data: parsed.base64,
    },
  };
}

function parseDataImageUrl(url: string): { mediaType: string; base64: string } {
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Anthropic-compatible image input requires a data:image/*;base64 URL.');
  }

  return {
    mediaType: match[1],
    base64: match[2],
  };
}

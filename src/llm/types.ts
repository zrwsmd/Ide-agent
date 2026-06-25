export type ProviderId = 'siliconflow' | 'anthropic-compatible';

export type LLMRole = 'system' | 'user' | 'assistant';

export interface LLMTextPart {
  type: 'text';
  text: string;
}

export interface LLMImageUrlPart {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

export type LLMContentPart = LLMTextPart | LLMImageUrlPart;
export type LLMMessageContent = string | LLMContentPart[];

export interface LLMMessage {
  role: LLMRole;
  content: LLMMessageContent;
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LLMConfig {
  provider: ProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface LLMAdapter {
  complete(messages: LLMMessage[], options?: LLMOptions): Promise<string>;
}

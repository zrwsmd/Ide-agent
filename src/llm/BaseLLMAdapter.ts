import { LLMAdapter, LLMConfig, LLMMessage, LLMOptions } from './types';

export abstract class BaseLLMAdapter implements LLMAdapter {
  protected readonly apiKey: string;
  protected readonly model: string;
  protected readonly baseUrl?: string;

  constructor(config: LLMConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = config.baseUrl;
  }

  abstract complete(messages: LLMMessage[], options?: LLMOptions): Promise<string>;

  protected async fetchJson<T>(
    url: string,
    init: RequestInit,
    options?: Pick<LLMOptions, 'timeoutMs' | 'signal'>
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = options?.timeoutMs ?? 20000;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const externalSignal = options?.signal;
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', onExternalAbort);
      }
    }

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (timedOut) {
          throw new Error(`LLM request timed out after ${timeoutMs}ms`);
        }
        const abortError = new Error('LLM request aborted');
        abortError.name = 'AbortError';
        throw abortError;
      }

      throw error;
    } finally {
      clearTimeout(timeout);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  protected authHeader(): string {
    const trimmed = this.apiKey.trim();
    return trimmed.startsWith('Bearer ') ? trimmed : `Bearer ${trimmed}`;
  }
}

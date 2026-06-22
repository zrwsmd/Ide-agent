import { OpenAICompatibleAdapter } from './OpenAICompatibleAdapter';
import { LLMConfig } from './types';

export const SILICONFLOW_BASE_URL = 'https://api.siliconflow.cn/v1';

export class SiliconFlowAdapter extends OpenAICompatibleAdapter {
  constructor(config: LLMConfig) {
    super(config, SILICONFLOW_BASE_URL);
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockModelProvider, OpenAICompatibleModelProvider } from '@wiseflow/mini-agent';
import type { ModelProvider } from '@wiseflow/mini-agent';

export interface ModelProviderSelection {
  provider: ModelProvider;
  modelName: string;
}

/**
 * Builds the active model provider from configuration.
 *
 * `LLM_PROVIDER=mock` (default) keeps the hardcoded provider so the demo
 * runs without an API key. `LLM_PROVIDER=openai` points the SDK at any
 * OpenAI-compatible endpoint (default: DeepSeek).
 */
@Injectable()
export class ModelProviderFactory {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  create(): ModelProviderSelection {
    const kind = this.config.get<string>('LLM_PROVIDER', 'mock');
    if (kind !== 'openai') {
      return { provider: new MockModelProvider(), modelName: 'mock' };
    }

    const apiKey = this.config.get<string>('OPENAI_API_KEY', '');
    const baseURL = this.config.get<string>('OPENAI_BASE_URL', 'https://api.deepseek.com');
    const model = this.config.get<string>('OPENAI_MODEL', 'deepseek-chat');

    return {
      provider: new OpenAICompatibleModelProvider({ apiKey, baseURL, model }),
      modelName: model,
    };
  }
}

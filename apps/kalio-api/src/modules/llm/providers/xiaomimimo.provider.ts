import { BaseOpenAICompatibleProvider } from './base-openai-compatible.provider';
import { buildProviderCompatHeaders } from '../../../common/utils/llm-provider-http.util';

export class XiaomiMiMoProvider extends BaseOpenAICompatibleProvider {
  constructor(apiKey: string, model = 'mimo-v2-omni', baseUrl?: string) {
    super('XiaomiMiMo', apiKey, model, baseUrl ?? 'https://token-plan-ams.xiaomimimo.com/v1');
  }

  protected override buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...buildProviderCompatHeaders('xiaomimimo', this.apiKey),
    };
  }

  protected override buildThinkingParams(): Record<string, unknown> {
    // Enable reasoning tokens for omni (reasoning) models.
    // MiMo-v2-omni requires explicit opt-in to emit reasoning_content.
    if (this.model.includes('omni')) {
      return { thinking: { type: 'enabled' } };
    }
    return {};
  }
}

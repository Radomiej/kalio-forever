import { BaseOpenAICompatibleProvider } from './base-openai-compatible.provider';
import {
  buildProviderCompatHeaders,
  XIAOMI_BASE_URL,
  readEnvBooleanFlag,
} from '../../../common/utils/llm-provider-http.util';

export class XiaomiMiMoProvider extends BaseOpenAICompatibleProvider {
  constructor(apiKey: string, model = 'mimo-v2.5-pro', baseUrl?: string) {
    super('XiaomiMiMo', apiKey, model, baseUrl ?? XIAOMI_BASE_URL);
  }

  protected override buildHeaders(): Record<string, string> {
    const allowCrossBorderAccess = readEnvBooleanFlag(
      process.env.XIAOMI_MIFE_ALLOW_CROSS_BORDER_ACCESS,
      true,
    );

    return {
      'Content-Type': 'application/json',
      ...buildProviderCompatHeaders('xiaomimimo', this.apiKey),
      ...(allowCrossBorderAccess
        ? { 'X-MiFE-Allow-Cross-Border-Access': 'true' }
        : {}),
    };
  }

  protected override buildThinkingParams(): Record<string, unknown> {
    // Xiaomi reasoning models require explicit opt-in to emit reasoning_content.
    if (this.model.includes('omni') || this.model.includes('v2.5-pro')) {
      return { thinking: { type: 'enabled' } };
    }
    return {};
  }

  protected override supportsReasoningContentHistory(): boolean {
    return true;
  }
}

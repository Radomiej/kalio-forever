import { BaseOpenAICompatibleProvider } from './base-openai-compatible.provider';

const XIAOMI_COMPAT_HEADERS: Record<string, string> = {
  'HTTP-Referer': 'https://github.com/RooVetGit/Roo-Cline',
  'X-Title': 'Roo Code',
  'User-Agent': 'RooCode/3.17.0',
};

export class XiaomiMiMoProvider extends BaseOpenAICompatibleProvider {
  constructor(apiKey: string, model = 'mimo-v2-omni', baseUrl?: string) {
    super('XiaomiMiMo', apiKey, model, baseUrl ?? 'https://token-plan-ams.xiaomimimo.com/v1');
  }

  protected override buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      ...XIAOMI_COMPAT_HEADERS,
    };
  }
}

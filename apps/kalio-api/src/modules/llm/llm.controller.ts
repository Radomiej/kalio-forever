import { Body, Controller, Get, HttpException, HttpStatus, Put, Query } from '@nestjs/common';
import { LLMService } from './llm.service';
import { CredentialsService } from '../credentials/credentials.service';
import { TimeoutSettingsService } from '../credentials/timeout-settings.service';
import type { LLMConfig } from '@kalio/types';
import { isLocalLlmProvider } from '../../common/utils/local-llm-provider.util';
import {
  buildProviderCompatHeaders,
  resolveLlmProviderBaseUrl,
} from '../../common/utils/llm-provider-http.util';

export interface LLMConfigResponse extends LLMConfig {
  contextWindowSize: number;
  maxToolAttempts: number;
  /** Whether the active LLM config comes from a DB credential or .env fallback */
  source: 'db' | 'env';
}

@Controller('llm')
export class LLMController {
  constructor(
    private readonly llm: LLMService,
    private readonly credentials: CredentialsService,
    private readonly timeoutSettings: TimeoutSettingsService,
  ) {}

  @Get('config')
  async getConfig(): Promise<LLMConfigResponse> {
    const [config, contextWindowSize, maxToolAttempts] = await Promise.all([
      this.llm.getConfig(),
      this.credentials.getContextWindowSize(),
      this.credentials.getMaxToolAttempts(),
    ]);
    return { ...config, contextWindowSize, maxToolAttempts };
  }

  @Get('active/models')
  async getActiveModels(): Promise<{ models: string[] }> {
    const models = await this.llm.getActiveModels();
    return { models };
  }

  @Put('active/model')
  async updateActiveModel(@Body() body: { model?: unknown }): Promise<LLMConfigResponse> {
    if (typeof body?.model !== 'string' || body.model.trim().length === 0) {
      throw new HttpException('Missing required body field: model', HttpStatus.BAD_REQUEST);
    }

    const normalizedModel = body.model.trim();

    const [config, contextWindowSize, maxToolAttempts] = await Promise.all([
      this.llm.updateActiveModel(normalizedModel),
      this.credentials.getContextWindowSize(),
      this.credentials.getMaxToolAttempts(),
    ]);

    return { ...config, contextWindowSize, maxToolAttempts };
  }

  @Get('models')
  async getModels(
    @Query('provider') provider: string,
    @Query('apiKey') apiKey?: string,
    @Query('baseUrl') baseUrl?: string,
  ): Promise<unknown> {
    if (!provider) {
      throw new HttpException('Missing required query param: provider', HttpStatus.BAD_REQUEST);
    }

    const resolvedBase = resolveLlmProviderBaseUrl(provider, baseUrl);
    const isLocal = isLocalLlmProvider(provider, resolvedBase);
    const allowsKeyless = isLocal;

    if (!apiKey && !allowsKeyless) {
      throw new HttpException(
        `Missing apiKey for ${provider}. Provide query apiKey or use a local endpoint.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const endpoint = `${resolvedBase}/models`;
    const timeoutMs = await this.timeoutSettings.getProviderTimeoutMs(isLocal);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const authHeaders = buildProviderCompatHeaders(provider, !allowsKeyless ? apiKey : undefined);

      const upstream = await fetch(endpoint, { headers: authHeaders, signal: controller.signal });

      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        let errorMessage = `Provider error: ${upstream.status}`;
        try {
          const parsed = JSON.parse(text) as { error?: { message?: string } };
          if (parsed?.error?.message) errorMessage = parsed.error.message;
        } catch { /* not JSON */ }
        throw new HttpException({ error: errorMessage, detail: text.slice(0, 500) }, upstream.status);
      }

      return upstream.json();
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const hint = isLocal
        ? `Local provider unreachable at ${resolvedBase}. Is it running?`
        : `Provider fetch failed: ${msg}`;
      throw new HttpException(
        { error: hint, detail: isAbort ? `Request timed out after ${timeoutMs}ms` : msg, localProviderOffline: isLocal },
        HttpStatus.BAD_GATEWAY,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

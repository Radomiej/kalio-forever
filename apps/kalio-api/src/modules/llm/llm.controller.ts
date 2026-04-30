import { Controller, Get, Query, HttpException, HttpStatus } from '@nestjs/common';
import { LLMService } from './llm.service';
import { CredentialsService } from '../credentials/credentials.service';
import type { LLMConfig } from '@kalio/types';

export interface LLMConfigResponse extends LLMConfig {
  contextWindowSize: number;
  /** Whether the active LLM config comes from a DB credential or .env fallback */
  source: 'db' | 'env';
}

const PROVIDER_BASE_URLS: Record<string, string> = {
  openai:     'https://api.openai.com/v1',
  xiaomimimo: 'https://token-plan-ams.xiaomimimo.com/v1',
  deepseek:   'https://api.deepseek.com/v1',
  cometapi:   'https://api.cometapi.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama:     'http://localhost:11434/v1',
  bitnet:     'http://localhost:8080/v1',
};

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', 'host.docker.internal']);

function isLocalBaseUrl(baseUrl?: string): boolean {
  if (!baseUrl || baseUrl.trim().length === 0) return false;
  const raw = baseUrl.trim();
  const normalized = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const { hostname } = new URL(normalized);
    return LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.local');
  } catch {
    return false;
  }
}

function resolveBaseUrl(provider: string, baseUrl?: string): string {
  if (baseUrl) return baseUrl.replace(/\/$/, '');
  return PROVIDER_BASE_URLS[provider] ?? 'https://api.openai.com/v1';
}

@Controller('llm')
export class LLMController {
  constructor(
    private readonly llm: LLMService,
    private readonly credentials: CredentialsService,
  ) {}

  @Get('config')
  async getConfig(): Promise<LLMConfigResponse> {
    const [config, contextWindowSize] = await Promise.all([
      this.llm.getConfig(),
      this.credentials.getContextWindowSize(),
    ]);
    return { ...config, contextWindowSize };
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

    const resolvedBase = resolveBaseUrl(provider, baseUrl);
    const isLocal = provider === 'ollama' || provider === 'bitnet' || (provider === 'custom' && isLocalBaseUrl(resolvedBase));
    const allowsKeyless = isLocal;

    if (!apiKey && !allowsKeyless) {
      throw new HttpException(
        `Missing apiKey for ${provider}. Provide query apiKey or use a local endpoint.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const endpoint = `${resolvedBase}/models`;
    const timeoutMs = isLocal ? 3_000 : 15_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const authHeaders: Record<string, string> =
        !allowsKeyless && apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

      if (provider === 'xiaomimimo') {
        authHeaders['HTTP-Referer'] = 'https://github.com/RooVetGit/Roo-Cline';
        authHeaders['X-Title'] = 'Roo Code';
        authHeaders['User-Agent'] = 'RooCode/3.17.0';
      }

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

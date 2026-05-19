import { Controller, Get, Post, Put, Patch, Delete, Param, Body, HttpCode, HttpStatus, Logger, BadRequestException } from '@nestjs/common';
import type { Credential, CreateCredentialDto, ToolTimeoutSettings } from '@kalio/types';
import { CredentialsService } from './credentials.service';
import { createLLMProvider } from '../llm/providers/provider-factory';
import { TimeoutSettingsService } from './timeout-settings.service';
import { isLocalLlmProvider } from '../../common/utils/local-llm-provider.util';

@Controller('credentials')
export class CredentialsController {
  private readonly logger = new Logger(CredentialsController.name);

  constructor(
    private readonly credentialsService: CredentialsService,
    private readonly timeoutSettings: TimeoutSettingsService,
  ) {}

  @Get()
  findAll(): Promise<Credential[]> {
    return this.credentialsService.findAll();
  }

  @Post()
  create(@Body() dto: CreateCredentialDto): Promise<Credential> {
    return this.credentialsService.create(dto);
  }

  // ─── Active credential ────────────────────────────────────────────────────────

  @Get('active')
  async getActive(): Promise<{ credentialId: string | null }> {
    const credentialId = await this.credentialsService.getActiveCredentialId();
    return { credentialId };
  }

  @Put('active/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setActive(@Param('id') id: string): Promise<void> {
    await this.credentialsService.setActiveCredential(id);
    this.logger.log(`Active LLM credential set via API: ${id}`);
  }

  @Delete('active')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearActive(): Promise<void> {
    await this.credentialsService.clearActiveCredential();
    this.logger.log('Active LLM credential cleared via API');
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    return this.credentialsService.remove(id);
  }

  // ─── Context window size ──────────────────────────────────────────────────────

  @Get('settings/context-window')
  async getContextWindow(): Promise<{ size: number }> {
    const size = await this.credentialsService.getContextWindowSize();
    return { size };
  }

  @Put('settings/context-window')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setContextWindow(@Body() body: { size: number }): Promise<void> {
    await this.credentialsService.setContextWindowSize(body.size);
    this.logger.log(`Context window size updated via API: ${body.size}`);
  }

  @Get('settings/max-tool-attempts')
  async getMaxToolAttempts(): Promise<{ size: number }> {
    const size = await this.credentialsService.getMaxToolAttempts();
    return { size };
  }

  @Put('settings/max-tool-attempts')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setMaxToolAttempts(@Body() body: { size: number }): Promise<void> {
    await this.credentialsService.setMaxToolAttempts(body.size);
    this.logger.log(`Max tool attempts updated via API: ${body.size}`);
  }

  @Get('settings/tool-timeouts')
  async getToolTimeouts(): Promise<ToolTimeoutSettings> {
    return this.timeoutSettings.getTimeoutSettings();
  }

  @Put('settings/tool-timeouts')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setToolTimeouts(@Body() body: Partial<ToolTimeoutSettings>): Promise<void> {
    if (
      body.webSearchTimeoutMs === undefined &&
      body.providerLocalTimeoutMs === undefined &&
      body.providerRemoteTimeoutMs === undefined
    ) {
      throw new BadRequestException('At least one tool timeout setting must be provided');
    }

    await this.timeoutSettings.setTimeoutSettings(body);
    this.logger.log(
      `Tool timeout settings updated via API: web_search=${body.webSearchTimeoutMs ?? '—'} local=${body.providerLocalTimeoutMs ?? '—'} remote=${body.providerRemoteTimeoutMs ?? '—'}`,
    );
  }

  // ─── Generation settings ─────────────────────────────────────────────────────

  @Get('settings/generation')
  async getGenerationSettings(): Promise<{ temperature: number; maxTokens: number }> {
    return this.credentialsService.getGenerationSettings();
  }

  @Put('settings/generation')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setGenerationSettings(@Body() body: { temperature?: number; maxTokens?: number }): Promise<void> {
    await this.credentialsService.setGenerationSettings(body);
    this.logger.log(`Generation settings updated via API: temperature=${body.temperature ?? '—'} maxTokens=${body.maxTokens ?? '—'}`);
  }

  // ─── Model listing for credential (placed after settings/ routes) ─────────────

  @Get(':id/models')
  async getModels(@Param('id') id: string): Promise<{ models: string[] }> {
    const models = await this.credentialsService.getModelsForCredential(id);
    return { models };
  }

  @Patch(':id/model')
  async updateModel(
    @Param('id') id: string,
    @Body() body: { model: string },
  ): Promise<import('@kalio/types').Credential> {
    return this.credentialsService.updateModel(id, body.model);
  }

  // ─── Test by credential ID (key looked up server-side) ──────────────────────

  @Post(':id/test')
  async testById(
    @Param('id') id: string,
  ): Promise<{ ok: boolean; latencyMs: number; modelCount?: number; error?: string }> {
    const start = Date.now();
    try {
      const all = await this.credentialsService.findAll();
      const cred = all.find((c) => c.id === id);
      if (!cred) {
        return { ok: false, latencyMs: Date.now() - start, error: 'Credential not found' };
      }

      const isLocal = isLocalLlmProvider(cred.provider, cred.baseUrl ?? undefined);

      const apiKey = await this.credentialsService.getApiKey(id);
      if (!apiKey && !isLocal) {
        return { ok: false, latencyMs: Date.now() - start, error: 'API key not available' };
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

      const resolvedBase = (cred.baseUrl ?? PROVIDER_BASE_URLS[cred.provider] ?? '').replace(/\/$/, '');
      const endpoint = `${resolvedBase}/models`;
      const timeoutMs = await this.timeoutSettings.getProviderTimeoutMs(isLocal);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const authHeaders: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
        if (cred.provider === 'xiaomimimo') {
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
          return { ok: false, latencyMs: Date.now() - start, error: errorMessage };
        }

        const json = await upstream.json() as { data?: unknown[]; models?: unknown[] };
        const modelCount = (json.data ?? json.models ?? []).length;
        return { ok: true, latencyMs: Date.now() - start, modelCount };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ─── Connection test (direct — key provided in body) ─────────────────────────

  @Post('test')
  async testConnection(
    @Body() body: { provider: string; apiKey: string; model: string; baseUrl?: string },
  ): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const llm = createLLMProvider({
        provider: body.provider,
        apiKey: body.apiKey,
        model: body.model,
        baseUrl: body.baseUrl,
      });
      await llm.streamChat(
        [{ role: 'user', content: 'ping' }],
        [],
        { sessionId: 'test-session', messageId: 'test-msg', onChunk: () => { /* drain chunks */ } },
      );
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

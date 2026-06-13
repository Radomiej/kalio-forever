import { Controller, Get, Post, Put, Patch, Delete, Param, Body, HttpCode, HttpStatus, Logger, BadRequestException } from '@nestjs/common';
import type { Credential, CreateCredentialDto, ToolTimeoutSettings } from '@kalio/types';
import { CredentialsService } from './credentials.service';
import { LLMService } from '../llm/llm.service';
import type { LLMToolDef } from '../llm/llm.types';
import { TimeoutSettingsService } from './timeout-settings.service';
import { isLocalLlmProvider } from '../../common/utils/local-llm-provider.util';
import { buildProviderCompatHeaders, isBuiltInLlmProvider, resolveLlmProviderBaseUrl } from '../../common/utils/llm-provider-http.util';

function requiresExplicitBaseUrl(provider: string): boolean {
  const normalized = provider.trim().toLowerCase();
  if (normalized === 'mock') {
    return false;
  }
  return !isBuiltInLlmProvider(provider);
}

@Controller('credentials')
export class CredentialsController {
  private readonly logger = new Logger(CredentialsController.name);

  constructor(
    private readonly credentialsService: CredentialsService,
    private readonly timeoutSettings: TimeoutSettingsService,
    private readonly llm: LLMService,
  ) {}

  private runtimeSmokeMessages(): Array<{ role: 'system' | 'user'; content: string }> {
    return [
      {
        role: 'system',
        content: [
          'You are the Kalio LLM runtime smoke-test role.',
          'Verify that the active provider, model, streaming, reasoning, and tool schema transport are usable.',
          'Do not execute tools. Return one compact JSON object with status, providerPath, modelObserved, and notes.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          'Run a bounded Kalio runtime readiness smoke.',
          'Confirm only that this request can stream a short response with the supplied tool schema available.',
          'Return JSON only. Do not call any tool and do not perform project work.',
        ].join(' '),
      },
    ];
  }

  private runtimeSmokeTools(): LLMToolDef[] {
    return [
      {
        name: 'runtime_smoke_tool',
        description: 'No-op tool schema used only to verify provider tool-schema transport during readiness smoke.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            note: { type: 'string' },
          },
          required: ['status'],
        },
      },
    ];
  }

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

  @Get('settings/conversation-title')
  async getConversationTitleSettings(): Promise<import('@kalio/types').ConversationTitleSettings> {
    return this.credentialsService.getConversationTitleSettings();
  }

  @Put('settings/conversation-title')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setConversationTitleSettings(
    @Body() body: Partial<import('@kalio/types').ConversationTitleSettings>,
  ): Promise<void> {
    await this.credentialsService.setConversationTitleSettings(body);
    this.logger.log(
      `Conversation title settings updated via API: autoRename=${body.autoRenameEnabled ?? '—'} cadence=${body.renameEveryReplies ?? '—'}`,
    );
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
      body.providerRemoteTimeoutMs === undefined &&
      body.providerMaxConcurrentStreams === undefined
    ) {
      throw new BadRequestException('At least one tool timeout setting must be provided');
    }

    await this.timeoutSettings.setTimeoutSettings(body);
    this.logger.log(
      `Tool timeout settings updated via API: web_search=${body.webSearchTimeoutMs ?? '—'} local=${body.providerLocalTimeoutMs ?? '—'} remote=${body.providerRemoteTimeoutMs ?? '—'} max_streams=${body.providerMaxConcurrentStreams ?? '—'}`,
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

      const explicitBaseUrl = cred.baseUrl?.trim();
      if (requiresExplicitBaseUrl(cred.provider) && !explicitBaseUrl) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: 'baseUrl is required for custom or unrecognized providers',
        };
      }

      const providerConfig = {
        provider: cred.provider,
        apiKey: apiKey || '',
        model: cred.model ?? '',
        ...(explicitBaseUrl ? { baseUrl: explicitBaseUrl } : {}),
      };
      const resolvedBase = resolveLlmProviderBaseUrl(providerConfig.provider, providerConfig.baseUrl);
      const endpoint = `${resolvedBase}/models`;
      const timeoutMs = await this.timeoutSettings.getProviderTimeoutMs(isLocal);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const authHeaders = buildProviderCompatHeaders(providerConfig.provider, apiKey || undefined);

        const upstream = await fetch(endpoint, { headers: authHeaders, signal: controller.signal });
        if (!upstream.ok) {
          const text = await upstream.text().catch(() => '');
          let errorMessage = `Provider error: ${upstream.status}`;
          try {
            const parsed = JSON.parse(text) as { error?: { message?: string } };
            if (parsed?.error?.message) errorMessage = parsed.error.message;
          } catch (err) {
            this.logger.debug(`Provider error body was not JSON: ${err instanceof Error ? err.message : String(err)}`);
          }
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
    const explicitBaseUrl = body.baseUrl?.trim();
    if (requiresExplicitBaseUrl(body.provider) && !explicitBaseUrl) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: 'baseUrl is required for custom or unrecognized providers',
      };
    }
    try {
      await this.llm.streamChatWithConfig(
        {
          provider: body.provider,
          apiKey: body.apiKey,
          model: body.model,
          ...(body.baseUrl ? { baseUrl: body.baseUrl } : {}),
        },
        [{ role: 'user', content: 'ping' }],
        [],
        { sessionId: 'test-session', messageId: 'test-msg', onChunk: () => { /* drain chunks */ } },
      );
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
    }
  }

  @Post(':id/test-completion')
  async testCompletionById(
    @Param('id') id: string,
    @Body() body?: { model?: string },
  ): Promise<{
    ok: boolean;
    latencyMs: number;
    mode: 'runtime_smoke';
    provider: string;
    model: string;
    source: 'db';
    error?: string;
  }> {
    const start = Date.now();
    let smokeProvider = 'unknown';
    let smokeModel = 'unknown';
    try {
      const all = await this.credentialsService.findAll();
      const cred = all.find((c) => c.id === id);
      if (!cred) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          mode: 'runtime_smoke',
          provider: '',
          model: '',
          source: 'db',
          error: 'Credential not found',
        };
      }
      smokeProvider = cred.provider;
      const requestedModel = typeof body?.model === 'string' ? body.model.trim() : '';
      smokeModel = requestedModel || cred.model || '';

      const isLocal = isLocalLlmProvider(cred.provider, cred.baseUrl ?? undefined);
      const apiKey = await this.credentialsService.getApiKey(id);
      if (!apiKey && !isLocal) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          mode: 'runtime_smoke',
          provider: cred.provider,
          model: cred.model ?? '',
          source: 'db',
          error: 'API key not available',
        };
      }
      if (!smokeModel) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          mode: 'runtime_smoke',
          provider: cred.provider,
          model: smokeModel,
          source: 'db',
          error: 'Credential model is not set',
        };
      }

      const providerConfig = {
        provider: cred.provider,
        apiKey: apiKey ?? '',
        model: smokeModel,
        ...(cred.baseUrl ? { baseUrl: cred.baseUrl } : {}),
      };
      await this.llm.streamChatWithConfig(
        providerConfig,
        this.runtimeSmokeMessages(),
        this.runtimeSmokeTools(),
        { sessionId: 'credential-completion-test-session', messageId: 'credential-completion-test-msg', onChunk: () => { /* drain chunks */ } },
      );
      return {
        ok: true,
        latencyMs: Date.now() - start,
        mode: 'runtime_smoke',
        provider: cred.provider,
        model: smokeModel,
        source: 'db',
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        mode: 'runtime_smoke',
        provider: smokeProvider,
        model: smokeModel,
        source: 'db',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

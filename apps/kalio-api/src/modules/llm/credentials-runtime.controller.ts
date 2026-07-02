import { Body, Controller, Param, Post } from '@nestjs/common';
import { CredentialsService } from '../credentials/credentials.service';
import { isLocalLlmProvider } from '../../common/utils/local-llm-provider.util';
import { requiresExplicitLlmProviderBaseUrl } from '../../common/utils/llm-provider-http.util';
import { LLMService, type LLMToolDef } from './llm.service';

@Controller('credentials')
export class CredentialsRuntimeController {
  constructor(
    private readonly credentialsService: CredentialsService,
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

  @Post('test')
  async testConnection(
    @Body() body: { provider: string; apiKey: string; model: string; baseUrl?: string },
  ): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    const explicitBaseUrl = body.baseUrl?.trim();
    if (requiresExplicitLlmProviderBaseUrl(body.provider) && !explicitBaseUrl) {
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

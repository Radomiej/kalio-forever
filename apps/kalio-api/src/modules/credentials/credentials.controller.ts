import { Controller, Get, Post, Put, Delete, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import type { Credential, CreateCredentialDto } from '@kalio/types';
import { CredentialsService } from './credentials.service';
import { createLLMProvider } from '../llm/providers/provider-factory';

@Controller('credentials')
export class CredentialsController {
  constructor(private readonly credentialsService: CredentialsService) {}

  @Get()
  findAll(): Promise<Credential[]> {
    return this.credentialsService.findAll();
  }

  @Post()
  create(@Body() dto: CreateCredentialDto): Promise<Credential> {
    return this.credentialsService.create(dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    return this.credentialsService.remove(id);
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
    return this.credentialsService.setActiveCredential(id);
  }

  @Delete('active')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearActive(): Promise<void> {
    return this.credentialsService.clearActiveCredential();
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

      const apiKey = await this.credentialsService.getApiKey(id);
      if (!apiKey) {
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

      const isLocal = ['ollama', 'bitnet'].includes(cred.provider);
      const resolvedBase = (cred.baseUrl ?? PROVIDER_BASE_URLS[cred.provider] ?? '').replace(/\/$/, '');
      const endpoint = `${resolvedBase}/models`;
      const timeoutMs = isLocal ? 3_000 : 15_000;
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
        () => { /* drain chunks */ },
        'test-session',
        'test-msg',
      );
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

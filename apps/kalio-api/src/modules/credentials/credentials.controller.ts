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

  // ─── Connection test ──────────────────────────────────────────────────────────

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

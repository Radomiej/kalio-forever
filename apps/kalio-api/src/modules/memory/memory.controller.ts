import {
  Controller,
  Get,
  Post,
  Delete,
  Put,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import type { MemoryIngestResult, MemorySearchResult, MemorySearchMode, EmbeddingStatus } from '@kalio/types';
import { MemoryService } from './memory.service';
import { CredentialsService } from '../credentials/credentials.service';
import type { IngestDto, IngestConversationDto, SearchDto } from './dto';

interface EmbeddingConfigDto {
  baseUrl: string;
  apiKey?: string;
  model: string;
  dimensions: number;
}

interface EmbeddingFromCredentialDto {
  credentialId: string;
  model: string;
  dimensions: number;
}

@Controller('memory')
export class MemoryController {
  constructor(
    private readonly memoryService: MemoryService,
    private readonly credentialsService: CredentialsService,
  ) {}

  @Post('ingest')
  async ingest(@Body() dto: IngestDto): Promise<MemoryIngestResult> {
    return this.memoryService.ingest(dto.text, dto.personaId, dto.metadata);
  }

  @Post('ingest-conversation')
  async ingestConversation(@Body() dto: IngestConversationDto): Promise<MemoryIngestResult> {
    return this.memoryService.ingestConversation(dto.messages, dto.personaId);
  }

  @Get('search')
  async search(
    @Query('query') query: string,
    @Query('personaId') personaId: string,
    @Query('limit') limit?: string,
    @Query('mode') mode?: MemorySearchMode
  ): Promise<MemorySearchResult[]> {
    const parsedLimit = limit ? parseInt(limit, 10) : 5;

    switch (mode) {
      case 'vector':
        return this.memoryService.search(query, personaId, parsedLimit);
      case 'fts':
        return this.memoryService.searchFTS(query, personaId, parsedLimit);
      case 'hybrid':
      default:
        return this.memoryService.hybridSearch(query, personaId, parsedLimit);
    }
  }

  @Get(':personaId')
  async getAll(@Param('personaId') personaId: string): Promise<MemorySearchResult[]> {
    return this.memoryService.getAll(personaId);
  }

  @Delete(':personaId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAll(@Param('personaId') personaId: string): Promise<void> {
    this.memoryService.deleteAll(personaId);
  }

  @Delete(':personaId/:id')
  async delete(
    @Param('personaId') personaId: string,
    @Param('id') id: string
  ): Promise<{ deleted: boolean }> {
    const deleted = this.memoryService.delete(id, personaId);
    return { deleted };
  }

  @Get('status/embedding')
  getEmbeddingStatus(): EmbeddingStatus {
    return this.memoryService.getEmbeddingService().getStatus();
  }

  @Put('config/embedding')
  async setEmbeddingConfig(@Body() dto: EmbeddingConfigDto): Promise<EmbeddingStatus> {
    await this.memoryService.getEmbeddingService().reconfigure({
      baseUrl: dto.baseUrl,
      apiKey: dto.apiKey ?? null,
      model: dto.model,
      dimensions: dto.dimensions,
    });
    return this.memoryService.getEmbeddingService().getStatus();
  }

  @Put('config/embedding/from-credential')
  async setEmbeddingFromCredential(@Body() dto: EmbeddingFromCredentialDto): Promise<EmbeddingStatus> {
    const cred = (await this.credentialsService.findAll()).find((c) => c.id === dto.credentialId);
    if (!cred) throw new NotFoundException(`Credential ${dto.credentialId} not found`);

    const apiKey = await this.credentialsService.getApiKey(dto.credentialId);
    if (!apiKey) throw new NotFoundException(`No API key found for credential ${dto.credentialId}`);

    const PROVIDER_BASE_URLS: Record<string, string> = {
      openai:     'https://api.openai.com/v1',
      xiaomimimo: 'https://token-plan-ams.xiaomimimo.com/v1',
      deepseek:   'https://api.deepseek.com/v1',
      cometapi:   'https://api.cometapi.com/v1',
      openrouter: 'https://openrouter.ai/api/v1',
      ollama:     'http://localhost:11434/v1',
    };
    const baseUrl = cred.baseUrl ?? PROVIDER_BASE_URLS[cred.provider] ?? '';

    await this.memoryService.getEmbeddingService().reconfigureFromCredential({
      credentialId: cred.id,
      credentialName: cred.name,
      apiKey,
      baseUrl,
      model: dto.model,
      dimensions: dto.dimensions,
    });
    return this.memoryService.getEmbeddingService().getStatus();
  }

  @Post('test/embedding')
  @HttpCode(HttpStatus.OK)
  async testEmbedding(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.memoryService.getEmbeddingService().embedOne('test');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

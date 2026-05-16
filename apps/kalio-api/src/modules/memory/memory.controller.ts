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
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  MemoryIngestResult,
  MemorySearchResult,
  MemorySearchMode,
  EmbeddingStatus,
  EmbeddingCredential,
  CreateEmbeddingCredentialDto,
} from '@kalio/types';
import { MemoryService } from './memory.service';
import { EmbeddingCredentialsService } from './embedding-credentials.service';
import {
  OpenAICompatibleEmbeddingProvider,
  OllamaEmbeddingProvider,
} from './embedding.service';
import type { IngestDto, IngestConversationDto } from './dto';

@Controller('memory')
export class MemoryController {
  private readonly logger = new Logger(MemoryController.name);

  constructor(
    private readonly memoryService: MemoryService,
    private readonly embeddingCredentials: EmbeddingCredentialsService,
  ) {}

  // ── Memory CRUD ─────────────────────────────────────────────────────────

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

  // ── Embedding status ─────────────────────────────────────────────────────

  @Get('status/embedding')
  async getEmbeddingStatus(): Promise<EmbeddingStatus> {
    return this.memoryService.getEmbeddingService().getStatus();
  }

  // ── Embedding credentials CRUD ───────────────────────────────────────────
  // NOTE: all embedding-credentials routes must be declared BEFORE :personaId
  // to prevent NestJS from routing literal paths to the parameterized handler.

  @Get('embedding-credentials')
  async listEmbeddingCredentials(): Promise<EmbeddingCredential[]> {
    return this.embeddingCredentials.findAll();
  }

  @Post('embedding-credentials')
  async createEmbeddingCredential(
    @Body() dto: CreateEmbeddingCredentialDto
  ): Promise<EmbeddingCredential> {
    this.logger.log(`Creating embedding credential "${dto.name}" (${dto.provider})`);
    const created = await this.embeddingCredentials.create(dto);
    return created;
  }

  @Delete('embedding-credentials/active')
  async clearActiveEmbeddingCredential(): Promise<EmbeddingStatus> {
    this.logger.log('Active embedding credential cleared');
    await this.embeddingCredentials.clearActive();
    await this.memoryService.getEmbeddingService().reloadFromCredential();
    return this.memoryService.getEmbeddingService().getStatus();
  }

  // NOTE: this must be BEFORE @Delete('embedding-credentials/:id') to avoid
  // NestJS treating 'active' as a credentialId.
  @Put('embedding-credentials/active/:id')
  async setActiveEmbeddingCredential(@Param('id') id: string): Promise<EmbeddingStatus> {
    this.logger.log(`Setting active embedding credential: ${id}`);
    await this.embeddingCredentials.setActive(id);
    await this.memoryService.getEmbeddingService().reloadFromCredential();
    return this.memoryService.getEmbeddingService().getStatus();
  }

  @Delete('embedding-credentials/:id')
  async removeEmbeddingCredential(@Param('id') id: string): Promise<EmbeddingStatus> {
    this.logger.log(`Removing embedding credential: ${id}`);
    await this.embeddingCredentials.remove(id);
    await this.memoryService.getEmbeddingService().reloadFromCredential();
    return this.memoryService.getEmbeddingService().getStatus();
  }

  /**
   * Probe a credential without saving it.
   * Accepts a full credential payload (including apiKey) and runs a live
   * connectivity test.  No row is written to the database.
   * Route must be declared BEFORE @Post('embedding-credentials/:id/test')
   * so 'probe' is not mistaken for an id segment.
   */
  @Post('embedding-credentials/probe')
  @HttpCode(HttpStatus.OK)
  async probeEmbeddingCredential(
    @Body() dto: CreateEmbeddingCredentialDto
  ): Promise<{ ok: boolean; error?: string }> {
    const isOllama = dto.baseUrl.includes('localhost:11434') || dto.baseUrl.toLowerCase().includes('ollama');
    try {
      if (isOllama) {
        const p = new OllamaEmbeddingProvider(dto.baseUrl, dto.model, dto.dimensions);
        await p.embed(['test']);
      } else {
        const p = new OpenAICompatibleEmbeddingProvider({
          apiKey: dto.apiKey,
          baseUrl: dto.baseUrl,
          model: dto.model,
          dimensions: dto.dimensions,
        });
        await p.embed(['test']);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  @Post('embedding-credentials/:id/test')
  @HttpCode(HttpStatus.OK)
  async testEmbeddingCredential(
    @Param('id') id: string
  ): Promise<{ ok: boolean; error?: string }> {
    const cred = await this.embeddingCredentials.getConfigById(id);
    if (!cred) throw new NotFoundException(`Embedding credential ${id} not found`);
    const isOllama = cred.baseUrl.includes('localhost:11434') || cred.baseUrl.toLowerCase().includes('ollama');
    try {
      if (isOllama) {
        const p = new OllamaEmbeddingProvider(cred.baseUrl, cred.model, cred.dimensions);
        await p.embed(['test']);
      } else {
        const p = new OpenAICompatibleEmbeddingProvider({
          apiKey: cred.apiKey,
          baseUrl: cred.baseUrl,
          model: cred.model,
          dimensions: cred.dimensions,
        });
        await p.embed(['test']);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── Memory CRUD (parameterized — must be LAST to avoid capturing literal routes) ─

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
}

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
} from '@nestjs/common';
import type { MemoryIngestResult, MemorySearchResult, MemorySearchMode, EmbeddingStatus } from '@kalio/types';
import { MemoryService } from './memory.service';
import type { IngestDto, IngestConversationDto, SearchDto } from './dto';

interface EmbeddingConfigDto {
  baseUrl: string;
  apiKey?: string;
  model: string;
  dimensions: number;
}

@Controller('memory')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

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

import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { MemoryIngestResult, MemorySearchResult, MemorySearchMode } from '@kalio/types';
import { MemoryService } from './memory.service';
import type { IngestDto, IngestConversationDto, SearchDto } from './dto';

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
  getEmbeddingStatus() {
    return this.memoryService.getEmbeddingService().getStatus();
  }
}

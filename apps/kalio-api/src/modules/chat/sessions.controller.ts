import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type {
  ChatMessage,
  ChatRunSnapshot,
  ChatSession,
  ContextPreviewRequest,
  CreateSessionDto,
  LLMContextPreview,
  SessionRuntimeContext,
} from '@kalio/types';

type SessionContextPreviewBody = Omit<Extract<ContextPreviewRequest, { sessionId: string }>, 'sessionId'>;
import { SessionsService } from './sessions.service';
import { RunJournalService } from './run-journal.service';
import { ContextPreviewService } from './context-preview.service';
import { SessionPipelineService } from './session-pipeline.service';

const PUBLIC_ARCHITECTURE_CONTEXT_KEYS = new Set([
  'projectPath',
  'executionCwd',
  'schemaId',
  'schemaName',
  'displayLabel',
]);

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly runJournal: RunJournalService,
    private readonly contextPreview: ContextPreviewService,
    private readonly sessionPipeline: SessionPipelineService,
  ) {}

  @Get()
  list(@Query('includeArchived') includeArchived?: string): Promise<ChatSession[]> {
    return this.sessions.list({ includeArchived: includeArchived === 'true' });
  }

  @Post()
  create(@Body() dto: CreateSessionDto): Promise<ChatSession> {
    return this.sessions.create({
      ...dto,
      runtimeContext: sanitizePublicRuntimeContext(dto.runtimeContext),
    });
  }

  @Get(':id/messages')
  getMessages(@Param('id') id: string): Promise<ChatMessage[]> {
    return this.sessions.getMessages(id);
  }

  @Get(':id/runs/current')
  getCurrentRun(@Param('id') id: string): Promise<ChatRunSnapshot | null> {
    return this.runJournal.getCurrentRun(id);
  }

  @Post(':id/context-preview')
  getContextPreview(
    @Param('id') id: string,
    @Body() body: SessionContextPreviewBody,
  ): Promise<LLMContextPreview> {
    return this.contextPreview.buildPreview(id, { ...body, target: 'session', sessionId: id });
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<void> {
    await this.sessionPipeline.stopAndDrain(id);
    await this.sessions.delete(id);
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string): Promise<void> {
    await this.sessions.archive(id);
  }

  @Post(':id/restore')
  async restore(@Param('id') id: string): Promise<void> {
    await this.sessions.restore(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { title?: string; personaId?: string; runtimeContext?: SessionRuntimeContext },
  ): Promise<void> {
    await this.sessions.update(id, {
      ...body,
      runtimeContext: sanitizePublicRuntimeContext(body.runtimeContext),
    });
  }

  @Post(':id/generate-title')
  async generateTitle(@Param('id') id: string): Promise<{ title: string }> {
    return this.sessions.generateTitle(id);
  }
}

function sanitizePublicRuntimeContext(
  runtimeContext: SessionRuntimeContext | undefined,
): SessionRuntimeContext | undefined {
  if (!runtimeContext) {
    return undefined;
  }

  const architectureContext = sanitizePublicArchitectureContext(runtimeContext.architectureContext);
  return architectureContext
    ? { runtimeKind: 'chat', architectureContext }
    : { runtimeKind: 'chat' };
}

function sanitizePublicArchitectureContext(
  architectureContext: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!architectureContext || typeof architectureContext !== 'object' || Array.isArray(architectureContext)) {
    return undefined;
  }

  const sanitized = Object.fromEntries(
    Object.entries(architectureContext).filter(([key, value]) => (
      PUBLIC_ARCHITECTURE_CONTEXT_KEYS.has(key)
      && typeof value === 'string'
      && value.trim().length > 0
    )),
  );

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

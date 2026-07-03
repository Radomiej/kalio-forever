import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type {
  ChatMessage,
  ChatRunSnapshot,
  ChatSession,
  ContextPreviewRequest,
  CreateSessionDto,
  LLMContextPreview,
  RuntimeWatchTarget,
  SessionRuntimeContext,
} from '@kalio/types';
import type { Response } from 'express';

type SessionContextPreviewBody = Omit<Extract<ContextPreviewRequest, { sessionId: string }>, 'sessionId'>;
import { SessionsService } from './sessions.service';
import { RunJournalService } from './run-journal.service';
import { ContextPreviewService } from './context-preview.service';
import { SessionRuntimeWatchlistService } from './session-runtime-watchlist.service';
import { SessionRuntimeStopService } from './session-runtime-stop.service';

const PUBLIC_ARCHITECTURE_CONTEXT_KEYS = new Set([
  'projectPath',
  'executionCwd',
  'schemaId',
  'schemaName',
  'displayLabel',
  'raAppLaunchId',
  'raAppLaunchName',
  'raAppLaunchSource',
]);

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly runJournal: RunJournalService,
    private readonly contextPreview: ContextPreviewService,
    private readonly runtimeWatchlist: SessionRuntimeWatchlistService,
    private readonly runtimeStop: SessionRuntimeStopService,
  ) {}

  @Get()
  list(
    @Query('includeArchived') includeArchived?: string,
    @Query('limit') limit?: string,
  ): Promise<ChatSession[]> {
    const parsedLimit = parseSessionListLimit(limit);
    const options: { includeArchived: boolean; limit?: number } = {
      includeArchived: includeArchived === 'true',
    };
    if (parsedLimit !== undefined) {
      options.limit = parsedLimit;
    }
    return this.sessions.list(options);
  }

  @Get('runtime-watchlist')
  listRuntimeWatchTargets(): Promise<RuntimeWatchTarget[]> {
    return this.runtimeWatchlist.list();
  }

  @Get(':id/children')
  listChildren(@Param('id') id: string): Promise<ChatSession[]> {
    return this.sessions.listChildren(id);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<ChatSession> {
    return this.sessions.get(id);
  }

  @Post()
  create(@Body() dto: CreateSessionDto): Promise<ChatSession> {
    return this.sessions.create({
      ...dto,
      runtimeContext: sanitizePublicRuntimeContext(dto.runtimeContext),
    });
  }

  @Get(':id/messages')
  async getMessages(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
    @Query('limit') limit?: string,
    @Query('beforeMessageId') beforeMessageId?: string,
  ): Promise<ChatMessage[]> {
    const hasExplicitPaging = (
      typeof limit === 'string' && limit.trim().length > 0
    ) || (
      typeof beforeMessageId === 'string' && beforeMessageId.trim().length > 0
    );
    if (!hasExplicitPaging) {
      const messages = await this.sessions.getMessages(id);
      response.setHeader('x-kalio-history-total-count', String(messages.length));
      response.setHeader('x-kalio-history-has-more-before', '0');
      response.setHeader('x-kalio-history-oldest-loaded-id', messages[0]?.id ?? '');
      return messages;
    }

    const page = await this.sessions.getMessagePage(id, {
      limit: typeof limit === 'string' && limit.trim().length > 0 ? Number.parseInt(limit, 10) : undefined,
      beforeMessageId,
    });
    response.setHeader('x-kalio-history-total-count', String(page.totalCount));
    response.setHeader('x-kalio-history-has-more-before', page.hasMoreBefore ? '1' : '0');
    response.setHeader('x-kalio-history-oldest-loaded-id', page.oldestLoadedMessageId ?? '');
    return page.messages;
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
    const sessionTree = await this.runtimeStop.stopSessionTree(id);
    const deleteOrder = [...sessionTree.sessionIds].reverse();
    for (const sessionId of deleteOrder) {
      await this.sessions.delete(sessionId);
    }
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

function parseSessionListLimit(limit: string | undefined): number | undefined {
  if (!limit || limit.trim().length === 0) {
    return undefined;
  }
  const parsed = Number.parseInt(limit, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
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

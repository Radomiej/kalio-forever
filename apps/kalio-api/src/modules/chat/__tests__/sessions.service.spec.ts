import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SessionsService } from '../sessions.service';
import type { IMessageRepository } from '../interfaces/message-repository.interface';
import type { DrizzleService } from '../../../database/drizzle.service';
import type { SessionManagerService } from '../session-manager.service';
import type { ChatSessionKind } from '@kalio/types';
import type { SessionEventsService } from '../session-events.service';
import type { LLMService } from '../../llm/llm.service';
import type { AllowedPathsService } from '../../allowed-paths/allowed-paths.service';

interface FakeRow {
  id: string;
  personaId: string;
  title: string;
  kind?: ChatSessionKind;
  parentSessionId?: string | null;
  parentTurnId?: string | null;
  parentToolCallId?: string | null;
  runtimeContext?: unknown;
  archivedAt?: number | Date | null;
  createdAt: number | Date;
  updatedAt: number | Date;
}

function makeDrizzle(rows: FakeRow[]): { drizzle: DrizzleService; rows: FakeRow[]; ops: string[] } {
  const ops: string[] = [];
  type RowQuery = PromiseLike<FakeRow[]> & { limit: (limit: number) => Promise<FakeRow[]> };
  const rowQuery = (sourceRows: FakeRow[]): RowQuery => ({
    then: (onfulfilled, onrejected) => Promise.resolve(sourceRows).then(onfulfilled, onrejected),
    limit: (limit: number) => Promise.resolve(sourceRows.slice(0, limit)),
  });
  const select = () => ({
    from: () => ({
      orderBy: () => rowQuery(rows),
      where: () => ({
        orderBy: () => rowQuery(rows.filter((row) => row.archivedAt == null)),
        limit: (limit: number) => Promise.resolve(rows.slice(0, limit)),
      }),
    }),
  });
  const insert = () => ({
    values: (row: FakeRow) => {
      ops.push('insert');
      rows.push(row);
      return Promise.resolve();
    },
  });
  const update = () => ({
    set: (patch: Partial<FakeRow>) => ({
      where: () => {
        ops.push('update');
        Object.assign(rows[0], patch);
        return Promise.resolve();
      },
    }),
  });
  const del = () => ({
    where: () => {
      ops.push('delete');
      rows.length = 0;
      return Promise.resolve();
    },
  });

  const drizzle = {
    db: { select, insert, update, delete: del },
  } as unknown as DrizzleService;

  return { drizzle, rows, ops };
}

describe('SessionsService', () => {
  let service: SessionsService;
  let repo: IMessageRepository;
  let sessionEvents: SessionEventsService;
  let llm: LLMService;
  let allowedPaths: AllowedPathsService;
  let rows: FakeRow[];
  let ops: string[];

  beforeEach(() => {
    rows = [];
    repo = {
      ensureSession: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      loadHistoryPage: vi.fn().mockResolvedValue({
        messages: [],
        totalCount: 0,
        hasMoreBefore: false,
        oldestLoadedMessageId: null,
      }),
      saveMessage: vi.fn().mockResolvedValue(undefined),
    };
    const fixture = makeDrizzle(rows);
    ops = fixture.ops;
    const sessionManager = {} as unknown as SessionManagerService;
    sessionEvents = {
      onSessionCreated: vi.fn().mockReturnValue(() => undefined),
      onSessionUpdated: vi.fn().mockReturnValue(() => undefined),
      emitSessionCreated: vi.fn(),
      emitSessionUpdated: vi.fn(),
    } as unknown as SessionEventsService;
    llm = {
      streamChat: vi.fn().mockImplementation(async (_messages, _tools, options) => {
        options.onChunk({ delta: 'Generated Title', done: false, sessionId: 'title', messageId: 'title-msg' });
        options.onChunk({ delta: '', done: true, sessionId: 'title', messageId: 'title-msg' });
        return [];
      }),
    } as unknown as LLMService;
    allowedPaths = {
      ensurePath: vi.fn().mockResolvedValue({ id: 'allowed-1', path: 'C:\\Projekty\\kalio-forever', createdAt: 1 }),
    } as unknown as AllowedPathsService;
    service = new SessionsService(fixture.drizzle, sessionManager, sessionEvents, repo, llm, allowedPaths);
  });

  describe('create', () => {
    it('inserts a session row and returns ChatSession', async () => {
      const result = await service.create({ personaId: 'p1', title: 'Test' });
      expect(result.personaId).toBe('p1');
      expect(result.title).toBe('Test');
      expect(result.id).toBeTruthy();
      expect(ops).toContain('insert');
    });

    it('defaults title to "New Chat" when not provided', async () => {
      const result = await service.create({ personaId: 'p1' });
      expect(result.title).toBe('New Chat');
    });

    it('does not register projectPath for public session creation by default', async () => {
      const runtimeContext = {
        runtimeKind: 'chat' as const,
        architectureContext: {
          projectPath: 'C:\\Projekty\\kalio-forever',
          executionCwd: 'C:\\Projekty\\kalio-forever',
        },
      };

      await service.create({ personaId: 'p1', runtimeContext });

      expect(allowedPaths.ensurePath).not.toHaveBeenCalled();
    });

    it('registers projectPath when an internal create explicitly requests it', async () => {
      const runtimeContext = {
        runtimeKind: 'chat' as const,
        architectureContext: {
          projectPath: 'C:\\Projekty\\kalio-forever',
          executionCwd: 'C:\\Projekty\\kalio-forever',
        },
      };

      await service.createWithId('scoped-session', { personaId: 'p1', runtimeContext }, {
        registerRuntimeProjectPath: true,
      });

      expect(allowedPaths.ensurePath).toHaveBeenCalledWith('C:\\Projekty\\kalio-forever');
    });
  });

  describe('list', () => {
    it('returns empty array when no sessions', async () => {
      const result = await service.list();
      expect(result).toEqual([]);
    });

    it('maps rows to ChatSession with millisecond timestamps', async () => {
      rows.push({
        id: 's1',
        personaId: 'p1',
        title: 'Hello',
        createdAt: new Date(1000),
        updatedAt: new Date(2000),
      });
      const result = await service.list();
      expect(result).toEqual([
        {
          id: 's1',
          personaId: 'p1',
          title: 'Hello',
          kind: 'chat',
          parentSessionId: undefined,
          parentTurnId: undefined,
          parentToolCallId: undefined,
          createdAt: 1000,
          updatedAt: 2000,
        },
      ]);
    });

    it('does not return archived sessions by default', async () => {
      rows.push(
        { id: 'visible', personaId: 'p1', title: 'Visible', createdAt: 1, updatedAt: 2, archivedAt: null },
        { id: 'archived', personaId: 'p1', title: 'Archived', createdAt: 1, updatedAt: 3, archivedAt: 4 },
      );

      const result = await service.list();

      expect(result.map((session) => session.id)).toEqual(['visible']);
    });

    it('can include archived sessions for lifecycle views', async () => {
      rows.push(
        { id: 'visible', personaId: 'p1', title: 'Visible', createdAt: 1, updatedAt: 2, archivedAt: null },
        { id: 'archived', personaId: 'p1', title: 'Archived', createdAt: 1, updatedAt: 3, archivedAt: 4 },
      );

      const result = await service.list({ includeArchived: true });

      expect(result.map((session) => session.id)).toEqual(['visible', 'archived']);
    });

    it('limits the default active session list for large histories', async () => {
      for (let index = 0; index < 260; index += 1) {
        rows.push({
          id: `session-${index}`,
          personaId: 'p1',
          title: `Session ${index}`,
          createdAt: index,
          updatedAt: index,
          archivedAt: null,
        });
      }

      const result = await service.list();

      expect(result).toHaveLength(250);
      expect(result.at(0)?.id).toBe('session-0');
      expect(result.at(-1)?.id).toBe('session-249');
    });

    it('clamps explicit active session limits to the release-safe maximum', async () => {
      for (let index = 0; index < 550; index += 1) {
        rows.push({
          id: `session-${index}`,
          personaId: 'p1',
          title: `Session ${index}`,
          createdAt: index,
          updatedAt: index,
          archivedAt: null,
        });
      }

      const result = await service.list({ limit: 999 });

      expect(result).toHaveLength(500);
    });
  });

  describe('getMessages', () => {
    it('throws NotFoundException when session does not exist', async () => {
      await expect(service.getMessages('missing')).rejects.toThrow(NotFoundException);
    });

    it('delegates to repo.loadHistory when session exists', async () => {
      rows.push({ id: 's1', personaId: 'p1', title: '', createdAt: 0, updatedAt: 0 });
      await service.getMessages('s1');
      expect(repo.loadHistory).toHaveBeenCalledWith('s1');
    });

    it('loads a paged message window for session activation', async () => {
      rows.push({ id: 's1', personaId: 'p1', title: '', createdAt: 0, updatedAt: 0 });

      await service.getMessagePage('s1', { limit: 40, beforeMessageId: 'msg-10' });

      expect(repo.loadHistoryPage).toHaveBeenCalledWith('s1', { limit: 40, beforeMessageId: 'msg-10' });
    });
  });

  describe('delete', () => {
    it('throws NotFoundException for missing session', async () => {
      await expect(service.delete('missing')).rejects.toThrow(NotFoundException);
    });

    it('deletes the row when session exists', async () => {
      rows.push({ id: 's1', personaId: 'p1', title: '', createdAt: 0, updatedAt: 0 });
      await service.delete('s1');
      expect(ops).toContain('delete');
    });
  });

  describe('archive', () => {
    it('throws NotFoundException for missing session', async () => {
      await expect(service.archive('missing')).rejects.toThrow(NotFoundException);
    });

    it('marks an existing session archived without deleting it', async () => {
      rows.push({ id: 's1', personaId: 'p1', title: '', createdAt: 0, updatedAt: 0 });
      await service.archive('s1');
      expect(ops).toContain('update');
      expect(rows[0].archivedAt).toBeInstanceOf(Date);
      expect(rows).toHaveLength(1);
    });
  });

  describe('restore', () => {
    it('clears archive state on an existing session', async () => {
      rows.push({ id: 's1', personaId: 'p1', title: '', createdAt: 0, updatedAt: 0, archivedAt: 1 });
      await service.restore('s1');
      expect(ops).toContain('update');
      expect(rows[0].archivedAt).toBeNull();
    });
  });

  describe('rename', () => {
    it('throws NotFoundException for missing session', async () => {
      await expect(service.rename('missing', 'New Title')).rejects.toThrow(NotFoundException);
    });

    it('updates title on existing session', async () => {
      rows.push({ id: 's1', personaId: 'p1', title: 'Old', createdAt: 0, updatedAt: 0 });
      await service.rename('s1', 'New');
      expect(ops).toContain('update');
      expect(rows[0].title).toBe('New');
    });
  });

  describe('update', () => {
    it('updates runtimeContext on an existing session', async () => {
      rows.push({ id: 's1', personaId: 'p1', title: 'Old', createdAt: 0, updatedAt: 0 });
      const runtimeContext = {
        runtimeKind: 'chat' as const,
        architectureContext: {
          projectPath: 'C:\\Projekty\\kalio-forever',
          executionCwd: 'C:\\Projekty\\kalio-forever',
        },
      };

      await service.update('s1', { runtimeContext });

      expect(ops).toContain('update');
      expect(rows[0].runtimeContext).toEqual(runtimeContext);
      expect(allowedPaths.ensurePath).not.toHaveBeenCalled();
    });

    it('updates metadata and runtimeContext in the same call', async () => {
      rows.push({ id: 's1', personaId: 'p1', title: 'Old', createdAt: 0, updatedAt: 0 });
      const runtimeContext = {
        runtimeKind: 'chat' as const,
        architectureContext: {
          projectPath: 'C:\\Projekty\\kalio-forever',
          executionCwd: 'C:\\Projekty\\kalio-forever',
        },
      };

      await service.update('s1', {
        title: 'New Title',
        personaId: 'builder',
        runtimeContext,
      });

      expect(rows[0].title).toBe('New Title');
      expect(rows[0].personaId).toBe('builder');
      expect(rows[0].runtimeContext).toEqual(runtimeContext);
      expect(sessionEvents.emitSessionUpdated).toHaveBeenCalledTimes(1);
      expect(allowedPaths.ensurePath).not.toHaveBeenCalled();
    });

    it('registers projectPath only for trusted runtime-context updates', async () => {
      rows.push({
        id: 's1',
        personaId: 'p1',
        title: 'Old',
        runtimeContext: {
          runtimeKind: 'chat',
          architectureContext: {
            projectPath: 'C:\\Projekty\\kalio-forever',
            executionCwd: 'C:\\Projekty\\kalio-forever',
          },
        },
        createdAt: 0,
        updatedAt: 0,
      });

      await service.registerRuntimeProjectPathForSession('s1');

      expect(allowedPaths.ensurePath).toHaveBeenCalledWith('C:\\Projekty\\kalio-forever');
    });
  });

  describe('generateTitle', () => {
    it('throws NotFoundException for missing session', async () => {
      await expect(service.generateTitle('missing')).rejects.toThrow(NotFoundException);
    });

    it('returns generated title text when the LLM produces a summary', async () => {
      rows.push({ id: 's1', personaId: 'p1', title: '', createdAt: 0, updatedAt: 0 });
      (repo.loadHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: '1', sessionId: 's1', role: 'user', content: 'Hello world', createdAt: 1 },
      ]);
      const result = await service.generateTitle('s1');
      expect(result.title).toBe('Generated Title');
    });

    it('ignores malformed assistant content while generating a title', async () => {
      rows.push({ id: 's1', personaId: 'p1', title: '', createdAt: 0, updatedAt: 0 });
      (repo.loadHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: '1', sessionId: 's1', role: 'user', content: 'Hello world', createdAt: 1 },
        {
          id: '2',
          sessionId: 's1',
          role: 'assistant',
          content: undefined as unknown as string,
          createdAt: 2,
        },
      ]);

      await expect(service.generateTitle('s1')).resolves.toEqual({ title: 'Generated Title' });
    });

    it('falls back to a deterministic heuristic when the provider echoes the prompt', async () => {
      rows.push({ id: 's1', personaId: 'p1', title: '', createdAt: 0, updatedAt: 0 });
      (llm.streamChat as ReturnType<typeof vi.fn>).mockImplementationOnce(async (_messages, _tools, options) => {
        options.onChunk({
          delta: '[MockLLM] Echo: Session title regression verification uses a deliberately long first prompt to exceed sixty characters.',
          done: false,
          sessionId: 'title',
          messageId: 'title-msg',
        });
        options.onChunk({ delta: '', done: true, sessionId: 'title', messageId: 'title-msg' });
        return [];
      });
      (repo.loadHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: '1',
          sessionId: 's1',
          role: 'user',
          content: 'Session title regression verification uses a deliberately long first prompt to exceed sixty characters. Reply with exactly OK and do not use tools.',
          createdAt: 1,
        },
      ]);
      const result = await service.generateTitle('s1');
      expect(result.title).toBe('Session Title Regression Verification');
    });

    it('derives an architecture review fallback from typed runtime project scope when needed', async () => {
      rows.push({
        id: 's1',
        personaId: 'p1',
        title: '',
        createdAt: 0,
        updatedAt: 0,
        runtimeContext: {
          runtimeKind: 'agent-flow-root',
          architectureContext: {
            projectPath: 'C:\\Projekty\\FamilyQuest',
          },
        },
      });
      (llm.streamChat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('provider unavailable'));
      (repo.loadHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: '1',
          sessionId: 's1',
          role: 'user',
          content: '[Architecture: Strategic Decision Council]\nC:\\Projekty\\FamilyQuest ocen architekturę i co byś w niej zmienił?',
          createdAt: 1,
        },
      ]);
      const result = await service.generateTitle('s1');
      expect(result.title).toBe('Architecture Review FamilyQuest');
    });

    it('does not derive architecture review project names from prompt text without typed runtime scope', async () => {
      rows.push({ id: 's1', personaId: 'p1', title: '', createdAt: 0, updatedAt: 0 });
      (llm.streamChat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('provider unavailable'));
      (repo.loadHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: '1',
          sessionId: 's1',
          role: 'user',
          content: '[Architecture: Strategic Decision Council]\nC:\\Projekty\\FamilyQuest ocen architekturÄ™ i co byĹ› w niej zmieniĹ‚?',
          createdAt: 1,
        },
      ]);
      const result = await service.generateTitle('s1');
      expect(result.title).not.toBe('Architecture Review FamilyQuest');
      expect(result.title).toBe('Architecture Review');
    });

    it('returns "New Chat" when no user messages in history', async () => {
      rows.push({ id: 's1', personaId: 'p1', title: '', createdAt: 0, updatedAt: 0 });
      (repo.loadHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: '1', sessionId: 's1', role: 'assistant', content: 'Hi there!', createdAt: 1 },
      ]);
      const result = await service.generateTitle('s1');
      expect(result.title).toBe('New Chat');
    });
  });
});

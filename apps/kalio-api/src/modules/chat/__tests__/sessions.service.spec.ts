import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SessionsService } from '../sessions.service';
import type { IMessageRepository } from '../interfaces/message-repository.interface';
import type { DrizzleService } from '../../../database/drizzle.service';
import type { SessionManagerService } from '../session-manager.service';

interface FakeRow {
  id: string;
  personaId: string;
  title: string;
  kind?: 'chat' | 'subagent';
  parentSessionId?: string | null;
  parentTurnId?: string | null;
  parentToolCallId?: string | null;
  interlocutorLabel?: string | null;
  createdAt: number | Date;
  updatedAt: number | Date;
}

function makeDrizzle(rows: FakeRow[]): { drizzle: DrizzleService; rows: FakeRow[]; ops: string[] } {
  const ops: string[] = [];
  const select = () => ({
    from: () => ({
      orderBy: () => Promise.resolve(rows),
      where: () => ({ limit: () => Promise.resolve(rows) }),
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
  let rows: FakeRow[];
  let ops: string[];

  beforeEach(() => {
    rows = [];
    repo = {
      ensureSession: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      saveMessage: vi.fn().mockResolvedValue(undefined),
    };
    const fixture = makeDrizzle(rows);
    ops = fixture.ops;
    const sessionManager = {} as unknown as SessionManagerService;
    service = new SessionsService(fixture.drizzle, sessionManager, repo);
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
          interlocutorLabel: undefined,
          createdAt: 1000,
          updatedAt: 2000,
        },
      ]);
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

  describe('generateTitle', () => {
    it('throws NotFoundException for missing session', async () => {
      await expect(service.generateTitle('missing')).rejects.toThrow(NotFoundException);
    });

    it('returns title from first user message content (truncated at 60 chars)', async () => {
      rows.push({ id: 's1', personaId: 'p1', title: '', createdAt: 0, updatedAt: 0 });
      (repo.loadHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: '1', sessionId: 's1', role: 'user', content: 'Hello world', createdAt: 1 },
      ]);
      const result = await service.generateTitle('s1');
      expect(result.title).toBe('Hello world');
    });

    it('truncates title with ellipsis when content exceeds 60 chars', async () => {
      rows.push({ id: 's1', personaId: 'p1', title: '', createdAt: 0, updatedAt: 0 });
      const longContent = 'A'.repeat(80);
      (repo.loadHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: '1', sessionId: 's1', role: 'user', content: longContent, createdAt: 1 },
      ]);
      const result = await service.generateTitle('s1');
      expect(result.title).toBe('A'.repeat(60) + '…');
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

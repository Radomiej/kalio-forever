import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatSession } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { createDrizzleDatabase, createSqliteDatabase, type SqliteClient } from '../../database/sqlite-runtime';
import { createMessageSessions } from './__tests__/message-session.fixture';
import { DrizzleMessageRepository } from './drizzle-message.repository';
import { SessionEventsService } from './session-events.service';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';

describe('message recency and existing session lifecycle events (real SQLite)', () => {
  let client: SqliteClient;
  let repository: DrizzleMessageRepository;
  let events: SessionEventsService;
  let observed: ChatSession[];
  let controller: SessionsController;
  const message: ChatMessage = {
    id: 'message', sessionId: 'child', role: 'user', content: 'Current turn', createdAt: 200,
    turnId: 'turn', promptMessageId: 'prompt',
  };
  const time = (id = 'child') => client.prepare<{ updatedAt: number }>(
    'SELECT updated_at AS updatedAt FROM sessions WHERE id = ?',
  ).get(id)?.updatedAt;

  beforeEach(() => {
    client = createSqliteDatabase(':memory:', 'node').client;
    createMessageSessions(client, ['root', 'child', 'other']);
    client.exec(`PRAGMA foreign_keys = ON;
      UPDATE sessions SET parent_session_id = 'root', parent_turn_id = 'parent-turn',
        parent_tool_call_id = 'parent-call', kind = 'subagent', title = 'Child title',
        project_id = 'project', external_thread_id = 'external', runtime_context = '{}',
        toolset_fingerprint = 'private-fingerprint' WHERE id = 'child';
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), role TEXT NOT NULL,
        content TEXT NOT NULL, turn_id TEXT, prompt_message_id TEXT, thinking TEXT,
        tool_calls TEXT, tool_call_id TEXT, attachments TEXT, created_at INTEGER NOT NULL
      );`);
    const service = Object.assign(Object.create(DrizzleService.prototype) as DrizzleService,
      { db: createDrizzleDatabase(client, 'node', schema) });
    events = new SessionEventsService();
    observed = [];
    events.onSessionUpdated(({ session }) => {
      // BEGIN fails if the repository emits before its SQLite transaction has committed.
      client.exec('BEGIN');
      try {
        expect(client.prepare('SELECT id FROM messages WHERE session_id = ?').get(session.id)).toBeDefined();
        expect(time(session.id)).toBe(session.updatedAt);
      } finally {
        client.exec('ROLLBACK');
      }
      observed.push(session);
    });
    repository = new DrizzleMessageRepository(service, events);
    const sessions = new SessionsService(service, null as never, events, repository,
      null as never, null as never, null as never);
    controller = new SessionsController(sessions, null as never, null as never, null as never, null as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    client.close();
  });

  it.each(['user', 'assistant', 'tool_result', 'system'] as const)(
    'advances only the owning session for a new %s message and emits the public session projection', async (role) => {
      await repository.saveMessage({ ...message, role });
      expect(time()).toBe(200);
      expect(time('root')).toBe(100);
      expect(time('other')).toBe(100);
      expect(observed).toEqual([{
        id: 'child', personaId: 'persona', title: 'Child title', kind: 'subagent',
        parentSessionId: 'root', parentTurnId: 'parent-turn', parentToolCallId: 'parent-call',
        projectId: 'project', executionProfileId: 'local-direct-default', externalThreadId: 'external',
        runtimeContext: {}, createdAt: 100, updatedAt: 200,
      }]);
    },
  );

  it('keeps recency monotonic across out-of-order inserts and equal timestamp ties', async () => {
    await repository.saveMessage(message);
    await repository.saveMessage({ ...message, id: 'older', createdAt: 150 });
    await repository.saveMessage({ ...message, id: 'tie', createdAt: 200 });
    expect(time()).toBe(200);
    expect(observed).toHaveLength(1);
    expect(await repository.loadHistory('child')).toHaveLength(3);
  });

  it('does not advance recency when a historical assistant is finalized or replayed with a newer input timestamp', async () => {
    await repository.saveMessage({ ...message, role: 'assistant', createdAt: 50 });
    await repository.saveMessage({ ...message, role: 'assistant', content: 'Final text', createdAt: 900 });
    expect((await repository.loadHistory('child'))[0]).toMatchObject({ content: 'Final text', createdAt: 50 });
    expect(time()).toBe(100);
    expect(observed).toEqual([]);
  });

  it('rejects a duplicate user message without time or event drift', async () => {
    await repository.saveMessage(message);
    observed.length = 0;
    await expect(repository.saveMessage({ ...message, createdAt: 900 })).rejects.toThrow();
    expect(time()).toBe(200);
    expect(observed).toEqual([]);
  });

  it('reloads durable recency through session detail and list controller projections', async () => {
    await repository.saveMessage(message);
    expect(await controller.get('child')).toEqual(observed[0]);
    expect((await controller.list())[0]).toMatchObject({ id: 'child', updatedAt: 200 });
  });

  it.each([
    { role: 'user' as const },
    { role: 'assistant' as const, sessionId: 'other' },
    { role: 'assistant' as const, turnId: 'foreign-turn' },
    { role: 'assistant' as const, promptMessageId: 'foreign-prompt' },
  ])('rejects duplicate or conflicting saves without time or event drift: %j', async (patch) => {
    await repository.saveMessage({ ...message, role: 'assistant' });
    observed.length = 0;
    await expect(repository.saveMessage({ ...message, ...patch, createdAt: 900 })).rejects.toThrow();
    expect(time()).toBe(200);
    expect(time('other')).toBe(100);
    expect(observed).toEqual([]);
    expect((await repository.loadHistory('child'))[0]).toMatchObject({ role: 'assistant', createdAt: 200 });
  });

  it.each(['user', 'assistant'] as const)('rolls back a %s message when the recency write fails and publishes nothing', async (role) => {
    client.exec(`CREATE TRIGGER reject_recency BEFORE UPDATE OF updated_at ON sessions
      BEGIN SELECT RAISE(ABORT, 'recency failure'); END;`);
    await expect(repository.saveMessage({ ...message, role })).rejects.toThrow();
    expect(await repository.loadHistory('child')).toEqual([]);
    expect(time()).toBe(100);
    expect(observed).toEqual([]);
  });

  it('does not emit or advance any session after a foreign-key write failure', async () => {
    await expect(repository.saveMessage({ ...message, sessionId: 'missing' })).rejects.toThrow();
    expect(time()).toBe(100);
    expect(observed).toEqual([]);
  });

  it('resolves a committed assistant save when a real event listener throws and does not republish on retry', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    let attempts = 0;
    events.onSessionUpdated(() => {
      attempts++;
      throw new Error('Private listener failure payload');
    });

    await expect(repository.saveMessage({ ...message, role: 'assistant' })).resolves.toBeUndefined();
    expect(time()).toBe(200);
    expect(await repository.loadHistory('child')).toMatchObject([
      { id: 'message', role: 'assistant', content: 'Current turn', createdAt: 200 },
    ]);
    expect(attempts).toBe(1);
    expect(observed).toHaveLength(1);
    expect(warn.mock.calls).toEqual([
      ['Session update publication failed after commit for session child'],
    ]);

    await expect(repository.saveMessage({ ...message, role: 'assistant', content: 'Final text', createdAt: 900 }))
      .resolves.toBeUndefined();
    expect(await repository.loadHistory('child')).toMatchObject([
      { id: 'message', role: 'assistant', content: 'Final text', createdAt: 200 },
    ]);
    expect(await repository.loadHistory('child')).toHaveLength(1);
    expect(time()).toBe(200);
    expect(attempts).toBe(1);
    expect(observed).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

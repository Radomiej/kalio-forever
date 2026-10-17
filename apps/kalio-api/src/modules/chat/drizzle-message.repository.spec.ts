import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { createDrizzleDatabase, createSqliteDatabase, type SqliteClient } from '../../database/sqlite-runtime';
import { DrizzleMessageRepository } from './drizzle-message.repository';
import { SessionEventsService } from './session-events.service';
import { createMessageSessions } from './__tests__/message-session.fixture';

describe('DrizzleMessageRepository assistant updates (SQLite)', () => {
  let client: SqliteClient;
  let repository: DrizzleMessageRepository;
  const initial: ChatMessage = {
    id: 'assistant-1', sessionId: 'session-1', role: 'assistant', content: '',
    turnId: 'turn-1', promptMessageId: 'prompt-1', createdAt: 1000,
    toolCalls: [{ id: 'call-1', name: 'fs_read', args: { path: 'App.jsx' } }],
  };

  beforeEach(() => {
    client = createSqliteDatabase(':memory:', 'node').client;
    createMessageSessions(client, ['session-1', 'session-2', 'foreign-session']);
    client.exec(`CREATE TABLE messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, turn_id TEXT, prompt_message_id TEXT, thinking TEXT,
      tool_calls TEXT, tool_call_id TEXT, attachments TEXT, created_at INTEGER NOT NULL
    )`);
    const service = Object.assign(Object.create(DrizzleService.prototype) as DrizzleService,
      { db: createDrizzleDatabase(client, 'node', schema) });
    repository = new DrizzleMessageRepository(service, new SessionEventsService());
  });
  afterEach(() => client.close());

  it('persists nonempty thinking, tool result linkage and VFS attachments on insert', async () => {
    await repository.saveMessage({
      ...initial, content: 'Draft response', thinking: 'Inspect the uploaded image',
      toolCallId: 'source-call',
      attachments: [{ path: 'uploads/source.png', mimeType: 'image/png' }],
    });

    expect(await repository.loadHistory('session-1')).toEqual([{
      id: 'assistant-1', sessionId: 'session-1', role: 'assistant', content: 'Draft response',
      turnId: 'turn-1', promptMessageId: 'prompt-1', createdAt: 1000,
      thinking: 'Inspect the uploaded image', toolCallId: 'source-call',
      toolCalls: [{ id: 'call-1', name: 'fs_read', args: { path: 'App.jsx' } }],
      attachments: [{ path: 'uploads/source.png', mimeType: 'image/png' }],
    }]);
  });

  it('finalizes payload fields while preserving original creation and turn linkage', async () => {
    await repository.saveMessage({
      ...initial, thinking: 'Draft analysis', toolCallId: 'draft-call',
      attachments: [{ path: 'uploads/draft.png', mimeType: 'image/png' }],
    });
    await repository.saveMessage({
      ...initial, content: 'Final response', createdAt: 2000,
      turnId: undefined, promptMessageId: undefined,
      thinking: 'Completed analysis', toolCallId: 'final-call',
      attachments: [{ path: 'uploads/final.pdf', mimeType: 'application/pdf' }],
    });

    expect(await repository.loadHistory('session-1')).toEqual([{
      id: 'assistant-1', sessionId: 'session-1', role: 'assistant', content: 'Final response',
      turnId: 'turn-1', promptMessageId: 'prompt-1', createdAt: 1000,
      thinking: 'Completed analysis', toolCallId: 'final-call',
      toolCalls: [{ id: 'call-1', name: 'fs_read', args: { path: 'App.jsx' } }],
      attachments: [{ path: 'uploads/final.pdf', mimeType: 'application/pdf' }],
    }]);
  });

  it('updates one assistant row with final text and two calls, preserving creation and turn linkage', async () => {
    await repository.saveMessage(initial);
    await repository.saveMessage({ ...initial, content: 'Finished', createdAt: 2000,
      turnId: undefined, promptMessageId: undefined,
      toolCalls: [...initial.toolCalls!, { id: 'call-2', name: 'fs_read', args: { path: 'styles.css' } }],
    });
    expect(await repository.loadHistory('session-1')).toEqual([{
      ...initial, content: 'Finished',
      toolCalls: [...initial.toolCalls!, { id: 'call-2', name: 'fs_read', args: { path: 'styles.css' } }],
      thinking: undefined, toolCallId: undefined, attachments: undefined,
    }]);
  });

  it.each([
    { sessionId: 'foreign-session' },
    { role: 'user' as const },
    { turnId: 'foreign-turn' },
    { promptMessageId: 'foreign-prompt' },
  ])('rejects conflicting ownership/linkage %j without changing the row', async (collision) => {
    await repository.saveMessage(initial);
    await expect(repository.saveMessage({ ...initial, ...collision, content: 'Overwrite' })).rejects.toThrow();
    expect((await repository.loadHistory('session-1'))[0]).toMatchObject(initial);
    expect(await repository.loadHistory('foreign-session')).toEqual([]);
  });

  it('does not update an existing user row even when the incoming role is assistant', async () => {
    const user: ChatMessage = { ...initial, role: 'user', toolCalls: undefined };
    await repository.saveMessage(user);
    await expect(repository.saveMessage(initial)).rejects.toThrow();
    expect((await repository.loadHistory('session-1'))[0]).toMatchObject(user);
  });

  it('keeps a long tool turn with its prompt, assistant and results across history pages', async () => {
    await repository.saveMessage({ ...initial, id: 'older', role: 'user',
      turnId: 'older-turn', promptMessageId: undefined, toolCalls: undefined, createdAt: 500 });
    await repository.saveMessage({ ...initial, id: 'prompt-1', role: 'user',
      toolCalls: undefined, createdAt: 900 });
    const calls = Array.from({ length: 79 }, (_, index) => ({
      id: `call-${index}`, name: 'terminal_output', args: { terminalId: 'build-terminal' },
    }));
    await repository.saveMessage({ ...initial, content: 'Build exited 0', toolCalls: calls });
    for (const [index, call] of calls.entries()) {
      await repository.saveMessage({ ...initial, id: `result-${index}`, role: 'tool_result',
        toolCalls: undefined, toolCallId: call.id, content: JSON.stringify({ status: 'exited', exitCode: 0 }),
        createdAt: 1100 + index });
    }
    const page = await repository.loadHistoryPage('session-1', { limit: 40 });
    expect(page.messages).toHaveLength(81);
    expect(page.messages[0].id).toBe('prompt-1');
    expect(page.messages.find((message) => message.id === initial.id)?.toolCalls).toEqual(calls);
    expect(page.messages.filter((message) => message.role === 'tool_result')).toHaveLength(79);
    expect(page.hasMoreBefore).toBe(true);
    expect(page.totalCount).toBe(82);
    const previous = await repository.loadHistoryPage('session-1', {
      limit: 40, beforeMessageId: page.oldestLoadedMessageId!,
    });
    expect(previous.messages.map((message) => message.id)).toEqual(['older']);
    expect(previous.hasMoreBefore).toBe(false);
  });

  it.each([false, true])('keeps every owner when expanding into an interleaved turn (prompt-only=%s)', async (promptOnly) => {
    for (const [turn, time] of [['B', 10], ['A', 30]] as const) {
      await repository.saveMessage({ ...initial, id: `prompt-${turn}`, role: 'user', toolCalls: undefined,
        turnId: promptOnly ? undefined : turn, promptMessageId: undefined, createdAt: time });
      await repository.saveMessage({ ...initial, id: `assistant-${turn}`, content: '',
        turnId: promptOnly ? undefined : turn, promptMessageId: `prompt-${turn}`, createdAt: time + 10,
        toolCalls: Array.from({ length: turn === 'A' ? 79 : 1 }, (_, index) => ({
          id: turn === 'A' ? `call-A-${index}` : 'call-B', name: 'terminal_output', args: {},
        })) });
    }
    await repository.saveMessage({ ...initial, id: 'result-B', role: 'tool_result', toolCalls: undefined,
      turnId: promptOnly ? undefined : 'B', promptMessageId: 'prompt-B', toolCallId: 'call-B', createdAt: 45 });
    for (let index = 0; index < 79; index++) {
      await repository.saveMessage({ ...initial, id: `result-A-${index}`, role: 'tool_result', toolCalls: undefined,
        turnId: promptOnly ? undefined : 'A', promptMessageId: 'prompt-A', toolCallId: `call-A-${index}`, createdAt: 50 + index });
    }
    const page = await repository.loadHistoryPage('session-1', { limit: 40 });
    expect(page.messages.map((message) => message.id)).toContain('assistant-B');
    expect(page.messages.map((message) => message.id)).toContain('prompt-B');
    expect(page.messages.map((message) => message.id)).toContain('assistant-A');
    expect(page.messages).toHaveLength(84);
    expect(page.hasMoreBefore).toBe(false);
    expect(new Set(page.messages.map((message) => message.id)).size).toBe(84);
  });

  it('uses stable timestamp ties and never expands into a different session with the same turn id', async () => {
    await repository.saveMessage({ ...initial, id: 'foreign', sessionId: 'session-2', createdAt: 1 });
    await repository.saveMessage({ ...initial, id: 'older', role: 'user',
      toolCalls: undefined, turnId: undefined, promptMessageId: undefined, createdAt: 50 });
    await repository.saveMessage({ ...initial, id: 'prompt-1', role: 'user', toolCalls: undefined, createdAt: 100 });
    await repository.saveMessage({ ...initial, createdAt: 100 });
    await repository.saveMessage({ ...initial, id: 'result-1', role: 'tool_result',
      toolCalls: undefined, toolCallId: 'call-1', createdAt: 100 });
    const page = await repository.loadHistoryPage('session-1', { limit: 1 });
    expect(page.messages.map((message) => message.id)).toEqual(['assistant-1', 'prompt-1', 'result-1']);
    expect(page.totalCount).toBe(4);
    expect(page.hasMoreBefore).toBe(true);
    const older = await repository.loadHistoryPage('session-1', { limit: 1, beforeMessageId: page.oldestLoadedMessageId! });
    expect(older.messages.map((message) => message.id)).toEqual(['older']);
    expect(older.hasMoreBefore).toBe(false);
  });

  it.each([
    { owner: true, prompt: false, expected: ['assistant-1', 'result'] },
    { owner: false, prompt: true, expected: ['prompt-1', 'result'] },
    { owner: false, prompt: false, expected: ['result'] },
  ])('terminates without fabricating missing references: %j', async ({ owner, prompt, expected }) => {
    await repository.saveMessage({ ...initial, id: 'older', role: 'user', toolCalls: undefined,
      turnId: undefined, promptMessageId: undefined, createdAt: 50 });
    if (prompt) await repository.saveMessage({ ...initial, id: 'prompt-1', role: 'user', toolCalls: undefined, createdAt: 100 });
    if (owner) await repository.saveMessage({ ...initial, createdAt: 110 });
    await repository.saveMessage({ ...initial, id: 'result', role: 'tool_result', toolCalls: undefined,
      toolCallId: 'call-1', createdAt: 200 });
    const page = await repository.loadHistoryPage('session-1', { limit: 1 });
    expect(page.messages.map((message) => message.id)).toEqual(expected);
    expect(page.hasMoreBefore).toBe(true);
  });

  it('does not cross the before cursor when it cuts through a linked turn', async () => {
    await repository.saveMessage({ ...initial, id: 'prompt-1', role: 'user', toolCalls: undefined, createdAt: 90 });
    await repository.saveMessage({ ...initial, createdAt: 100 });
    for (const [id, createdAt] of [['result-first', 200], ['result-last', 210]] as const) {
      await repository.saveMessage({ ...initial, id, role: 'tool_result', toolCalls: undefined,
        toolCallId: 'call-1', createdAt });
    }
    const page = await repository.loadHistoryPage('session-1', { limit: 1, beforeMessageId: 'result-last' });
    expect(page.messages.map((message) => message.id)).toEqual(['prompt-1', 'assistant-1', 'result-first']);
    expect(page.hasMoreBefore).toBe(false);
  });
});

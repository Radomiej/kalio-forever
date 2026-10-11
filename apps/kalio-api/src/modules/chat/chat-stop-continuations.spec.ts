import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { HitlRequestService } from '../hitl/hitl-request.service';
import { ChatService } from './chat.service';
import { DrizzleMessageRepository } from './drizzle-message.repository';
import { SessionManagerService } from './session-manager.service';
import { RunJournalService } from './run-journal.service';

const clients: Database.Database[] = [];
const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  clients.splice(0).forEach(client => { if (client.open) client.close(); });
  directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true }));
});

function fixture(path = ':memory:') {
  const client = new Database(path); clients.push(client); client.pragma('foreign_keys = ON');
  const db = drizzle(client, { schema });
  migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
  db.insert(schema.executionProfiles).values({ id: 'test-profile', name: 'Test', kind: 'direct-llm', model: 'mock',
    createdAt: new Date(1), updatedAt: new Date(1) }).onConflictDoNothing().run();
  db.insert(schema.personas).values({ id: 'persona', name: 'Test', model: 'mock', executionProfileId: 'test-profile',
    createdAt: new Date(1), updatedAt: new Date(1) }).onConflictDoNothing().run();
  db.insert(schema.sessions).values({ id: 'session', personaId: 'persona', createdAt: new Date(1), updatedAt: new Date(1) })
    .onConflictDoNothing().run();
  const service = Object.assign(Object.create(DrizzleService.prototype) as DrizzleService, { db });
  const requests = new HitlRequestService(service);
  const journal = new RunJournalService(service);
  const repository = new DrizzleMessageRepository(service);
  const sessionManager = Object.create(SessionManagerService.prototype) as SessionManagerService;
  Object.assign(sessionManager, { repo: repository });
  const chat = Object.create(ChatService.prototype) as ChatService;
  Object.assign(chat, { hitlRequests: requests, runJournal: journal, sessionManager });
  return { client, db, requests, journal, chat, repository };
}

async function seed(f: ReturnType<typeof fixture>, linked = true, prompt: string | null = 'prompt') {
  const run = linked ? await f.journal.startRun({ sessionId: 'session', turnId: 'turn' }) : null;
  await f.requests.create({ id: 'request', kind: 'tool_confirmation', sessionId: 'session', toolCallId: 'call',
    ...(run ? { runId: run.id, turnId: 'turn' } : {}), payload: { toolName: 'fs_write', args: { path: 'file' } },
    continuation: { version: 1, executionState: 'pending', sessionId: 'session',
      ...(run ? { runId: run.id, turnId: 'turn' } : {}), ...(prompt ? { promptMessageId: prompt } : {}) } });
  return run;
}

describe('actual ChatService Stop continuation cleanup (migrated SQLite)', () => {
  it('cancels two pending confirmations on the same run atomically and interrupts the journal once', async () => {
    const f = fixture(); const run = await seed(f);
    await f.requests.create({ id: 'request-2', kind: 'tool_confirmation', sessionId: 'session',
      runId: run!.id, turnId: 'turn', toolCallId: 'call-2', payload: { toolName: 'fs_write', args: { path: 'second-file' } },
      continuation: { version: 1, executionState: 'pending', sessionId: 'session',
        runId: run!.id, turnId: 'turn', promptMessageId: 'prompt' } });
    await expect(f.chat.cancelPendingContinuations('session')).resolves.toBeUndefined();
    for (const id of ['request', 'request-2']) {
      expect(await f.requests.getById(id)).toMatchObject({ status: 'cancelled', revision: 2,
        outcome: { message: 'Turn interrupted by user' } });
    }
    const history = await f.repository.loadHistory('session');
    expect(history).toHaveLength(2);
    expect(history.map(message => message.toolCallId).sort()).toEqual(['call', 'call-2']);
    expect(history.every(message => message.role === 'tool_result' && message.turnId === 'turn'
      && message.promptMessageId === 'prompt'
      && message.content === '{"status":"cancelled","errorMessage":"Turn interrupted by user"}')).toBe(true);
    expect(f.client.prepare('SELECT status,revision FROM chat_runs WHERE id=?').get(run!.id))
      .toEqual({ status: 'interrupted', revision: 2 });
  });

  it('rolls the entire same-run batch back on the second message failure, then retries', async () => {
    const f = fixture(); const run = await seed(f);
    await f.requests.create({ id: 'request-2', kind: 'tool_confirmation', sessionId: 'session', runId: run!.id,
      turnId: 'turn', toolCallId: 'call-2', payload: { toolName: 'fs_write', args: {} },
      continuation: { sessionId: 'session', runId: run!.id, turnId: 'turn', promptMessageId: 'prompt' } });
    f.client.exec(`CREATE TRIGGER fail_second_message BEFORE INSERT ON messages WHEN NEW.tool_call_id='call-2'
      BEGIN SELECT RAISE(ABORT,'private second-message failure'); END`);
    await expect(f.chat.cancelPendingContinuations('session')).rejects.toThrow();
    for (const id of ['request', 'request-2']) expect(await f.requests.getById(id)).toMatchObject({ status: 'pending', revision: 1 });
    expect(await f.repository.loadHistory('session')).toEqual([]);
    expect(f.client.prepare('SELECT status,revision FROM chat_runs WHERE id=?').get(run!.id))
      .toEqual({ status: 'active', revision: 1 });
    f.client.exec('DROP TRIGGER fail_second_message'); await f.chat.cancelPendingContinuations('session');
    expect(await f.requests.listPending('session')).toEqual([]);
    expect(await f.repository.loadHistory('session')).toHaveLength(2);
    expect(f.client.prepare('SELECT status,revision FROM chat_runs WHERE id=?').get(run!.id))
      .toEqual({ status: 'interrupted', revision: 2 });
  });

  it('rejects a protected mixed batch before cancelling any ordinary row', async () => {
    const f = fixture(); const run = await seed(f);
    await f.requests.create({ id: 'protected', kind: 'tool_confirmation', sessionId: 'session', toolCallId: 'goal-call',
      payload: { toolName: 'run_sub_agentflow', args: {} }, continuation: { hostConfirmationRequirement: { goalLaunch: null } } });
    await expect(f.chat.cancelPendingContinuations('session')).rejects.toThrow('ORDINARY_CANCELLATION_CONFLICT');
    expect((await f.requests.listPending('session')).map(row => row.id).sort()).toEqual(['protected', 'request']);
    expect(await f.repository.loadHistory('session')).toEqual([]);
    expect(f.client.prepare('SELECT status,revision FROM chat_runs WHERE id=?').get(run!.id)).toEqual({ status: 'active', revision: 1 });
  });

  it('rejects a pending toolset gaining a row after the consumer snapshot', async () => {
    const f = fixture(); const run = await seed(f); const list = f.requests.listPending.bind(f.requests);
    vi.spyOn(f.requests, 'listPending').mockImplementation(async sessionId => {
      const rows = await list(sessionId);
      await f.requests.create({ id: 'new-request', kind: 'tool_confirmation', sessionId, toolCallId: 'new-call',
        payload: { toolName: 'fs_write', args: {} } });
      return rows;
    });
    await expect(f.chat.cancelPendingContinuations('session')).rejects.toThrow('ORDINARY_CANCELLATION_CONFLICT');
    expect((await list('session')).map(row => row.id).sort()).toEqual(['new-request', 'request']);
    expect(await f.repository.loadHistory('session')).toEqual([]);
    expect(f.client.prepare('SELECT status,revision FROM chat_runs WHERE id=?').get(run!.id)).toEqual({ status: 'active', revision: 1 });
  });

  it('preserves empty-toolset Stop on the scoped current run without touching native/budget rows', async () => {
    const f = fixture(); const run = await f.journal.startRun({ sessionId: 'session', turnId: 'turn' });
    for (const kind of ['raapp_native', 'tool_budget'] as const) await f.requests.create({ id: kind, kind, sessionId: 'session', payload: {} });
    await f.chat.cancelPendingContinuations('session');
    expect(f.client.prepare('SELECT status,revision FROM chat_runs WHERE id=?').get(run.id)).toEqual({ status: 'interrupted', revision: 2 });
    expect((await f.requests.listPending('session')).map(row => row.id).sort()).toEqual(['raapp_native', 'tool_budget']);
    expect(await f.repository.loadHistory('session')).toEqual([]);
  });

  it('rejects empty-toolset journal revision drift rather than using the unguarded interrupt tail', async () => {
    const f = fixture(); const run = await f.journal.startRun({ sessionId: 'session', turnId: 'turn' });
    const read = f.journal.getCurrentRun.bind(f.journal);
    vi.spyOn(f.journal, 'getCurrentRun').mockImplementation(async sessionId => {
      const snapshot = await read(sessionId);
      f.client.prepare('UPDATE chat_runs SET revision=revision+1 WHERE id=?').run(run.id);
      return snapshot;
    });
    await expect(f.chat.cancelPendingContinuations('session')).rejects.toThrow('ORDINARY_CANCELLATION_CONFLICT');
    expect(f.client.prepare('SELECT status,revision FROM chat_runs WHERE id=?').get(run.id)).toEqual({ status: 'active', revision: 2 });
  });

  it('rolls cancellation back after a message-write failure, then retries after reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'kalio-stop-atomic-')); directories.push(directory);
    const path = join(directory, 'test.db'); const f = fixture(path); const run = await seed(f);
    f.client.exec(`CREATE TRIGGER fail_stop_message BEFORE INSERT ON messages
      WHEN NEW.role='tool_result' BEGIN SELECT RAISE(ABORT,'private injected failure'); END`);
    await expect(f.chat.cancelPendingContinuations('session')).rejects.toThrow();
    expect(await f.requests.getById('request')).toMatchObject({ status: 'pending', revision: 1, outcome: null });
    expect(f.client.prepare('SELECT status,revision FROM chat_runs WHERE id=?').get(run!.id))
      .toEqual({ status: 'active', revision: 1 });
    expect(await f.repository.loadHistory('session')).toEqual([]);
    f.client.exec('DROP TRIGGER fail_stop_message'); f.client.close();
    const reopened = fixture(path);
    await reopened.chat.cancelPendingContinuations('session');
    expect(await reopened.requests.getById('request')).toMatchObject({ status: 'cancelled', revision: 2,
      outcome: { message: 'Turn interrupted by user' } });
    expect(await reopened.repository.loadHistory('session')).toEqual([expect.objectContaining({
      role: 'tool_result', toolCallId: 'call', turnId: 'turn', promptMessageId: 'prompt',
      content: '{"status":"cancelled","errorMessage":"Turn interrupted by user"}' })]);
    expect(reopened.client.prepare('SELECT status,revision,safe_resume,error_code FROM chat_runs WHERE id=?').get(run!.id))
      .toEqual({ status: 'interrupted', revision: 2, safe_resume: 0, error_code: 'INTERRUPTED' });
  });

  it('keeps a conflicting tool result immutable and leaves the request pending', async () => {
    const f = fixture(); const run = await seed(f);
    await f.repository.saveMessage({ id: 'actual-result', sessionId: 'session', role: 'tool_result',
      toolCallId: 'call', turnId: 'turn', promptMessageId: 'prompt', content: '{"status":"success"}', createdAt: 2 });
    await expect(f.chat.cancelPendingContinuations('session')).rejects.toThrow();
    expect(await f.requests.getById('request')).toMatchObject({ status: 'pending', revision: 1 });
    expect((await f.repository.loadHistory('session'))[0]?.content).toBe('{"status":"success"}');
    expect(f.client.prepare('SELECT status,revision FROM chat_runs WHERE id=?').get(run!.id))
      .toEqual({ status: 'active', revision: 1 });
  });

  it('stores missing prompt linkage as NULL rather than the generated message ID', async () => {
    const f = fixture(); await seed(f, true, null);
    await f.chat.cancelPendingContinuations('session');
    expect(f.client.prepare("SELECT prompt_message_id FROM messages WHERE role='tool_result'").get())
      .toEqual({ prompt_message_id: null });
  });

  it('rejects protected preparing/malformed goal requests before cancellation', async () => {
    const f = fixture(); const run = await seed(f);
    f.client.prepare("UPDATE hitl_requests SET payload=?,continuation=? WHERE id='request'").run(
      JSON.stringify({ toolName: 'run_sub_agentflow', args: {} }), JSON.stringify({ hostConfirmationRequirement: { goalLaunch: null } }));
    await expect(f.chat.cancelPendingContinuations('session')).rejects.toThrow();
    expect(await f.requests.getById('request')).toMatchObject({ status: 'pending', revision: 1 });
    expect(await f.repository.loadHistory('session')).toEqual([]);
    expect(f.client.prepare('SELECT status FROM chat_runs WHERE id=?').get(run!.id)).toEqual({ status: 'active' });
  });

  it('preserves ordinary unlinked confirmation cleanup without inventing a journal', async () => {
    const f = fixture(); await seed(f, false);
    await f.chat.cancelPendingContinuations('session');
    expect(await f.requests.getById('request')).toMatchObject({ status: 'cancelled' });
    expect(f.client.prepare('SELECT count(*) AS n FROM chat_runs').get()).toEqual({ n: 0 });
    expect(await f.repository.loadHistory('session')).toEqual([expect.objectContaining({ toolCallId: 'call', turnId: undefined })]);
  });

  it('leaves native and budget request rows untouched', async () => {
    const f = fixture();
    for (const kind of ['raapp_native', 'tool_budget'] as const) {
      await f.requests.create({ id: kind, kind, sessionId: 'session', payload: {} });
    }
    await f.chat.cancelPendingContinuations('session');
    expect((await f.requests.listPending('session')).map(row => row.id).sort()).toEqual(['raapp_native', 'tool_budget']);
    expect(await f.repository.loadHistory('session')).toEqual([]);
  });

  it('does not interrupt an unrelated journal when the ordinary request has neither run nor turn', async () => {
    const f = fixture(); await seed(f, false);
    const unrelated = await f.journal.startRun({ sessionId: 'session', turnId: 'unrelated' });
    await f.chat.cancelPendingContinuations('session');
    expect(await f.requests.getById('request')).toMatchObject({ status: 'cancelled' });
    expect(f.client.prepare('SELECT status,revision FROM chat_runs WHERE id=?').get(unrelated.id))
      .toEqual({ status: 'active', revision: 1 });
  });

  it('rejects a journal revision changing after the consumer read without partial cancellation', async () => {
    const f = fixture(); const run = await seed(f); const read = f.journal.getTurn.bind(f.journal);
    vi.spyOn(f.journal, 'getTurn').mockImplementation(async (...args) => {
      const snapshot = await read(...args);
      f.client.prepare('UPDATE chat_runs SET revision=revision+1 WHERE id=?').run(run!.id);
      return snapshot;
    });
    await expect(f.chat.cancelPendingContinuations('session')).rejects.toThrow('ORDINARY_CANCELLATION_CONFLICT');
    expect(await f.requests.getById('request')).toMatchObject({ status: 'pending', revision: 1 });
    expect(await f.repository.loadHistory('session')).toEqual([]);
    expect(f.client.prepare('SELECT status,revision FROM chat_runs WHERE id=?').get(run!.id))
      .toEqual({ status: 'active', revision: 2 });
  });

  it.each(['run_id', 'turn_id'])('rejects a partially linked request in the actual consumer: %s', column => {
    const f = fixture(); return seed(f).then(async run => {
      f.client.exec(`UPDATE hitl_requests SET ${column}=NULL`);
      await expect(f.chat.cancelPendingContinuations('session')).rejects.toThrow('ORDINARY_CANCELLATION_CONFLICT');
      expect(await f.requests.getById('request')).toMatchObject({ status: 'pending', revision: 1 });
      expect(await f.repository.loadHistory('session')).toEqual([]);
      expect(f.client.prepare('SELECT status FROM chat_runs WHERE id=?').get(run!.id)).toEqual({ status: 'active' });
    });
  });
});

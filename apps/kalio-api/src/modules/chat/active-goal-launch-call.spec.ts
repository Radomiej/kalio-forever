import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as schema from '../../database/schema';
import { readActiveLaunchCallExact } from './active-goal-launch-call';

const clients: Database.Database[] = [];
afterEach(() => clients.splice(0).forEach(client => client.close()));
const locator = { runId: 'run', sessionId: 'session', turnId: 'turn', promptMessageId: 'prompt',
  assistantMessageId: 'assistant', callId: 'call', expectedRevision: 3, actualArgs: { goal: 'Żółć 😀', flowId: 'flow' } };
function fixture() {
  const client = new Database(':memory:'); clients.push(client);
  client.exec(`CREATE TABLE chat_runs (id TEXT PRIMARY KEY, session_id TEXT, turn_id TEXT, revision INTEGER,
    status TEXT, phase TEXT, started_at INTEGER, updated_at INTEGER, last_heartbeat_at INTEGER, completed_at INTEGER);
    CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT, turn_id TEXT, prompt_message_id TEXT,
    role TEXT, tool_calls TEXT, created_at INTEGER);
    INSERT INTO chat_runs VALUES ('run','session','turn',3,'active','tool_running',100,200,200,NULL);
    INSERT INTO messages VALUES ('prompt','session','turn',NULL,'user',NULL,100);`);
  client.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?)').run('assistant', 'session', 'turn', 'prompt', 'assistant',
    JSON.stringify([{ id: 'call', name: 'run_sub_agentflow', args: locator.actualArgs }]), 150);
  return { client, db: drizzle(client, { schema }) };
}
it('reads the exact persisted active call without dispatch authority claims', async () => {
  const { db } = fixture();
  expect(await readActiveLaunchCallExact(db, locator)).toMatchObject({ runId: 'run', revision: 3,
    status: 'active', phase: 'tool_running', call: { id: 'call', name: 'run_sub_agentflow', args: locator.actualArgs } });
});
it.each(['runId', 'sessionId', 'turnId', 'promptMessageId', 'assistantMessageId', 'callId', 'expectedRevision'])('does not substitute mismatched %s', async key => {
  const { db } = fixture();
  expect(await readActiveLaunchCallExact(db, { ...locator, [key]: key === 'expectedRevision' ? 4 : 'foreign' })).toBeNull();
});
it('matches nested args irrespective of object insertion order but preserves array order', async () => {
  const { db, client } = fixture();
  client.prepare("UPDATE messages SET tool_calls=? WHERE id='assistant'").run(JSON.stringify([
    { id: 'call', name: 'run_sub_agentflow', args: { nested: { z: 1, a: 2 }, items: [2, 1] } },
  ]));
  expect(await readActiveLaunchCallExact(db, { ...locator, actualArgs: { items: [2, 1], nested: { a: 2, z: 1 } } })).not.toBeNull();
  expect(await readActiveLaunchCallExact(db, { ...locator, actualArgs: { items: [1, 2], nested: { a: 2, z: 1 } } })).toBeNull();
});
it.each(['queued', 'waiting_for_human', 'completed', 'failed', 'cancelled', 'interrupted', 'interrupted_needs_retry'])('rejects nonactive %s', async status => {
  const { db, client } = fixture(); client.prepare('UPDATE chat_runs SET status=?').run(status);
  expect(await readActiveLaunchCallExact(db, locator)).toBeNull();
});
it.each(['queued', 'started', 'llm_streaming', 'tool_pending', 'completed', 'interrupted', 'failed'])('rejects phase %s', async phase => {
  const { db, client } = fixture(); client.prepare('UPDATE chat_runs SET phase=?').run(phase);
  expect(await readActiveLaunchCallExact(db, locator)).toBeNull();
});
it.each(['turn_id', 'prompt_message_id', 'session_id', 'role'])('rejects assistant linkage mismatch %s', async field => {
  const { db, client } = fixture(); client.exec(`UPDATE messages SET ${field}='foreign' WHERE id='assistant'`);
  expect(await readActiveLaunchCallExact(db, locator)).toBeNull();
});
it.each(['turn_id', 'session_id', 'role'])('rejects prompt linkage mismatch %s', async field => {
  const { db, client } = fixture(); client.exec(`UPDATE messages SET ${field}='foreign' WHERE id='prompt'`);
  expect(await readActiveLaunchCallExact(db, locator)).toBeNull();
});
it.each(['turn_id', 'prompt_message_id'])('rejects legacy null assistant %s', async field => {
  const { db, client } = fixture(); client.exec(`UPDATE messages SET ${field}=NULL WHERE id='assistant'`);
  expect(await readActiveLaunchCallExact(db, locator)).toBeNull();
});
it('rejects duplicate call IDs in the same message or another exact-scope assistant', async () => {
  for (const sameMessage of [true, false]) {
    const { db, client } = fixture(); const call = { id: 'call', name: 'run_sub_agentflow', args: locator.actualArgs };
    if (sameMessage) client.prepare("UPDATE messages SET tool_calls=? WHERE id='assistant'").run(JSON.stringify([call, call]));
    else client.exec("INSERT INTO messages SELECT 'duplicate',session_id,turn_id,prompt_message_id,role,tool_calls,created_at FROM messages WHERE id='assistant'");
    await expect(readActiveLaunchCallExact(db, locator)).rejects.toThrow(/^ACTIVE_GOAL_LAUNCH_AMBIGUOUS$/);
  }
});
it('does not count foreign prompt or turn calls and never selects a newer journal', async () => {
  const { db, client } = fixture();
  client.exec("INSERT INTO messages SELECT 'foreign',session_id,'other',prompt_message_id,role,tool_calls,created_at FROM messages WHERE id='assistant'; INSERT INTO chat_runs SELECT 'newer',session_id,turn_id,4,status,phase,started_at,999,999,NULL FROM chat_runs");
  expect(await readActiveLaunchCallExact(db, locator)).toMatchObject({ runId: 'run', revision: 3 });
});
it.each(['{', '{}', '[null]', '[{"id":"call","name":"run_sub_agentflow","args":[]}]', '[{"id":"call","name":"run_sub_agentflow","args":{},"extra":1}]', '[{"id":"call","name":"run_sub_agentflow","args":{"x":1e999}}]'])('fails closed for malformed call JSON %s', async raw => {
  const { db, client } = fixture(); client.prepare("UPDATE messages SET tool_calls=? WHERE id='assistant'").run(raw);
  await expect(readActiveLaunchCallExact(db, locator)).rejects.toThrow(/^ACTIVE_GOAL_LAUNCH_CORRUPT$/);
});
it('rejects undecodable stored UTF8', async () => {
  const { db, client } = fixture(); client.exec("UPDATE messages SET tool_calls=CAST(X'FF' AS TEXT) WHERE id='assistant'");
  await expect(readActiveLaunchCallExact(db, locator)).rejects.toThrow(/^ACTIVE_GOAL_LAUNCH_CORRUPT$/);
});
it.each([0, -1, 1.5, 8640000000000001])('rejects corrupt timestamps %s', async value => {
  const { db, client } = fixture(); client.prepare("UPDATE messages SET created_at=? WHERE id='assistant'").run(value);
  await expect(readActiveLaunchCallExact(db, locator)).rejects.toThrow(/^ACTIVE_GOAL_LAUNCH_CORRUPT$/);
});
it('rejects terminal timestamp and wrong tool without elevating either', async () => {
  const { db, client } = fixture(); client.exec('UPDATE chat_runs SET completed_at=300');
  expect(await readActiveLaunchCallExact(db, locator)).toBeNull();
  client.exec('UPDATE chat_runs SET completed_at=NULL');
  client.prepare("UPDATE messages SET tool_calls=? WHERE id='assistant'").run(JSON.stringify([{ id: 'call', name: 'terminal_spawn', args: locator.actualArgs }]));
  expect(await readActiveLaunchCallExact(db, locator)).toBeNull();
});
it('rejects locator/args getters without invoking them', async () => {
  const { db } = fixture(); const getter = vi.fn(() => { throw new Error('secret'); });
  await expect(readActiveLaunchCallExact(db, Object.defineProperty({ ...locator }, 'runId', { get: getter }))).rejects.toThrow(/^ACTIVE_GOAL_LAUNCH_INVALID$/);
  await expect(readActiveLaunchCallExact(db, { ...locator, actualArgs: Object.defineProperty({}, 'goal', { get: getter, enumerable: true }) })).rejects.toThrow(/^ACTIVE_GOAL_LAUNCH_INVALID$/);
  expect(getter).not.toHaveBeenCalled();
});
it.each([0, -1, 1.5, NaN])('rejects invalid revision %s', async expectedRevision => {
  await expect(readActiveLaunchCallExact(fixture().db, { ...locator, expectedRevision })).rejects.toThrow(/^ACTIVE_GOAL_LAUNCH_INVALID$/);
});
it('sanitizes custom abort reason and driver failure', async () => {
  const { db, client } = fixture(); const controller = new AbortController(); controller.abort(new Error('secret'));
  await expect(readActiveLaunchCallExact(db, locator, controller.signal)).rejects.toThrow(/^ACTIVE_GOAL_LAUNCH_ABORTED$/);
  client.exec('DROP TABLE messages');
  await expect(readActiveLaunchCallExact(db, locator)).rejects.toThrow(/^ACTIVE_GOAL_LAUNCH_STORAGE_ERROR$/);
});
it('rejects an abort after a SQLite read and closes the transaction', async () => {
  const { db, client } = fixture(); const controller = new AbortController();
  client.function('stop_read', () => { controller.abort('secret'); return 150; });
  client.exec("ALTER TABLE messages RENAME TO stored_messages; CREATE VIEW messages AS SELECT id,session_id,turn_id,prompt_message_id,role,tool_calls,stop_read() AS created_at FROM stored_messages");
  await expect(readActiveLaunchCallExact(db, locator, controller.signal)).rejects.toThrow(/^ACTIVE_GOAL_LAUNCH_ABORTED$/);
  expect(client.inTransaction).toBe(false);
});
it('hashes exact persisted UTF8 rather than canonicalized args and returns detached data', async () => {
  const { db, client } = fixture();
  const raw = ' [ { "id":"call", "name":"run_sub_agentflow", "args":{"flowId":"flow","goal":"Żółć 😀"} } ] ';
  client.prepare("UPDATE messages SET tool_calls=? WHERE id='assistant'").run(raw);
  const result = await readActiveLaunchCallExact(db, locator);
  expect(result).toMatchObject({ toolCallsSha256: createHash('sha256').update(Buffer.from(raw, 'utf8')).digest('hex'),
    toolCallsUtf8Bytes: Buffer.byteLength(raw, 'utf8'), startedAt: 100, updatedAt: 200, lastHeartbeatAt: 200,
    promptCreatedAt: 100, assistantCreatedAt: 150 });
  expect(result?.call.args).not.toBe(locator.actualArgs);
  expect(Object.isFrozen(result?.call.args)).toBe(true);
});
it.each(['started_at', 'updated_at', 'last_heartbeat_at'])('rejects invalid raw journal %s', async column => {
  const { db, client } = fixture(); client.exec(`UPDATE chat_runs SET ${column}=1.5`);
  await expect(readActiveLaunchCallExact(db, locator)).rejects.toThrow(/^ACTIVE_GOAL_LAUNCH_CORRUPT$/);
});
it.each(['phase', 'status'])('rejects unknown journal enum %s', async column => {
  const { db, client } = fixture(); client.exec(`UPDATE chat_runs SET ${column}='unknown'`);
  await expect(readActiveLaunchCallExact(db, locator)).rejects.toThrow(/^ACTIVE_GOAL_LAUNCH_CORRUPT$/);
});
it('rejects proxies, unknown locator fields, undefined args and cyclic args statically', async () => {
  const { db } = fixture(); const getter = vi.fn();
  const proxy = new Proxy(locator, { get: getter });
  await expect(readActiveLaunchCallExact(db, proxy)).rejects.toThrow(/^ACTIVE_GOAL_LAUNCH_INVALID$/);
  expect(getter).not.toHaveBeenCalled();
  await expect(readActiveLaunchCallExact(db, { ...locator, extra: true } as typeof locator)).rejects.toThrow(/^ACTIVE_GOAL_LAUNCH_INVALID$/);
  await expect(readActiveLaunchCallExact(db, { ...locator, actualArgs: { goal: undefined } })).rejects.toThrow(/^ACTIVE_GOAL_LAUNCH_INVALID$/);
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  await expect(readActiveLaunchCallExact(db, { ...locator, actualArgs: cyclic })).rejects.toThrow(/^ACTIVE_GOAL_LAUNCH_INVALID$/);
});
it('returns null for absent records without inserting or reconstructing rows', async () => {
  const { db, client } = fixture(); client.exec("DELETE FROM messages WHERE id='prompt'");
  expect(await readActiveLaunchCallExact(db, locator)).toBeNull();
  expect(client.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 1 });
});

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from './schema';
import { commitOrdinaryContinuationCancellationBatch, type OrdinaryCancellationBatchInput } from './ordinary-continuation-cancellation';

type SingleFixtureInput = OrdinaryCancellationBatchInput['requests'][number] & { sessionId: string };
// Keep the original 43 single-row regressions, now exercising a real one-item batch.
function commitOrdinaryContinuationCancellation(db: Parameters<typeof commitOrdinaryContinuationCancellationBatch>[0], input: SingleFixtureInput) {
  const { sessionId, ...request } = input;
  return commitOrdinaryContinuationCancellationBatch(db, { sessionId, requests: [request], expectedRunWithoutConfirmations: null });
}

const clients: Database.Database[] = [];
afterEach(() => clients.splice(0).forEach(client => client.close()));
const content = '{"status":"cancelled","errorMessage":"Turn interrupted by user"}';
function fixture() {
  const client = new Database(':memory:'); clients.push(client); client.pragma('foreign_keys = ON');
  const db = drizzle(client, { schema }); migrate(db, { migrationsFolder: resolve(__dirname, 'migrations') });
  client.exec(`INSERT INTO personas(id,name,model,created_at,updated_at) VALUES ('persona','test','mock',1,1);
    INSERT INTO sessions(id,persona_id,created_at,updated_at) VALUES ('session','persona',1,1);
    INSERT INTO chat_runs(id,session_id,turn_id,phase,status,revision,started_at,updated_at,last_heartbeat_at)
      VALUES ('run','session','turn','tool_running','waiting_for_human',7,1,1,1);`);
  client.prepare(`INSERT INTO hitl_requests(id,kind,session_id,turn_id,run_id,tool_call_id,payload,continuation,revision,created_at,updated_at)
    VALUES ('request','tool_confirmation','session','turn','run','call',?,?,3,1,1)`).run(
    JSON.stringify({ toolName: 'fs_write', args: { path: 'file' } }),
    JSON.stringify({ sessionId: 'session', turnId: 'turn', runId: 'run', promptMessageId: 'prompt', executionState: 'pending' }));
  const input: SingleFixtureInput = { requestId: 'request', sessionId: 'session', expectedRequestRevision: 3,
    expectedRun: { id: 'run', turnId: 'turn', revision: 7 }, serializedToolResult: content };
  const state = () => ({ request: client.prepare('SELECT * FROM hitl_requests').all(),
    runs: client.prepare('SELECT * FROM chat_runs').all(), messages: client.prepare('SELECT * FROM messages').all() });
  return { client, db, input, state };
}
function batch(f: ReturnType<typeof fixture>): OrdinaryCancellationBatchInput {
  const { sessionId, ...request } = f.input;
  return { sessionId, requests: [request], expectedRunWithoutConfirmations: null };
}
function secondRequest(f: ReturnType<typeof fixture>) {
  f.client.exec(`INSERT INTO hitl_requests(id,kind,session_id,turn_id,run_id,tool_call_id,payload,continuation,revision,created_at,updated_at)
    SELECT 'request-2',kind,session_id,turn_id,run_id,'call-2',payload,continuation,revision,created_at,updated_at
    FROM hitl_requests WHERE id='request'`);
  const selected = batch(f);
  return { ...selected, requests: [...selected.requests, { ...selected.requests[0]!, requestId: 'request-2' }] };
}

describe('pending-only ordinary cancellation transaction (actual migrations)', () => {
  it('commits all three destinations and rejects every cancelled-row retry', () => {
    const f = fixture(); expect(commitOrdinaryContinuationCancellation(f.db, f.input)).toBe('committed');
    expect(f.client.prepare('SELECT status,revision,outcome FROM hitl_requests').get())
      .toEqual({ status: 'cancelled', revision: 4, outcome: '{"message":"Turn interrupted by user"}' });
    expect(f.client.prepare('SELECT role,session_id,tool_call_id,turn_id,prompt_message_id,content FROM messages').get())
      .toEqual({ role: 'tool_result', session_id: 'session', tool_call_id: 'call', turn_id: 'turn', prompt_message_id: 'prompt', content });
    expect(f.client.prepare('SELECT status,phase,revision,safe_resume,error_code FROM chat_runs').get())
      .toEqual({ status: 'interrupted', phase: 'interrupted', revision: 8, safe_resume: 0, error_code: 'INTERRUPTED' });
    const before = f.state();
    expect(commitOrdinaryContinuationCancellation(f.db, f.input)).toBe('conflict'); expect(f.state()).toEqual(before);
  });
  it('rolls back cancellation and result if the journal write fails', () => {
    const f = fixture(); const before = f.state();
    f.client.exec("CREATE TRIGGER fail_journal BEFORE UPDATE ON chat_runs BEGIN SELECT RAISE(ABORT,'private journal failure'); END");
    expect(() => commitOrdinaryContinuationCancellation(f.db, f.input)).toThrow('ORDINARY_CANCELLATION_STORAGE_FAILED');
    expect(f.state()).toEqual(before);
    f.client.exec('DROP TRIGGER fail_journal');
    expect(commitOrdinaryContinuationCancellation(f.db, f.input)).toBe('committed');
  });
  it.each([
    { sessionId: 'foreign' }, { expectedRequestRevision: 2 }, { expectedRequestRevision: 0 },
    { expectedRun: null }, { expectedRun: { id: 'foreign', turnId: 'turn', revision: 7 } },
    { expectedRun: { id: 'run', turnId: 'foreign', revision: 7 } },
    { expectedRun: { id: 'run', turnId: 'turn', revision: 6 } },
    { serializedToolResult: null }, { serializedToolResult: '{"status":"success"}' },
    { serializedToolResult: '{"status":"cancelled","errorMessage":"foreign"}' },
  ])('rejects stale scope/revision or forged result without changing destinations: %j', patch => {
    const f = fixture(); const before = f.state();
    expect(commitOrdinaryContinuationCancellation(f.db, { ...f.input, ...patch })).toBe('conflict');
    expect(f.state()).toEqual(before);
  });
  it.each(['completed', 'failed', 'cancelled', 'interrupted', 'queued'])('never overwrites journal status %s', status => {
    const f = fixture(); f.client.prepare('UPDATE chat_runs SET status=?').run(status); const before = f.state();
    expect(commitOrdinaryContinuationCancellation(f.db, f.input)).toBe('conflict'); expect(f.state()).toEqual(before);
  });
  it.each(['active', 'waiting_for_human', 'interrupted_needs_retry'])('interrupts only the eligible current journal %s', status => {
    const f = fixture(); f.client.prepare('UPDATE chat_runs SET status=?').run(status);
    expect(commitOrdinaryContinuationCancellation(f.db, f.input)).toBe('committed');
  });
  it('rejects a superseded admitted turn but does not treat a merely queued turn as admitted', () => {
    const f = fixture(); f.client.exec(`INSERT INTO chat_runs(id,session_id,turn_id,phase,status,revision,started_at,updated_at,last_heartbeat_at,queued_at)
      VALUES ('newer','session','new-turn','queued','queued',1,2,2,2,2)`);
    expect(commitOrdinaryContinuationCancellation(f.db, f.input)).toBe('committed');
    const g = fixture(); g.client.exec(`INSERT INTO chat_runs(id,session_id,turn_id,phase,status,revision,started_at,updated_at,last_heartbeat_at)
      VALUES ('newer','session','new-turn','started','active',1,2,2,2)`); const before = g.state();
    expect(commitOrdinaryContinuationCancellation(g.db, g.input)).toBe('conflict'); expect(g.state()).toEqual(before);
  });
  it.each(['run_id', 'turn_id'])('rejects partial journal linkage: %s', column => {
    const f = fixture(); f.client.exec(`UPDATE hitl_requests SET ${column}=NULL`); const before = f.state();
    expect(commitOrdinaryContinuationCancellation(f.db, f.input)).toBe('conflict'); expect(f.state()).toEqual(before);
  });
  it.each(['sessionId', 'runId', 'turnId'])('rejects contradictory persisted source field %s', field => {
    const f = fixture(); f.client.prepare('UPDATE hitl_requests SET continuation=?').run(JSON.stringify({
      sessionId: 'session', runId: 'run', turnId: 'turn', [field]: 'foreign' })); const before = f.state();
    expect(commitOrdinaryContinuationCancellation(f.db, f.input)).toBe('conflict'); expect(f.state()).toEqual(before);
  });
  it('cancels an ordinary unlinked request, with nullable source fields and no journal writes', () => {
    const f = fixture(); f.client.exec('UPDATE hitl_requests SET run_id=NULL,turn_id=NULL,continuation=NULL');
    const before = f.client.prepare('SELECT * FROM chat_runs').all();
    expect(commitOrdinaryContinuationCancellation(f.db, { ...f.input, expectedRun: null })).toBe('committed');
    expect(f.client.prepare('SELECT turn_id,prompt_message_id FROM messages').get()).toEqual({ turn_id: null, prompt_message_id: null });
    expect(f.client.prepare('SELECT * FROM chat_runs').all()).toEqual(before);
  });
  it.each(['tool_call_id', 'payload'])('keeps missing %s legacy cancellation-only, without fabricating a result', column => {
    const f = fixture(); f.client.exec(column === 'tool_call_id' ? 'UPDATE hitl_requests SET tool_call_id=NULL' : "UPDATE hitl_requests SET payload='{}'");
    expect(commitOrdinaryContinuationCancellation(f.db, { ...f.input, serializedToolResult: null })).toBe('committed');
    expect(f.client.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 0 });
  });
  it.each([
    { toolName: 'run_sub_agentflow', goalLaunch: null }, { toolName: 'run_sub_agentflow', goalLaunch: { schemaVersion: 999 } },
    { toolName: 'foreign', goalLaunch: [] },
  ])('rejects protected and malformed family markers before any mutation: %j', marker => {
    const f = fixture(); f.client.prepare('UPDATE hitl_requests SET continuation=?').run(JSON.stringify({ hostConfirmationRequirement: marker }));
    const before = f.state(); expect(commitOrdinaryContinuationCancellation(f.db, f.input)).toBe('conflict'); expect(f.state()).toEqual(before);
  });
  it.each(['raapp_native', 'tool_budget'])('never cancels non-tool-confirmation kind %s', kind => {
    const f = fixture(); f.client.prepare('UPDATE hitl_requests SET kind=?').run(kind); const before = f.state();
    expect(commitOrdinaryContinuationCancellation(f.db, f.input)).toBe('conflict'); expect(f.state()).toEqual(before);
  });
  it.each([content, '{"status":"success"}'])('rejects an existing result even if cancellation bytes happen to match', existing => {
    const f = fixture(); f.client.prepare("INSERT INTO messages(id,session_id,role,content,tool_call_id,created_at) VALUES ('other','session','tool_result',?,'call',2)")
      .run(existing); const before = f.state();
    expect(commitOrdinaryContinuationCancellation(f.db, f.input)).toBe('conflict'); expect(f.state()).toEqual(before);
    expect(() => f.client.exec("INSERT INTO messages(id,session_id,role,content,tool_call_id,created_at) VALUES ('duplicate','session','tool_result','', 'call',3)"))
      .toThrow('UNIQUE constraint failed');
  });
  it('rolls back the request and message when a journal CAS loses inside the transaction', () => {
    const f = fixture(); const before = f.state();
    f.client.exec(`CREATE TRIGGER move_journal AFTER UPDATE ON hitl_requests WHEN NEW.status='cancelled'
      BEGIN UPDATE chat_runs SET revision=revision+1 WHERE id='run'; END`);
    expect(commitOrdinaryContinuationCancellation(f.db, f.input)).toBe('conflict');
    expect(f.state()).toEqual(before);
  });
  it.each([
    "CREATE TRIGGER corrupt_request AFTER UPDATE ON hitl_requests BEGIN UPDATE hitl_requests SET payload='{}' WHERE id=NEW.id; END",
    "CREATE TRIGGER corrupt_message AFTER INSERT ON messages BEGIN UPDATE messages SET prompt_message_id='foreign' WHERE id=NEW.id; END",
    "CREATE TRIGGER corrupt_run AFTER UPDATE ON chat_runs BEGIN UPDATE chat_runs SET turn_id='foreign' WHERE id=NEW.id; END",
  ])('requires complete readback and rolls back corrupt destination writes', trigger => {
    const f = fixture(); const before = f.state(); f.client.exec(trigger);
    expect(() => commitOrdinaryContinuationCancellation(f.db, f.input)).toThrow('ORDINARY_CANCELLATION_STORAGE_FAILED');
    expect(f.state()).toEqual(before);
  });
  it.each(['approved', 'denied', 'cancelled'])('never treats already-resolved status %s as proof', status => {
    const f = fixture(); f.client.prepare('UPDATE hitl_requests SET status=?').run(status); const before = f.state();
    expect(commitOrdinaryContinuationCancellation(f.db, f.input)).toBe('conflict'); expect(f.state()).toEqual(before);
  });

  it('deduplicates one exact journal for two requests and accepts selector order independent of row order', () => {
    const f = fixture(); const input = secondRequest(f); input.requests.reverse();
    expect(commitOrdinaryContinuationCancellationBatch(f.db, input)).toBe('committed');
    expect(f.client.prepare('SELECT revision,status FROM chat_runs').get()).toEqual({ revision: 8, status: 'interrupted' });
    expect(f.client.prepare('SELECT status,revision FROM hitl_requests ORDER BY id').all())
      .toEqual([{ status: 'cancelled', revision: 4 }, { status: 'cancelled', revision: 4 }]);
    expect(f.client.prepare('SELECT tool_call_id FROM messages ORDER BY tool_call_id').all())
      .toEqual([{ tool_call_id: 'call' }, { tool_call_id: 'call-2' }]);
  });
  it('rejects inconsistent snapshots of the same journal before any writes', () => {
    const f = fixture(); const selected = secondRequest(f);
    selected.requests[1] = { ...selected.requests[1]!, expectedRun: { id: 'run', turnId: 'turn', revision: 8 } };
    const before = f.state();
    expect(commitOrdinaryContinuationCancellationBatch(f.db, selected)).toBe('conflict'); expect(f.state()).toEqual(before);
  });
  it.each(['subset', 'duplicate', 'disappeared', 'foreign'])('requires exact complete session pending membership: %s', mutation => {
    const f = fixture(); let selected: OrdinaryCancellationBatchInput = secondRequest(f);
    if (mutation === 'subset') selected = batch(f);
    if (mutation === 'duplicate') selected = { ...selected, requests: [selected.requests[0]!, selected.requests[0]!] };
    if (mutation === 'disappeared') f.client.exec("UPDATE hitl_requests SET status='denied' WHERE id='request-2'");
    if (mutation === 'foreign') f.client.exec("UPDATE hitl_requests SET session_id='foreign' WHERE id='request-2'");
    const before = f.state();
    expect(commitOrdinaryContinuationCancellationBatch(f.db, selected)).toBe('conflict'); expect(f.state()).toEqual(before);
  });
  it('rejects a second-request collision before committing any first-request result', () => {
    const f = fixture(); const selected = secondRequest(f);
    f.client.exec("INSERT INTO messages(id,session_id,role,content,tool_call_id,created_at) VALUES ('actual','session','tool_result','success','call-2',2)");
    const before = f.state();
    expect(commitOrdinaryContinuationCancellationBatch(f.db, selected)).toBe('conflict'); expect(f.state()).toEqual(before);
  });
  it('guards deterministic message ID collisions without changing an unrelated existing message', () => {
    const first = fixture(); expect(commitOrdinaryContinuationCancellationBatch(first.db, batch(first))).toBe('committed');
    const message = first.client.prepare('SELECT id FROM messages').get() as { id: string };
    const f = fixture(); f.client.prepare("INSERT INTO messages(id,session_id,role,content,tool_call_id,created_at) VALUES (?,'session','tool_result','unrelated','other-call',2)")
      .run(message.id); const before = f.state();
    expect(commitOrdinaryContinuationCancellationBatch(f.db, batch(f))).toBe('conflict'); expect(f.state()).toEqual(before);
  });
  it('rejects duplicate call sources rather than relying on a late UNIQUE error', () => {
    const f = fixture(); const selected = secondRequest(f);
    f.client.exec("UPDATE hitl_requests SET tool_call_id='call' WHERE id='request-2'"); const before = f.state();
    expect(commitOrdinaryContinuationCancellationBatch(f.db, selected)).toBe('conflict'); expect(f.state()).toEqual(before);
  });
  it('checks earlier destinations after later writes, rolling back cross-request readback corruption', () => {
    const f = fixture(); const selected = secondRequest(f); const before = f.state();
    f.client.exec(`CREATE TRIGGER corrupt_first_message AFTER INSERT ON messages WHEN NEW.tool_call_id='call-2'
      BEGIN UPDATE messages SET prompt_message_id='foreign' WHERE tool_call_id='call'; END`);
    expect(() => commitOrdinaryContinuationCancellationBatch(f.db, selected)).toThrow('ORDINARY_CANCELLATION_STORAGE_FAILED');
    expect(f.state()).toEqual(before);
  });
  it('keeps ordinary/foreign native and budget rows outside the complete toolset unchanged', () => {
    const f = fixture(); const selected = secondRequest(f);
    f.client.exec(`INSERT INTO hitl_requests(id,kind,session_id,payload,created_at,updated_at) VALUES
      ('native','raapp_native','session','{}',1,1),('budget','tool_budget','session','{}',1,1),
      ('foreign-tool','tool_confirmation','foreign','{}',1,1)`);
    const before = f.client.prepare("SELECT * FROM hitl_requests WHERE id IN ('native','budget','foreign-tool') ORDER BY id").all();
    expect(commitOrdinaryContinuationCancellationBatch(f.db, selected)).toBe('committed');
    expect(f.client.prepare("SELECT * FROM hitl_requests WHERE id IN ('native','budget','foreign-tool') ORDER BY id").all()).toEqual(before);
  });
  it('requires an empty fallback journal only when the exact pending toolset is empty', () => {
    const f = fixture(); const before = f.state();
    const selected: OrdinaryCancellationBatchInput = { sessionId: 'session', requests: [], expectedRunWithoutConfirmations: f.input.expectedRun };
    expect(commitOrdinaryContinuationCancellationBatch(f.db, selected)).toBe('conflict'); expect(f.state()).toEqual(before);
    expect(commitOrdinaryContinuationCancellationBatch(f.db, { ...batch(f), expectedRunWithoutConfirmations: f.input.expectedRun })).toBe('conflict');
    expect(f.state()).toEqual(before);
  });
  it('preserves native/budget requests while atomically interrupting an explicit empty-toolset journal', () => {
    const f = fixture(); f.client.exec(`UPDATE hitl_requests SET kind='raapp_native';
      INSERT INTO hitl_requests(id,kind,session_id,payload,created_at,updated_at) VALUES ('budget','tool_budget','session','{}',1,1)`);
    const before = f.client.prepare('SELECT * FROM hitl_requests ORDER BY id').all();
    expect(commitOrdinaryContinuationCancellationBatch(f.db, { sessionId: 'session', requests: [], expectedRunWithoutConfirmations: f.input.expectedRun }))
      .toBe('committed');
    expect(f.client.prepare('SELECT * FROM hitl_requests ORDER BY id').all()).toEqual(before);
    expect(f.client.prepare('SELECT status,revision FROM chat_runs').get()).toEqual({ status: 'interrupted', revision: 8 });
    expect(f.client.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 0 });
  });
  it.each([
    { id: 'missing', turnId: 'turn', revision: 7 }, { id: 'run', turnId: 'foreign', revision: 7 },
    { id: 'run', turnId: 'turn', revision: 6 },
  ])('rejects mismatched empty-toolset journal snapshots: %j', pick => {
    const f = fixture(); f.client.exec('DELETE FROM hitl_requests'); const before = f.state();
    expect(commitOrdinaryContinuationCancellationBatch(f.db, { sessionId: 'session', requests: [], expectedRunWithoutConfirmations: pick }))
      .toBe('conflict'); expect(f.state()).toEqual(before);
  });
  it.each(['completed', 'failed', 'cancelled', 'interrupted', 'queued'])('never accepts empty-toolset journal status %s as retry proof', status => {
    const f = fixture(); f.client.exec('DELETE FROM hitl_requests'); f.client.prepare('UPDATE chat_runs SET status=?').run(status);
    const before = f.state();
    expect(commitOrdinaryContinuationCancellationBatch(f.db, { sessionId: 'session', requests: [], expectedRunWithoutConfirmations: f.input.expectedRun }))
      .toBe('conflict'); expect(f.state()).toEqual(before);
  });
  it('does not infer an empty-toolset journal when the explicit snapshot is absent', () => {
    const f = fixture(); f.client.exec('DELETE FROM hitl_requests'); const before = f.state();
    expect(commitOrdinaryContinuationCancellationBatch(f.db, { sessionId: 'session', requests: [] })).toBe('committed');
    expect(f.state()).toEqual(before);
  });
  it('rejects an empty-toolset journal superseded by newer actual admission regardless of updated_at', () => {
    const f = fixture(); f.client.exec(`DELETE FROM hitl_requests;
      UPDATE chat_runs SET updated_at=999999;
      INSERT INTO chat_runs(id,session_id,turn_id,phase,status,revision,started_at,updated_at,last_heartbeat_at)
      VALUES ('newer','session','new-turn','started','active',1,2,2,2)`); const before = f.state();
    expect(commitOrdinaryContinuationCancellationBatch(f.db, { sessionId: 'session', requests: [], expectedRunWithoutConfirmations: f.input.expectedRun }))
      .toBe('conflict'); expect(f.state()).toEqual(before);
  });
  it('rejects a fallback journal owned by a foreign session', () => {
    const f = fixture(); f.client.exec("DELETE FROM hitl_requests; UPDATE chat_runs SET session_id='foreign'"); const before = f.state();
    expect(commitOrdinaryContinuationCancellationBatch(f.db, { sessionId: 'session', requests: [], expectedRunWithoutConfirmations: f.input.expectedRun }))
      .toBe('conflict'); expect(f.state()).toEqual(before);
  });
  it('requires empty-toolset journal readback and rolls back failures', () => {
    const f = fixture(); f.client.exec(`DELETE FROM hitl_requests;
      CREATE TRIGGER corrupt_empty_run AFTER UPDATE ON chat_runs BEGIN UPDATE chat_runs SET turn_id='foreign' WHERE id=NEW.id; END`);
    const before = f.state();
    expect(() => commitOrdinaryContinuationCancellationBatch(f.db, { sessionId: 'session', requests: [], expectedRunWithoutConfirmations: f.input.expectedRun }))
      .toThrow('ORDINARY_CANCELLATION_STORAGE_FAILED'); expect(f.state()).toEqual(before);
  });
  it('rolls back a fallback journal when a new tool wait appears during its write', () => {
    const f = fixture(); f.client.exec(`DELETE FROM hitl_requests;
      CREATE TRIGGER new_wait AFTER UPDATE ON chat_runs BEGIN
        INSERT INTO hitl_requests(id,kind,session_id,payload,created_at,updated_at) VALUES ('new','tool_confirmation','session','{}',1,1); END`);
    const before = f.state();
    expect(commitOrdinaryContinuationCancellationBatch(f.db, { sessionId: 'session', requests: [], expectedRunWithoutConfirmations: f.input.expectedRun }))
      .toBe('conflict'); expect(f.state()).toEqual(before);
  });
  it('rejects input getters/proxies without invoking them', () => {
    const f = fixture(); const getter = vi.fn(() => 'private'); const selected = batch(f);
    const before = f.state(); Object.defineProperty(selected.requests[0]!, 'requestId', { enumerable: true, get: getter });
    expect(commitOrdinaryContinuationCancellationBatch(f.db, selected)).toBe('conflict');
    expect(commitOrdinaryContinuationCancellationBatch(f.db, new Proxy(batch(f), { ownKeys: getter }))).toBe('conflict');
    expect(getter).not.toHaveBeenCalled(); expect(f.state()).toEqual(before);
  });
  it.each(['root', 'array-entry', 'run', 'empty-run'])('rejects %s accessors before reading them', location => {
    const f = fixture(); const selected = batch(f); const getter = vi.fn(() => { throw new Error('private accessor'); });
    if (location === 'root') Object.defineProperty(selected, 'requests', { enumerable: true, get: getter });
    if (location === 'array-entry') Object.defineProperty(selected.requests, '0', { enumerable: true, get: getter });
    if (location === 'run') Object.defineProperty(selected.requests[0]!.expectedRun!, 'revision', { enumerable: true, get: getter });
    if (location === 'empty-run') Object.defineProperty(selected, 'expectedRunWithoutConfirmations', { enumerable: true, get: getter });
    const before = f.state();
    expect(commitOrdinaryContinuationCancellationBatch(f.db, selected)).toBe('conflict');
    expect(getter).not.toHaveBeenCalled(); expect(f.state()).toEqual(before);
  });
  it.each(['proxy', 'sparse', 'extra', 'symbol', 'nonenumerable'])('rejects %s request arrays without invoking proxy traps', mutation => {
    const f = fixture(); const selected = batch(f); const trap = vi.fn(() => { throw new Error('private trap'); });
    if (mutation === 'proxy') selected.requests = new Proxy(selected.requests, { ownKeys: trap, get: trap });
    if (mutation === 'sparse') Reflect.deleteProperty(selected.requests, '0');
    if (mutation === 'extra') Object.defineProperty(selected.requests, 'extra', { enumerable: true, value: 'private' });
    if (mutation === 'symbol') Object.defineProperty(selected.requests, Symbol('extra'), { enumerable: true, value: 'private' });
    if (mutation === 'nonenumerable') Object.defineProperty(selected.requests, '0', { enumerable: false });
    const before = f.state();
    expect(commitOrdinaryContinuationCancellationBatch(f.db, selected)).toBe('conflict');
    expect(trap).not.toHaveBeenCalled(); expect(f.state()).toEqual(before);
  });
});

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as schema from '../../database/schema';
import { PersistedRuntimeEvidenceReader } from './persisted-runtime-evidence-reader';
import type { DrizzleService } from '../../database/drizzle.service';
import { createHostDispatchReceiptStore, createHostDispatchReceiptRecorder, type HostDispatchReceiptV1, type HostDispatchReceiptPorts } from './host-dispatch-receipts';

const clients: Database.Database[] = [];
const directories: string[] = [];
afterEach(() => { clients.splice(0).forEach(db => { if (db.open) db.close(); }); directories.splice(0).forEach(path => rmSync(path, { recursive: true })); });
const key = { runId: 'run', sessionId: 'session', turnId: 'turn', promptMessageId: 'prompt', callId: 'call' };
const target = { kind: 'kalio_registry' as const, catalogEntryId: 'catalog', executorImplementationId: 'terminal', executorImplementationVersion: 1, requiresConfirmation: true };
const approval = { kind: 'durable_confirmation' as const, requestId: 'hitl', claimedRevision: 3 };
const commit = { requestId: 'hitl', claimedRevision: 3, committedRevision: 4, status: 'approved' as const,
  executionState: 'tool_result_committed' as const, resultStatus: 'success' as const };
const content = '"Żółć 😀"';
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const payload: HostDispatchReceiptV1 = { version: 1, requestedName: 'terminal_spawn', canonicalName: 'terminal_spawn',
  argsSha256: hash('args snapshot'), enteredTarget: target, approval, hitlCommit: commit, registeredCommitAck: 'acknowledged',
  result: { messageId: 'result', contentSha256: hash(content), contentUtf8Bytes: Buffer.byteLength(content), status: 'success' } };

function fixture(path = ':memory:', initialize = true) {
  const client = new Database(path); clients.push(client);
  if (initialize) {
    client.exec(readFileSync(join(__dirname, '../../database/migrations/0037_host_dispatch_receipts.sql'), 'utf8'));
    client.exec('CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, turn_id TEXT, prompt_message_id TEXT, tool_call_id TEXT, created_at INTEGER NOT NULL)');
    client.exec('CREATE TABLE chat_runs (id TEXT PRIMARY KEY, session_id TEXT, turn_id TEXT, revision INTEGER)');
    client.exec("INSERT INTO chat_runs VALUES ('run', 'session', 'turn', 5); INSERT INTO messages VALUES ('prompt','session','user','secret','turn','prompt',NULL,1)");
    client.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run('result', 'session', 'tool_result', content, 'turn', 'prompt', 'call', 2);
    // Fixture adapter boundary: mimics the exact readback projection of the host HITL service.
    client.exec('CREATE TABLE fixture_hitl (id TEXT PRIMARY KEY, evidence TEXT NOT NULL)');
    client.prepare('INSERT INTO fixture_hitl VALUES (?,?)').run('hitl', JSON.stringify({ identity: { runId: key.runId, sessionId: key.sessionId,
      turnId: key.turnId, promptMessageId: key.promptMessageId }, callId: key.callId, toolName: 'terminal_spawn', approval, commit }));
  }
  const db = drizzle(client, { schema });
  const capabilities = new WeakMap<object, { key: typeof key; payload: HostDispatchReceiptV1 }>();
  const capability = {}; capabilities.set(capability, { key, payload });
  const ports: HostDispatchReceiptPorts = {
    readCapability: supplied => capabilities.get(supplied) ?? null,
    readRegisteredTargetExact: async () => ({ canonicalName: 'terminal_spawn', target }),
    readHitlExact: async () => {
      const row = client.prepare('SELECT evidence FROM fixture_hitl WHERE id = ?').get('hitl') as { evidence: string } | undefined;
      return row ? JSON.parse(row.evidence) as Awaited<ReturnType<HostDispatchReceiptPorts['readHitlExact']>> : null;
    },
    readJournalScopeExact: async () => {
      const row = client.prepare("SELECT r.revision FROM chat_runs r JOIN messages p ON p.id = ? AND p.session_id = r.session_id AND p.turn_id = r.turn_id AND p.prompt_message_id = p.id AND p.role = 'user' WHERE r.id = ? AND r.session_id = ? AND r.turn_id = ?").get(key.promptMessageId, key.runId, key.sessionId, key.turnId) as { revision: number } | undefined;
      return row ? { runId: key.runId, sessionId: key.sessionId, turnId: key.turnId, promptMessageId: key.promptMessageId, revision: row.revision } : null;
    },
    durableReader: new PersistedRuntimeEvidenceReader({ db } as unknown as DrizzleService),
  };
  return { client, capability, capabilities, ports, store: createHostDispatchReceiptStore(db, ports) };
}

describe('append-only host dispatch receipts real SQLite', () => {
  it('inserts exact secret-free bytes, verifies readback and keeps identical duplicates insert-only', async () => {
    const { store, client, capability, capabilities } = fixture();
    const first = await store.append(capability);
    expect(first.key).toEqual(key); expect(first.payload).toEqual(payload);
    expect(first.recordSha256).toBe(hash(first.recordJson));
    expect(first.recordJson).not.toContain('secret'); expect(first.recordJson).not.toContain('args snapshot');
    const secondCapability = {}; capabilities.set(secondCapability, { key, payload });
    expect(await store.append(secondCapability)).toEqual(first);
    expect(await store.readExact(key)).toEqual(first);
    expect(client.prepare('SELECT COUNT(*) AS count FROM host_dispatch_receipts').get()).toEqual({ count: 1 });
  });
  it('closes and reopens SQLite, revalidating registry, durable result and HITL', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'kalio-host-receipts-')); directories.push(directory);
    const path = join(directory, 'test.db'); const first = fixture(path);
    const written = await first.store.append(first.capability); first.client.close();
    const second = fixture(path, false);
    expect(await second.store.readExact(key)).toEqual(written);
    second.ports.readRegisteredTargetExact = async () => ({ canonicalName: 'terminal_spawn', target: { ...target, executorImplementationVersion: 2 } });
    await expect(second.store.readExact(key)).rejects.toThrow('HOST_DISPATCH_RECEIPT_AUTHORITY');
  });
  it('rejects conflicting duplicate without changing the original row', async () => {
    const { store, capability, capabilities } = fixture(); const first = await store.append(capability);
    const conflict = {}; capabilities.set(conflict, { key, payload: { ...payload, argsSha256: hash('different') } });
    await expect(store.append(conflict)).rejects.toThrow('HOST_DISPATCH_RECEIPT_CONFLICT');
    expect(await store.readExact(key)).toEqual(first);
  });
  it('rejects model/audit JSON as capability and never inserts it', async () => {
    const { store, client } = fixture();
    await expect(store.append({ key, payload })).rejects.toThrow('HOST_DISPATCH_RECEIPT_CAPABILITY');
    expect(client.prepare('SELECT COUNT(*) AS count FROM host_dispatch_receipts').get()).toEqual({ count: 0 });
  });
  it.each(['runId', 'sessionId', 'turnId', 'promptMessageId', 'callId'])('requires exact key %s with no latest fallback', async field => {
    const { store, capability } = fixture(); await store.append(capability);
    expect(await store.readExact({ ...key, [field]: 'other' })).toBeNull();
  });
  it.each(['registry', 'result', 'hitl', 'journal'])('rejects missing/mismatched %s durable authority', async kind => {
    const { store, client, capability, ports } = fixture(); await store.append(capability);
    if (kind === 'registry') ports.readRegisteredTargetExact = async () => null;
    if (kind === 'result') client.exec("UPDATE messages SET content = 'different' WHERE id = 'result'");
    if (kind === 'hitl') client.exec("DELETE FROM fixture_hitl");
    if (kind === 'journal') client.exec("UPDATE messages SET prompt_message_id = 'foreign' WHERE id = 'prompt'");
    await expect(store.readExact(key)).rejects.toThrow('HOST_DISPATCH_RECEIPT_AUTHORITY');
  });
  it.each(['hash', 'fields', 'utf8', 'timestamp'])('independently rejects persisted %s corruption', async kind => {
    const { store, client, capability } = fixture(); const written = await store.append(capability);
    if (kind === 'hash') client.exec("UPDATE host_dispatch_receipts SET record_sha256 = 'bad'");
    if (kind === 'fields') {
      const raw = JSON.stringify({ ...payload, extra: true }); client.prepare('UPDATE host_dispatch_receipts SET record_json = ?, record_sha256 = ?').run(raw, hash(raw));
    }
    if (kind === 'utf8') client.exec("UPDATE host_dispatch_receipts SET record_json = CAST(X'FF' AS TEXT)");
    if (kind === 'timestamp') client.exec('UPDATE host_dispatch_receipts SET created_at = -1');
    await expect(store.readExact(key)).rejects.toThrow('HOST_DISPATCH_RECEIPT_CORRUPT');
    expect(written.payload.version).toBe(1);
  });
  it.each(['getter', 'proxy', 'symbol', 'hidden'])('rejects unsafe key %s without executing user code', async mode => {
    const { store } = fixture(); let reads = 0; const input = { ...key };
    if (mode === 'getter') Object.defineProperty(input, 'callId', { enumerable: true, get() { reads++; return 'call'; } });
    if (mode === 'symbol') Reflect.set(input, Symbol('extra'), true);
    if (mode === 'hidden') Object.defineProperty(input, 'extra', { value: true });
    const supplied = mode === 'proxy' ? new Proxy(input, { ownKeys(target) { reads++; return Reflect.ownKeys(target); } }) : input;
    await expect(store.readExact(supplied)).rejects.toThrow('HOST_DISPATCH_RECEIPT_INVALID'); expect(reads).toBe(0);
  });
  it('records cancelled non-entry without granting resolved authority', async () => {
    const { store, capability, capabilities, client } = fixture();
    capabilities.set(capability, { key, payload: { ...payload, canonicalName: null, enteredTarget: null, approval: null, hitlCommit: null,
      registeredCommitAck: 'not_registered', result: { ...payload.result, status: 'cancelled' } } });
    const written = await store.append(capability); expect(written.payload.enteredTarget).toBeNull();
    expect(client.prepare('SELECT COUNT(*) AS count FROM host_dispatch_receipts').get()).toEqual({ count: 1 });
  });
  it('aborts during verification with no insertion or capability retry', async () => {
    const { store, ports, capability, client } = fixture(); const controller = new AbortController(); let calls = 0;
    ports.readRegisteredTargetExact = async () => { calls++; controller.abort(); return { canonicalName: 'terminal_spawn', target }; };
    await expect(store.append(capability, controller.signal)).rejects.toThrow('HOST_DISPATCH_RECEIPT_ABORTED');
    await expect(store.append(capability)).rejects.toThrow('HOST_DISPATCH_RECEIPT_ABORTED'); expect(calls).toBe(1);
    expect(client.prepare('SELECT COUNT(*) AS count FROM host_dispatch_receipts').get()).toEqual({ count: 0 });
  });
  it.each(['registry', 'hitl', 'journal'])('aborts hanging %s read and passes the actual signal', async kind => {
    const { store, ports, capability, client } = fixture(); const controller = new AbortController();
    let observed: AbortSignal | undefined;
    if (kind === 'registry') ports.readRegisteredTargetExact = async (_target, signal) => { observed = signal; controller.abort(); return new Promise(() => {}); };
    if (kind === 'hitl') ports.readHitlExact = async (_key, _approval, _commit, signal) => { observed = signal; controller.abort(); return new Promise(() => {}); };
    if (kind === 'journal') ports.readJournalScopeExact = async (_identity, signal) => { observed = signal; controller.abort(); return new Promise(() => {}); };
    await expect(store.append(capability, controller.signal)).rejects.toThrow('HOST_DISPATCH_RECEIPT_ABORTED');
    expect(observed).toBe(controller.signal);
    expect(client.prepare('SELECT COUNT(*) AS count FROM host_dispatch_receipts').get()).toEqual({ count: 0 });
  });
  it('records actual resolved/entered/committed callbacks without exposing a JSON capability mint', async () => {
    const f = fixture(); const entry = {}; const executor = {}; const identity = { runId: key.runId, sessionId: key.sessionId, turnId: key.turnId, promptMessageId: key.promptMessageId };
    const resolved = { identity, callId: key.callId, requestedName: 'terminal_spawn', canonicalName: 'terminal_spawn', args: { command: 'secret' },
      target: { kind: 'kalio_registry' as const, entryIdentity: entry, executorIdentity: executor, requiresConfirmation: true }, approval };
    const recorder = createHostDispatchReceiptRecorder(drizzle(f.client, { schema }), { ...f.ports,
      captureRegisteredTarget: async receipt => receipt.target.kind === 'kalio_registry'
        && receipt.target.entryIdentity === entry && receipt.target.executorIdentity === executor ? target : null });
    const call = recorder.createCallRecorder({ identity, callId: key.callId, toolName: 'terminal_spawn', args: { command: 'secret' } });
    await call.resolved(resolved); call.entered(resolved);
    const written = await call.commit({ identity, callId: key.callId, toolName: 'terminal_spawn', persistedMessageId: 'result',
      contentSha256: hash(content), status: 'success', registeredCommitAck: 'acknowledged', resolvedDispatch: resolved, hitlCommit: commit });
    expect(written.payload.enteredTarget).toEqual(target); expect(written.recordJson).not.toContain('secret');
    expect(await recorder.readExact(key)).toEqual(written);
  });
});

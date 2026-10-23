import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostRuntimeToolCommit, HostResolvedToolDispatch } from '@kalio/types';
import * as schema from '../../database/schema';
import type { DrizzleService } from '../../database/drizzle.service';
import { PersistedRuntimeEvidenceReader } from './persisted-runtime-evidence-reader';
import { createHostDispatchReceiptRecorder, type HostDispatchReceiptRecorderPorts } from './host-dispatch-receipts';
import { createHostCancellationRecordingScope } from './host-cancellation-recording-scope';

const clients: Database.Database[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.close()); vi.useRealTimers(); });
const identity = { runId: 'run', sessionId: 'session', turnId: 'turn', promptMessageId: 'prompt' };
const content = '"cancelled Ż"';
const target = { kind: 'kalio_registry' as const, catalogEntryId: 'catalog', executorImplementationId: 'executor', executorImplementationVersion: 1, requiresConfirmation: false };
async function fixture(entered = false) {
  const client = new Database(':memory:'); clients.push(client);
  client.exec(readFileSync(join(__dirname, '../../database/migrations/0037_host_dispatch_receipts.sql'), 'utf8'));
  client.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,turn_id TEXT,prompt_message_id TEXT,tool_call_id TEXT,created_at INTEGER);
    CREATE TABLE chat_runs (id TEXT PRIMARY KEY,session_id TEXT,turn_id TEXT,revision INTEGER);
    INSERT INTO chat_runs VALUES ('run','session','turn',1);
    INSERT INTO messages VALUES ('prompt','session','user','request','turn','prompt',NULL,1);`);
  client.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run('result', 'session', 'tool_result', content, 'turn', 'prompt', 'call', 2);
  const db = drizzle(client, { schema });
  const ports: HostDispatchReceiptRecorderPorts = {
    durableReader: new PersistedRuntimeEvidenceReader({ db } as unknown as DrizzleService),
    readJournalScopeExact: async () => ({ ...identity, revision: 1 }),
    readHitlExact: async () => null,
    captureRegisteredTarget: async () => target,
    readRegisteredTargetExact: async () => ({ canonicalName: 'read', target }),
  };
  const execution = new AbortController(); const persistence = new AbortController(); const owner = {};
  const admission = { identity, callId: 'call', toolName: 'read', args: {} };
  const factory = createHostDispatchReceiptRecorder(db, { ...ports,
    readJournalScopeExact: (value, signal) => ports.readJournalScopeExact(value, signal) });
  const call = factory.createCallRecorder(admission, execution.signal);
  const scope = createHostCancellationRecordingScope({ executionIdentity: owner, executionSignal: execution.signal, identity,
    maxPersistenceLeaseMs: 1000, acquirePersistenceLease: () => ({ signal: persistence.signal, expiresAt: Date.now() + 100 }) });
  const handle = scope.lookup(owner, execution.signal)!;
  await handle.registerAdmission(admission, call, Promise.resolve());
  const resolved: HostResolvedToolDispatch = { identity, callId: 'call', requestedName: 'read', canonicalName: 'read', args: {},
    target: { kind: 'kalio_registry', entryIdentity: {}, executorIdentity: {}, requiresConfirmation: false },
    approval: { kind: 'non_durable', reason: 'not_required' } };
  if (entered) { await call.resolved(resolved); call.entered(resolved); }
  const receipt: HostRuntimeToolCommit = { identity, callId: 'call', toolName: 'read', persistedMessageId: 'result',
    contentSha256: createHash('sha256').update(content).digest('hex'), status: 'cancelled', registeredCommitAck: 'not_registered',
    resolvedDispatch: entered ? resolved : null, hitlCommit: null };
  const stop = () => { handle.stop(); execution.abort(); return handle.permitFor('call', call)!; };
  const count = () => client.prepare('SELECT COUNT(*) AS n FROM host_dispatch_receipts').get();
  return { client, ports, factory, call, receipt, execution, handle, stop, count, resolved };
}
describe('bounded owner cancellation recording (real SQLite)', () => {
  it.each([false, true])('records cancellation with genuinely entered=%s and no completion authority', async entered => {
    const f = await fixture(entered); const permit = f.stop();
    const saved = await f.call.recordCancelled(f.receipt, permit);
    expect(saved.payload.enteredTarget).toEqual(entered ? target : null);
    expect(saved.payload.result.status).toBe('cancelled'); expect(f.count()).toEqual({ n: 1 });
    expect(await f.factory.readExact({ ...identity, callId: 'call' })).toEqual(saved);
    f.handle.close();
  });
  it('rejects forged permits and does not allow a corrected retry', async () => {
    const f = await fixture(); const permit = f.stop();
    await expect(f.call.recordCancelled(f.receipt, {})).rejects.toThrow('HOST_CANCELLATION_RECORDING_INVALID');
    await expect(f.call.recordCancelled(f.receipt, permit)).rejects.toThrow(); expect(f.count()).toEqual({ n: 0 }); f.handle.close();
  });
  it('rejects a permit from another recorder/call', async () => {
    const f = await fixture(); const g = await fixture(); const foreign = g.stop(); f.stop();
    await expect(f.call.recordCancelled(f.receipt, foreign)).rejects.toThrow('HOST_CANCELLATION_RECORDING_INVALID');
    expect(f.count()).toEqual({ n: 0 }); f.handle.close(); g.handle.close();
  });
  it('requires actual execution abort even with an owner permit', async () => {
    const f = await fixture(); f.handle.stop(); const permit = f.handle.permitFor('call', f.call)!;
    await expect(f.call.recordCancelled(f.receipt, permit)).rejects.toThrow('HOST_DISPATCH_RECEIPT_INVALID');
    expect(f.count()).toEqual({ n: 0 }); f.handle.close();
  });
  it.each(['success', 'error'] as const)('rejects non-cancelled status %s', async status => {
    const f = await fixture(); const permit = f.stop();
    await expect(f.call.recordCancelled({ ...f.receipt, status }, permit)).rejects.toThrow('HOST_DISPATCH_RECEIPT_INVALID');
    expect(f.count()).toEqual({ n: 0 }); f.handle.close();
  });
  it('rejects fabricated or omitted executor entry linkage', async () => {
    for (const entered of [false, true]) {
      const f = await fixture(entered); const permit = f.stop();
      await expect(f.call.recordCancelled({ ...f.receipt, resolvedDispatch: entered ? null : f.resolved }, permit)).rejects.toThrow('HOST_DISPATCH_RECEIPT_INVALID');
      expect(f.count()).toEqual({ n: 0 }); f.handle.close();
    }
  });
  it('never retries normal commit through cancellation even with the identical receipt', async () => {
    const f = await fixture(); const permit = f.stop();
    const normal = f.call.commit(f.receipt);
    await expect(normal).rejects.toThrow('HOST_DISPATCH_RECEIPT_ABORTED');
    await expect(f.call.recordCancelled(f.receipt, permit)).rejects.toThrow('HOST_DISPATCH_RECEIPT_CONFLICT');
    expect(f.count()).toEqual({ n: 0 }); f.handle.close();
  });
  it('fences a normal commit racing the cancellation attempt', async () => {
    const f = await fixture(); const permit = f.stop();
    const cancelled = f.call.recordCancelled(f.receipt, permit);
    await expect(f.call.commit(f.receipt)).rejects.toThrow('HOST_DISPATCH_RECEIPT_CONFLICT');
    await cancelled; expect(f.count()).toEqual({ n: 1 }); f.handle.close();
  });
  it('reuses only the exact original cancellation attempt without another insertion', async () => {
    const f = await fixture(); const permit = f.stop();
    const first = f.call.recordCancelled(f.receipt, permit);
    expect(f.call.recordCancelled(f.receipt, permit)).toBe(first);
    await first;
    await expect(f.call.recordCancelled({ ...f.receipt }, permit)).rejects.toThrow('HOST_DISPATCH_RECEIPT_CONFLICT');
    expect(f.count()).toEqual({ n: 1 }); f.handle.close();
  });
  it('rejects wall-clock expiry during store verification before SQLite insert', async () => {
    vi.useFakeTimers(); const f = await fixture();
    f.ports.readJournalScopeExact = async () => { vi.setSystemTime(Date.now() + 101); return { ...identity, revision: 1 }; };
    const permit = f.stop();
    await expect(f.call.recordCancelled(f.receipt, permit)).rejects.toThrow('HOST_CANCELLATION_RECORDING_EXPIRED');
    expect(f.count()).toEqual({ n: 0 }); f.handle.close();
  });
  it('aborts a hanging authority read at deadline, rejects late resolution and never inserts', async () => {
    vi.useFakeTimers(); const f = await fixture(); let finish!: () => void; let observed: AbortSignal | undefined;
    f.ports.readJournalScopeExact = async (_identity, signal) => { observed = signal; await new Promise<void>(resolve => { finish = resolve; }); return { ...identity, revision: 1 }; };
    const permit = f.stop(); const attempt = f.call.recordCancelled(f.receipt, permit);
    const rejected = expect(attempt).rejects.toThrow('HOST_DISPATCH_RECEIPT_ABORTED');
    await vi.advanceTimersByTimeAsync(100); await rejected; expect(observed?.aborted).toBe(true);
    finish(); await Promise.resolve(); await Promise.resolve(); expect(f.count()).toEqual({ n: 0 });
    await expect(f.call.recordCancelled(f.receipt, permit)).rejects.toThrow(); f.handle.close();
  });
  it('rechecks a revoked permit after the exact result wait', async () => {
    const f = await fixture(); const original = f.ports.durableReader;
    const read = original.readToolResultExact.bind(original);
    vi.spyOn(original, 'readToolResultExact').mockImplementation(async locator => { const result = await read(locator); f.handle.close(); return result; });
    const permit = f.stop(); await expect(f.call.recordCancelled(f.receipt, permit)).rejects.toThrow(); expect(f.count()).toEqual({ n: 0 });
  });
});

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostRuntimeToolAdmission, HostRuntimeToolCommit } from '@kalio/types';
import * as schema from '../../database/schema';
import type { DrizzleService } from '../../database/drizzle.service';
import type { MCPService } from '../mcp/mcp.service';
import { HitlRequestService } from '../hitl/hitl-request.service';
import { ToolConfirmationService } from './tool-confirmation.service';
import { ToolDispatchService } from './tool-dispatch.service';
import { HostDispatchReceiptService } from './host-dispatch-receipt.service';
import { PersistedRuntimeEvidenceReader } from './persisted-runtime-evidence-reader';
import { SessionExecutionAdmission } from './session-execution-admission';
import { createHostCancellationRecordingScope, type HostCancellationLifecycleHandle } from './host-cancellation-recording-scope';
import { dispatchRuntimeTool, TurnExecutionLane } from './llm-turn-tool-execution';
import type { LLMAgentLoopRequest } from './llm-turn-runtime.types';
import type { SessionManagerService } from './session-manager.service';
import type { StreamContext } from './interfaces/stream-context.interface';
import { TurnState } from './turn-state';
import { LLMTurnRuntimeService } from './llm-turn-runtime.service';
import { StreamProcessorService } from './stream-processor.service';
import type { ILLMSource, LLMSourceParams } from './interfaces/llm-source.interface';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const databases: Database.Database[] = [];
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); for (const db of databases.splice(0)) db.close(); });

function fixture(mode: 'before_entry' | 'after_entry' | 'after_ack' | 'normal' | 'unowned_abort' = 'before_entry') {
  const client = new Database(':memory:'); databases.push(client);
  client.exec(readFileSync(join(__dirname, '../../database/migrations/0037_host_dispatch_receipts.sql'), 'utf8'));
  client.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,turn_id TEXT,prompt_message_id TEXT,tool_call_id TEXT,created_at INTEGER);
    CREATE TABLE chat_runs (id TEXT PRIMARY KEY,session_id TEXT,turn_id TEXT,revision INTEGER);
    CREATE TABLE hitl_requests (id TEXT PRIMARY KEY,kind TEXT,status TEXT DEFAULT 'pending',session_id TEXT,turn_id TEXT,run_id TEXT,tool_call_id TEXT,
      payload TEXT,continuation TEXT,outcome TEXT,revision INTEGER DEFAULT 1,created_at INTEGER,updated_at INTEGER,resolved_at INTEGER);
    INSERT INTO chat_runs VALUES ('r','s','t',1); INSERT INTO messages VALUES ('p','s','user','test','t','p',NULL,1);`);
  const provider = { db: drizzle(client, { schema }) } as unknown as DrizzleService;
  const requests = new HitlRequestService(provider);
  const confirmations = new ToolConfirmationService(null, null, null, requests);
  const owner = new SessionExecutionAdmission();
  const reservation = owner.reserve('s', 't')!;
  const identity = { runId: 'r', sessionId: 's', turnId: 't', promptMessageId: 'p' };
  const lease = new AbortController();
  const scope = createHostCancellationRecordingScope({ executionIdentity: reservation, executionSignal: reservation.controller.signal,
    identity, maxPersistenceLeaseMs: 10_000, acquirePersistenceLease: () => ({ signal: lease.signal, expiresAt: Date.now() + 9_000 }) });
  const handle = scope.lookup(reservation, reservation.controller.signal)!;
  const registration = vi.fn(handle.registerAdmission.bind(handle));
  const runtimeHandle: HostCancellationLifecycleHandle = { ...handle, registerAdmission: registration };
  expect(owner.bindCancellationRecording('s', reservation, scope)).toBe(true);
  cleanups.push(() => owner.release('s', reservation));
  let stopping: Promise<void> | undefined;
  let stopSettled = false;
  const stop = () => { stopping = owner.stopAndDrain('s'); void stopping.then(() => { stopSettled = true; }); };
  if (mode === 'after_ack') {
    const finish = confirmations.finishLiveExecutionRequired.bind(confirmations);
    vi.spyOn(confirmations, 'finishLiveExecutionRequired').mockImplementation(async (...args) => {
      const receipt = await finish(...args); stop(); return receipt;
    });
  }
  const entry = { meta: { name: 'terminal_spawn', description: '', parameters: {}, requiresConfirmation: true },
    catalogEntryId: 'catalog.spawn', executorImplementationId: 'executor.spawn', executorImplementationVersion: 1,
    execute: vi.fn(async () => { if (mode === 'after_entry') stop(); return { text: 'Zażółć 🧪' }; }) };
  const mcp = { getAllTools: () => [], resolveToolName: () => null } as unknown as MCPService;
  const reader = new PersistedRuntimeEvidenceReader(provider);
  const receiptService = new HostDispatchReceiptService(provider, [entry], reader, mcp);
  const admissionGate = deferred(); admissionGate.resolve();
  const observer = { admit: vi.fn(async (_admission: HostRuntimeToolAdmission) => { await admissionGate.promise; }),
    resolvedDispatch: vi.fn(async () => undefined), commit: vi.fn(async (_receipt: HostRuntimeToolCommit) => undefined),
    drain: vi.fn(async () => undefined), journalComplete: vi.fn(async () => undefined) };
  const dispatcher = new ToolDispatchService([entry], null, null, null, null, confirmations);
  const context: StreamContext = { ...identity, messageId: 'assistant', state: new TurnState(), emit: vi.fn(), abortSignal: reservation.controller.signal,
    markToolRunning: async () => {
      if (mode === 'before_entry') stop();
      if (mode === 'unowned_abort' || mode === 'after_ack') reservation.controller.abort('fixture execution cancelled');
    } };
  const sessionManager = { saveToolResult: async (_session: string, _call: string, content: string) => {
    client.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)').run('result', 's', 'tool_result', content, 't', 'p', 'c', 2);
    return 'result';
  } } as unknown as SessionManagerService;
  const request: LLMAgentLoopRequest & { hostCancellationRecording?: HostCancellationLifecycleHandle } = {
    ...identity, runtimeKind: 'chat', personaId: 'fixture', effectiveSystemPrompt: '', maxIterations: 1,
    emit: context.emit, abortSignal: context.abortSignal, toolMetas: dispatcher.getToolMetas(),
    hostRuntimeReceiptObserver: observer, hostDispatchReceiptRecorder: receiptService.recorder, hostCancellationRecording: runtimeHandle };
  const run = (overrides: Partial<typeof request> = {}) => dispatchRuntimeTool({ request: { ...request, ...overrides },
    call: { id: 'c', name: 'terminal_spawn', args: {} }, context, lane: new TurnExecutionLane(), sessionManager, toolDispatch: dispatcher });
  const approve = async () => {
    let id = '';
    await vi.waitFor(() => { const rows = confirmations.getPendingConfirmations('s'); expect(rows).toHaveLength(1); id = rows[0]!.requestId; });
    expect(await confirmations.resolveConfirmation(id, 's')).toBe('resolved');
    return id;
  };
  return { client, provider, identity, observer, entry, run, approve, request, reader, lease, handle, confirmations,
    dispatcher, sessionManager, receiptService, registration, stop, release: () => owner.release('s', reservation), get stopping() { return stopping; },
    get stopSettled() { return stopSettled; } };
}

describe('runtime owner-bound cancellation recording (real SQLite)', () => {
  it.each(['before_entry', 'after_entry'] as const)('records %s cancellation and Stop waits for the durable write, never producer completion', async mode => {
    const f = fixture(mode);
    const readStarted = deferred(); const writeGate = deferred();
    const realRead = f.reader.readToolResultExact.bind(f.reader);
    vi.spyOn(f.reader, 'readToolResultExact').mockImplementation(async locator => { readStarted.resolve(); await writeGate.promise; return realRead(locator); });
    const pending = f.run();
    const outcome = pending.then(value => ({ value }), error => ({ error: error as unknown }));
    const requestId = await f.approve(); await Promise.race([readStarted.promise, outcome]);
    expect(f.stopSettled).toBe(false);
    expect(f.client.prepare('SELECT COUNT(*) AS n FROM host_dispatch_receipts').get()).toEqual({ n: 0 });
    writeGate.resolve();
    expect(await outcome).toMatchObject({ value: { status: 'cancelled' } });
    const row = await f.receiptService.recorder.readExact({ ...f.identity, callId: 'c' });
    expect(row?.payload).toMatchObject({ hitlCommit: { requestId, status: 'approved', executionState: 'tool_result_committed', resultStatus: 'cancelled' },
      registeredCommitAck: 'acknowledged', result: { status: 'cancelled' } });
    expect(row?.payload.enteredTarget === null).toBe(mode === 'before_entry');
    expect(f.entry.execute).toHaveBeenCalledTimes(mode === 'before_entry' ? 0 : 1);
    expect(f.observer.admit).toHaveBeenCalledOnce(); expect(f.observer.commit).not.toHaveBeenCalled();
    expect(f.observer.journalComplete).not.toHaveBeenCalled();
    expect(f.stopSettled).toBe(false); f.release(); await f.stopping; expect(f.stopSettled).toBe(true);
  });

  it.each(['observer', 'recorder'] as const)('rejects a handle without %s before admission/dispatch', async missing => {
    const f = fixture();
    vi.spyOn(f.dispatcher, 'dispatch').mockRejectedValue(new Error('fixture unexpectedly reached dispatch'));
    await expect(f.run(missing === 'observer' ? { hostRuntimeReceiptObserver: undefined } : { hostDispatchReceiptRecorder: undefined }))
      .rejects.toThrow('HOST_CANCELLATION_DEPENDENCIES_REQUIRED');
    expect(f.entry.execute).not.toHaveBeenCalled(); expect(f.observer.admit).not.toHaveBeenCalled();
    expect(f.client.prepare('SELECT COUNT(*) AS n FROM hitl_requests').get()).toEqual({ n: 0 });
  });

  it('registers the actual ACK promise and exact stable recorder before any dispatch, without double admission', async () => {
    const f = fixture('normal'); const gate = deferred();
    f.observer.admit.mockImplementation(async () => { await gate.promise; });
    const registration = f.registration;
    const factory = vi.spyOn(f.receiptService.recorder, 'createCallRecorder');
    const pending = f.run();
    const outcome = pending.then(value => ({ value }), error => ({ error: error as unknown }));
    await vi.waitFor(() => expect(f.observer.admit).toHaveBeenCalledOnce());
    const registered = registration.mock.calls.length;
    const ack = registration.mock.calls[0]?.[2];
    expect(f.client.prepare('SELECT COUNT(*) AS n FROM hitl_requests').get()).toEqual({ n: 0 });
    gate.resolve(); await f.approve(); expect(await outcome).toMatchObject({ value: { status: 'success' } });
    expect(registered).toBe(1);
    expect(ack).toBe(f.observer.admit.mock.results[0]?.value);
    expect(factory).toHaveBeenCalledOnce();
    expect(registration.mock.calls[0]?.[1]).toBe(factory.mock.results[0]?.value);
    expect(f.observer.commit).toHaveBeenCalledOnce(); expect(f.observer.admit).toHaveBeenCalledOnce();
  });

  it('fails closed for execution abort without an owner permit, never retries via cancellation recording', async () => {
    const f = fixture('unowned_abort'); const pending = f.run();
    const failure = expect(pending).rejects.toThrow('HOST_DISPATCH_RECEIPT_ABORTED');
    await f.approve(); await failure;
    expect(f.observer.commit).not.toHaveBeenCalled();
    expect(f.client.prepare('SELECT COUNT(*) AS n FROM host_dispatch_receipts').get()).toEqual({ n: 0 });
  });

  it('selects the actual owner permit after the real HITL result ACK, not before it', async () => {
    const f = fixture('after_ack'); const pending = f.run(); const requestId = await f.approve();
    expect((await pending).status).toBe('cancelled');
    const row = await f.receiptService.recorder.readExact({ ...f.identity, callId: 'c' });
    expect(row?.payload).toMatchObject({ enteredTarget: null, approval: null, canonicalName: null,
      hitlCommit: { requestId, executionState: 'tool_result_committed', resultStatus: 'cancelled' } });
    expect(f.observer.commit).not.toHaveBeenCalled(); f.release(); await f.stopping;
  });

  it('fails closed when the bounded lease is revoked during the cancellation write', async () => {
    const f = fixture(); const reading = deferred(); const gate = deferred();
    const read = f.reader.readToolResultExact.bind(f.reader);
    vi.spyOn(f.reader, 'readToolResultExact').mockImplementation(async locator => { reading.resolve(); await gate.promise; return read(locator); });
    const pending = f.run(); const failure = expect(pending).rejects.toThrow('HOST_DISPATCH_RECEIPT_ABORTED');
    await f.approve(); await reading.promise; f.lease.abort('SECRET_LEASE_REASON'); gate.resolve(); await failure;
    expect(f.observer.commit).not.toHaveBeenCalled(); expect(f.observer.journalComplete).not.toHaveBeenCalled();
    expect(f.client.prepare('SELECT COUNT(*) AS n FROM host_dispatch_receipts').get()).toEqual({ n: 0 });
    f.release(); await f.stopping;
  });

  it('never catch-and-retries a failed normal commit even when Stop subsequently grants a permit', async () => {
    const f = fixture('unowned_abort');
    const create = f.receiptService.recorder.createCallRecorder.bind(f.receiptService.recorder);
    let cancellationWrites = 0;
    vi.spyOn(f.receiptService.recorder, 'createCallRecorder').mockImplementation((...args) => {
      const call = create(...args);
      vi.spyOn(call, 'commit').mockImplementation(async () => { f.stop(); throw new Error('HOST_DISPATCH_RECEIPT_STORAGE'); });
      const cancelled = call.recordCancelled.bind(call);
      vi.spyOn(call, 'recordCancelled').mockImplementation(async (...values) => { cancellationWrites++; return cancelled(...values); });
      return call;
    });
    const pending = f.run(); const failure = expect(pending).rejects.toThrow('HOST_DISPATCH_RECEIPT_STORAGE');
    await f.approve(); await failure; expect(cancellationWrites).toBe(0);
    expect(f.observer.commit).not.toHaveBeenCalled();
    expect(f.client.prepare('SELECT COUNT(*) AS n FROM host_dispatch_receipts').get()).toEqual({ n: 0 });
    f.release(); await f.stopping;
  });

  it('rejects failed admission before dispatch and never obtains cancellation authority from it', async () => {
    const f = fixture(); f.observer.admit.mockRejectedValue(new Error('fixture admission rejected'));
    await expect(f.run()).rejects.toThrow('HOST_CANCELLATION_RECORDING_ADMISSION');
    expect(f.entry.execute).not.toHaveBeenCalled();
    expect(f.client.prepare('SELECT COUNT(*) AS n FROM hitl_requests').get()).toEqual({ n: 0 });
    f.stop(); expect(f.handle.permitFor('c', f.registration.mock.calls[0]![1])).toBeNull();
    f.release(); await f.stopping;
  });

  it('keeps the host handle out of actual provider params; recorder injection precedes dispatch validation', async () => {
    const f = fixture('normal'); let params: LLMSourceParams | undefined;
    const source: ILLMSource = { async *stream(value) {
      params = value;
      if (!value.dispatchNativeTool) throw new Error('fixture native dispatch absent');
      await value.dispatchNativeTool({ id: 'c', name: 'terminal_spawn', args: {} }, { abortSignal: new AbortController().signal });
      yield { type: 'structured_output', value: { fixture: 'native tool finished' } };
    } };
    const sessions = { ...f.sessionManager, loadHistoryForLLM: async () => ({ history: [], unboundedHistoryCount: 0 }),
      persistAssistantMessage: async () => undefined } as unknown as SessionManagerService;
    const runtime = new LLMTurnRuntimeService(source, new StreamProcessorService([], []), sessions, f.dispatcher,
      undefined, undefined, f.receiptService);
    const pending = runtime.runAgentLoop({ ...f.request, hostDispatchReceiptRecorder: undefined, providerCompletesTurn: true });
    await f.approve(); expect((await pending).aborted).toBe(false);
    expect((await f.receiptService.recorder.readExact({ ...f.identity, callId: 'c' }))?.payload.result.status).toBe('success');
    expect(f.observer.commit).toHaveBeenCalledOnce();
    expect(params).toBeDefined();
    expect(params).not.toHaveProperty('hostCancellationRecording');
    expect(params).not.toHaveProperty('hostDispatchReceiptRecorder');
    expect(params).not.toHaveProperty('hostRuntimeReceiptObserver');
  });
});

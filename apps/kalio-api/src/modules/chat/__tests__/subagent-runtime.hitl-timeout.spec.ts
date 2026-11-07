import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../database/schema';
import { DrizzleService } from '../../../database/drizzle.service';
import { HitlRequestService } from '../../hitl/hitl-request.service';
import { ToolConfirmationService } from '../tool-confirmation.service';
import { ToolDispatchService } from '../tool-dispatch.service';
import { makeContextAssembly, makeLLMTurnRuntime, makeToolPolicy } from './llm-runtime-test-harness';
import { SubagentRuntimeService } from '../subagent-runtime.service';
import { RuntimeExecutionScheduler } from '../../agent-runtime/runtime-execution.scheduler';
import { AgentBudgetApprovalService } from '../agent-budget-approval.service';
import type { ILLMSource, LLMSourceParams } from '../interfaces/llm-source.interface';
import type { StreamContext } from '../interfaces/stream-context.interface';
import type { SessionManagerService } from '../session-manager.service';
import type { SessionsService } from '../sessions.service';
import type { VFSService } from '../../vfs/vfs.service';
import type { InternalLLMChunk } from '../interfaces/llm-chunk.types';

function gate() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}

async function untilGate(promise: Promise<void>, signal: AbortSignal) {
  signal.throwIfAborted();
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });
  try { await Promise.race([promise, aborted]); } finally { signal.removeEventListener('abort', onAbort); }
}

function fixture(options: { ordinary?: boolean; count?: number; finish?: boolean; scheduler?: RuntimeExecutionScheduler;
  preparation?: ReturnType<typeof gate>; parentSignal?: AbortSignal } = {}) {
  const sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE hitl_requests (
    id text PRIMARY KEY NOT NULL, kind text NOT NULL, status text NOT NULL DEFAULT 'pending',
    session_id text NOT NULL, turn_id text, run_id text, tool_call_id text,
    payload text NOT NULL, continuation text, outcome text, revision integer NOT NULL DEFAULT 1,
    created_at integer NOT NULL, updated_at integer NOT NULL, resolved_at integer
  );`);
  const database = new DrizzleService(null as never);
  (database as unknown as { db: unknown }).db = drizzle(sqlite, { schema });
  const requests = new HitlRequestService(database);
  const confirmations = new ToolConfirmationService(null, null, null, requests);
  const write = vi.fn(async () => ({ bytesWritten: 1 }));
  const meta = { name: 'fs_write', description: 'fixture write', parameters: {}, requiresConfirmation: true };
  const dispatch = new ToolDispatchService([{ meta, execute: write }], null, null, null, null, confirmations);
  const entered = gate(); const startTools = gate(); const toolsFinished = gate(); const finish = gate();
  let params!: LLMSourceParams;
  let turns = 0;
  const stream = vi.fn(async function* (input: LLMSourceParams): AsyncGenerator<InternalLLMChunk> {
    params = input;
    entered.open();
    if (turns++ > 0) { yield { type: 'text_delta', delta: 'Final summary' }; yield { type: 'done' }; return; }
    await untilGate(startTools.promise, input.abortSignal!);
    await Promise.all(Array.from({ length: options.count ?? 1 }, (_, index) => input.dispatchNativeTool!({
      id: `write-${index}`, name: 'fs_write', args: { path: `fixture-${index}.txt`, content: 'x' },
    }, { abortSignal: input.abortSignal! })));
    toolsFinished.open();
    if (!options.finish) await untilGate(finish.promise, input.abortSignal!);
    yield { type: 'text_delta', delta: 'Fixture complete' };
    yield { type: 'done' };
  });
  const source: ILLMSource = { stream };
  const results = vi.fn(async () => 'result-message');
  const sessionManager = {
    persistUserMessage: vi.fn(async () => ({ id: 'prompt' })),
    persistAssistantMessage: vi.fn(async () => undefined), saveToolResult: results,
    loadHistoryForLLM: vi.fn(async () => ({ history: [], unboundedHistoryCount: 0 })),
  };
  const manager = sessionManager as unknown as SessionManagerService;
  const sessions = { createWithId: async (id: string, dto: { parentSessionId?: string }) => ({ id,
      personaId: 'default', title: 'Fixture', kind: 'subagent', parentSessionId: dto.parentSessionId,
      createdAt: 0, updatedAt: 0 }) } as unknown as SessionsService;
  const persona = { getSessionConfig: vi.fn(async () => ({ systemPrompt: '', model: '',
    allowedTools: ['fs_write'], skillIds: [], mcpPolicy: 'deny_all' as const, kv: {} })) };
  const assembly = makeContextAssembly(persona, dispatch);
  const actualAssemble = assembly.assembleForRuntime.bind(assembly);
  const assemble = vi.spyOn(assembly, 'assembleForRuntime');
  const preparing = gate();
  if (options.preparation) {
    assemble.mockImplementation(async request => {
      preparing.open(); await options.preparation!.promise;
      return actualAssemble(request);
    });
  }
  const loop = makeLLMTurnRuntime(source, { process: async (chunk: InternalLLMChunk, ctx: StreamContext) => {
    if (chunk.type === 'text_delta') ctx.state.appendText(chunk.delta);
  } }, manager, dispatch);
  const runtime = new SubagentRuntimeService(source, loop, manager, sessions, {} as VFSService,
    assembly, makeToolPolicy(persona, dispatch),
    { requestAdditionalBudget: vi.fn(async () => null) } as unknown as AgentBudgetApprovalService,
    undefined, undefined, undefined, undefined, undefined, options.scheduler);
  const run = runtime.runSubagent({ parentSessionId: 'parent', parentToolCallId: 'role', objective: 'fixture',
    parentSignal: options.parentSignal,
    timeoutMs: 50, vfsMode: 'shared', copyOutputs: false, availableTools: [meta],
    architectureContext: { projectPath: process.cwd(), executionCwd: process.cwd() },
    ...(options.ordinary ? {} : { auditContext: { architectureRunId: 'architecture-fixture' },
      slotPolicy: { allowedToolNames: ['fs_write'] } }),
  });
  let outcome: 'pending' | 'resolved' | 'rejected' = 'pending';
  const settled = run.then(value => { outcome = 'resolved'; return { value, error: undefined }; },
    (error: unknown) => { outcome = 'rejected'; return { value: undefined, error }; });
  return { sqlite, requests, confirmations, write, dispatch, entered, startTools, toolsFinished, finish, runtime,
    settled, results, stream, assemble, preparing, get outcome() { return outcome; }, get params() { return params; } };
}

afterEach(() => vi.useRealTimers());

it('propagates a parent stop to the active child and cancels its durable tool approval', async () => {
  const parent = new AbortController();
  const f = fixture({ parentSignal: parent.signal });
  try {
    await f.entered.promise;
    f.startTools.open();
    const sessionId = f.params.sessionId!;
    await vi.waitFor(() => expect(f.confirmations.getPendingConfirmations(sessionId)).toHaveLength(1));
    const [request] = f.confirmations.getPendingConfirmations(sessionId);
    parent.abort(new Error('Parent stopped.'));
    await f.settled;
    expect((await f.requests.getById(request!.requestId))?.status).toBe('cancelled');
    expect(f.confirmations.getPendingConfirmations(sessionId)).toHaveLength(0);
    expect(f.write).not.toHaveBeenCalled();
  } finally {
    f.sqlite.close();
  }
});

describe('Architecture remaining execution time with real durable tool waiter', () => {
  it('charges preparation after admission and never starts a model after that deadline', async () => {
    vi.useFakeTimers(); const preparation = gate(); const f = fixture({ ordinary: true, preparation });
    try {
      await f.preparing.promise;
      await vi.advanceTimersByTimeAsync(50);
      preparation.open();
      expect((await f.settled).error).toMatchObject({ code: 'SUBAGENT_TIMEOUT' });
      expect(f.stream).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
    } finally { preparation.open(); await f.runtime.stopAndDrainSessions(['parent']); await f.settled; f.sqlite.close(); }
  });

  it('preserves the ordinary queued-lease exclusion, then starts the deadline on admission', async () => {
    vi.useFakeTimers(); const scheduler = new RuntimeExecutionScheduler({ maxConcurrentExecutions: 1 });
    const held = await scheduler.acquire({ projectId: 'other', priority: 'foreground', label: 'fixture owner' });
    const f = fixture({ ordinary: true, scheduler });
    try {
      await vi.advanceTimersByTimeAsync(0); expect(scheduler.queuedCount).toBe(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(f.outcome).toBe('pending'); expect(f.stream).not.toHaveBeenCalled();
      expect(f.assemble).not.toHaveBeenCalled();
      held.release(); await f.entered.promise;
      await vi.advanceTimersByTimeAsync(49); expect(f.outcome).toBe('pending');
      await vi.advanceTimersByTimeAsync(1);
      expect((await f.settled).error).toMatchObject({ code: 'SUBAGENT_TIMEOUT' });
      expect(f.write).not.toHaveBeenCalled();
    } finally { held.release(); await f.runtime.stopAndDrainSessions(['parent']); await f.settled; f.sqlite.close(); }
  });

  it.each([true, false])('Stop before queued admission permits no model/prepared work (ordinary=%s)', async ordinary => {
    vi.useFakeTimers(); const scheduler = new RuntimeExecutionScheduler({ maxConcurrentExecutions: 1 });
    const held = await scheduler.acquire({ projectId: 'other', priority: 'foreground', label: 'fixture owner' });
    const f = fixture({ ordinary, scheduler });
    try {
      await vi.advanceTimersByTimeAsync(0); expect(scheduler.queuedCount).toBe(1);
      const stop = f.runtime.stopAndDrainSessions(['parent']);
      await vi.advanceTimersByTimeAsync(500);
      held.release(); await stop; await f.settled;
      expect(f.stream).not.toHaveBeenCalled(); expect(f.assemble).not.toHaveBeenCalled();
      expect(f.write).not.toHaveBeenCalled(); expect(scheduler.activeCount).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally { held.release(); await f.runtime.stopAndDrainSessions(['parent']); await f.settled; f.sqlite.close(); }
  });

  it('survives a long manual wait and approves exactly one write', async () => {
    vi.useFakeTimers();
    const f = fixture({ finish: true });
    try {
      await f.entered.promise;
      expect(f.params).not.toHaveProperty('beginManualToolWait');
      await vi.advanceTimersByTimeAsync(20);
      f.startTools.open(); await vi.advanceTimersByTimeAsync(0);
      const [pending] = await f.requests.listPending(f.params.sessionId);
      expect(pending).toMatchObject({ status: 'pending', toolCallId: 'write-0' });
      await vi.advanceTimersByTimeAsync(500);
      expect(f.outcome).toBe('pending'); expect(f.write).not.toHaveBeenCalled();
      expect(await f.confirmations.resolveConfirmation(pending.id, f.params.sessionId)).toBe('resolved');
      expect((await f.settled).error).toBeUndefined();
      expect(f.write).toHaveBeenCalledTimes(1);
      expect((await f.requests.getById(pending.id))?.continuation).toMatchObject({ executionState: 'tool_result_committed' });
    } finally {
      await f.runtime.stopAndDrainSessions(['parent']); await f.settled; f.sqlite.close();
    }
  });

  it.each(['approve', 'deny'] as const)('charges only remaining time after %s, not a fresh timeout', async decision => {
    vi.useFakeTimers(); const f = fixture();
    try {
      await f.entered.promise; await vi.advanceTimersByTimeAsync(20);
      f.startTools.open(); await vi.advanceTimersByTimeAsync(0);
      const [pending] = await f.requests.listPending(f.params.sessionId);
      await vi.advanceTimersByTimeAsync(500);
      expect(f.outcome).toBe('pending');
      if (decision === 'approve') await f.confirmations.resolveConfirmation(pending.id, f.params.sessionId);
      else await f.confirmations.cancelConfirmation(pending.id, f.params.sessionId);
      await f.toolsFinished.promise;
      await vi.advanceTimersByTimeAsync(29); expect(f.outcome).toBe('pending');
      await vi.advanceTimersByTimeAsync(1);
      expect((await f.settled).error).toMatchObject({ code: 'SUBAGENT_TIMEOUT' });
      expect(f.write).toHaveBeenCalledTimes(decision === 'approve' ? 1 : 0);
    } finally { await f.runtime.stopAndDrainSessions(['parent']); await f.settled; f.sqlite.close(); }
  });

  it('keeps overlapping waits paused until the last decision and Stop fences late approval', async () => {
    vi.useFakeTimers(); const f = fixture({ count: 2 });
    try {
      await f.entered.promise; await vi.advanceTimersByTimeAsync(20);
      f.startTools.open(); await vi.advanceTimersByTimeAsync(0);
      const pending = await f.requests.listPending(f.params.sessionId);
      expect(pending).toHaveLength(2);
      await f.confirmations.cancelConfirmation(pending[0]!.id, f.params.sessionId);
      await vi.advanceTimersByTimeAsync(500); expect(f.outcome).toBe('pending');
      await f.runtime.stopAndDrainSessions(['parent']); await f.settled;
      expect(f.params.abortSignal?.aborted).toBe(true);
      expect(await f.confirmations.resolveConfirmation(pending[1]!.id, f.params.sessionId)).toBe('not_found');
      expect(f.write).not.toHaveBeenCalled();
      expect((await f.requests.getById(pending[1]!.id))?.status).toBe('cancelled');
      await vi.advanceTimersByTimeAsync(500); expect(f.write).not.toHaveBeenCalled();
    } finally { await f.runtime.stopAndDrainSessions(['parent']); await f.settled; f.sqlite.close(); }
  });

  it('retains ordinary subagent wall-clock timeout during a manual approval', async () => {
    vi.useFakeTimers(); const f = fixture({ ordinary: true });
    try {
      await f.entered.promise; await vi.advanceTimersByTimeAsync(20);
      f.startTools.open(); await vi.advanceTimersByTimeAsync(0);
      expect(await f.requests.listPending(f.params.sessionId)).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(30);
      expect((await f.settled).error).toMatchObject({ code: 'SUBAGENT_TIMEOUT' });
      expect(f.write).not.toHaveBeenCalled();
    } finally { await f.runtime.stopAndDrainSessions(['parent']); await f.settled; f.sqlite.close(); }
  });

  it('charges post-approval work only when the other manual wait has settled', async () => {
    vi.useFakeTimers(); const f = fixture({ count: 2 });
    try {
      await f.entered.promise; await vi.advanceTimersByTimeAsync(20);
      f.startTools.open(); await vi.advanceTimersByTimeAsync(0);
      const pending = await f.requests.listPending(f.params.sessionId);
      expect(pending).toHaveLength(2);
      await f.confirmations.resolveConfirmation(pending[0]!.id, f.params.sessionId);
      await vi.advanceTimersByTimeAsync(500);
      expect(f.write).toHaveBeenCalledTimes(1); expect(f.outcome).toBe('pending');
      await f.confirmations.cancelConfirmation(pending[1]!.id, f.params.sessionId);
      await f.toolsFinished.promise;
      await vi.advanceTimersByTimeAsync(29); expect(f.outcome).toBe('pending');
      await vi.advanceTimersByTimeAsync(1);
      expect((await f.settled).error).toMatchObject({ code: 'SUBAGENT_TIMEOUT' });
      expect(f.write).toHaveBeenCalledTimes(1);
    } finally { await f.runtime.stopAndDrainSessions(['parent']); await f.settled; f.sqlite.close(); }
  });

  it('charges the approval-to-claim interval and prevents entry when that remaining budget expires', async () => {
    vi.useFakeTimers(); const f = fixture(); const claimEntered = gate(); const claimGate = gate();
    const claim = f.requests.claimApprovedContinuation.bind(f.requests);
    vi.spyOn(f.requests, 'claimApprovedContinuation').mockImplementation(async (id, revision) => {
      claimEntered.open(); await untilGate(claimGate.promise, f.params.abortSignal!);
      return claim(id, revision);
    });
    try {
      await f.entered.promise; await vi.advanceTimersByTimeAsync(20);
      f.startTools.open(); await vi.advanceTimersByTimeAsync(0);
      const [pending] = await f.requests.listPending(f.params.sessionId);
      await vi.advanceTimersByTimeAsync(500);
      await f.confirmations.resolveConfirmation(pending.id, f.params.sessionId);
      await claimEntered.promise;
      await vi.advanceTimersByTimeAsync(30);
      expect((await f.settled).error).toMatchObject({ code: 'SUBAGENT_TIMEOUT' });
      expect(f.write).not.toHaveBeenCalled();
    } finally { claimGate.open(); await f.runtime.stopAndDrainSessions(['parent']); await f.settled; f.sqlite.close(); }
  });

  it.each(['during persistence', 'before approval CAS', 'after approval CAS', 'before claim', 'after claim'] as const)(
    'Stop fences write admission %s', async boundary => {
      vi.useFakeTimers(); const f = fixture();
      let stop = Promise.resolve();
      const stopNow = () => { stop = f.runtime.stopAndDrainSessions(['parent']); };
      if (boundary === 'during persistence') {
        const create = f.requests.create.bind(f.requests);
        vi.spyOn(f.requests, 'create').mockImplementation(async input => {
          const row = await create(input); stopNow(); return row;
        });
      } else if (boundary.includes('approval CAS')) {
        const resolve = f.requests.resolve.bind(f.requests);
        vi.spyOn(f.requests, 'resolve').mockImplementation(async (id, revision, status, outcome) => {
          if (status === 'approved' && boundary === 'before approval CAS') stopNow();
          const committed = await resolve(id, revision, status, outcome);
          if (status === 'approved' && boundary === 'after approval CAS') stopNow();
          return committed;
        });
      } else {
        const claim = f.requests.claimApprovedContinuation.bind(f.requests);
        vi.spyOn(f.requests, 'claimApprovedContinuation').mockImplementation(async (id, revision) => {
          if (boundary === 'before claim') stopNow();
          const row = await claim(id, revision);
          if (boundary === 'after claim') stopNow();
          return row;
        });
      }
      try {
        await f.entered.promise; await vi.advanceTimersByTimeAsync(20);
        f.startTools.open(); await vi.advanceTimersByTimeAsync(0);
        if (boundary !== 'during persistence') {
          const [pending] = await f.requests.listPending(f.params.sessionId);
          expect(pending).toBeDefined();
          await f.confirmations.resolveConfirmation(pending.id, f.params.sessionId);
        }
        await stop; await f.settled;
        expect(f.params.abortSignal?.aborted).toBe(true);
        expect(f.write).not.toHaveBeenCalled();
        expect(await f.requests.listPending(f.params.sessionId)).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(500); expect(f.write).not.toHaveBeenCalled();
      } finally { await f.runtime.stopAndDrainSessions(['parent']); await f.settled; f.sqlite.close(); }
    },
  );
});

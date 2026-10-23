import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { HitlRequestService } from '../hitl/hitl-request.service';
import { ChatService } from './chat.service';
import { SessionPipelineService } from './session-pipeline.service';
import { SessionProfileAdmissionService } from './session-profile-admission.service';
import { RunJournalService } from './run-journal.service';
import { ChatGateway } from './chat.gateway';
import { SessionRuntimeStopService } from './session-runtime-stop.service';
import { sessionTreeStopAdmission } from '../../database/session-tree-stop-admission';
import { resolveToolConfirmation } from './chat.runtime-hitl';
import type { EmitFn, StreamContext } from './interfaces/stream-context.interface';
import type { LLMTurnRuntimeService } from './llm-turn-runtime.service';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function barrier<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const databases: Database.Database[] = [];
afterEach(() => { databases.splice(0).forEach((database) => database.close()); });

async function fixture() {
  const sqlite = new Database(':memory:');
  databases.push(sqlite);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
  db.insert(schema.personas).values({ id: 'persona', name: 'Test', model: 'mock', createdAt: new Date(1), updatedAt: new Date(1) }).run();
  db.insert(schema.sessions).values({ id: 'session', personaId: 'persona', createdAt: new Date(1), updatedAt: new Date(1) }).run();
  const database = new DrizzleService(null as never);
  (database as unknown as { db: unknown }).db = db;
  const durableJournal = new RunJournalService(database);
  await database.db.insert(schema.chatRuns).values({
    id: 'original-run', sessionId: 'session', turnId: 'original-turn', phase: 'tool_pending', status: 'waiting_for_human',
    startedAt: new Date(), updatedAt: new Date(), lastHeartbeatAt: new Date(), safeResume: false,
  });
  const requests = new HitlRequestService(database);
  await requests.create({
    id: 'approval', kind: 'tool_confirmation', sessionId: 'session', turnId: 'original-turn', runId: 'original-run', toolCallId: 'call',
    payload: { toolName: 'fs_write', args: { path: 'approved.txt', content: 'approved' } },
    continuation: {
      kind: 'approved_tool_then_resume_turn', executionState: 'pending', runtimeKind: 'chat',
      promptMessageId: 'original-prompt', iteration: 2, currentLimit: 8, historySessionId: 'history', vfsSessionId: 'vfs',
    },
  });
  const emit = vi.fn<EmitFn>();
  const manager = { ensureSession: vi.fn(), persistUserMessage: vi.fn(), saveToolResult: vi.fn().mockResolvedValue(undefined) };
  const sessions = {
    claimTreeStop: (id: string) => sessionTreeStopAdmission(db).claim(id),
    listChildren: vi.fn().mockResolvedValue([]), getMessages: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({ id: 'session', personaId: 'persona', projectId: 'project', executionProfileId: 'devin-swe-2', externalThreadId: 'thread' }),
  };
  const profile = { id: 'devin-swe-2', kind: 'devin-cli-acp', model: 'swe-2' };
  const profiles = { assertEnabled: vi.fn().mockResolvedValue(profile) };
  const assembled = { model: 'swe-2', effectiveSystemPrompt: 'system', toolMetas: [], personaConfig: { providerToolNames: ['fs_write'] } };
  const context = { assembleForSessionRuntime: vi.fn().mockResolvedValue(assembled) };
  const toolResult = { toolCallId: 'call', toolName: 'fs_write', status: 'success', data: { written: true } };
  const dispatch = { dispatchApproved: vi.fn().mockResolvedValue(toolResult), getPendingConfirmations: vi.fn().mockReturnValue([]) };
  const loopResult = { finalText: 'done', lastMessageId: 'assistant', finalLimit: 8, aborted: false, maxIterationsReached: false, emptyNoToolRetriesExhausted: false };
  const loop = { runAgentLoop: vi.fn().mockResolvedValue(loopResult) };
  const journal = {
    getTurn: vi.fn().mockImplementation((sessionId: string, turnId: string) => durableJournal.getTurn(sessionId, turnId)),
    getCurrentRun: vi.fn().mockResolvedValue(null),
    startRun: vi.fn().mockResolvedValue({ id: 'new-run' }), checkpoint: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined), fail: vi.fn().mockResolvedValue(undefined), interrupt: vi.fn().mockResolvedValue(undefined),
  };
  const lease = { release: vi.fn() };
  const scheduler = { acquire: vi.fn().mockResolvedValue(lease) };
  const chat = new ChatService(
    manager as never, {} as never, { log: vi.fn() } as never, loop as never, {} as never, sessions as never,
    journal as never, context as never, dispatch as never, requests, scheduler as never, profiles as never,
  );
  const pipeline = new SessionPipelineService(chat, journal as never, undefined, new SessionProfileAdmissionService());
  const approve = () => chat.approveAndResumeTool('approval', 'session', 'approved', emit);
  return { sqlite, requests, chat, pipeline, approve, emit, manager, sessions, context, profiles, profile, assembled, dispatch, toolResult, loop, loopResult, journal, durableJournal, scheduler, lease };
}

describe('restored HITL shared admission (isolated SQLite)', () => {
  it('labels a lost Devin continuation without incorrectly naming Codex', async () => {
    const f = await fixture();
    f.loop.runAgentLoop.mockImplementation(async (params: Parameters<LLMTurnRuntimeService['runAgentLoop']>[0]) => {
      params.onExternalRuntimeLost?.({ authProfileId: 'devin-local', processEpoch: 'epoch', reason: 'reset' });
      throw new Error('Devin host lost');
    });
    expect(await f.approve()).toBe(false);
    expect(f.journal.interrupt).toHaveBeenCalledWith('original-run', 'Turn interrupted because the external agent runtime was lost.');
    expect(f.emit).toHaveBeenCalledWith('chat:error', expect.objectContaining({
      code: 'INTERRUPTED', message: 'Turn interrupted because the external agent runtime was lost.',
    }));
  });

  it('persists a cancelled tool result with its original turn binding on idle Stop', async () => {
    const f = await fixture();
    await f.pipeline.stopAndDrain('session');
    expect(f.sqlite.prepare('SELECT content,turn_id,prompt_message_id FROM messages WHERE tool_call_id=?').get('call')).toEqual({
      content: '{"status":"cancelled","errorMessage":"Turn interrupted by user"}',
      turn_id: 'original-turn', prompt_message_id: 'original-prompt',
    });
    expect(f.dispatch.dispatchApproved).not.toHaveBeenCalled();
  });

  it.each([false, true])('durably cancels a pending confirmation on Stop (seeded=%s) before allowing follow-up', async (seeded) => {
    const f = await fixture();
    if (seeded) f.pipeline.seedActiveTurn('session', 'original-turn');
    f.journal.getCurrentRun.mockImplementation((id: string) => f.durableJournal.getCurrentRun(id));
    f.journal.getTurn.mockImplementation((sessionId: string, turnId: string) => f.durableJournal.getTurn(sessionId, turnId));
    const cleanup = barrier<void>();
    vi.spyOn(f.requests, 'cancelOrdinaryContinuationsRequired').mockImplementation(async (input) => {
      const result = HitlRequestService.prototype.cancelOrdinaryContinuationsRequired.call(f.requests, input);
      await cleanup.promise;
      return result;
    });
    let drained = false;
    const stop = f.pipeline.stopAndDrain('session').then(() => { drained = true; });
    const normal = vi.spyOn(f.chat, 'handleTurn').mockResolvedValue(undefined);
    const followUp = f.pipeline.submit({ sessionId: 'session', content: 'next', personaId: 'persona' }, f.emit);
    await flush();
    expect((await f.requests.getById('approval'))?.status).toBe('cancelled');
    expect(await f.durableJournal.getTurn('session', 'original-turn')).toMatchObject({ status: 'interrupted', safeResume: false });
    expect(f.journal.interrupt).not.toHaveBeenCalled();
    expect(drained).toBe(false);
    expect(normal).not.toHaveBeenCalled();
    cleanup.resolve();
    await Promise.all([stop, followUp]);
    expect(await f.durableJournal.getTurn('session', 'original-turn')).toMatchObject({ status: 'interrupted', phase: 'interrupted', safeResume: false });
    expect(await f.durableJournal.getCurrentRun('session')).toBeNull();
    expect(await f.approve()).toBe(false);
    expect(f.dispatch.dispatchApproved).not.toHaveBeenCalled();
    expect(normal).toHaveBeenCalledTimes(1);
  });

  it('projects durable cancelled/interrupted idle Stop through the gateway and rebuilds it after identify', async () => {
    const f = await fixture();
    f.journal.getCurrentRun.mockImplementation((id: string) => f.durableJournal.getCurrentRun(id));
    f.journal.getTurn.mockImplementation((sessionId: string, turnId: string) => f.durableJournal.getTurn(sessionId, turnId));
    f.journal.interrupt.mockImplementation((id: string, message: string) => f.durableJournal.interrupt(id, message));
    const gateway = new ChatGateway(f.dispatch as never, f.pipeline, {} as never, f.sessions as never,
      { onSessionCreated: vi.fn(), onSessionUpdated: vi.fn() } as never,
      { getPendingApprovals: vi.fn().mockReturnValue([]) } as never,
      undefined, undefined, undefined, undefined, f.requests, f.chat,
      new SessionRuntimeStopService(f.sessions as never, f.pipeline));
    const client = { id: 'socket', emit: vi.fn() };
    gateway.handleConnection(client as never);
    (gateway as unknown as { socketSessions: Map<string, Set<string>> }).socketSessions.get('socket')!.add('session');
    await gateway.handleChatStop(client as never, { sessionId: 'session' });
    expect(await f.durableJournal.getTurn('session', 'original-turn')).toMatchObject({ status: 'interrupted', safeResume: false });
    expect(await f.requests.listPendingToolConfirmations('session')).toEqual([]);
    expect(client.emit).toHaveBeenCalledWith('session:runtime_snapshot', expect.objectContaining({ active: false, pendingConfirmations: [] }));
    const resumeQueue = vi.spyOn(f.pipeline, 'resumeQueuedSession').mockResolvedValue(undefined);
    await gateway.handleSessionIdentify(client as never, { sessionId: 'session' });
    expect(resumeQueue).toHaveBeenCalled();
    expect(client.emit).not.toHaveBeenCalledWith('tool:confirmation_required', expect.anything());
    const snapshots = client.emit.mock.calls.filter(([event]) => event === 'session:runtime_snapshot');
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1][1]).toMatchObject({ active: false, pendingConfirmations: [] });
    expect(snapshots[1][1].run?.status).not.toBe('waiting_for_human');
    expect(await f.approve()).toBe(false);
    expect(f.dispatch.dispatchApproved).not.toHaveBeenCalled();
    expect(f.scheduler.acquire).not.toHaveBeenCalled();
  });

  it('adopts only the matching seeded turn and stale seeded cleanup cannot clear its worker', async () => {
    const f = await fixture();
    f.pipeline.seedActiveTurn('session', 'different-turn');
    expect(await f.approve()).toBe(false);
    expect(f.pipeline.getSessionStatus('session').turnId).toBe('different-turn');
    f.pipeline.clearSeededActiveTurn('session');
    f.pipeline.seedActiveTurn('session', 'original-turn');
    const tool = barrier<typeof f.toolResult>();
    f.dispatch.dispatchApproved.mockReturnValue(tool.promise);
    const approval = f.approve();
    await flush();
    f.pipeline.clearSeededActiveTurn('session');
    expect(f.pipeline.getSessionStatus('session')).toMatchObject({ active: true, turnId: 'original-turn' });
    tool.resolve(f.toolResult);
    expect(await approval).toBe(true);
    expect(f.dispatch.dispatchApproved).toHaveBeenCalledTimes(1);
    expect(await f.chat.resumeApprovedTool('approval', f.emit)).toBe(false);
  });

  it('reconciles Stop arriving during terminal journal persistence before releasing the worker', async () => {
    const f = await fixture();
    const completion = barrier<void>();
    f.journal.complete.mockReturnValue(completion.promise);
    const approval = f.approve();
    await flush();
    expect(f.journal.complete).toHaveBeenCalledTimes(1);
    const stop = f.pipeline.stopAndDrain('session');
    completion.resolve();
    await Promise.all([stop, approval]);
    expect(f.journal.interrupt).toHaveBeenCalledWith('original-run', 'Turn interrupted by user');
    expect((await f.requests.getById('approval'))?.continuation).toMatchObject({ executionState: 'tool_result_committed' });
    expect(await f.chat.resumeApprovedTool('approval', f.emit)).toBe(false);
    expect(f.dispatch.dispatchApproved).toHaveBeenCalledTimes(1);
  });

  it('uses pipeline admission through confirmation routing without reseeding the durable turn, prompt, or model', async () => {
    const f = await fixture();
    const claim = vi.spyOn(f.requests, 'claimApprovedContinuation');
    claim.mockImplementation(async (...args) => {
      expect(f.pipeline.getSessionStatus('session')).toMatchObject({ active: true, turnId: 'original-turn' });
      return HitlRequestService.prototype.claimApprovedContinuation.apply(f.requests, args);
    });
    await resolveToolConfirmation({
      payload: { requestId: 'approval', sessionId: 'session' },
      toolDispatch: { resolveConfirmation: vi.fn().mockResolvedValue('not_found') }, chatService: f.chat, emit: f.emit,
    });
    expect(f.journal.startRun).not.toHaveBeenCalled();
    expect(f.manager.persistUserMessage).not.toHaveBeenCalled();
    expect(f.profiles.assertEnabled).toHaveBeenCalledWith('devin-swe-2');
    expect(f.loop.runAgentLoop).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session', runId: 'original-run', turnId: 'original-turn', promptMessageId: 'original-prompt',
      executionProfile: f.profile, model: 'swe-2', externalThreadId: 'thread', providerCompletesTurn: true,
      historySessionId: 'history', vfsSessionId: 'vfs', resumeState: { iteration: 2, currentLimit: 8 },
    }));
    expect((await f.requests.getById('approval'))?.continuation).toMatchObject({ executionState: 'tool_result_committed' });
    expect(f.pipeline.getSessionStatus('session').active).toBe(false);
    expect(f.lease.release).toHaveBeenCalledTimes(1);
  });

  it('fences an approval whose initial metadata read crosses Stop, before any durable approval or effect', async () => {
    const f = await fixture();
    const pending = await f.requests.getById('approval');
    const metadata = barrier<typeof pending>();
    vi.spyOn(f.requests, 'getById').mockReturnValueOnce(metadata.promise);
    const resolve = vi.spyOn(f.requests, 'resolve');
    const claim = vi.spyOn(f.requests, 'claimApprovedContinuation');
    const approval = f.approve();
    await f.pipeline.stopAndDrain('session');
    metadata.resolve(pending);
    expect(await approval).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
    expect(await f.durableJournal.getTurn('session', 'original-turn')).toMatchObject({ status: 'interrupted', safeResume: false });
    expect(claim).not.toHaveBeenCalled();
    expect(f.dispatch.dispatchApproved).not.toHaveBeenCalled();
    expect((await f.requests.getById('approval'))?.status).toBe('cancelled');
  });

  it('cancels while the durable CAS is pending, then drains interruption cleanup before releasing admission', async () => {
    const f = await fixture();
    const claiming = barrier<void>();
    const cleanup = barrier<void>();
    vi.spyOn(f.requests, 'claimApprovedContinuation').mockImplementation(async (...args) => {
      await claiming.promise;
      return HitlRequestService.prototype.claimApprovedContinuation.apply(f.requests, args);
    });
    f.journal.interrupt.mockReturnValue(cleanup.promise);
    const approval = f.approve();
    await flush();
    let drained = false;
    const stop = f.pipeline.stopAndDrain('session').then(() => { drained = true; });
    claiming.resolve();
    await flush();
    expect(f.dispatch.dispatchApproved).not.toHaveBeenCalled();
    expect(f.journal.interrupt).toHaveBeenCalledWith('original-run', 'Turn interrupted by user');
    expect(drained).toBe(false);
    expect(f.pipeline.getSessionStatus('session').active).toBe(true);
    cleanup.resolve();
    await stop;
    expect(await approval).toBe(false);
    expect(f.pipeline.getSessionStatus('session').active).toBe(false);
  });

  it('retires approval committed across Stop without executing or leaving its cursor replayable', async () => {
    const f = await fixture();
    const approving = barrier<void>();
    vi.spyOn(f.requests, 'resolve').mockImplementation(async (...args) => {
      if (args[2] === 'approved') await approving.promise;
      return HitlRequestService.prototype.resolve.apply(f.requests, args);
    });
    const approval = f.approve();
    await flush();
    const stop = f.pipeline.stopAndDrain('session');
    approving.resolve();
    await Promise.all([stop, approval]);
    expect(f.dispatch.dispatchApproved).not.toHaveBeenCalled();
    expect(await f.chat.resumeApprovedTool('approval', f.emit)).toBe(false);
    expect(f.dispatch.dispatchApproved).not.toHaveBeenCalled();
  });

  it('cancels a pending tool and preserves its canonical result marker before Stop and follow-up drain', async () => {
    const f = await fixture();
    const tool = barrier<typeof f.toolResult>();
    const persistence = barrier<void>();
    const cleanup = barrier<void>();
    f.dispatch.dispatchApproved.mockReturnValue(tool.promise);
    f.manager.saveToolResult.mockReturnValue(persistence.promise);
    f.journal.interrupt.mockReturnValue(cleanup.promise);
    const approval = f.approve();
    await flush();
    const signal = (f.dispatch.dispatchApproved.mock.calls[0][3] as StreamContext).abortSignal;
    let drained = false;
    const stop = f.pipeline.stopAndDrain('session').then(() => { drained = true; });
    expect(signal.aborted).toBe(true);
    const normal = vi.spyOn(f.chat, 'handleTurn').mockResolvedValue(undefined);
    const followUp = f.pipeline.submit({ sessionId: 'session', content: 'follow-up', personaId: 'persona' }, f.emit);
    tool.resolve(f.toolResult);
    await flush();
    expect(f.manager.saveToolResult).toHaveBeenCalledWith('session', 'call', expect.any(String), {
      turnId: 'original-turn', promptMessageId: 'original-prompt',
    });
    expect(drained).toBe(false);
    expect(normal).not.toHaveBeenCalled();
    persistence.resolve();
    await flush();
    expect((await f.requests.getById('approval'))?.continuation).toMatchObject({ executionState: 'tool_result_committed' });
    expect(f.loop.runAgentLoop).not.toHaveBeenCalled();
    expect(f.lease.release).not.toHaveBeenCalled();
    expect(drained).toBe(false);
    cleanup.resolve();
    await stop;
    expect(await approval).toBe(false);
    await followUp;
    expect(normal).toHaveBeenCalledTimes(1);
    expect(f.lease.release).toHaveBeenCalledTimes(1);
    expect(await f.chat.resumeApprovedTool('approval', f.emit)).toBe(false);
    expect(f.dispatch.dispatchApproved).toHaveBeenCalledTimes(1);
  });

  it('allows at most one effect for simultaneous approvals through the durable CAS and shared slot', async () => {
    const f = await fixture();
    const tool = barrier<typeof f.toolResult>();
    f.dispatch.dispatchApproved.mockReturnValue(tool.promise);
    const first = f.approve();
    const second = f.approve();
    await flush();
    expect(f.dispatch.dispatchApproved).toHaveBeenCalledTimes(1);
    expect(await second).toBe(false);
    tool.resolve(f.toolResult);
    expect(await first).toBe(true);
    expect(f.dispatch.dispatchApproved).toHaveBeenCalledTimes(1);
  });

  it('leaves a restored approval pending while a normal turn owns admission', async () => {
    const f = await fixture();
    const work = barrier<void>();
    vi.spyOn(f.chat, 'handleTurn').mockReturnValue(work.promise);
    const normal = f.pipeline.submit({ sessionId: 'session', content: 'normal', personaId: 'persona' }, f.emit);
    expect(await f.approve()).toBe(false);
    expect((await f.requests.getById('approval'))?.status).toBe('pending');
    expect(f.dispatch.dispatchApproved).not.toHaveBeenCalled();
    work.resolve();
    await normal;
    expect(await f.approve()).toBe(true);
  });

  it('does not invalidate a still-pending confirmation rejected only by busy admission', async () => {
    const f = await fixture();
    const work = barrier<void>();
    vi.spyOn(f.chat, 'handleTurn').mockReturnValue(work.promise);
    const normal = f.pipeline.submit({ sessionId: 'session', content: 'normal', personaId: 'persona' }, f.emit);
    await resolveToolConfirmation({
      payload: { requestId: 'approval', sessionId: 'session' },
      toolDispatch: { resolveConfirmation: vi.fn().mockResolvedValue('not_found') }, chatService: f.chat, emit: f.emit,
    });
    expect(f.emit).not.toHaveBeenCalledWith('tool:confirmation_invalidated', expect.anything());
    expect((await f.requests.getById('approval'))?.status).toBe('pending');
    expect(f.dispatch.dispatchApproved).not.toHaveBeenCalled();
    work.resolve();
    await normal;
    expect(await f.approve()).toBe(true);
  });

  it('releases admission after a failed claim and admits the next normal turn', async () => {
    const f = await fixture();
    vi.spyOn(f.requests, 'claimApprovedContinuation').mockResolvedValueOnce(null);
    expect(await f.approve()).toBe(false);
    expect(f.pipeline.getSessionStatus('session').active).toBe(false);
    expect(f.dispatch.dispatchApproved).not.toHaveBeenCalled();
    const normal = vi.spyOn(f.chat, 'handleTurn').mockResolvedValue(undefined);
    await f.pipeline.submit({ sessionId: 'session', content: 'next', personaId: 'persona' }, f.emit);
    expect(normal).toHaveBeenCalledTimes(1);
  });

  it.each(['session', 'profile', 'assembly'] as const)('releases admission after failed %s preparation without a replayable effect', async (stage) => {
    const f = await fixture();
    const target = stage === 'session' ? f.sessions.get : stage === 'profile' ? f.profiles.assertEnabled : f.context.assembleForSessionRuntime;
    target.mockRejectedValue(new Error('preparation failed'));
    expect(await f.approve()).toBe(false);
    expect(f.pipeline.getSessionStatus('session').active).toBe(false);
    expect(f.dispatch.dispatchApproved).not.toHaveBeenCalled();
    expect(f.journal.fail).toHaveBeenCalledWith('original-run', 'TOOL_EXECUTION_FAILED', 'preparation failed');
  });

  it.each(['false', 'throws'] as const)('keeps effects non-replayable when result acknowledgement %s', async (mode) => {
    const f = await fixture();
    const marker = vi.spyOn(f.requests, 'markContinuationToolResult');
    if (mode === 'false') marker.mockResolvedValue(false);
    else marker.mockRejectedValue(new Error('ack unavailable'));
    expect(await f.approve()).toBe(false);
    expect(f.manager.saveToolResult).toHaveBeenCalledTimes(1);
    expect((await f.requests.getById('approval'))?.continuation).toMatchObject({ executionState: 'claimed' });
    expect(await f.chat.resumeApprovedTool('approval', f.emit)).toBe(false);
    expect(f.dispatch.dispatchApproved).toHaveBeenCalledTimes(1);
    expect(f.loop.runAgentLoop).not.toHaveBeenCalled();
  });

  it('stops a resumed LLM wait, preserving the committed tool marker and waiting for journal cleanup', async () => {
    const f = await fixture();
    const llm = barrier<typeof f.loopResult>();
    f.loop.runAgentLoop.mockReturnValue(llm.promise);
    const approval = f.approve();
    await flush();
    const signal = (f.loop.runAgentLoop.mock.calls[0][0] as Parameters<LLMTurnRuntimeService['runAgentLoop']>[0]).abortSignal;
    const stop = f.pipeline.stopAndDrain('session');
    expect(signal.aborted).toBe(true);
    llm.resolve({ ...f.loopResult, aborted: true });
    await stop;
    await approval;
    expect(f.journal.complete).not.toHaveBeenCalled();
    expect(f.journal.interrupt).toHaveBeenCalledWith('original-run', 'Turn interrupted by user');
    expect((await f.requests.getById('approval'))?.continuation).toMatchObject({ executionState: 'tool_result_committed' });
  });

  it('cancels a normal reservation while startRun awaits, before ChatService registers its controller', async () => {
    const f = await fixture();
    const started = barrier<{ id: string }>();
    f.journal.startRun.mockReturnValue(started.promise);
    const normal = f.pipeline.submit({ sessionId: 'session', content: 'normal', personaId: 'persona' }, f.emit);
    await flush();
    const stop = f.pipeline.stopAndDrain('session');
    started.resolve({ id: 'new-run' });
    await stop;
    await normal;
    expect(f.manager.ensureSession).not.toHaveBeenCalled();
    expect(f.manager.persistUserMessage).not.toHaveBeenCalled();
    expect(f.loop.runAgentLoop).not.toHaveBeenCalled();
    expect(f.journal.interrupt).toHaveBeenCalledWith('new-run', expect.any(String));
  });
});

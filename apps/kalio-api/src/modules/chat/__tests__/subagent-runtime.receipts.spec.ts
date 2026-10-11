import { describe, expect, it, vi } from 'vitest';
import type { ChatRunSnapshot } from '@kalio/types';
import { SubagentRuntimeService } from '../subagent-runtime.service';
import type { LLMAgentLoopRequest } from '../llm-turn-runtime.types';
import { readHostCancellationRecordingPermit } from '../host-cancellation-recording-scope';

function fixture(fail?: 'drain' | 'journalComplete' | 'completeRequired' | 'terminalSave', loopGate?: Promise<void>) {
  const order: string[] = [];
  const observer = {
    admit: vi.fn(async () => undefined), commit: vi.fn(async () => undefined),
    drain: vi.fn(async () => { order.push('drain'); if (fail === 'drain') throw new Error('drain rejected'); }),
    journalComplete: vi.fn(async () => { order.push('journalComplete'); if (fail === 'journalComplete') throw new Error('observer rejected'); }),
  };
  let received: LLMAgentLoopRequest | undefined;
  let current: ChatRunSnapshot;
  const journal = {
    startRun: vi.fn(async (input: { sessionId: string; turnId: string }) => {
      current = { id: 'journal', ...input, phase: 'started', status: 'active', revision: 1, retryCount: 0, safeResume: false, startedAt: 1, updatedAt: 1, lastHeartbeatAt: 1 };
      return current;
    }),
    checkpoint: vi.fn(async () => { current = { ...current, phase: 'llm_streaming', revision: 9 }; }),
    getTurn: vi.fn(async () => { order.push('readRevision'); return current; }),
    complete: vi.fn(async () => { order.push('legacyComplete'); }),
    completeRequired: vi.fn(async (id: string, revision: number, outcome: ChatRunSnapshot['outcome']) => {
      order.push('completeRequired');
      if (fail === 'completeRequired' || id !== current.id || revision !== current.revision) throw new Error('completion conflict');
      current = { ...current, revision: revision + 1, phase: 'completed', status: 'completed', outcome };
      return current;
    }),
    fail: vi.fn(async () => { current = { ...current, phase: 'failed', status: 'failed' }; }),
  };
  const loop = { runAgentLoop: vi.fn(async (request: LLMAgentLoopRequest) => {
    received = request;
    await journal.checkpoint();
    await loopGate;
    if (request.abortSignal.aborted) throw new Error('loop drained after abort');
    return { lastMessageId: 'assistant', finalText: '', exhausted: false, aborted: false, iterationCount: 1, finalLimit: 1, emptyNoToolRetriesExhausted: false, maxIterationsReached: false };
  }) };
  const parent = { id: 'parent', projectId: 'project', executionProfileId: 'profile', runtimeContext: { runtimeKind: 'chat', architectureContext: { executionCwd: '/approved/src' } } };
  const children = new Map<string, object>();
  const sessions = {
    get: vi.fn(async (id: string) => id === 'parent' ? parent : children.get(id)),
    createWithId: vi.fn(async (id: string, input: object) => { const child = { id, ...input, projectId: parent.projectId, executionProfileId: parent.executionProfileId, createdAt: 1, updatedAt: 1 }; children.set(id, child); return child; }),
    updateRuntimeContext: vi.fn(async (id: string, runtimeContext: object) => { children.set(id, { ...children.get(id), runtimeContext }); }),
  };
  const profile = { id: 'profile', model: 'swe-2', provider: 'devin', enabled: true };
  const profiles = { assertEnabled: vi.fn(async () => profile) };
  const projects = { assertAssignable: vi.fn(async () => ({ id: 'project', path: '/approved', kind: 'workspace' })) };
  const vfs = { copySessionFiles: () => { order.push('copy'); return []; }, assertProjectExecutionCwd: vi.fn(() => ({ projectRoot: '/approved', cwd: '/approved/src' })) };
  const messages = {
    persistUserMessage: vi.fn(async () => ({ id: 'prompt' })),
    persistAssistantMessage: vi.fn(async () => { order.push('terminalSave'); if (fail === 'terminalSave') throw new Error('save rejected'); }),
  };
  const replay = { replay: vi.fn(async () => ({ result: 'replayed' })) };
  const runtime = new SubagentRuntimeService({} as never, loop as never, messages as never, sessions as never,
    vfs as never,
    { assembleForRuntime: async () => ({ effectiveSystemPrompt: '', toolMetas: [] }) } as never,
    { decide: async () => ({ tools: [], allowedToolNames: [] }) } as never,
    { requestAdditionalBudget: async () => null } as never, undefined, journal as never, replay as never, profiles as never, undefined, undefined, projects as never);
  const run = (extras = {}) => runtime.runSubagent({ parentSessionId: 'parent', parentToolCallId: 'parent-call', objective: 'fixture', timeoutMs: 1000, vfsMode: 'isolated', copyOutputs: true, hostRuntimeReceiptObserver: observer, ...extras });
  return { run, runtime, observer, journal, loop, replay, messages, order, parent, sessions, children, profiles, profile, projects, vfs, get received() { return received; }, get current() { return current; } };
}

describe('subagent owns the final receipt drain and durable completion ACK', () => {
  it('connects actual observed service Stop to its bounded cancellation handle', async () => {
    let release!: () => void;
    const f = fixture(undefined, new Promise<void>(resolve => { release = resolve; }));
    const running = f.run();
    const rejected = expect(running).rejects.toThrow('loop drained after abort');
    await vi.waitFor(() => expect(f.received?.hostCancellationRecording).toBeDefined());
    const request = f.received!;
    const handle = request.hostCancellationRecording!;
    const identity = { runId: request.runId!, sessionId: request.sessionId, turnId: request.turnId!, promptMessageId: request.promptMessageId! };
    const recorder = {};
    await handle.registerAdmission({ identity, callId: 'call', toolName: 'read', args: {} }, recorder, f.observer.admit());
    const stopping = f.runtime.stopAndDrainSessions(['parent']);
    expect(request.abortSignal.aborted).toBe(true);
    const permit = handle.permitFor('call', recorder)!;
    const lease = readHostCancellationRecordingPermit(permit, identity, 'call', recorder);
    expect(lease.signal.aborted).toBe(false);
    release();
    await rejected;
    await stopping;
    expect(lease.signal.aborted).toBe(true);
    expect(f.observer.drain).not.toHaveBeenCalled();
    expect(f.observer.journalComplete).not.toHaveBeenCalled();
    expect(f.journal.completeRequired).not.toHaveBeenCalled();
  });

  it('uses persisted project cwd and exact persisted profile, not request context/model overrides', async () => {
    const f = fixture();
    await f.run({ model: 'invented', architectureContext: { projectPath: '/foreign', executionCwd: '/foreign', provider: 'invented' } });
    expect(f.received?.cwd).toBe('/approved/src');
    expect(f.received?.executionProfile).toBe(f.profile);
    expect(f.received?.model).toBe('swe-2');
    expect(f.vfs.assertProjectExecutionCwd).toHaveBeenCalledWith('/approved', '/approved/src');
    expect(f.profiles.assertEnabled).toHaveBeenCalledWith('profile');
    const persisted = [...f.children.values()][0];
    expect(persisted).toHaveProperty('runtimeContext.architectureContext.projectPath', '/approved');
    expect(JSON.stringify(persisted)).not.toContain('hostRuntimeReceiptObserver');
  });

  it.each(['project', 'profile'] as const)('fails closed before execution when persisted %s is missing', async missing => {
    const f = fixture();
    if (missing === 'project') f.parent.projectId = 'system:none';
    else f.parent.executionProfileId = '';
    await expect(f.run()).rejects.toThrow();
    expect(f.loop.runAgentLoop).not.toHaveBeenCalled();
    expect(f.messages.persistUserMessage).not.toHaveBeenCalled();
  });

  it('rejects a child with foreign parent/project/profile linkage before bootstrap writes', async () => {
    const f = fixture();
    f.children.set('child', { id: 'child', kind: 'subagent', parentSessionId: 'foreign', projectId: 'project', executionProfileId: 'profile' });
    await expect(f.run({ childSessionId: 'child' })).rejects.toThrow();
    expect(f.sessions.updateRuntimeContext).not.toHaveBeenCalled();
    expect(f.loop.runAgentLoop).not.toHaveBeenCalled();
  });

  it('reloads a precreated child after replacing stale request-derived context', async () => {
    const f = fixture();
    f.children.set('child', { id: 'child', kind: 'subagent', parentSessionId: 'parent', projectId: 'project', executionProfileId: 'profile', runtimeContext: { runtimeKind: 'subagent', architectureContext: { executionCwd: '/stale' } } });
    await f.run({ childSessionId: 'child', architectureContext: { executionCwd: '/foreign' } });
    expect(f.sessions.updateRuntimeContext).toHaveBeenCalledOnce();
    expect(f.sessions.get.mock.calls.filter(([id]) => id === 'child').length).toBeGreaterThanOrEqual(3);
    expect(f.received?.cwd).toBe('/approved/src');
  });
  it('forwards the same capability and drains after copy/terminal writes, using the observed checkpoint revision', async () => {
    const f = fixture(); await f.run();
    expect(f.received).toHaveProperty('hostRuntimeReceiptObserver', f.observer);
    expect(f.order).toEqual(['copy', 'terminalSave', 'drain', 'readRevision', 'completeRequired', 'journalComplete']);
    expect(f.journal.completeRequired).toHaveBeenCalledWith('journal', 9, expect.objectContaining({ messageId: expect.any(String) }));
    expect(f.observer.drain).toHaveBeenCalledOnce();
    expect(f.observer.journalComplete).toHaveBeenCalledWith(expect.objectContaining({ runId: 'journal', promptMessageId: 'prompt' }), expect.objectContaining({ id: 'journal', revision: 10, status: 'completed' }));
    expect(f.journal.complete).not.toHaveBeenCalled();
  });

  it.each(['drain', 'completeRequired', 'terminalSave'] as const)('does not acknowledge completion after %s failure', async fail => {
    const f = fixture(fail); await expect(f.run()).rejects.toThrow();
    expect(f.observer.journalComplete).not.toHaveBeenCalled();
    expect(f.loop.runAgentLoop).toHaveBeenCalledOnce();
    if (fail === 'terminalSave') {
      expect(f.journal.completeRequired).not.toHaveBeenCalled();
      expect(f.messages.persistAssistantMessage).toHaveBeenCalledOnce();
      expect(f.observer.drain).not.toHaveBeenCalled();
    }
  });

  it('preserves an atomically completed journal when its post-ACK observer rejects', async () => {
    const f = fixture('journalComplete'); await expect(f.run()).rejects.toThrow('observer rejected');
    expect(f.current.status).toBe('completed');
    expect(f.journal.fail).not.toHaveBeenCalled();
    expect(f.messages.persistAssistantMessage).toHaveBeenCalledOnce();
    expect(f.loop.runAgentLoop).toHaveBeenCalledOnce();
  });

  it('rejects observer-bound replay before calling the replay service or model', async () => {
    const f = fixture(); await expect(f.run({ resumeTurnId: 'old-turn' })).rejects.toThrow();
    expect(f.replay.replay).not.toHaveBeenCalled();
    expect(f.loop.runAgentLoop).not.toHaveBeenCalled();
  });

  it('does not release a timed-out observed run before its actual loop and writes settle', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const f = fixture(undefined, gate);
    let settled = false;
    const run = f.run({ timeoutMs: 20 }).catch(error => { settled = true; throw error; });
    const rejection = expect(run).rejects.toThrow('timed out');
    await vi.waitFor(() => expect(f.received?.abortSignal.aborted).toBe(true));
    const prematurelySettled = settled;
    release();
    await rejection;
    expect(prematurelySettled).toBe(false);
    expect(f.observer.journalComplete).not.toHaveBeenCalled();
  });

  it('does not complete if the run aborts while awaiting observer drain', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const f = fixture();
    f.observer.drain.mockImplementation(async () => { await gate; });
    const run = f.run({ timeoutMs: 20 });
    const rejection = expect(run).rejects.toThrow(/aborted|timed out/);
    await vi.waitFor(() => expect(f.received?.abortSignal.aborted).toBe(true));
    release(); await rejection;
    expect(f.journal.completeRequired).not.toHaveBeenCalled();
    expect(f.observer.journalComplete).not.toHaveBeenCalled();
  });
});

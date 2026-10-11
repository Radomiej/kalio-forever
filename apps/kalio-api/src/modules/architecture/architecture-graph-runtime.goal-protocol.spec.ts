import type { ArchitectureExecutionEvent, ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import { describe, expect, it, vi } from 'vitest';
import { createArchitectureGraphEvents, type GraphRuntimeOptions } from './architecture-graph-runtime';
import { appendGoalSource, createGoalPacket } from './architecture-goal-source';
import { acceptGoalProjection, goalProjectionPolicyTargets, prepareGoalProjection } from './architecture-goal-projection';
import type { ArchitectureGoalState } from './architecture-goal.repository';
import type { ArchitectureRoleExecutor } from './architecture-role-executor';

const raw = { sourceVersion: 1, criteria: [{ text: 'Build feature', sourceQuotes: [{ messageId: 'prompt', quote: 'Build feature' }], supersedes: [] }] };
function fixture() {
  const schema: ArchitectureSchema = {
    id: 'goal', name: 'Goal', description: 'Goal fixture', version: '1',
    roleSlots: ['worker', 'judge'].map(id => ({ id, label: id, description: id, slotType: 'participant', defaultPersonaId: id,
      allowedPersonaTags: [], required: true, canOverrideAtRunStart: false })),
    nodes: [{ id: 'worker', label: 'Worker', kind: 'role', roleSlotId: 'worker' },
      { id: 'judge', label: 'Judge', kind: 'role', roleSlotId: 'judge' }, { id: 'end', label: 'End', kind: 'artifact' }],
    edges: [{ id: 'wj', fromNodeId: 'worker', toNodeId: 'judge' }, { id: 'jw', fromNodeId: 'judge', toNodeId: 'worker', selection: 'continuation' }, { id: 'je', fromNodeId: 'judge', toNodeId: 'end' }],
    routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: true, canReturnNeedsMoreResearch: true },
    contextPolicy: { includeUserTask: true, includeProjectMemory: false, includeBrowserSession: false, includePriorDecisions: false },
    memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true }, outputArtifactSchema: 'goal',
  };
  const packet = createGoalPacket({ messageId: 'prompt', sessionId: 'host', turnId: 'turn', content: 'Build feature', createdAt: 1 });
  const run: ArchitectureRun = { id: 'run', schemaId: schema.id, rootSessionId: 'root', prompt: packet.original.content,
    executionMode: 'subagent_execution', branchSessionIds: { worker: 'worker-session', judge: 'judge-session' },
    context: { goalProtocol: 1 }, goalPacket: packet, status: 'running', createdAt: 1, updatedAt: 1 };
  let state: ArchitectureGoalState = { runId: run.id, rootSessionId: run.rootSessionId!, stateRevision: 1, packet,
    createdAt: 1, updatedAt: 1, evidenceInventory: null, completionAuthorization: null };
  const events: ArchitectureExecutionEvent[] = [];
  const execute = vi.fn<ArchitectureRoleExecutor['execute']>(async () => ({ message: 'Untrusted prose', data: {}, structuredOutput: raw }));
  const adapter: NonNullable<GraphRuntimeOptions['goalProtocol']> = {
    workerNodeId: 'worker', judgeNodeId: 'judge', completionNodeIds: ['end'],
    beforeBatch: vi.fn<NonNullable<GraphRuntimeOptions['goalProtocol']>['beforeBatch']>(async () => ({ kind: state.packet.projection.status === 'pending' && state.packet.projection.proposal ? 'projection_judge' : 'proposal', state: structuredClone(state) })),
    recordProposal: vi.fn(async () => {
      const packet = structuredClone(state.packet);
      if (packet.projection.status !== 'pending') throw new Error('fixture');
      packet.projection.proposal = prepareGoalProjection(packet, raw);
      state = { ...state, stateRevision: state.stateRevision + 1, packet };
      return structuredClone(state);
    }),
    judgeProjection: vi.fn<NonNullable<GraphRuntimeOptions['goalProtocol']>['judgeProjection']>(async () => ({ status: 'rejected', state: structuredClone(state) })),
    judgeCompletion: vi.fn(async () => ({ state: structuredClone(state), selection: { status: 'needs_user' as const, reason: 'uncertain' as const } })),
    persistRouteRequired: vi.fn(async () => undefined),
    persistPauseRequired: vi.fn(async () => undefined),
  };
  // Protocol fixture only; actual receipt persistence is exercised by producer integration tests.
  const options: GraphRuntimeOptions = { schema, run, now: 1, roleExecutor: { execute }, personaForSlot: slot => slot.id,
    signal: new AbortController().signal,
    openGoalWorkerAttempt: vi.fn(async () => ({ observer: {
      admit: vi.fn(async () => undefined), commit: vi.fn(async () => undefined),
      drain: vi.fn(async () => undefined), journalComplete: vi.fn(async () => undefined),
    }, finish: vi.fn(async () => undefined) })),
    persistGoalVisit: vi.fn(async () => undefined), goalProtocol: adapter, onEvent: event => events.push(event) };
  return { options, adapter, events, execute, state: () => state, setState: (next: ArchitectureGoalState) => { state = next; } };
}

describe('graph goal protocol gate', () => {
  it('awaits start ACK before role execution or local start publication', async () => {
    const f = fixture(); let release!: () => void; let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.options.persistGoalVisit = vi.fn(async input => {
      if (input.event.type === 'node_started' && input.node.id === 'worker') {
        entered(); await new Promise<void>(resolve => { release = resolve; });
      }
    });
    const running = createArchitectureGraphEvents(f.options); await started;
    expect(f.execute).not.toHaveBeenCalled(); expect(f.events.some(event => event.type === 'node_started')).toBe(false);
    release(); await running; expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it('keeps existing route ACK before completed ACK, and blocks next judge until completed ACK', async () => {
    const f = fixture(); let release!: () => void; let entered!: () => void;
    const completed = new Promise<void>(resolve => { entered = resolve; });
    f.options.persistGoalVisit = vi.fn(async input => {
      if (input.event.type === 'node_completed') {
        expect(f.adapter.persistRouteRequired).toHaveBeenCalledTimes(1);
        entered(); await new Promise<void>(resolve => { release = resolve; });
      }
    });
    const running = createArchitectureGraphEvents(f.options); await completed;
    expect(f.adapter.judgeProjection).not.toHaveBeenCalled();
    expect(f.events.some(event => event.type === 'node_completed')).toBe(false);
    release(); await running; expect(f.adapter.judgeProjection).toHaveBeenCalledTimes(1);
  });
  it('missing visit hook prevents goal execution', async () => {
    const f = fixture(); delete f.options.persistGoalVisit;
    await expect(createArchitectureGraphEvents(f.options)).rejects.toThrow('Goal graph visit failed.');
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('Stop during start ACK prevents role execution', async () => {
    const f = fixture(); f.options.persistGoalVisit = vi.fn(async () => { f.options.run.status = 'cancelled'; });
    await createArchitectureGraphEvents(f.options);
    expect(f.execute).not.toHaveBeenCalled(); expect(f.events.some(event => event.type === 'node_started')).toBe(false);
  });
  it('Stop during completed ACK prevents next judge and completed publication', async () => {
    const f = fixture(); f.options.persistGoalVisit = vi.fn(async input => {
      if (input.event.type === 'node_completed') f.options.run.status = 'cancelled';
    });
    await createArchitectureGraphEvents(f.options);
    expect(f.adapter.persistRouteRequired).toHaveBeenCalledTimes(1);
    expect(f.adapter.judgeProjection).not.toHaveBeenCalled();
    expect(f.events.some(event => event.type === 'node_completed')).toBe(false);
  });
  it('recovery re-ACKs the exact persisted start before execution without duplicating it', async () => {
    const f = fixture();
    const start: ArchitectureExecutionEvent = { id: 'run:event:3', runId: 'run', sequence: 3, type: 'node_started',
      nodeId: 'worker', roleSlotId: 'worker', message: 'Started', createdAt: 3, data: { goalVisit: 1 } };
    f.options.priorEvents = [start];
    f.options.resumeFrom = { reason: 'runtime_recovery', pendingNodeIds: ['worker'], visitCounts: {}, resumeStartedNodeIds: ['worker'] };
    const visit = vi.fn<NonNullable<GraphRuntimeOptions['persistGoalVisit']>>(async input => {
      if (input.replay) expect(f.execute).not.toHaveBeenCalled();
    }); f.options.persistGoalVisit = visit;
    const events = await createArchitectureGraphEvents(f.options);
    expect(visit.mock.calls[0]?.[0]).toMatchObject({ replay: true, startedEventId: start.id, event: start });
    expect(events.filter(event => event.type === 'node_started' && event.nodeId === 'worker')).toEqual([start]);
  });
  function acceptFixture(state: ArchitectureGoalState): ArchitectureGoalState {
    if (state.packet.projection.status !== 'pending' || !state.packet.projection.proposal) throw new Error('fixture');
    const proposal = state.packet.projection.proposal;
    const targets = goalProjectionPolicyTargets(state.packet, proposal);
    // Fixture reviewer authorization only; the graph never constructs a review binding.
    const packet = acceptGoalProjection(state.packet, proposal, { requiredEvidenceKindsByCriterion: Object.fromEntries(targets.map(row => [row.id, ['BUILD_RESULT']])) },
      { sourceVersion: state.packet.version, sourceFingerprint: state.packet.sourceFingerprint, proposalFingerprint: proposal.proposalFingerprint, accepted: true });
    return { ...state, packet, stateRevision: state.stateRevision + 2 };
  }
  it('accepted projection permits ready work but never authorizes completion', async () => {
    const f = fixture();
    f.adapter.judgeProjection = vi.fn<NonNullable<GraphRuntimeOptions['goalProtocol']>['judgeProjection']>(async () => {
      const next = acceptFixture(f.state());
      f.setState(next);
      return { status: 'accepted', state: next };
    });
    const initial = f.adapter.beforeBatch;
    f.adapter.beforeBatch = vi.fn<NonNullable<GraphRuntimeOptions['goalProtocol']>['beforeBatch']>(async input => f.state().packet.projection.status === 'accepted'
      ? input.readyNodeIds.includes('worker') ? { kind: 'work', state: f.state(), executableNodeIds: ['worker'] }
        : { kind: 'completion_judge', state: f.state() } : initial(input));
    const events = await createArchitectureGraphEvents(f.options);
    expect(f.execute).toHaveBeenCalledTimes(2);
    expect(f.execute.mock.calls[1]?.[0]).not.toHaveProperty('purpose');
    expect(events.filter(event => event.type === 'node_completed').map(event => event.nodeId)).toEqual(['worker', 'judge', 'worker']);
    expect(events.at(-1)).toMatchObject({ reasonCode: 'runtime_pause', data: { pendingNodeIds: ['judge'] } });
    expect(events.some(event => event.type === 'final_artifact')).toBe(false);
  });
  it('rejects accepted output from a different proposal even with a valid snapshot fingerprint', async () => {
    const f = fixture();
    f.adapter.judgeProjection = vi.fn<NonNullable<GraphRuntimeOptions['goalProtocol']>['judgeProjection']>(async () => {
      const different = structuredClone(f.state());
      if (different.packet.projection.status !== 'pending') throw new Error('fixture');
      different.packet.projection.proposal = prepareGoalProjection(different.packet, { ...raw, criteria: [{ ...raw.criteria[0]!, text: 'Other criterion' }] });
      return { status: 'accepted', state: acceptFixture(different) };
    });
    await expect(createArchitectureGraphEvents(f.options)).rejects.toMatchObject({ code: 'CONTRACT_VIOLATION' });
    expect(f.events.some(event => event.type === 'node_completed' && event.nodeId === 'judge')).toBe(false);
  });
  it('rejects source changes returned after deferred judge review, including rejected results', async () => {
    const f = fixture();
    let release!: () => void;
    f.adapter.judgeProjection = vi.fn<NonNullable<GraphRuntimeOptions['goalProtocol']>['judgeProjection']>(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      return { status: 'rejected', state: f.state() };
    });
    const execution = createArchitectureGraphEvents(f.options);
    const rejection = expect(execution).rejects.toMatchObject({ code: 'CONTRACT_VIOLATION' });
    await vi.waitFor(() => expect(f.adapter.judgeProjection).toHaveBeenCalledTimes(1));
    f.setState({ ...f.state(), stateRevision: f.state().stateRevision + 1,
      packet: appendGoalSource(f.state().packet, { ...f.state().packet.original, messageId: 'next', turnId: 'next-turn', content: 'New source' }) });
    release();
    await rejection;
    expect(f.adapter.persistPauseRequired).not.toHaveBeenCalled();
  });
  it('does not publish worker completion until recordProposal ACK resolves', async () => {
    const f = fixture();
    const original = f.adapter.recordProposal;
    let release!: () => void;
    f.adapter.recordProposal = vi.fn(async input => {
      await new Promise<void>(resolve => { release = resolve; });
      return original(input);
    });
    const execution = createArchitectureGraphEvents(f.options);
    await vi.waitFor(() => expect(f.adapter.recordProposal).toHaveBeenCalledTimes(1));
    expect(f.events.some(event => event.type === 'node_completed')).toBe(false);
    expect(f.adapter.judgeProjection).not.toHaveBeenCalled();
    release();
    await execution;
    expect(f.events.some(event => event.type === 'node_completed' && event.nodeId === 'worker')).toBe(true);
  });
  it.each(['stop', 'mutation', 'recoverable'])('accepted work cannot finish after %s', async boundary => {
    const f = fixture();
    const pending = structuredClone(f.state());
    if (pending.packet.projection.status !== 'pending') throw new Error('fixture');
    pending.packet.projection.proposal = prepareGoalProjection(pending.packet, raw);
    f.setState(acceptFixture(pending));
    f.options.resumeFrom = { reason: 'runtime_recovery', pendingNodeIds: ['worker'], visitCounts: {} };
    f.adapter.beforeBatch = async () => ({ kind: 'work', state: f.state(), executableNodeIds: ['worker'] });
    const controller = new AbortController();
    f.options.signal = controller.signal;
    f.execute.mockImplementation(async () => {
      if (boundary === 'stop') controller.abort();
      else if (boundary === 'mutation') f.options.run.goalPacket = appendGoalSource(f.state().packet, { ...f.state().packet.original, messageId: 'next', turnId: 'next-turn', content: 'More' });
      else throw Object.assign(new Error('private provider detail'), { code: 'TIMEOUT' });
      return { message: 'Work', data: {} };
    });
    const execution = createArchitectureGraphEvents(f.options);
    if (boundary === 'stop') await execution;
    else await expect(execution).rejects.toMatchObject({ code: 'CONTRACT_VIOLATION' });
    expect(f.events.some(event => event.type === 'node_completed' || event.type === 'participant_output')).toBe(false);
    expect(JSON.stringify(f.events)).not.toContain('private provider detail');
  });
  it('hydrates a newer canonical packet instead of using stale in-memory proposal', async () => {
    const f = fixture();
    const next = appendGoalSource(f.state().packet, { ...f.state().packet.original, messageId: 'next', turnId: 'next-turn', content: 'More source' });
    f.setState({ ...f.state(), stateRevision: 2, packet: next });
    f.adapter.beforeBatch = vi.fn<NonNullable<GraphRuntimeOptions['goalProtocol']>['beforeBatch']>(async () => ({ kind: 'pause', state: f.state() }));
    await createArchitectureGraphEvents(f.options);
    expect(f.options.run.goalPacket).toEqual(next);
    expect(f.options.run.goalPacket).not.toBe(next);
    expect(f.options.run.prompt).toBe('Build feature');
  });
  it('empty recovery cursor pauses rather than falling back to graph roots', async () => {
    const f = fixture();
    f.options.resumeFrom = { reason: 'runtime_recovery', pendingNodeIds: ['removed'], visitCounts: {} };
    const events = await createArchitectureGraphEvents(f.options);
    expect(f.execute).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ reasonCode: 'runtime_pause', data: { pendingNodeIds: [] } });
  });
  it('pause persistence failure emits typed failure and never publishes waiting', async () => {
    const f = fixture();
    f.adapter.beforeBatch = vi.fn<NonNullable<GraphRuntimeOptions['goalProtocol']>['beforeBatch']>(async () => ({ kind: 'pause', state: f.state() }));
    f.adapter.persistPauseRequired = vi.fn(async () => { throw new Error('private store detail'); });
    await expect(createArchitectureGraphEvents(f.options)).rejects.toMatchObject({ code: 'CONTRACT_VIOLATION' });
    expect(f.events.some(event => event.reasonCode === 'runtime_pause')).toBe(false);
    expect(JSON.stringify(f.events)).not.toContain('private store detail');
  });
  it.each(['worker', 'record', 'judge', 'pause'])('Stop during %s await prevents post-ACK execution', async boundary => {
    const f = fixture();
    const controller = new AbortController();
    f.options.signal = controller.signal;
    if (boundary === 'worker') f.execute.mockImplementation(async () => { controller.abort(); return { message: '', data: {}, structuredOutput: raw }; });
    if (boundary === 'record') {
      const original = f.adapter.recordProposal;
      f.adapter.recordProposal = async input => { const state = await original(input); controller.abort(); return state; };
    }
    if (boundary === 'judge') f.adapter.judgeProjection = async () => { controller.abort(); return { status: 'rejected', state: f.state() }; };
    if (boundary === 'pause') {
      f.adapter.beforeBatch = async () => ({ kind: 'pause', state: f.state() });
      f.adapter.persistPauseRequired = async () => { controller.abort(); };
    }
    const events = await createArchitectureGraphEvents(f.options);
    expect(events.some(event => event.reasonCode === 'runtime_pause')).toBe(false);
    expect(events.some(event => event.type === 'node_completed' && event.nodeId === (boundary === 'judge' ? 'judge' : 'worker'))).toBe(false);
  });
  it('fails closed before dispatch without adapter or with unsupported marker', async () => {
    for (const unsupported of [false, true]) {
      const f = fixture();
      if (unsupported) f.options.run.context = { goalProtocol: 2 }; else f.options.goalProtocol = undefined;
      await expect(createArchitectureGraphEvents(f.options)).rejects.toMatchObject({ code: 'CONTRACT_VIOLATION' });
      expect(f.execute).not.toHaveBeenCalled();
      expect(f.events).toContainEqual(expect.objectContaining({ type: 'node_failed', errorCode: 'CONTRACT_VIOLATION' }));
    }
  });
  it('uses host purpose, records before completed, then judges without another child and pauses rejected truth', async () => {
    const f = fixture();
    const events = await createArchitectureGraphEvents(f.options);
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.execute).toHaveBeenCalledWith(expect.objectContaining({ purpose: { kind: 'goal_proposal', packet: f.options.run.goalPacket && expect.objectContaining({ version: 1 }) } }));
    expect(f.adapter.recordProposal).toHaveBeenCalledTimes(1);
    expect(f.adapter.judgeProjection).toHaveBeenCalledTimes(1);
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'final_artifact' }));
    expect(events.at(-1)).toMatchObject({ status: 'waiting_on_orchestrator', lifecycle: 'waiting_on_orchestrator', reasonCode: 'runtime_pause', data: { pendingNodeIds: ['judge'] } });
  });
  it('requires proposal ACK before node_completed and sanitizes failures', async () => {
    const f = fixture();
    f.adapter.recordProposal = vi.fn(async () => { throw new Error('secret source content'); });
    await expect(createArchitectureGraphEvents(f.options)).rejects.toMatchObject({ code: 'CONTRACT_VIOLATION', message: 'Goal graph protocol failed.' });
    expect(f.events).not.toContainEqual(expect.objectContaining({ type: 'node_completed' }));
    expect(JSON.stringify(f.events)).not.toContain('secret source content');
  });
  it('requires pause ACK before publishing waiting and returning', async () => {
    const f = fixture();
    f.adapter.beforeBatch = vi.fn<NonNullable<GraphRuntimeOptions['goalProtocol']>['beforeBatch']>(async () => ({ kind: 'pause', state: f.state() }));
    let release!: () => void;
    f.adapter.persistPauseRequired = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const execution = createArchitectureGraphEvents(f.options);
    await vi.waitFor(() => expect(f.adapter.persistPauseRequired).toHaveBeenCalledTimes(1));
    expect(f.events.some(event => event.reasonCode === 'runtime_pause')).toBe(false);
    release();
    expect((await execution).at(-1)?.reasonCode).toBe('runtime_pause');
  });
  it('pauses stale resumed cursor rather than scheduling the proposal worker or completing', async () => {
    const f = fixture();
    f.options.resumeFrom = { reason: 'runtime_recovery', pendingNodeIds: ['end'], visitCounts: {} };
    const events = await createArchitectureGraphEvents(f.options);
    expect(f.execute).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ reasonCode: 'runtime_pause', data: { pendingNodeIds: ['end'] } });
  });
  it.each(['owner', 'source', 'topology'])('rejects invalid %s before child dispatch', async invalid => {
    const f = fixture();
    if (invalid === 'topology') f.adapter.judgeNodeId = 'worker';
    else f.adapter.beforeBatch = vi.fn<NonNullable<GraphRuntimeOptions['goalProtocol']>['beforeBatch']>(async () => ({ kind: 'proposal', state: { ...f.state(),
      ...(invalid === 'owner' ? { rootSessionId: 'foreign' } : { packet: { ...f.state().packet, sourceFingerprint: 'forged' } }) } }));
    await expect(createArchitectureGraphEvents(f.options)).rejects.toMatchObject({ code: 'CONTRACT_VIOLATION' });
    expect(f.execute).not.toHaveBeenCalled();
  });
  it.each(['signal', 'isStopped'])('honors Stop during beforeBatch (%s)', async stop => {
    const f = fixture();
    const controller = new AbortController();
    let stopped = false;
    f.options.signal = controller.signal;
    f.options.isStopped = () => stopped;
    f.adapter.beforeBatch = vi.fn<NonNullable<GraphRuntimeOptions['goalProtocol']>['beforeBatch']>(async () => {
      if (stop === 'signal') controller.abort(); else stopped = true;
      return { kind: 'proposal', state: f.state() };
    });
    await createArchitectureGraphEvents(f.options);
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.events.some(event => event.type === 'node_completed')).toBe(false);
  });
});

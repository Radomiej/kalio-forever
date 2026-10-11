import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureRun, ArchitectureSchema, HostRuntimeReceiptObserver } from '@kalio/types';
import { ArchitectureGraphContext, type GraphRuntimeOptions } from './architecture-graph-runtime.context';
import { executeNode, executeRoleNode } from './architecture-graph-runtime.nodes';
import { createGoalPacket } from './architecture-goal-source';
import { acceptGoalProjection, goalProjectionPolicyTargets, prepareGoalProjection } from './architecture-goal-projection';
import type { ArchitectureGoalState } from './architecture-goal.repository';

function fixture() {
  const packet = createGoalPacket({ messageId: 'human', sessionId: 'host', turnId: 'turn', content: 'Build feature', createdAt: 1 });
  const proposal = prepareGoalProjection(packet, { sourceVersion: 1, criteria: [{ text: 'Build feature', sourceQuotes: [{ messageId: 'human', quote: 'Build feature' }], supersedes: [] }] });
  packet.projection = { status: 'pending', base: null, proposal };
  const criterionId = goalProjectionPolicyTargets(packet, proposal)[0]!.id;
  const accepted = acceptGoalProjection(packet, proposal, { requiredEvidenceKindsByCriterion: { [criterionId]: ['BUILD_RESULT'] } },
    { sourceVersion: 1, sourceFingerprint: packet.sourceFingerprint, proposalFingerprint: proposal.proposalFingerprint, accepted: true });
  const schema: ArchitectureSchema = {
    id: 'schema', name: 'Fixture', description: 'Fixture', version: '1',
    roleSlots: ['worker', 'judge'].map(id => ({ id, label: id, description: id, slotType: 'participant', defaultPersonaId: id, allowedPersonaTags: [], required: true, canOverrideAtRunStart: false })),
    nodes: [{ id: 'worker', label: 'Worker', kind: 'role', roleSlotId: 'worker' }, { id: 'judge', label: 'Judge', kind: 'role', roleSlotId: 'judge' }, { id: 'end', label: 'End', kind: 'artifact' }],
    edges: [{ id: 'wj', fromNodeId: 'worker', toNodeId: 'judge' }, { id: 'jw', fromNodeId: 'judge', toNodeId: 'worker', selection: 'continuation' }, { id: 'je', fromNodeId: 'judge', toNodeId: 'end' }],
    routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: true, canReturnNeedsMoreResearch: true },
    contextPolicy: { includeUserTask: true, includeProjectMemory: false, includeBrowserSession: false, includePriorDecisions: false },
    memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true }, outputArtifactSchema: 'goal',
  };
  const run: ArchitectureRun = { id: 'run', rootSessionId: 'root', schemaId: 'schema', prompt: 'Build feature', goalPacket: accepted,
    context: { goalProtocol: 1 }, executionMode: 'subagent_execution', branchSessionIds: { worker: 'branch', judge: 'judge-branch' }, status: 'running', createdAt: 1, updatedAt: 1 };
  const state: ArchitectureGoalState = { runId: 'run', rootSessionId: 'root', stateRevision: 1, packet: accepted,
    createdAt: 1, updatedAt: 1, evidenceInventory: null, completionAuthorization: null };
  const order: string[] = []; const controller = new AbortController();
  const observer: HostRuntimeReceiptObserver = { admit: vi.fn(async () => undefined), resolvedDispatch: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined), drain: vi.fn(async () => undefined), journalComplete: vi.fn(async () => undefined) };
  const finish = vi.fn(async (): Promise<void> => { order.push('finish'); });
  const open = vi.fn<NonNullable<GraphRuntimeOptions['openGoalWorkerAttempt']>>(async () => { order.push('open'); return { observer, finish }; });
  const execute = vi.fn<GraphRuntimeOptions['roleExecutor']['execute']>(async () => { order.push('execute'); return { message: 'Output', data: {} }; });
  const beforeBatch = vi.fn<NonNullable<GraphRuntimeOptions['goalProtocol']>['beforeBatch']>(async () => {
    order.push('refresh'); return { kind: 'completion_judge', state: structuredClone(state) };
  });
  const route = vi.fn(async (): Promise<void> => { order.push('route'); });
  const options: GraphRuntimeOptions = { schema, run, now: 1, signal: controller.signal, roleExecutor: { execute }, personaForSlot: slot => slot.id,
    openGoalWorkerAttempt: open, goalProtocol: { workerNodeId: 'worker', judgeNodeId: 'judge', completionNodeIds: ['end'], beforeBatch,
      recordProposal: vi.fn(), judgeProjection: vi.fn(), judgeCompletion: vi.fn(), persistRouteRequired: route, persistPauseRequired: vi.fn() } };
  const ctx = new ArchitectureGraphContext(options);
  ctx.goalDirective = { kind: 'work', state, executableNodeIds: ['worker'] };
  const node = schema.nodes[0]!;
  const invoke = () => executeRoleNode(ctx, node, ['judge']);
  return { ctx, options, node, invoke, open, execute, finish, observer, beforeBatch, route, controller, order };
}

describe('host-only goal worker attempt plumbing (fixture producer)', () => {
  it('opens with actual scope/signal, forwards the exact capability, finishes before refresh and ACK', async () => {
    const f = fixture(); await expect(f.invoke()).resolves.toEqual(['judge']);
    expect(f.order).toEqual(['open', 'execute', 'finish', 'refresh', 'route', 'refresh']);
    const input = f.open.mock.calls[0]![0];
    expect(input).toMatchObject({ nodeId: 'worker', branchSessionId: 'branch', run: { id: 'run', rootSessionId: 'root' } });
    expect(input.run).not.toBe(f.options.run); expect(input.signal).toBe(f.controller.signal);
    expect(f.execute.mock.calls[0]![0].hostRuntimeReceiptObserver).toBe(f.observer);
    expect(f.ctx.events.some(event => event.type === 'router_decision')).toBe(true);
    expect(JSON.stringify(f.ctx.events)).not.toContain('hostRuntimeReceiptObserver');
  });
  it.each(['callback', 'signal', 'directive', 'worker', 'membership', 'node', 'branch'])('fails closed before opening for missing/invalid %s', async kind => {
    const f = fixture();
    if (kind === 'callback') delete f.options.openGoalWorkerAttempt;
    if (kind === 'signal') delete f.options.signal;
    if (kind === 'directive') f.ctx.goalDirective = { kind: 'completion_judge', state: f.ctx.goalDirective!.state };
    if (kind === 'worker') f.options.goalProtocol!.workerNodeId = 'judge';
    if (kind === 'membership' && f.ctx.goalDirective?.kind === 'work') f.ctx.goalDirective.executableNodeIds = [];
    if (kind === 'node') f.options.schema.nodes[0] = { ...f.node };
    if (kind === 'branch') delete f.options.run.branchSessionIds!.worker;
    await expect(f.invoke()).rejects.toThrow(); expect(f.open).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  });
  it.each(['open', 'execute', 'finish'])('rejected %s cannot refresh or route', async stage => {
    const f = fixture();
    if (stage === 'open') f.open.mockRejectedValue(new Error('PRIVATE'));
    if (stage === 'execute') f.execute.mockRejectedValue(new Error('PRIVATE'));
    if (stage === 'finish') f.finish.mockRejectedValue(new Error('PRIVATE'));
    await expect(f.invoke()).rejects.toThrow();
    if (stage !== 'finish') expect(f.finish).not.toHaveBeenCalled();
    expect(f.beforeBatch).not.toHaveBeenCalled(); expect(f.route).not.toHaveBeenCalled();
  });
  it.each(['admit', 'commit', 'drain', 'journalComplete', 'resolvedDispatch', 'finish', 'observer', 'accessor', 'proxy'])('rejects malformed %s capability with a static error', async hook => {
    const f = fixture(); const getter = vi.fn(() => f.observer); const trap = vi.fn(() => { throw new Error('PRIVATE'); });
    const capability = { observer: f.observer, finish: f.finish };
    if (hook === 'finish' || hook === 'observer') Reflect.set(capability, hook, null);
    else if (hook === 'accessor') Object.defineProperty(capability, 'observer', { enumerable: true, get: getter });
    else if (hook === 'proxy') capability.observer = new Proxy(f.observer, { ownKeys: trap });
    else Reflect.set(f.observer, hook, 42);
    f.open.mockResolvedValue(capability);
    await expect(f.invoke()).rejects.toThrow(/^GOAL_GRAPH_WORK_ATTEMPT_FAILED$/);
    expect(getter).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled(); expect(f.finish).not.toHaveBeenCalled(); expect(f.route).not.toHaveBeenCalled();
  });
  it('permits the optional resolved-dispatch hook to be absent', async () => {
    const f = fixture(); delete f.observer.resolvedDispatch;
    await expect(f.invoke()).resolves.toEqual(['judge']); expect(f.finish).toHaveBeenCalledOnce();
  });
  it.each(['open', 'execute', 'finish'])('stop during %s suppresses subsequent finish/refresh/route', async stage => {
    const f = fixture();
    if (stage === 'open') f.open.mockImplementation(async () => { f.controller.abort(); return { observer: f.observer, finish: f.finish }; });
    if (stage === 'execute') f.execute.mockImplementation(async () => { f.controller.abort(); return { message: 'Output', data: {} }; });
    if (stage === 'finish') f.finish.mockImplementation(async () => { f.controller.abort(); });
    await expect(f.invoke()).resolves.toEqual([]);
    if (stage !== 'finish') expect(f.finish).not.toHaveBeenCalled();
    if (stage === 'open') expect(f.execute).not.toHaveBeenCalled();
    expect(f.beforeBatch).not.toHaveBeenCalled(); expect(f.route).not.toHaveBeenCalled();
  });
  it('already stopped never opens or executes', async () => {
    const f = fixture(); f.controller.abort(); await expect(f.invoke()).resolves.toEqual([]);
    expect(f.open).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  });
  it.each(['open', 'execute', 'finish'])('stale state during %s prevents subsequent success steps', async stage => {
    const f = fixture(); const mutate = () => { f.ctx.goalDirective!.state.stateRevision++; };
    if (stage === 'open') f.open.mockImplementation(async () => { mutate(); return { observer: f.observer, finish: f.finish }; });
    if (stage === 'execute') f.execute.mockImplementation(async () => { mutate(); return { message: 'Output', data: {} }; });
    if (stage === 'finish') f.finish.mockImplementation(async () => { mutate(); });
    await expect(f.invoke()).rejects.toThrow();
    if (stage !== 'finish') expect(f.finish).not.toHaveBeenCalled();
    if (stage === 'open') expect(f.execute).not.toHaveBeenCalled();
    expect(f.beforeBatch).not.toHaveBeenCalled(); expect(f.route).not.toHaveBeenCalled();
  });
  it('validates the role result before finishing', async () => {
    const f = fixture(); f.options.schema.roleSlots[0]!.slotType = 'tool_executor';
    await expect(f.invoke()).rejects.toThrow(); expect(f.finish).not.toHaveBeenCalled(); expect(f.route).not.toHaveBeenCalled();
  });
  it.each(['signal', 'membership', 'worker', 'branch', 'source'])('rechecks actual %s identity after opening', async field => {
    const f = fixture(); f.open.mockImplementation(async () => {
      if (field === 'signal') f.options.signal = new AbortController().signal;
      if (field === 'membership' && f.ctx.goalDirective?.kind === 'work') f.ctx.goalDirective.executableNodeIds = [];
      if (field === 'worker') f.options.goalProtocol!.workerNodeId = 'judge';
      if (field === 'branch') f.options.run.branchSessionIds!.worker = 'foreign';
      if (field === 'source') f.options.run.goalPacket!.sourceFingerprint = 'f'.repeat(64);
      return { observer: f.observer, finish: f.finish };
    });
    await expect(f.invoke()).rejects.toThrow(); expect(f.execute).not.toHaveBeenCalled(); expect(f.finish).not.toHaveBeenCalled();
  });
  it.each(['missing', 'disabled'])('does not skip %s goal worker slot and silently route', async kind => {
    const f = fixture();
    if (kind === 'missing') f.options.schema.roleSlots = [];
    else f.options.run.executionMode = 'session_branches';
    await expect(f.invoke()).rejects.toThrow(); expect(f.open).not.toHaveBeenCalled(); expect(f.route).not.toHaveBeenCalled();
  });
  it.each(['agent_started', 'participant_output'])('stop from %s callback prevents next external step', async eventType => {
    const f = fixture(); f.options.onEvent = event => { if (event.type === eventType) f.controller.abort(); };
    await expect(f.invoke()).resolves.toEqual([]);
    if (eventType === 'agent_started') { expect(f.execute).not.toHaveBeenCalled(); expect(f.finish).not.toHaveBeenCalled(); }
    expect(f.beforeBatch).not.toHaveBeenCalled(); expect(f.route).not.toHaveBeenCalled();
  });
  it('source change from output callback cannot refresh or route', async () => {
    const f = fixture(); f.options.onEvent = event => { if (event.type === 'participant_output') f.options.run.goalPacket!.sourceFingerprint = 'f'.repeat(64); };
    await expect(f.invoke()).rejects.toThrow(); expect(f.beforeBatch).not.toHaveBeenCalled(); expect(f.route).not.toHaveBeenCalled();
  });
  it('removing goal markers during output cannot downgrade the current work attempt to ordinary routing', async () => {
    const f = fixture(); f.options.onEvent = event => {
      if (event.type === 'participant_output') { delete f.options.run.goalPacket; f.options.run.context = {}; }
    };
    await expect(f.invoke()).rejects.toThrow(); expect(f.beforeBatch).not.toHaveBeenCalled(); expect(f.route).not.toHaveBeenCalled();
  });
  it('waits for signal-honoring finish and never routes after stop during its await', async () => {
    const f = fixture(); let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.finish.mockImplementation(async () => {
      entered(); await new Promise<void>(resolve => f.controller.signal.addEventListener('abort', () => resolve(), { once: true }));
    });
    const execution = f.invoke(); await started;
    expect(f.beforeBatch).not.toHaveBeenCalled(); expect(f.route).not.toHaveBeenCalled();
    f.controller.abort(); await expect(execution).resolves.toEqual([]);
    expect(f.beforeBatch).not.toHaveBeenCalled(); expect(f.route).not.toHaveBeenCalled();
  });
  it('non-goal execution ignores host-looking context and never opens an attempt', async () => {
    const f = fixture(); delete f.options.run.goalPacket; f.options.run.context = { hostRuntimeReceiptObserver: 'untrusted' };
    await expect(f.invoke()).resolves.toEqual(['judge']); expect(f.open).not.toHaveBeenCalled(); expect(f.finish).not.toHaveBeenCalled();
    expect(f.execute.mock.calls[0]![0].hostRuntimeReceiptObserver).toBeUndefined();
  });
  it('proposal uses the separate goal executor without opening a work attempt', async () => {
    const f = fixture(); const pending = createGoalPacket({ messageId: 'human', sessionId: 'host', turnId: 'turn', content: 'Build feature', createdAt: 1 });
    f.options.run.goalPacket = pending; f.ctx.goalDirective = { kind: 'proposal', state: { ...f.ctx.goalDirective!.state, packet: pending } };
    f.execute.mockImplementation(async () => { f.controller.abort(); return { message: 'Proposal', data: {} }; });
    await expect(executeNode(f.ctx, f.node, [], ['judge'], new Map(f.options.schema.nodes.map(node => [node.id, node])))).resolves.toEqual([]);
    expect(f.execute.mock.calls[0]![0].purpose?.kind).toBe('goal_proposal');
    expect(f.open).not.toHaveBeenCalled(); expect(f.finish).not.toHaveBeenCalled();
  });
});

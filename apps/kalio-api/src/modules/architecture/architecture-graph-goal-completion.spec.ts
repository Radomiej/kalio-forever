import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import type { ArchitectureExecutionEvent, ArchitectureRun, ArchitectureSchema, DecisionSettingsPort } from '@kalio/types';
import type { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { AuditService } from '../chat/audit.service';
import { JevDecisionsClient } from '../../common/jev-decisions.client';
import { createGoalPacket, appendGoalSource } from './architecture-goal-source';
import { acceptGoalProjection, goalProjectionPolicyTargets, prepareGoalProjection } from './architecture-goal-projection';
import { ArchitectureGoalRepository, type ArchitectureGoalState } from './architecture-goal.repository';
import { ArchitectureGoalCompletionReviewService } from './architecture-goal-completion-review.service';
import { ArchitectureGoalCompletionAuthorizationService } from './architecture-goal-completion-authorization.service';
import { ArchitectureGoalGraphAdapterService } from './architecture-goal-graph-adapter.service';
import { ArchitectureGoalAuditService } from './architecture-goal-audit.service';
import { createArchitectureGraphEvents, type GraphRuntimeOptions } from './architecture-graph-runtime';
import { ArchitectureGraphContext } from './architecture-graph-runtime.context';
import { goalPhaseBinding } from './architecture-graph-goal-nodes';
import { publishGoalArtifact } from './architecture-graph-goal-completion';

const clients: Database.Database[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.close()); vi.unstubAllGlobals(); });
function fixture() {
  const client = new Database(':memory:'); clients.push(client);
  const db = drizzle(client, { schema }); migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
  const dep = { db } as unknown as DrizzleService;
  const repo = new ArchitectureGoalRepository(dep); const audit = new AuditService(dep);
  const pending = createGoalPacket({ messageId: 'human', sessionId: 'HOST', turnId: 'turn', content: 'Build home site.', createdAt: 1 });
  const proposal = prepareGoalProjection(pending, { sourceVersion: 1, criteria: [{ text: 'Build home site', sourceQuotes: [{ messageId: 'human', quote: 'Build home site' }], supersedes: [] }] });
  pending.projection = { status: 'pending', base: null, proposal };
  const criterionId = goalProjectionPolicyTargets(pending, proposal)[0]!.id;
  const packet = acceptGoalProjection(pending, proposal, { requiredEvidenceKindsByCriterion: { [criterionId]: ['BUILD_RESULT'] } },
    { sourceVersion: 1, sourceFingerprint: pending.sourceFingerprint, proposalFingerprint: proposal.proposalFingerprint, accepted: true });
  repo.create({ runId: 'run', rootSessionId: 'root', packet, createdAt: 1, updatedAt: 1 });
  if (packet.projection.status !== 'accepted') throw new Error('fixture');
  repo.replaceEvidenceInventory('run', 1, 'root', { schemaVersion: 2, runId: 'run', rootSessionId: 'root', goalVersion: 1,
    sourceFingerprint: packet.sourceFingerprint, host: { evidenceById: { build: { kind: 'BUILD_RESULT', status: 'passed', data: { exitCode: 0 } } }, cliChildrenById: {} },
    provenance: { schemaVersion: 2, runId: 'run', rootSessionId: 'root', goalVersion: 1, sourceFingerprint: packet.sourceFingerprint,
      goalFingerprint: packet.projection.snapshot.goalFingerprint,
      checkpoint: { checkpointId: 'seal', status: 'sealed',
        admissions: [{ callId: 'call', sessionId: 'branch', turnId: 'bt', promptMessageId: 'bp', sequence: 1, admissionCheckpointId: 'admit' }],
        commits: [{ callId: 'call', sequence: 1, commitCheckpointId: 'producer', resultMessageId: 'result', status: 'success' }],
        completedRunJournalRef: { checkpointId: 'journal', eventId: 'done', sequence: 2 } },
      evidenceRefsById: { build: { checkpointId: 'producer', eventId: 'build-event', sequence: 1, evidenceIndex: 0, dispatchCallId: 'call' } },
      childRefsById: {}, supersededEvidenceIds: {},
      buildExpectation: { approvedSource: { messageId: 'human', sessionId: 'HOST', turnId: 'turn' }, executable: 'npm', args: ['run', 'build'], canonicalCwd: 'E:\\project' } } }, 2);
  const load = () => { const state = repo.load('run', 'root'); if (!state) throw new Error('fixture'); return state; };
  const http = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ answers: { goal_completion: { type: 'choice', choice: 'complete', confidence: .95 } } }));
  vi.stubGlobal('fetch', http);
  const settings: DecisionSettingsPort = { resolve: vi.fn(async () => ({ endpoint: 'https://decisions.invalid', model: 'jev', apiKey: 'PRIVATE' })), getConfig: vi.fn(), updateConfig: vi.fn() };
  const completionHost = { readCurrent: async (_runId?: string, _signal?: AbortSignal) => {
    const state = load(); const inventory = state.evidenceInventory;
    if (inventory?.schemaVersion !== 2) throw new Error('fixture');
    return { runId: 'run', rootSessionId: 'root', stateRevision: state.stateRevision, packet: state.packet, host: inventory.host,
      criterionEvidenceIds: { [criterionId]: ['build'] }, provenance: inventory.provenance };
  } };
  const review = new ArchitectureGoalCompletionReviewService(settings, new JevDecisionsClient(), completionHost);
  // Fixture producer verifier; no live provenance proof is claimed.
  const verify = vi.fn(async (): Promise<void> => undefined);
  const finalAck = vi.fn(async (_run: unknown, state: ArchitectureGoalState): Promise<void> => {
    await audit.logRequired(`run:goal-completion:${state.stateRevision}`, { sessionId: 'root', type: 'architecture_event', label: 'goal_completion', data: { binding: state.completionAuthorization?.binding } });
  });
  const completion = new ArchitectureGoalCompletionAuthorizationService(repo, review, { verifyDurableInventory: verify, acknowledgeFinalizationRequired: finalAck });
  const protocolEvents: ArchitectureExecutionEvent[] = [];
  const routeAck = vi.fn(async (event: ArchitectureExecutionEvent, checkpointId: string): Promise<void> => {
    await audit.logRequired(checkpointId, { sessionId: 'root', type: 'architecture_event', label: 'goal_route', data: { ...event } });
    protocolEvents.push(event);
  });
  const graph: ArchitectureSchema = {
    id: 'schema', name: 'Goal', description: 'Fixture', version: '1',
    roleSlots: ['worker', 'judge'].map(id => ({ id, label: id, description: id, slotType: 'participant', defaultPersonaId: id, allowedPersonaTags: [], required: true, canOverrideAtRunStart: false })),
    // Deliberately not worker-first: admission must seed the validated worker.
    nodes: [{ id: 'end', label: 'End', kind: 'artifact' }, { id: 'judge', label: 'Judge', kind: 'role', roleSlotId: 'judge' }, { id: 'worker', label: 'Worker', kind: 'role', roleSlotId: 'worker' }],
    edges: [{ id: 'wj', fromNodeId: 'worker', toNodeId: 'judge' }, { id: 'jw', fromNodeId: 'judge', toNodeId: 'worker', selection: 'continuation' }, { id: 'je', fromNodeId: 'judge', toNodeId: 'end', selection: 'default' }],
    routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: true, canReturnNeedsMoreResearch: true },
    contextPolicy: { includeUserTask: true, includeProjectMemory: false, includeBrowserSession: false, includePriorDecisions: false },
    memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true }, outputArtifactSchema: 'goal',
  };
  const run: ArchitectureRun = { id: 'run', rootSessionId: 'root', schemaId: 'schema', prompt: packet.original.content, goalPacket: packet,
    context: { goalProtocol: 1 }, executionMode: 'subagent_execution', branchSessionIds: { worker: 'worker-session', judge: 'judge-session' }, status: 'running', createdAt: 1, updatedAt: 1 };
  const adapterFactory = new ArchitectureGoalGraphAdapterService({ hydrate: load }, repo, new ArchitectureGoalAuditService(audit),
    { record: async () => { throw new Error('Unexpected proposal'); } }, { project: async () => { throw new Error('Unexpected projection'); } }, completion, completionHost);
  const adapter = adapterFactory.create(run, { workerNodeId: 'worker', judgeNodeId: 'judge', completionNodeIds: ['end'], hostPolicyFactory: rows => ({ requiredEvidenceKindsByCriterion: Object.fromEntries(rows.map(row => [row.id, ['BUILD_RESULT']])) }) }, routeAck);
  const execute = vi.fn<GraphRuntimeOptions['roleExecutor']['execute']>(async () => ({ message: 'Worker output', data: { evidence: [{ kind: 'BUILD_RESULT', status: 'passed', data: { exitCode: 0 } }] } }));
  const terminal = vi.fn<NonNullable<GraphRuntimeOptions['commitGoalTerminal']>>(async input => {
    const state = load(); const receipt = state.completionAuthorization;
    if (state.stateRevision !== input.authorization.authorizedStateRevision || receipt?.schemaVersion !== 2
      || JSON.stringify(receipt.binding) !== JSON.stringify(input.authorization.binding)) throw new Error('Stale');
    // Fixture ACK only; not evidence that a production sink durably wrote this visit.
    input.signal?.throwIfAborted(); input.publish({ completedVisitCheckpointId: input.completedVisit.checkpointId, event: structuredClone(input.completedVisit.event) });
  });
  // Plumbing fixture only: no producer, BUILD verification or seal proof.
  const options: GraphRuntimeOptions = { schema: graph, run, now: 1, signal: new AbortController().signal,
    openGoalWorkerAttempt: async () => ({ observer: { admit: async () => undefined, commit: async () => undefined,
      drain: async () => undefined, journalComplete: async () => undefined }, finish: async () => undefined }),
    persistGoalVisit: vi.fn(async () => undefined),
    roleExecutor: { execute }, personaForSlot: slot => slot.id, goalProtocol: adapter, commitGoalTerminal: terminal };
  return { options, repo, load, http, criterionId, finalAck, routeAck, execute, terminal, protocolEvents, adapter, completion, completionHost };
}

describe('goal graph completion (SQLite, real Jev parser, fixture host barrier)', () => {
  it('rejects an old JS terminal sink calling publish without ACK', async () => {
    const f = fixture(); const seen: ArchitectureExecutionEvent[] = []; f.options.onEvent = event => seen.push(event);
    f.terminal.mockImplementation(async input => { Reflect.apply(input.publish, undefined, []); });
    await expect(createArchitectureGraphEvents(f.options)).rejects.toThrow();
    expect(seen.some(event => event.nodeId === 'end' && event.type === 'node_completed')).toBe(false);
    expect(seen.some(event => event.type === 'final_artifact')).toBe(false);
  });
  it.each(['checkpoint', 'event', 'mutated-input'] as const)('rejects mismatched terminal ACK: %s', async mode => {
    const f = fixture(); const seen: ArchitectureExecutionEvent[] = []; f.options.onEvent = event => seen.push(event);
    f.terminal.mockImplementation(async input => {
      const ack = { completedVisitCheckpointId: input.completedVisit.checkpointId, event: structuredClone(input.completedVisit.event) };
      if (mode === 'checkpoint') ack.completedVisitCheckpointId = 'other';
      if (mode === 'event') ack.event.message = 'other';
      if (mode === 'mutated-input') { input.completedVisit.checkpointId = 'other'; ack.completedVisitCheckpointId = 'other'; }
      input.publish(ack);
    });
    await expect(createArchitectureGraphEvents(f.options)).rejects.toThrow();
    expect(seen.some(event => event.nodeId === 'end' && event.type === 'node_completed')).toBe(false);
    expect(seen.some(event => event.type === 'final_artifact')).toBe(false);
  });
  it('terminal sink receives exact completion before any terminal success projection', async () => {
    const f = fixture(); const seen: ArchitectureExecutionEvent[] = []; f.options.onEvent = event => seen.push(event);
    const sink = f.terminal.getMockImplementation()!;
    f.terminal.mockImplementation(async input => {
      expect(input.completedVisit).toMatchObject({ visit: 1, node: { id: 'end' }, event: { type: 'node_completed', nodeId: 'end', data: { goalVisit: 1 } } });
      expect(seen.some(event => event.nodeId === 'end' && event.type === 'node_completed')).toBe(false);
      expect(seen.some(event => event.type === 'final_artifact')).toBe(false);
      await sink(input);
    });
    const events = await createArchitectureGraphEvents(f.options);
    expect(events.slice(-2).map(event => event.type)).toEqual(['node_completed', 'final_artifact']);
  });
  it('rolls back both local events if the second terminal append throws', async () => {
    const f = fixture(); await f.completion.authorize(f.options.run, 1);
    const ctx = new ArchitectureGraphContext(f.options);
    ctx.goalDirective = await f.adapter.beforeBatch({ run: f.options.run, readyNodeIds: ['end'] });
    ctx.push('node_started', 'Terminal started', { nodeId: 'end', data: { goalVisit: 1 } });
    const before = [...ctx.events];
    f.options.onEvent = event => { if (event.type === 'final_artifact') throw new Error('PRIVATE'); };
    await expect(publishGoalArtifact(ctx, f.options.schema.nodes[0]!, 'Result', {})).rejects.toThrow(/^GOAL_GRAPH_COMPLETION_FAILED$/);
    expect(ctx.events).toEqual(before); expect(ctx.goalTerminalPublished).toBe(false);
  });
  it('continues through the declared worker cycle then completes without a judge persona', async () => {
    const f = fixture(); let choices = 0;
    f.http.mockImplementation(async () => Response.json({ answers: { goal_completion: { type: 'choice', choice: choices++ === 0 ? `continue:${f.criterionId}` : 'complete', confidence: .95 } } }));
    const events = await createArchitectureGraphEvents(f.options);
    expect(events.filter(e => e.type === 'node_completed').map(e => e.nodeId)).toEqual(['worker', 'judge', 'worker', 'judge', 'end']);
    expect(events.at(-1)?.type).toBe('final_artifact');
    expect(f.execute.mock.calls.map(([input]) => input.node?.id)).toEqual(['worker', 'worker']);
    expect(f.protocolEvents.some(e => e.data?.['pendingNodeIds'] instanceof Array && e.data['pendingNodeIds'][0] === 'worker')).toBe(true);
    expect(f.load().completionAuthorization?.schemaVersion).toBe(2);
  });
  it.each([false, true])('missing terminal port blocks artifact (role backed=%s)', async roleBacked => {
    const f = fixture(); delete f.options.commitGoalTerminal;
    if (roleBacked) f.options.schema.nodes[0]!.roleSlotId = 'worker';
    const seen: ArchitectureExecutionEvent[] = []; f.options.onEvent = e => seen.push(e);
    await expect(createArchitectureGraphEvents(f.options)).rejects.toThrow();
    expect(seen.some(e => e.type === 'final_artifact')).toBe(false);
    expect(f.execute.mock.calls.map(([input]) => input.node?.id)).toEqual(['worker']);
  });
  it('needs_user ACK pauses without a completed judge or artifact', async () => {
    const f = fixture(); f.http.mockImplementation(async () => Response.json({ answers: { goal_completion: { type: 'choice', choice: 'complete', confidence: .8 } } }));
    const events = await createArchitectureGraphEvents(f.options);
    expect(events.at(-1)).toMatchObject({ reasonCode: 'runtime_pause', data: { pendingNodeIds: ['judge'] } });
    expect(events.some(e => e.type === 'final_artifact')).toBe(false);
    expect(f.protocolEvents.at(-1)?.reasonCode).toBe('runtime_pause');
  });
  it.each(['route', 'final'])('failed required %s ACK cannot publish', async stage => {
    const f = fixture(); const seen: ArchitectureExecutionEvent[] = []; f.options.onEvent = e => seen.push(e);
    if (stage === 'route') f.routeAck.mockRejectedValue(new Error('PRIVATE'));
    else f.finalAck.mockRejectedValue(new Error('PRIVATE'));
    await expect(createArchitectureGraphEvents(f.options)).rejects.toThrow();
    expect(seen.some(e => e.type === 'final_artifact')).toBe(false);
  });
  it.each(['revision', 'source'])('terminal barrier rejects %s mutation', async mutation => {
    const f = fixture(); const seen: ArchitectureExecutionEvent[] = []; f.options.onEvent = e => seen.push(e);
    const publish = f.terminal.getMockImplementation()!;
    f.terminal.mockImplementation(async input => {
      const state = f.load(); const packet = mutation === 'source'
        ? appendGoalSource(state.packet, { messageId: 'update', sessionId: 'HOST', turnId: 'u', content: 'More work', createdAt: 3 }) : state.packet;
      f.repo.compareAndSwap('run', state.stateRevision, { rootSessionId: 'root', packet, updatedAt: 3 });
      await publish(input);
    });
    await expect(createArchitectureGraphEvents(f.options)).rejects.toThrow();
    expect(seen.some(e => e.type === 'final_artifact')).toBe(false);
  });
  it('stop in terminal barrier suppresses publication', async () => {
    const f = fixture(); const controller = new AbortController(); f.options.signal = controller.signal;
    f.terminal.mockImplementation(async input => { controller.abort(); input.publish({ completedVisitCheckpointId: input.completedVisit.checkpointId, event: input.completedVisit.event }); });
    const events = await createArchitectureGraphEvents(f.options);
    expect(events.some(e => e.type === 'final_artifact')).toBe(false);
  });
  it.each(['jw', 'je'])('rejects missing declared edge %s before work', async edge => {
    const f = fixture(); f.options.schema.edges = f.options.schema.edges.filter(e => e.id !== edge);
    await expect(createArchitectureGraphEvents(f.options)).rejects.toThrow(); expect(f.execute).not.toHaveBeenCalled();
  });
  it('a throwing terminal projection callback leaves neither a success marker nor local final event', async () => {
    const f = fixture(); await f.completion.authorize(f.options.run, 1);
    const ctx = new ArchitectureGraphContext(f.options);
    ctx.goalDirective = await f.adapter.beforeBatch({ run: f.options.run, readyNodeIds: ['end'] });
    ctx.push('node_started', 'Terminal started', { nodeId: 'end', data: { goalVisit: 1 } });
    f.options.onEvent = () => { throw new Error('PRIVATE projection failure'); };
    await expect(publishGoalArtifact(ctx, f.options.schema.nodes[0]!, 'Result', {})).rejects.toThrow(/^GOAL_GRAPH_COMPLETION_FAILED$/);
    expect(ctx.goalTerminalPublished).toBe(false);
    expect(ctx.events.some(e => e.type === 'final_artifact')).toBe(false);
  });
  it('rejects a terminal port that resolves without publishing', async () => {
    const f = fixture(); f.terminal.mockImplementation(async () => undefined);
    await expect(createArchitectureGraphEvents(f.options)).rejects.toThrow();
  });
  it('rejects delayed publication after the terminal port resolved', async () => {
    const f = fixture(); let late: (() => void) | undefined;
    f.terminal.mockImplementation(async input => { late = () => input.publish({ completedVisitCheckpointId: input.completedVisit.checkpointId, event: input.completedVisit.event }); });
    await expect(createArchitectureGraphEvents(f.options)).rejects.toThrow();
    expect(() => late?.()).toThrow(/^GOAL_GRAPH_COMPLETION_FAILED$/);
  });
  it('continues only after the required route ACK resolves', async () => {
    const f = fixture(); let release!: () => void;
    const sink = f.routeAck.getMockImplementation()!;
    f.routeAck.mockImplementation(async (event, checkpoint) => {
      if (event.data?.['criterionId']) await new Promise<void>(resolve => { release = resolve; });
      await sink(event, checkpoint);
    });
    let choices = 0;
    f.http.mockImplementation(async () => Response.json({ answers: { goal_completion: { type: 'choice', choice: choices++ === 0 ? `continue:${f.criterionId}` : 'complete', confidence: .95 } } }));
    const pending = createArchitectureGraphEvents(f.options);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(f.execute).toHaveBeenCalledTimes(1); release();
    expect((await pending).at(-1)?.type).toBe('final_artifact');
    expect(f.execute).toHaveBeenCalledTimes(2);
  });
  it.each(['refs', 'provenance', 'root', 'downgrade', 'getter'])('rejects completion host %s corruption without invoking getters', async change => {
    const f = fixture(); const read = f.completionHost.readCurrent; let getters = 0;
    f.completionHost.readCurrent = async () => {
      const snapshot = await read();
      if (change === 'refs') snapshot.criterionEvidenceIds = { [f.criterionId]: ['foreign'] };
      if (change === 'root') snapshot.rootSessionId = 'foreign';
      if (change === 'provenance') Reflect.set(snapshot.provenance.checkpoint, 'checkpointId', 'foreign');
      if (change === 'downgrade') Reflect.deleteProperty(snapshot, 'provenance');
      if (change === 'getter') Object.defineProperty(snapshot, 'host', { enumerable: true, get: () => { getters++; return snapshot.host; } });
      return snapshot;
    };
    const state = f.load();
    await expect(f.adapter.judgeCompletion({ run: f.options.run, binding: goalPhaseBinding(state) })).rejects.toThrow(/^GOAL_GRAPH_ADAPTER_FAILED$/);
    expect(getters).toBe(0); expect(f.load().completionAuthorization).toBeNull();
  });
  it('rejects unchanged-revision refs mutation after authorize', async () => {
    const f = fixture(); const original = f.completion.authorize.bind(f.completion);
    f.http.mockImplementation(async () => Response.json({ answers: { goal_completion: { type: 'choice', choice: `continue:${f.criterionId}`, confidence: .95 } } }));
    const read = f.completionHost.readCurrent;
    vi.spyOn(f.completion, 'authorize').mockImplementation(async (...args) => {
      const result = await original(...args);
      f.completionHost.readCurrent = async () => ({ ...await read(), criterionEvidenceIds: { [f.criterionId]: [] } });
      return result;
    });
    await expect(f.adapter.judgeCompletion({ run: f.options.run, binding: goalPhaseBinding(f.load()) })).rejects.toThrow(/^GOAL_GRAPH_ADAPTER_FAILED$/);
    expect(f.load().stateRevision).toBe(2);
  });
  it('rejects unchanged-revision refs mutation during continue ACK', async () => {
    const f = fixture(); const read = f.completionHost.readCurrent;
    f.http.mockImplementation(async () => Response.json({ answers: { goal_completion: { type: 'choice', choice: `continue:${f.criterionId}`, confidence: .95 } } }));
    f.routeAck.mockImplementation(async event => {
      if (event.data?.['criterionId']) f.completionHost.readCurrent = async () => ({ ...await read(), criterionEvidenceIds: { [f.criterionId]: [] } });
    });
    await expect(createArchitectureGraphEvents(f.options)).rejects.toThrow();
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it('forwards the same signal and stops before route publication on verifier abort', async () => {
    const f = fixture(); const controller = new AbortController(); f.options.signal = controller.signal;
    const read = f.completionHost.readCurrent;
    const hostRead = vi.fn(async (_runId?: string, signal?: AbortSignal) => { expect(signal).toBe(controller.signal); controller.abort(); signal?.throwIfAborted(); return read(); });
    f.completionHost.readCurrent = hostRead;
    const events = await createArchitectureGraphEvents(f.options);
    expect(events.some(e => e.type === 'final_artifact')).toBe(false);
    expect(f.http).not.toHaveBeenCalled();
  });
  it('preserves legacy construction for work but fails closed at completion without ports', async () => {
    const f = fixture(); const factory = new ArchitectureGoalGraphAdapterService({ hydrate: f.load }, f.repo,
      { persistRequired: async () => undefined }, { record: async () => f.load() }, { project: async () => ({ status: 'rejected', state: f.load() }) });
    const adapter = factory.create(f.options.run, { workerNodeId: 'worker', judgeNodeId: 'judge', completionNodeIds: ['end'], hostPolicyFactory: () => ({ requiredEvidenceKindsByCriterion: {} }) }, f.routeAck);
    expect(await adapter.beforeBatch({ run: f.options.run, readyNodeIds: ['worker'] })).toHaveProperty('kind', 'work');
    await expect(adapter.judgeCompletion({ run: f.options.run, binding: goalPhaseBinding(f.load()) })).rejects.toThrow(/^GOAL_GRAPH_ADAPTER_FAILED$/);
  });
  it('permits a host inventory revision advance caused by accepted work before judging current evidence', async () => {
    const f = fixture();
    f.execute.mockImplementation(async () => {
      const state = f.load(); const inventory = state.evidenceInventory;
      if (inventory?.schemaVersion !== 2) throw new Error('fixture');
      const { inventoryStateRevision: _revision, ...input } = inventory;
      f.repo.replaceEvidenceInventory('run', state.stateRevision, 'root', input, 3);
      return { message: 'Worker', data: { evidence: [{ kind: 'BUILD_RESULT', status: 'passed' }] } };
    });
    expect((await createArchitectureGraphEvents(f.options)).at(-1)?.type).toBe('final_artifact');
    expect(f.load().stateRevision).toBe(4);
  });
  it('rejects artifact publication without an executing designated terminal visit', async () => {
    const f = fixture(); await f.completion.authorize(f.options.run, 1);
    const ctx = new ArchitectureGraphContext(f.options);
    ctx.goalDirective = await f.adapter.beforeBatch({ run: f.options.run, readyNodeIds: ['end'] });
    await expect(publishGoalArtifact(ctx, f.options.schema.nodes[0]!, 'Result', {})).rejects.toThrow();
    expect(ctx.goalTerminalPublished).toBe(false);
  });
  it('fences a role-backed artifact after its finalizer result', async () => {
    const f = fixture(); f.options.schema.nodes[0]!.roleSlotId = 'worker';
    const events = await createArchitectureGraphEvents(f.options);
    expect(events.at(-1)?.type).toBe('final_artifact');
    expect(f.execute.mock.calls.map(([input]) => input.node?.id)).toEqual(['worker', 'end']);
    expect(f.terminal).toHaveBeenCalledOnce();
  });
  it.each(['continue-route', 'completion-ACK', 'finalizer'])('stop during %s publishes neither failure nor terminal', async stage => {
    const f = fixture(); const controller = new AbortController(); f.options.signal = controller.signal;
    if (stage === 'continue-route') {
      f.http.mockImplementation(async () => Response.json({ answers: { goal_completion: { type: 'choice', choice: `continue:${f.criterionId}`, confidence: .95 } } }));
      f.routeAck.mockImplementation(async event => { if (event.data?.['criterionId']) controller.abort(); });
    } else if (stage === 'completion-ACK') f.finalAck.mockImplementation(async () => { controller.abort(); });
    else {
      f.options.schema.nodes[0]!.roleSlotId = 'worker';
      f.execute.mockImplementation(async input => { if (input.node?.id === 'end') controller.abort(); return { message: 'Worker', data: { evidence: [{ kind: 'BUILD_RESULT', status: 'passed', data: { exitCode: 0 } }] } }; });
    }
    const events = await createArchitectureGraphEvents(f.options);
    expect(events.some(e => e.type === 'final_artifact' || e.type === 'node_failed')).toBe(false);
  });
  it('resume uses exact ACKed pending nodes and visit counts instead of reseeding the worker', async () => {
    const f = fixture(); const state = f.load();
    const initial = await f.adapter.beforeBatch({ run: f.options.run, readyNodeIds: ['worker'] });
    if (initial.kind !== 'work') throw new Error('fixture');
    const ctx = new ArchitectureGraphContext(f.options); ctx.goalDirective = initial; ctx.nodeVisitCounts.set('worker', 1);
    const { persistGoalRoute } = await import('./architecture-graph-goal-completion');
    await persistGoalRoute(ctx, f.options.schema.nodes.find(node => node.id === 'worker')!, ['judge']);
    const route = f.protocolEvents.at(-1); if (!route) throw new Error('fixture');
    f.options.priorEvents = [route];
    f.options.resumeFrom = { reason: 'runtime_recovery', pendingNodeIds: ['judge'], visitCounts: { worker: 2 } };
    const events = await createArchitectureGraphEvents(f.options);
    expect(f.execute).not.toHaveBeenCalled();
    expect(events.at(-1)?.type).toBe('final_artifact');
    expect(state.packet.version).toBe(f.load().packet.version);
  });
});

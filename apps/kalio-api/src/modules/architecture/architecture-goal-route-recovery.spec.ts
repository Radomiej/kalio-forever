import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureExecutionEvent, ArchitectureSchema } from '@kalio/types';
import { recoverGoalRouteCandidate } from './architecture-goal-route-recovery';

const sourceFingerprint = 'a'.repeat(64);
const completionBinding = { goalVersion: 1, sourceFingerprint, goalFingerprint: 'b'.repeat(64), evidenceFingerprint: 'c'.repeat(64), policyFingerprint: 'd'.repeat(64) };
const scope = { id: 'run', rootSessionId: 'root', schemaId: 'schema' };
const topology = { workerNodeId: 'worker', judgeNodeId: 'judge', completionNodeIds: ['end'] };
function schema(): ArchitectureSchema {
  return { id: 'schema', name: 'Goal', description: '', version: '1', roleSlots: [],
    nodes: [{ id: 'worker', kind: 'role', label: 'Worker' }, { id: 'judge', kind: 'role', label: 'Judge' }, { id: 'end', kind: 'artifact', label: 'End' }],
    edges: [{ id: 'wj', fromNodeId: 'worker', toNodeId: 'judge' }, { id: 'jw', fromNodeId: 'judge', toNodeId: 'worker', selection: 'continuation' }, { id: 'je', fromNodeId: 'judge', toNodeId: 'end' }],
    routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: true, canReturnNeedsMoreResearch: true },
    contextPolicy: { includeUserTask: true, includeProjectMemory: false, includeBrowserSession: false, includePriorDecisions: false },
    memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true }, outputArtifactSchema: 'goal' };
}
function event(sequence: number, type: ArchitectureExecutionEvent['type'], nodeId?: string): ArchitectureExecutionEvent {
  return { id: `opaque-${sequence}`, runId: 'run', sequence, createdAt: sequence, type, message: 'PRIVATE prose', ...(nodeId ? { nodeId } : {}) };
}
function route(phase: 'proposal' | 'work' | 'projection' | 'continue' | 'artifact', sequence = 1): ArchitectureExecutionEvent {
  const from = phase === 'proposal' || phase === 'work' ? 'worker' : 'judge';
  const to = from === 'worker' ? 'judge' : phase === 'artifact' ? 'end' : 'worker';
  return { ...event(sequence, 'router_decision', from),
    route: { source: 'runtime_fallback', fromNodeId: from, nextNodeId: to, selectedNodeIds: [to], rejectedNodeIds: [] },
    data: { schemaId: 'schema', rootSessionId: 'root', runId: 'run',
      goalBinding: { stateRevision: 3, sourceVersion: 1, sourceFingerprint, ...(phase === 'proposal' ? { proposalFingerprint: 'e'.repeat(64) } : {}) },
      ...(phase === 'continue' || phase === 'artifact' ? { completionBinding: { ...completionBinding } } : {}),
      ...(phase === 'continue' ? { criterionId: 'active-criterion' } : {}),
      pendingNodeIds: [to], visitCounts: { [from]: 1 } } };
}
function recover(events: ArchitectureExecutionEvent[], graph = schema()) { return recoverGoalRouteCandidate(graph, scope, topology, events); }

describe('goal route diagnostic recovery (no execution authorization)', () => {
  it.each(['proposal', 'work', 'projection', 'continue', 'artifact'] as const)('projects exact %s route and full bindings without authority', phase => {
    const result = recover([route(phase)]);
    const from = phase === 'proposal' || phase === 'work' ? 'worker' : 'judge';
    const to = from === 'worker' ? 'judge' : phase === 'artifact' ? 'end' : 'worker';
    expect(result).toMatchObject({ status: 'candidate', candidate: { anchorEventId: 'opaque-1', anchorSequence: 1,
      sourceNodeId: from, kind: 'route', goalBinding: { stateRevision: 3, sourceVersion: 1, sourceFingerprint },
      cursorCandidate: { reason: 'runtime_recovery', pendingNodeIds: [to], visitCounts: { [from]: 1 } } } });
    if (result.status !== 'candidate') throw new Error('Expected candidate');
    expect(result.candidate.completionBinding).toEqual(phase === 'continue' || phase === 'artifact' ? completionBinding : undefined);
    expect(result.candidate.criterionId).toBe(phase === 'continue' ? 'active-criterion' : undefined);
    expect(result.candidate).not.toHaveProperty('accepted');
    expect(result.candidate).not.toHaveProperty('authorization');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('chooses latest repeated-cycle checkpoint, not a union of historical pending nodes', () => {
    const first = route('continue');
    const second = route('work', 3); second.data!.visitCounts = { judge: 1, worker: 1 };
    const third = route('continue', 5); third.data!.visitCounts = { judge: 2, worker: 1 };
    const result = recover([third, event(4, 'node_completed', 'worker'), first, event(2, 'node_completed', 'judge'), second]);
    expect(result).toMatchObject({ status: 'candidate', candidate: { anchorEventId: 'opaque-5', cursorCandidate: { pendingNodeIds: ['worker'], visitCounts: { judge: 2, worker: 1 } } } });
  });
  it.each(['run_stopped', 'final_artifact', 'node_failed'] as const)('%s dominates diagnostic routing without a fallback', type => {
    expect(recover([route('artifact'), event(2, type, type === 'run_stopped' ? undefined : 'end')])).toEqual({ status: 'halted', eventId: 'opaque-2' });
  });
  it('does not resurrect a terminal segment from a later route', () => {
    expect(recover([event(1, 'run_stopped'), route('work', 2)])).toEqual({ status: 'halted', eventId: 'opaque-1' });
  });
  it.each(([[], ['judge'], ['end']] as string[][]).map(pending => [pending]))('keeps pause pending %j diagnostically distinct', pendingNodeIds => {
    const pause = { ...event(1, 'router_decision'), reasonCode: 'runtime_pause' as const,
      data: { goalBinding: { stateRevision: 3, sourceVersion: 1, sourceFingerprint }, pendingNodeIds, visitCounts: { worker: 1 } } };
    expect(recover([pause])).toMatchObject({ status: 'candidate', candidate: { kind: 'pause', cursorCandidate: { pendingNodeIds, visitCounts: { worker: 1 } } } });
    const result = recover([pause]); if (result.status === 'candidate') expect(result.candidate.sourceNodeId).toBeUndefined();
  });
  it('preserves an unfinished started successor without replaying the checkpoint source', () => {
    expect(recover([route('continue'), event(2, 'node_started', 'worker')])).toMatchObject({ status: 'candidate', candidate: {
      cursorCandidate: { pendingNodeIds: ['worker'], resumeStartedNodeIds: ['worker'], visitCounts: { judge: 1 } } } });
  });
  it('allows matching source completion after its required route ACK', () => {
    const done = event(2, 'node_completed', 'judge'); done.data = { selectedNodeIds: ['worker'] };
    expect(recover([route('continue'), done])).toHaveProperty('status', 'candidate');
  });
  it('returns none for missing goal routes; does not seed started work or reinterpret auto routing', () => {
    expect(recover([])).toEqual({ status: 'none' });
    expect(recover([event(1, 'node_started', 'worker')])).toEqual({ status: 'none' });
    const auto = event(1, 'router_decision', 'judge'); auto.data = { autoRoutingVisit: 1, selectedEdgeId: 'jw' };
    expect(recover([auto])).toEqual({ status: 'none' });
  });
  it('ignores V1 storage tags as authority and returns only a diagnostic', () => {
    const row = route('artifact'); row.data!.schemaVersion = 1;
    const result = recover([row]); expect(result).toHaveProperty('status', 'candidate');
    expect(result).not.toHaveProperty('authorized');
  });
  it.each(['pending', 'next', 'from', 'selected', 'visit-zero', 'visit-fraction', 'foreign-count', 'missing-count', 'source-scope', 'root-scope', 'run-scope', 'metadata', 'proposal-completion', 'criterion', 'missing-completion'] as const)('rejects contradictory %s', corruption => {
    const row = route('continue'); const data = row.data!;
    if (corruption === 'pending') data.pendingNodeIds = ['end'];
    if (corruption === 'next') row.route!.nextNodeId = 'end';
    if (corruption === 'from') row.route!.fromNodeId = 'worker';
    if (corruption === 'selected') row.route!.selectedNodeIds = ['worker', 'end'];
    if (corruption === 'visit-zero') data.visitCounts = { judge: 0 };
    if (corruption === 'visit-fraction') data.visitCounts = { judge: 1.5 };
    if (corruption === 'foreign-count') data.visitCounts = { judge: 1, foreign: 1 };
    if (corruption === 'missing-count') data.visitCounts = {};
    if (corruption === 'source-scope') data.schemaId = 'other';
    if (corruption === 'root-scope') data.rootSessionId = 'other';
    if (corruption === 'run-scope') row.runId = 'other';
    if (corruption === 'metadata') data.goalBinding = { sourceVersion: 1 };
    if (corruption === 'proposal-completion') Reflect.set(data.goalBinding as object, 'proposalFingerprint', 'e'.repeat(64));
    if (corruption === 'criterion') delete data.criterionId;
    if (corruption === 'missing-completion') delete data.completionBinding;
    expect(() => recover([row])).toThrow(/^GOAL_ROUTE_RECOVERY_INVALID$/);
  });
  it.each(['worker', 'end'])('rejects missing declared judge edge to %s', target => {
    const graph = schema(); graph.edges = graph.edges.filter(edge => !(edge.fromNodeId === 'judge' && edge.toNodeId === target));
    expect(() => recover([route(target === 'end' ? 'artifact' : 'continue')], graph)).toThrow(/^GOAL_ROUTE_RECOVERY_INVALID$/);
  });
  it.each(['completed-target', 'restarted-source', 'foreign-progress', 'repeated-start', 'wrong-completed-route', 'too-many-completions'])('rejects progress contradiction %s without topology traversal', kind => {
    const rows = [route('continue')];
    if (kind === 'completed-target') rows.push(event(2, 'node_completed', 'worker'));
    if (kind === 'restarted-source') rows.push(event(2, 'node_started', 'judge'));
    if (kind === 'foreign-progress') rows.push(event(2, 'node_started', 'end'));
    if (kind === 'repeated-start') rows.push(event(2, 'node_started', 'worker'), event(3, 'node_started', 'worker'));
    if (kind === 'wrong-completed-route') rows.push({ ...event(2, 'node_completed', 'judge'), data: { selectedNodeIds: ['end'] } });
    if (kind === 'too-many-completions') rows.push(event(2, 'node_completed', 'judge'), event(3, 'node_completed', 'judge'));
    expect(() => recover(rows)).toThrow(/^GOAL_ROUTE_RECOVERY_INVALID$/);
  });
  it('rejects regressed counts and unchanged-source revision/fingerprint contradictions across checkpoints', () => {
    for (const kind of ['counts', 'revision', 'fingerprint']) {
      const first = route('continue'); const next = route('work', 2);
      next.data!.visitCounts = { judge: kind === 'counts' ? 0 : 1, worker: 1 };
      if (kind === 'revision') next.data!.goalBinding = { stateRevision: 2, sourceVersion: 1, sourceFingerprint };
      if (kind === 'fingerprint') next.data!.goalBinding = { stateRevision: 3, sourceVersion: 1, sourceFingerprint: 'f'.repeat(64) };
      expect(() => recover([first, next])).toThrow(/^GOAL_ROUTE_RECOVERY_INVALID$/);
    }
  });
  it.each(['sequence', 'event-id'])('rejects ambiguous duplicate %s', duplicate => {
    const first = route('continue'); const second = route('work', duplicate === 'sequence' ? 1 : 2);
    if (duplicate === 'event-id') second.id = first.id;
    expect(() => recover([first, second])).toThrow(/^GOAL_ROUTE_RECOVERY_INVALID$/);
  });
  it.each(['event', 'data', 'binding', 'counts', 'route'])('rejects %s accessors without invoking them', location => {
    const row = route('continue'); const getter = vi.fn(() => 'PRIVATE');
    const target = location === 'event' ? row : location === 'data' ? row.data!
      : location === 'binding' ? row.data!.goalBinding as object : location === 'counts' ? row.data!.visitCounts as object : row.route!;
    const key = location === 'event' ? 'nodeId' : location === 'data' ? 'goalBinding' : location === 'binding' ? 'stateRevision' : location === 'counts' ? 'judge' : 'nextNodeId';
    Object.defineProperty(target, key, { enumerable: true, get: getter });
    expect(() => recover([row])).toThrow(/^GOAL_ROUTE_RECOVERY_INVALID$/); expect(getter).not.toHaveBeenCalled();
  });
  it.each(['nodes', 'edges'])('rejects missing schema %s', key => {
    const graph = schema(); Reflect.deleteProperty(graph, key);
    expect(() => recover([route('work')], graph)).toThrow(/^GOAL_ROUTE_RECOVERY_INVALID$/);
  });
  it.each(['nodes', 'edges', 'node-index', 'edge-index', 'event-index'])('rejects %s getters without invoking them', location => {
    const graph = schema(); const rows = [route('work')]; const getter = vi.fn(() => undefined);
    const target = location === 'nodes' || location === 'edges' ? graph
      : location === 'node-index' ? graph.nodes : location === 'edge-index' ? graph.edges : rows;
    const key = location === 'nodes' || location === 'edges' ? location : '0';
    Object.defineProperty(target, key, { enumerable: true, get: getter });
    expect(() => recover(rows, graph)).toThrow(/^GOAL_ROUTE_RECOVERY_INVALID$/);
    expect(getter).not.toHaveBeenCalled();
  });
  it('normalizes throwing proxy descriptor traps to a static error', () => {
    const graph = new Proxy(schema(), { getOwnPropertyDescriptor() { throw new Error('PRIVATE'); } });
    expect(() => recover([route('work')], graph)).toThrow(/^GOAL_ROUTE_RECOVERY_INVALID$/);
  });
  it('detaches returned bindings, arrays and counts from mutable inputs', () => {
    const row = route('continue'); const result = recover([row]); if (result.status !== 'candidate') throw new Error('fixture');
    result.candidate.goalBinding.stateRevision = 99;
    result.candidate.cursorCandidate.pendingNodeIds.push('foreign');
    result.candidate.cursorCandidate.visitCounts.judge = 99;
    expect(row.data!.goalBinding).toMatchObject({ stateRevision: 3 });
    expect(row.data!.pendingNodeIds).toEqual(['worker']); expect(row.data!.visitCounts).toEqual({ judge: 1 });
  });
});

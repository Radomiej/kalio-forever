import type { ArchitectureExecutionEvent, ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import type { GoalPhaseBinding, GraphGoalProtocolAdapter } from './architecture-graph-goal-nodes';
import type { GoalCompletionBinding } from './architecture-goal-completion';
import type { ArchitectureRuntimeResumeCursor } from './architecture-runtime-auto-routing-recovery.utils';
import { cloneGoalCompletionJson } from './architecture-goal-completion-state';
import { goalRouteAuditData } from './architecture-goal-route-audit';

export type GoalRouteTopology = Pick<GraphGoalProtocolAdapter, 'workerNodeId' | 'judgeNodeId' | 'completionNodeIds'>;
export interface GoalRouteResumeCandidate {
  anchorEventId: string;
  anchorSequence: number;
  sourceNodeId?: string;
  kind: 'route' | 'pause';
  goalBinding: GoalPhaseBinding;
  completionBinding?: GoalCompletionBinding;
  criterionId?: string;
  cursorCandidate: Extract<ArchitectureRuntimeResumeCursor, { reason: 'runtime_recovery' }>;
}
export type GoalRouteRecovery = { status: 'none' } | { status: 'halted'; eventId: string }
  | { status: 'candidate'; candidate: GoalRouteResumeCandidate };

function fail(): never { throw new Error('GOAL_ROUTE_RECOVERY_INVALID'); }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  return Reflect.ownKeys(value).every(key => typeof key === 'string'
    && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'));
}
/** Select descriptors before cloning: graph events legitimately contain optional
 * undefined fields; never stringify them or copy raw prompts into diagnostics. */
function select(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!record(raw)) return fail();
  return Object.fromEntries(keys.flatMap(key => {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    return descriptor && descriptor.value !== undefined ? [[key, cloneGoalCompletionJson(descriptor.value)]] : [];
  }));
}
interface Observation {
  id: string; sequence: number; type: string; nodeId?: string;
  reasonCode?: unknown; route?: unknown; data: Record<string, unknown>;
}
function array(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return fail();
  const length = Object.getOwnPropertyDescriptor(raw, 'length')?.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0
    || Reflect.ownKeys(raw).length !== length + 1) return fail();
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail();
    result.push(descriptor.value);
  }
  return result;
}
function observation(raw: unknown, scope: Pick<ArchitectureRun, 'id' | 'rootSessionId' | 'schemaId'>): Observation {
  if (!record(raw)) return fail();
  const fields = select(raw, ['id', 'runId', 'sequence', 'type', 'nodeId', 'reasonCode', 'route']);
  const descriptor = Object.getOwnPropertyDescriptor(raw, 'data');
  const data = descriptor?.value === undefined ? {} : descriptor.value;
  if (!record(data) || !text(fields.id) || fields.runId !== scope.id || !text(fields.type)
    || typeof fields.sequence !== 'number' || !Number.isSafeInteger(fields.sequence) || fields.sequence < 1
    || fields.nodeId !== undefined && !text(fields.nodeId)) return fail();
  const selected = select(data, ['runId', 'rootSessionId', 'schemaId', 'pendingNodeIds', 'visitCounts', 'selectedNodeIds']);
  for (const [key, expected] of [['runId', scope.id], ['rootSessionId', scope.rootSessionId], ['schemaId', scope.schemaId]] as const) {
    if (Object.hasOwn(selected, key) && selected[key] !== expected) return fail();
  }
  return { id: fields.id, sequence: fields.sequence, type: fields.type,
    ...(fields.nodeId !== undefined ? { nodeId: fields.nodeId } : {}),
    ...(fields.reasonCode !== undefined ? { reasonCode: fields.reasonCode } : {}),
    ...(fields.route !== undefined ? { route: fields.route } : {}), data: { ...selected, ...goalRouteAuditData(data) } };
}
function ids(raw: unknown, known: Set<string>): string[] {
  if (!Array.isArray(raw) || raw.some(id => !text(id) || !known.has(id)) || new Set(raw).size !== raw.length) return fail();
  return raw;
}
function counts(raw: unknown, known: Set<string>): Record<string, number> {
  if (!record(raw)) return fail();
  const result: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!known.has(id) || typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return fail();
    result[id] = value;
  }
  return result;
}
function candidate(row: Observation, topology: GoalRouteTopology, known: Set<string>, edges: ArchitectureSchema['edges']): GoalRouteResumeCandidate {
  const metadata = goalRouteAuditData(row.data);
  // These two shapes have already been validated by the shared local decoder.
  const goalBinding = metadata.goalBinding as GoalPhaseBinding;
  const completionBinding = metadata.completionBinding as GoalCompletionBinding | undefined;
  const criterionId = metadata.criterionId as string | undefined;
  const pendingNodeIds = ids(row.data.pendingNodeIds, new Set([topology.workerNodeId, topology.judgeNodeId, ...topology.completionNodeIds]));
  const visitCounts = counts(row.data.visitCounts, known);
  if (row.type !== 'router_decision' || !goalBinding || row.nodeId !== undefined && !known.has(row.nodeId)) return fail();
  const paused = row.reasonCode === 'runtime_pause';
  if (paused) {
    if (completionBinding || criterionId || row.route !== undefined) return fail();
  } else {
    const route = row.route;
    if (!record(route) || route.source !== 'runtime_fallback' || route.fromNodeId !== row.nodeId || pendingNodeIds.length !== 1
      || route.nextNodeId !== pendingNodeIds[0] || JSON.stringify(ids(route.selectedNodeIds, known)) !== JSON.stringify(pendingNodeIds)
      || !row.nodeId || (visitCounts[row.nodeId] ?? 0) < 1
      || !edges.some(edge => edge.fromNodeId === row.nodeId && edge.toNodeId === pendingNodeIds[0])) return fail();
    if (route.rejectedNodeIds !== undefined && ids(route.rejectedNodeIds, known).some(id => pendingNodeIds.includes(id))) return fail();
    const to = pendingNodeIds[0];
    if (row.nodeId === topology.workerNodeId) {
      if (to !== topology.judgeNodeId || completionBinding || criterionId) return fail();
    } else if (row.nodeId === topology.judgeNodeId && to === topology.workerNodeId) {
      if (goalBinding.proposalFingerprint || !!completionBinding !== !!criterionId
        || !edges.some(edge => edge.fromNodeId === row.nodeId && edge.toNodeId === to && edge.selection === 'continuation')) return fail();
    } else if (row.nodeId === topology.judgeNodeId && topology.completionNodeIds.includes(to)) {
      if (!completionBinding || criterionId || goalBinding.proposalFingerprint) return fail();
    } else return fail();
  }
  return { anchorEventId: row.id, anchorSequence: row.sequence, ...(row.nodeId ? { sourceNodeId: row.nodeId } : {}),
    kind: paused ? 'pause' : 'route', goalBinding,
    ...(completionBinding ? { completionBinding } : {}), ...(criterionId ? { criterionId } : {}),
    cursorCandidate: { reason: 'runtime_recovery', pendingNodeIds, visitCounts } };
}

/** Diagnostic only: no receipt/ACK/current V2 producer trust is asserted here.
 * Parent MUST validate current scoped state, node/visit, bindings and required
 * audit ACK before executing cursorCandidate. Terminal history is never skipped:
 * an explicitly readmitted segment/source is a separate host responsibility.
 * Plain JSON data is required. Accessors are rejected without invocation;
 * hostile Proxy reflection traps cannot be made side-effect-free by this API. */
export function recoverGoalRouteCandidate(schema: ArchitectureSchema,
  scope: Pick<ArchitectureRun, 'id' | 'rootSessionId' | 'schemaId'>,
  topology: GoalRouteTopology, events: readonly ArchitectureExecutionEvent[]): GoalRouteRecovery {
  try {
    const identity = select(scope, ['id', 'rootSessionId', 'schemaId']);
    const config = cloneGoalCompletionJson(topology);
    const graphId = select(schema, ['id']).id;
    if (!text(identity.id) || !text(identity.rootSessionId) || !text(identity.schemaId) || graphId !== identity.schemaId
      || !Array.isArray(config.completionNodeIds) || !config.completionNodeIds.length) return fail();
    const nodes = array(Object.getOwnPropertyDescriptor(schema, 'nodes')?.value).map(node => select(node, ['id', 'kind']));
    const known = new Set(nodes.map(node => node.id).filter(text));
    const configured = [config.workerNodeId, config.judgeNodeId, ...config.completionNodeIds];
    if (known.size !== nodes.length || configured.some(id => !text(id) || !known.has(id)) || new Set(configured).size !== configured.length
      || nodes.some(node => configured.includes(String(node.id)) && node.kind !== (config.completionNodeIds.includes(String(node.id)) ? 'artifact' : 'role'))) return fail();
    const edges = array(Object.getOwnPropertyDescriptor(schema, 'edges')?.value).map(edge => select(edge, ['id', 'fromNodeId', 'toNodeId', 'selection']));
    if (edges.some(edge => !text(edge.id) || !text(edge.fromNodeId) || !text(edge.toNodeId)
      || !known.has(edge.fromNodeId) || !known.has(edge.toNodeId))) return fail();
    // Narrowed endpoints are reused as topology only, never as authorization.
    const graphEdges = edges as unknown as ArchitectureSchema['edges'];
    if (!edges.some(edge => edge.fromNodeId === config.workerNodeId && edge.toNodeId === config.judgeNodeId)
      || !edges.some(edge => edge.fromNodeId === config.judgeNodeId && edge.toNodeId === config.workerNodeId && edge.selection === 'continuation')
      || config.completionNodeIds.some(id => !edges.some(edge => edge.fromNodeId === config.judgeNodeId && edge.toNodeId === id))) return fail();
    const rows = array(events).map(row => observation(row, scope)).sort((a, b) => a.sequence - b.sequence);
    if (new Set(rows.map(row => row.id)).size !== rows.length || new Set(rows.map(row => row.sequence)).size !== rows.length) return fail();
    let latest: GoalRouteResumeCandidate | undefined;
    const completed: Record<string, number> = {};
    let terminal: Observation | undefined;
    for (const row of rows) {
      if (row.nodeId && !known.has(row.nodeId)) return fail();
      if (['run_stopped', 'final_artifact', 'node_failed'].includes(row.type)) terminal = row;
      if (Object.hasOwn(row.data, 'goalBinding')) {
        const next = candidate(row, config, known, graphEdges);
        const saved = next.cursorCandidate.visitCounts;
        if (Object.entries(completed).some(([id, count]) => (saved[id] ?? 0) < count)
          || next.kind === 'route' && saved[next.sourceNodeId!]! <= (completed[next.sourceNodeId!] ?? 0)) return fail();
        if (latest && (Object.entries(latest.cursorCandidate.visitCounts).some(([id, count]) => (saved[id] ?? 0) < count)
          || next.goalBinding.stateRevision < latest.goalBinding.stateRevision || next.goalBinding.sourceVersion < latest.goalBinding.sourceVersion
          || next.goalBinding.sourceVersion === latest.goalBinding.sourceVersion && next.goalBinding.sourceFingerprint !== latest.goalBinding.sourceFingerprint)) return fail();
        latest = next;
      }
      if (row.type === 'node_completed' && row.nodeId) completed[row.nodeId] = (completed[row.nodeId] ?? 0) + 1;
    }
    if (terminal) return { status: 'halted', eventId: terminal.id };
    if (!latest) return { status: 'none' };
    const after = rows.filter(row => row.sequence > latest!.anchorSequence);
    const started: string[] = [];
    const sourceCompletions: string[] = [];
    for (const row of after) {
      if (!['node_started', 'node_completed'].includes(row.type)) continue;
      if (!row.nodeId) return fail();
      if (row.type === 'node_started') {
        if (!latest.cursorCandidate.pendingNodeIds.includes(row.nodeId) || started.includes(row.nodeId)) return fail();
        started.push(row.nodeId);
      } else {
        if (latest.kind !== 'route' || row.nodeId !== latest.sourceNodeId || sourceCompletions.includes(row.nodeId)
          || Object.hasOwn(row.data, 'selectedNodeIds') && JSON.stringify(ids(row.data.selectedNodeIds, known)) !== JSON.stringify(latest.cursorCandidate.pendingNodeIds)) return fail();
        sourceCompletions.push(row.nodeId);
      }
    }
    if (started.length) latest.cursorCandidate.resumeStartedNodeIds = started;
    return { status: 'candidate', candidate: cloneGoalCompletionJson(latest) };
  } catch { return fail(); }
}

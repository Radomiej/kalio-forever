import type { ArchitectureExecutionEvent, ArchitectureSchemaNode } from '@kalio/types';
import type { ArchitectureGraphContext } from './architecture-graph-runtime.context';
import { goalPhaseBinding, type GoalPhaseBinding } from './architecture-graph-goal-nodes';
import { createWorkflowError } from '../../common/utils/workflow-error.util';

export interface GoalVisitInput {
  event: ArchitectureExecutionEvent;
  node: ArchitectureSchemaNode;
  visit: number;
  startedEventId: string;
  branchSessionId: string | null;
  rootSessionId: string;
  goalBinding: GoalPhaseBinding;
  checkpointId: string;
  replay: boolean;
  signal?: AbortSignal;
}
/** Host-created start metadata, durably bound by persistGoalVisit, never inferred on replay. */
export interface GoalStartVisitMetadata { goalVisit: number }
function fail(): never {
  throw createWorkflowError('CONTRACT_VIOLATION', 'Goal graph visit failed.', { source: 'architecture-graph-runtime', retryable: false });
}
function identity(ctx: ArchitectureGraphContext, node: ArchitectureSchemaNode): string {
  return JSON.stringify([ctx.options.run, ctx.goalDirective, ctx.options.schema, node, ctx.visitCount(node.id)]);
}
export function prepareGoalVisit(ctx: ArchitectureGraphContext, node: ArchitectureSchemaNode,
  event: ArchitectureExecutionEvent, startedEventId: string, replay: boolean): GoalVisitInput {
  const run = ctx.options.run;
  const state = ctx.goalDirective?.state;
  const start = event.type === 'node_started' ? event : ctx.events.find(item => item.id === startedEventId);
  const branch = node.roleSlotId ? run.branchSessionIds?.[node.roleSlotId] : null;
  if (!state || !run.rootSessionId || state.runId !== run.id || state.rootSessionId !== run.rootSessionId
    || JSON.stringify(state.packet) !== JSON.stringify(run.goalPacket) || !ctx.options.schema.nodes.includes(node)
    || !start || start.type !== 'node_started' || start.id !== startedEventId || start.nodeId !== node.id
    || start.runId !== run.id || event.runId !== run.id || event.nodeId !== node.id || event.roleSlotId !== node.roleSlotId
    || !['node_started', 'node_completed'].includes(event.type) || node.roleSlotId && !branch
    || replay && (event.type !== 'node_started' || !ctx.events.includes(event))
    || event.type === 'node_completed' && ctx.events.some(item => item.nodeId === node.id && item.type === 'node_started' && item.sequence > start.sequence)) fail();
  const fresh = event.type === 'node_started' && !replay;
  const count = ctx.visitCount(node.id);
  const visit = fresh ? count + 1 : start.data?.['goalVisit'];
  if (typeof visit !== 'number' || !Number.isSafeInteger(visit) || visit < 1
    || fresh && (!Number.isSafeInteger(count) || count < 0)
    || fresh && start.data?.['goalVisit'] !== undefined && start.data['goalVisit'] !== visit) fail();
  const detachedEvent = structuredClone(event);
  detachedEvent.data = { ...detachedEvent.data, goalVisit: visit };
  return { event: detachedEvent, node: structuredClone(node), visit, startedEventId,
    branchSessionId: branch ?? null, rootSessionId: run.rootSessionId, goalBinding: goalPhaseBinding(state),
    checkpointId: `${run.id}:goal-visit:${startedEventId}:${event.type}`, replay, signal: ctx.options.signal };
}
/** Host verifies durable ownership/full currentness; local snapshots only detect in-flight changes. */
export async function acknowledgeGoalVisit(ctx: ArchitectureGraphContext, node: ArchitectureSchemaNode,
  event: ArchitectureExecutionEvent, startedEventId: string, replay: boolean): Promise<boolean> {
  if (ctx.isStopped()) return false;
  try {
    if (typeof ctx.options.persistGoalVisit !== 'function') fail();
    const before = identity(ctx, node);
    const signal = ctx.options.signal;
    const input = prepareGoalVisit(ctx, node, event, startedEventId, replay);
    const acknowledgedEvent = structuredClone(input.event);
    await ctx.options.persistGoalVisit(input);
    if (ctx.isStopped()) return false;
    if (signal !== ctx.options.signal || before !== identity(ctx, node)) fail();
    if (!replay) ctx.appendEvent(acknowledgedEvent);
    return true;
  } catch {
    if (ctx.isStopped()) return false;
    return fail();
  }
}

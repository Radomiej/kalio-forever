import { createHash } from 'node:crypto';
import type { ArchitectureSchemaNode } from '@kalio/types';
import type { ArchitectureGoalState } from './architecture-goal.repository';
import type { ArchitectureGraphContext, EventOptions } from './architecture-graph-runtime.context';
import { cloneGoalCompletionJson, validateGoalCompletionState } from './architecture-goal-completion-state';
import { goalPhaseBinding, pauseGoalGraph, type GoalCompletionAuthorized } from './architecture-graph-goal-nodes';
import { prepareGoalVisit } from './architecture-graph-goal-visits';
import { isDeepStrictEqual } from 'node:util';

function fail(): never { throw new Error('GOAL_GRAPH_COMPLETION_FAILED'); }
/** Equality only; domain fingerprints remain owned by the existing pure builders. */
function canonical(value: unknown): string {
  return JSON.stringify(cloneGoalCompletionJson(value), (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
}
export function assertGoalArtifactAuthorization(state: ArchitectureGoalState, authorization: GoalCompletionAuthorized): void {
  const checked = cloneGoalCompletionJson(state);
  const proof = cloneGoalCompletionJson(authorization);
  validateGoalCompletionState(checked, checked.evidenceInventory, checked.completionAuthorization);
  const receipt = checked.completionAuthorization;
  if (checked.packet.projection.status !== 'accepted' || checked.evidenceInventory?.schemaVersion !== 2 || receipt?.schemaVersion !== 2
    || proof.status !== 'authorized' || proof.authorizedStateRevision !== checked.stateRevision
    || proof.checkpointId !== `${checked.runId}:goal-completion:${checked.stateRevision}`
    || canonical(proof.binding) !== canonical(receipt.binding) || typeof proof.replayed !== 'boolean') fail();
}

/** Durably ACK the existing cursor fields before completing the source node. */
export async function persistGoalRoute(ctx: ArchitectureGraphContext, node: ArchitectureSchemaNode, selectedNodeIds: readonly string[],
  completionBinding?: GoalCompletionAuthorized['binding'], criterionId?: string): Promise<void> {
  if (ctx.isStopped()) return;
  const adapter = ctx.options.goalProtocol;
  const state = ctx.goalDirective?.state;
  if (!adapter || !state || typeof adapter.persistRouteRequired !== 'function' || !selectedNodeIds.length
    || selectedNodeIds.some(id => !ctx.options.schema.edges.some(edge => edge.fromNodeId === node.id && edge.toNodeId === id))) fail();
  const visitCounts = { ...Object.fromEntries(ctx.nodeVisitCounts), [node.id]: ctx.visitCount(node.id) + 1 };
  const event = ctx.createEvent('router_decision', 'Goal host branch selected.', {
    nodeId: node.id,
    route: { source: 'runtime_fallback', fromNodeId: node.id, selectedNodeIds: [...selectedNodeIds],
      rejectedNodeIds: ctx.options.schema.edges.filter(edge => edge.fromNodeId === node.id && !selectedNodeIds.includes(edge.toNodeId)).map(edge => edge.toNodeId), nextNodeId: selectedNodeIds[0] },
    data: { pendingNodeIds: [...selectedNodeIds], visitCounts, goalBinding: goalPhaseBinding(state),
      ...(completionBinding ? { completionBinding, ...(criterionId ? { criterionId } : {}) } : {}) },
  });
  const digest = createHash('sha256').update(canonical({ runId: state.runId, rootSessionId: state.rootSessionId,
    binding: goalPhaseBinding(state), pendingNodeIds: selectedNodeIds, visitCounts, sequence: event.sequence })).digest('hex');
  await adapter.persistRouteRequired(structuredClone(event), `${state.runId}:goal-route:${digest}`, ctx.options.signal);
  if (ctx.isStopped()) return;
  const current = await adapter.beforeBatch({ run: structuredClone(ctx.options.run), readyNodeIds: selectedNodeIds, signal: ctx.options.signal });
  if (ctx.isStopped()) return;
  if (canonical(current.state) !== canonical(state)) fail();
  ctx.appendEvent(event);
}

export async function executeGoalCompletionJudge(ctx: ArchitectureGraphContext, node: ArchitectureSchemaNode, outgoing: readonly string[]): Promise<string[]> {
  const adapter = ctx.options.goalProtocol;
  const initial = ctx.goalDirective;
  if (!adapter || initial?.kind !== 'completion_judge' || node.id !== adapter.judgeNodeId || typeof adapter.judgeCompletion !== 'function') return fail();
  const runIdentity = JSON.stringify([ctx.options.run.id, ctx.options.run.rootSessionId, ctx.options.run.goalPacket]);
  const result = cloneGoalCompletionJson(await adapter.judgeCompletion({ run: structuredClone(ctx.options.run), binding: goalPhaseBinding(initial.state), signal: ctx.options.signal }));
  if (ctx.isStopped()) return [];
  if (runIdentity !== JSON.stringify([ctx.options.run.id, ctx.options.run.rootSessionId, ctx.options.run.goalPacket])
    || result.state.runId !== initial.state.runId || result.state.rootSessionId !== initial.state.rootSessionId
    || canonical(result.state.packet) !== canonical(initial.state.packet)) fail();
  ctx.options.run.goalPacket = structuredClone(result.state.packet);
  ctx.goalDirective = { kind: 'pause', state: result.state };
  if (result.selection.status === 'needs_user') {
    await pauseGoalGraph(ctx, [node.id]); return [];
  }
  let selected: string[];
  if (result.selection.status === 'authorized') {
    assertGoalArtifactAuthorization(result.state, result.selection);
    selected = outgoing.filter(id => adapter.completionNodeIds.includes(id));
  } else if (result.selection.status === 'continue') {
    if (canonical(result.state) !== canonical(initial.state) || result.selection.reviewedStateRevision !== result.state.stateRevision
      || result.state.packet.projection.status !== 'accepted' || result.selection.confidence < .95 || result.selection.confidence > 1
      || !Number.isFinite(result.selection.confidence)) fail();
    const rows = result.state.packet.projection.snapshot.criteria;
    const superseded = new Set(rows.flatMap(row => row.supersedes));
    const criterionId = result.selection.criterionId;
    if (!rows.some(row => row.id === criterionId && !superseded.has(row.id))) fail();
    selected = outgoing.filter(id => id === adapter.workerNodeId);
  } else return fail();
  if (selected.length !== 1) fail();
  await persistGoalRoute(ctx, node, selected, result.selection.binding,
    result.selection.status === 'continue' ? result.selection.criterionId : undefined);
  return ctx.isStopped() ? [] : selected;
}

/** Worker production may legitimately advance the inventory revision, not the
 * canonical goal/source/policy. Refresh and ACK that state before routing review. */
export async function refreshGoalWorkState(ctx: ArchitectureGraphContext): Promise<void> {
  const initial = ctx.goalDirective;
  const adapter = ctx.options.goalProtocol;
  if (initial?.kind !== 'work' || !adapter) return fail();
  const current = cloneGoalCompletionJson(await adapter.beforeBatch({ run: structuredClone(ctx.options.run),
    readyNodeIds: [adapter.judgeNodeId], signal: ctx.options.signal }));
  if (ctx.isStopped()) return;
  if (current.kind !== 'completion_judge' || current.state.runId !== initial.state.runId || current.state.rootSessionId !== initial.state.rootSessionId
    || current.state.stateRevision < initial.state.stateRevision || canonical(current.state.packet) !== canonical(initial.state.packet)) fail();
  ctx.goalDirective = { kind: 'pause', state: current.state };
}

export function assertGoalArtifactPort(ctx: ArchitectureGraphContext, node: ArchitectureSchemaNode): void {
  const directive = ctx.goalDirective;
  const started = [...ctx.events].reverse().find(event => event.type === 'node_started');
  if (directive?.kind !== 'artifact' || !directive.executableNodeIds.includes(node.id) || !ctx.options.commitGoalTerminal
    || !ctx.options.goalProtocol?.completionNodeIds.includes(node.id) || node.kind !== 'artifact'
    || !ctx.options.schema.nodes.includes(node) || started?.nodeId !== node.id
    || ctx.events.some(event => event.nodeId === node.id && event.sequence > started.sequence && event.type === 'node_completed')) fail();
  assertGoalArtifactAuthorization(directive.state, directive.authorization);
}
export async function publishGoalArtifact(ctx: ArchitectureGraphContext, node: ArchitectureSchemaNode, message: string, options: EventOptions): Promise<void> {
  assertGoalArtifactPort(ctx, node);
  const directive = ctx.goalDirective;
  if (directive?.kind !== 'artifact') return fail();
  const started = [...ctx.events].reverse().find(event => event.nodeId === node.id && event.type === 'node_started');
  if (!started) return fail();
  const completed = ctx.createEvent('node_completed', `${node.label} completed.`, {
    lifecycle: 'node_completed', status: 'done', nodeId: node.id, roleSlotId: node.roleSlotId, data: { selectedNodeIds: [] },
  });
  const completedVisit = prepareGoalVisit(ctx, node, completed, started.id, false);
  const completedEvent = structuredClone(completedVisit.event);
  const completedVisitCheckpointId = completedVisit.checkpointId;
  const original = JSON.stringify([ctx.options.run.id, ctx.options.run.rootSessionId, ctx.options.run.goalPacket]);
  let active = true;
  let invoked = false;
  try {
    await ctx.options.commitGoalTerminal!({ run: structuredClone(ctx.options.run), nodeId: node.id,
      authorization: cloneGoalCompletionJson(directive.authorization), completedVisit, signal: ctx.options.signal, publish: ack => {
        if (!active || invoked) fail();
        if (!ack || ack.completedVisitCheckpointId !== completedVisitCheckpointId
          || !isDeepStrictEqual(ack.event, completedEvent)) fail();
        invoked = true;
        if (ctx.isStopped()) return;
        if (original !== JSON.stringify([ctx.options.run.id, ctx.options.run.rootSessionId, ctx.options.run.goalPacket])) fail();
        assertGoalArtifactPort(ctx, node);
        const event = ctx.createEvent('final_artifact', message, options);
        try { ctx.appendEvent(completedEvent); ctx.appendEvent(event); }
        catch {
          // Only retract this local projection. External durability/replay is
          // owned by the host checkpoint sink; the marker is never its proof.
          const index = ctx.events.indexOf(event);
          if (index >= 0) ctx.events.splice(index, 1);
          const completedIndex = ctx.events.indexOf(completedEvent);
          if (completedIndex >= 0) ctx.events.splice(completedIndex, 1);
          return fail();
        }
        ctx.goalTerminalPublished = true;
      } });
  } finally { active = false; }
  if (!ctx.isStopped() && !ctx.goalTerminalPublished) fail();
}

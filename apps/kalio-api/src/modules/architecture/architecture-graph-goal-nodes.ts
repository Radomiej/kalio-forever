import { createHash } from 'node:crypto';
import type { ArchitectureExecutionEvent, ArchitectureRun, ArchitectureSchemaNode } from '@kalio/types';
import type { ArchitectureGoalState } from './architecture-goal.repository';
import type { GoalProjectionStateResult } from './architecture-goal-projection.service';
import type { ArchitectureGraphContext } from './architecture-graph-runtime.context';
import { appendGoalSource } from './architecture-goal-source';
import { assertGoalProjectionHistory, goalProjectionPolicyTargets, prepareGoalProjection } from './architecture-goal-projection';
import { createWorkflowError } from '../../common/utils/workflow-error.util';
import type { GoalCompletionAuthorizationResult } from './architecture-goal-completion-authorization.service';
import { executeGoalCompletionJudge, assertGoalArtifactAuthorization, persistGoalRoute } from './architecture-graph-goal-completion';

export interface GoalPhaseBinding {
  stateRevision: number;
  sourceVersion: number;
  sourceFingerprint: string;
  proposalFingerprint?: string;
}
export type GoalBatchDirective =
  | { kind: 'proposal' | 'projection_judge' | 'completion_judge' | 'pause'; state: ArchitectureGoalState }
  | { kind: 'work'; state: ArchitectureGoalState; executableNodeIds: readonly string[] }
  | { kind: 'artifact'; state: ArchitectureGoalState; authorization: GoalCompletionAuthorized; executableNodeIds: readonly string[] };
export type GoalCompletionAuthorized = Extract<GoalCompletionAuthorizationResult, { status: 'authorized' }>;
export interface GoalCompletionGraphResult { state: ArchitectureGoalState; selection: GoalCompletionAuthorizationResult }
export interface GraphGoalProtocolAdapter {
  workerNodeId: string;
  judgeNodeId: string;
  /** Only a current V2 completion receipt may permit these artifact nodes. */
  completionNodeIds: readonly string[];
  /** Hydrate canonical state and ACK its required audit. Never return uncommitted state. */
  beforeBatch(input: { run: ArchitectureRun; readyNodeIds: readonly string[]; signal?: AbortSignal }): Promise<GoalBatchDirective>;
  /** CAS against binding, recheck source currentness, and ACK before returning. */
  recordProposal(input: { run: ArchitectureRun; binding: GoalPhaseBinding; output: unknown; signal?: AbortSignal }): Promise<ArchitectureGoalState>;
  /** Owns real review, current-source CAS and required audit (including same-proposal re-CAS). */
  judgeProjection(input: { run: ArchitectureRun; binding: GoalPhaseBinding; signal?: AbortSignal }): Promise<GoalProjectionStateResult>;
  judgeCompletion(input: { run: ArchitectureRun; binding: GoalPhaseBinding; signal?: AbortSignal }): Promise<GoalCompletionGraphResult>;
  persistRouteRequired(event: ArchitectureExecutionEvent, checkpointId: string, signal?: AbortSignal): Promise<void>;
  persistPauseRequired(event: ArchitectureExecutionEvent, checkpointId: string): Promise<void>;
}

export function goalProtocolRequired(ctx: ArchitectureGraphContext): boolean {
  return Object.hasOwn(ctx.options.run.context ?? {}, 'goalProtocol') || ctx.options.run.goalPacket !== undefined;
}
function fail(): never {
  throw createWorkflowError('CONTRACT_VIOLATION', 'Goal graph protocol failed.', { source: 'architecture-graph-runtime', retryable: false });
}
export function goalPhaseBinding(state: ArchitectureGoalState): GoalPhaseBinding {
  return { stateRevision: state.stateRevision, sourceVersion: state.packet.version, sourceFingerprint: state.packet.sourceFingerprint,
    ...(state.packet.projection.status === 'pending' && state.packet.projection.proposal
      ? { proposalFingerprint: state.packet.projection.proposal.proposalFingerprint } : {}) };
}
function validateState(ctx: ArchitectureGraphContext, state: ArchitectureGoalState, previous?: ArchitectureGoalState): ArchitectureGoalState {
  const run = ctx.options.run;
  if (!state || state.runId !== run.id || state.rootSessionId !== run.rootSessionId
    || !Number.isSafeInteger(state.stateRevision) || state.stateRevision < 1) fail();
  const packet = appendGoalSource(state.packet, state.packet.original);
  assertGoalProjectionHistory(packet);
  if (packet.projection.status === 'accepted') {
    const rows = packet.projection.snapshot.criteria;
    const superseded = new Set(rows.flatMap(row => row.supersedes));
    const active = rows.filter(row => !superseded.has(row.id));
    const policy = packet.completionPolicy.requiredEvidenceKindsByCriterion;
    if (!active.length || Object.keys(policy).length !== active.length
      || active.some(row => !Array.isArray(policy[row.id]) || !policy[row.id]!.length
        || new Set(policy[row.id]).size !== policy[row.id]!.length
        || policy[row.id]!.some(kind => !['BUILD_RESULT', 'GIT_STATUS', 'FINAL_ARTIFACT', 'QUALITY_GATE', 'TOOL_RESULT', 'CLI_CHILD', 'VFS_WRITE', 'VFS_READ'].includes(kind)))) fail();
  }
  if (packet.projection.status === 'pending' && packet.projection.proposal) {
    const { proposalFingerprint, ...raw } = packet.projection.proposal;
    if (prepareGoalProjection(packet, raw).proposalFingerprint !== proposalFingerprint) fail();
  }
  const old = previous?.packet ?? run.goalPacket;
  if (old && (JSON.stringify(packet.original) !== JSON.stringify(old.original) || packet.version < old.version
    || JSON.stringify(packet.updates.slice(0, old.updates.length)) !== JSON.stringify(old.updates))) fail();
  if (previous && (state.stateRevision < previous.stateRevision
    || state.stateRevision === previous.stateRevision && JSON.stringify(packet) !== JSON.stringify(previous.packet))) fail();
  return structuredClone(state);
}
export function validateGoalGraphConfig(ctx: ArchitectureGraphContext): GraphGoalProtocolAdapter {
  const adapter = ctx.options.goalProtocol;
  const marker = ctx.options.run.context;
  if ((Object.hasOwn(marker ?? {}, 'goalProtocol') && marker?.['goalProtocol'] !== 1) || !adapter
    || !ctx.options.run.goalPacket || ctx.options.run.schemaId !== ctx.options.schema.id
    || ctx.options.run.executionMode !== 'subagent_execution') fail();
  const ids = [adapter.workerNodeId, adapter.judgeNodeId, ...adapter.completionNodeIds];
  const nodes = ctx.options.schema.nodes;
  if (ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length
    || new Set(nodes.map(node => node.id)).size !== nodes.length || ids.some(id => !nodes.some(node => node.id === id))
    || !ctx.options.schema.edges.some(edge => edge.fromNodeId === adapter.workerNodeId && edge.toNodeId === adapter.judgeNodeId)
    || !ctx.options.schema.edges.some(edge => edge.fromNodeId === adapter.judgeNodeId && edge.toNodeId === adapter.workerNodeId && edge.selection === 'continuation')
    || !adapter.completionNodeIds.length || adapter.completionNodeIds.some(id => !nodes.some(node => node.id === id && node.kind === 'artifact')
      || !ctx.options.schema.edges.some(edge => edge.fromNodeId === adapter.judgeNodeId && edge.toNodeId === id))
    || ctx.options.schema.edges.some(edge => !nodes.some(node => node.id === edge.fromNodeId) || !nodes.some(node => node.id === edge.toNodeId))
    || ['beforeBatch', 'recordProposal', 'judgeProjection', 'persistPauseRequired'].some(key => typeof adapter[key as keyof GraphGoalProtocolAdapter] !== 'function')) fail();
  for (const id of [adapter.workerNodeId, adapter.judgeNodeId]) {
    const node = nodes.find(node => node.id === id)!;
    if (node.kind !== 'role' || !node.roleSlotId || !ctx.options.schema.roleSlots.some(slot => slot.id === node.roleSlotId)
      || !ctx.options.run.branchSessionIds?.[node.roleSlotId]) fail();
  }
  return adapter;
}

/** Select only nodes already made ready by the existing scheduler; never invent a redirect. */
export async function gateGoalBatch(ctx: ArchitectureGraphContext, ready: readonly ArchitectureSchemaNode[]): Promise<ArchitectureSchemaNode[]> {
  if (!goalProtocolRequired(ctx)) return [...ready];
  try {
    if (ctx.isStopped()) return [];
    const adapter = validateGoalGraphConfig(ctx);
    const prior = ctx.goalDirective?.state;
    const identity = JSON.stringify([ctx.options.run.id, ctx.options.run.rootSessionId, ctx.options.run.goalPacket]);
    const response = structuredClone(await adapter.beforeBatch({ run: structuredClone(ctx.options.run), readyNodeIds: ready.map(node => node.id), signal: ctx.options.signal }));
    if (ctx.isStopped()) return [];
    if (identity !== JSON.stringify([ctx.options.run.id, ctx.options.run.rootSessionId, ctx.options.run.goalPacket])) fail();
    const state = validateState(ctx, response.state, prior);
    const projection = state.packet.projection;
    if (response.kind === 'proposal' && (projection.status !== 'pending' || projection.proposal)
      || response.kind === 'projection_judge' && (projection.status !== 'pending' || !projection.proposal)
      || response.kind === 'work' && projection.status !== 'accepted'
      || (response.kind === 'completion_judge' || response.kind === 'artifact') && projection.status !== 'accepted'
      || !['proposal', 'projection_judge', 'completion_judge', 'artifact', 'work', 'pause'].includes(response.kind)) fail();
    const requested = response.kind === 'proposal' ? [adapter.workerNodeId]
      : response.kind === 'projection_judge' ? [adapter.judgeNodeId]
      : response.kind === 'completion_judge' ? [adapter.judgeNodeId]
      : response.kind === 'work' || response.kind === 'artifact' ? response.executableNodeIds : [];
    if (!Array.isArray(requested) || new Set(requested).size !== requested.length
      || requested.some(id => !ctx.options.schema.nodes.some(node => node.id === id))) fail();
    if (response.kind === 'work' && requested.some(id => id === adapter.judgeNodeId || adapter.completionNodeIds.includes(id)
      || ctx.options.schema.nodes.find(node => node.id === id)?.kind === 'artifact')) fail();
    if (response.kind === 'artifact') {
      assertGoalArtifactAuthorization(state, response.authorization);
      if (requested.some(id => !adapter.completionNodeIds.includes(id))) fail();
    }
    ctx.goalDirective = { ...response, state };
    ctx.options.run.goalPacket = structuredClone(state.packet);
    ctx.options.run.prompt = state.packet.original.content;
    const selected = ready.filter(node => requested.includes(node.id));
    if (selected.length === 0) await pauseGoalGraph(ctx, ready.map(node => node.id));
    return selected;
  } catch {
    if (ctx.isStopped()) return [];
    return fail();
  }
}

export async function pauseGoalGraph(ctx: ArchitectureGraphContext, pendingNodeIds: readonly string[]): Promise<void> {
  if (ctx.isStopped()) return;
  try {
    const state = ctx.goalDirective?.state;
    if (!state) fail();
    const event = ctx.createEvent('router_decision', 'Goal execution requires host authorization or source redirect.', {
      lifecycle: 'waiting_on_orchestrator', status: 'waiting_on_orchestrator', reasonCode: 'runtime_pause',
      data: { reasonCode: 'runtime_pause', pendingNodeIds: [...pendingNodeIds], visitCounts: Object.fromEntries(ctx.nodeVisitCounts), goalBinding: goalPhaseBinding(state) },
    });
    const digest = createHash('sha256').update(JSON.stringify([state.runId, state.rootSessionId, goalPhaseBinding(state), pendingNodeIds, event.sequence])).digest('hex');
    await ctx.options.goalProtocol!.persistPauseRequired(structuredClone(event), `goal-pause:${digest}`);
    if (ctx.isStopped()) return;
    ctx.appendEvent(event);
    ctx.goalPaused = true;
  } catch {
    if (!ctx.isStopped()) fail();
  }
}

/** null delegates ordinary accepted work to the existing node executor. */
export async function executeGoalNode(ctx: ArchitectureGraphContext, node: ArchitectureSchemaNode, outgoingNodeIds: string[]): Promise<string[] | null> {
  if (!goalProtocolRequired(ctx)) return null;
  try {
    if (ctx.isStopped()) return [];
    const adapter = validateGoalGraphConfig(ctx);
    const directive = ctx.goalDirective;
    if (!directive) fail();
    if (directive.kind === 'work' || directive.kind === 'artifact') return null;
    if (directive.kind === 'completion_judge') return await executeGoalCompletionJudge(ctx, node, outgoingNodeIds);
    const state = structuredClone(directive.state);
    const phaseBinding = goalPhaseBinding(state);
    const run = structuredClone(ctx.options.run);
    const unchanged = () => {
      if (JSON.stringify(ctx.options.run.goalPacket) !== JSON.stringify(run.goalPacket)
        || ctx.options.run.id !== run.id || ctx.options.run.rootSessionId !== run.rootSessionId) fail();
    };
    let returned: ArchitectureGoalState;
    if (directive.kind === 'proposal' && node.id === adapter.workerNodeId) {
      const slot = ctx.options.schema.roleSlots.find(slot => slot.id === node.roleSlotId)!;
      const branchSessionId = run.branchSessionIds![slot.id]!;
      ctx.push('agent_started', 'Goal proposal worker started.', { nodeId: node.id, roleSlotId: slot.id, data: { branchSessionId, personaId: ctx.options.personaForSlot(slot), slotType: slot.slotType } });
      const result = await ctx.options.roleExecutor.execute({ schema: ctx.options.schema, run, slot, branchSessionId,
        personaId: ctx.options.personaForSlot(slot), node, incomingEvents: ctx.incomingEventsForSlot(slot, ctx.incomingNodeIdsFor(node.id)),
        outgoingNodeIds, purpose: { kind: 'goal_proposal', packet: structuredClone(state.packet) },
        resumeChildTurnId: ctx.options.resumeFrom?.waitingNodeId === node.id ? ctx.options.resumeFrom.waitIdentity?.childTurnId : undefined,
        emit: ctx.branchEventEmit(node, slot) });
      if (ctx.isStopped()) return [];
      unchanged();
      const proposal = prepareGoalProjection(state.packet, result.structuredOutput);
      returned = validateState(ctx, await adapter.recordProposal({ run: structuredClone(run), binding: phaseBinding, output: structuredClone(result.structuredOutput), signal: ctx.options.signal }), state);
      if (ctx.isStopped()) return [];
      unchanged();
      if (returned.stateRevision !== state.stateRevision + 1 || returned.packet.projection.status !== 'pending'
        || returned.packet.projection.proposal?.proposalFingerprint !== proposal.proposalFingerprint
        || JSON.stringify(returned.packet.projection.base) !== JSON.stringify(state.packet.projection.status === 'pending' ? state.packet.projection.base : null)
        || JSON.stringify(returned.packet.completionPolicy) !== JSON.stringify(state.packet.completionPolicy)) fail();
    } else if (directive.kind === 'projection_judge' && node.id === adapter.judgeNodeId) {
      const result = await adapter.judgeProjection({ run, binding: phaseBinding, signal: ctx.options.signal });
      if (ctx.isStopped()) return [];
      unchanged();
      returned = validateState(ctx, result.state, state);
      if (returned.packet.version !== phaseBinding.sourceVersion || returned.packet.sourceFingerprint !== phaseBinding.sourceFingerprint) fail();
      if (result.status === 'accepted') {
        if (returned.packet.projection.status !== 'accepted' || returned.stateRevision <= state.stateRevision) fail();
        if (state.packet.projection.status !== 'pending' || !state.packet.projection.proposal) fail();
        const targets = goalProjectionPolicyTargets(state.packet, state.packet.projection.proposal);
        const expectedRows = new Map((state.packet.projection.base?.criteria ?? []).map(row => [row.id, row]));
        targets.forEach(row => expectedRows.set(row.id, row));
        const actual = returned.packet.projection.snapshot.criteria;
        if (actual.length !== expectedRows.size || actual.some(row => JSON.stringify(row) !== JSON.stringify(expectedRows.get(row.id)))) fail();
      } else if (result.status === 'rejected' || result.status === 'needs_user') {
        if (returned.packet.projection.status !== 'pending' || returned.packet.projection.proposal?.proposalFingerprint !== phaseBinding.proposalFingerprint
          || JSON.stringify(returned.packet.completionPolicy) !== JSON.stringify(state.packet.completionPolicy)
          || JSON.stringify(returned.packet.projection.base) !== JSON.stringify(state.packet.projection.status === 'pending' ? state.packet.projection.base : null)) fail();
        ctx.goalDirective = { kind: 'pause', state: returned };
        ctx.options.run.goalPacket = structuredClone(returned.packet);
        await pauseGoalGraph(ctx, [node.id]);
        return [];
      } else fail();
    } else return fail();
    if (returned.packet.version !== phaseBinding.sourceVersion || returned.packet.sourceFingerprint !== phaseBinding.sourceFingerprint) fail();
    ctx.goalDirective = { kind: 'pause', state: returned };
    ctx.options.run.goalPacket = structuredClone(returned.packet);
    ctx.push('participant_output', 'Goal phase persisted and audited.', { nodeId: node.id, roleSlotId: node.roleSlotId, data: { goalBinding: goalPhaseBinding(returned) } });
    const selected = outgoingNodeIds.filter(id => id === (directive.kind === 'proposal' ? adapter.judgeNodeId : adapter.workerNodeId));
    if (selected.length !== 1) fail();
    await persistGoalRoute(ctx, node, selected);
    return selected;
  } catch {
    if (ctx.isStopped()) return [];
    return fail();
  }
}

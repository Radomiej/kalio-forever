import type { ArchitectureRun } from '@kalio/types';
import { types } from 'node:util';
import type { ArchitectureGoalRepository, ArchitectureGoalState } from './architecture-goal.repository';
import type { GoalCompletionReviewHostPort } from './architecture-goal-completion-review.service';
import type { ArchitectureGoalCompletionAuthorizationService } from './architecture-goal-completion-authorization.service';
import type { GoalRouteResumePort } from './architecture-runtime-resume.utils';
import type { GoalRouteResumeCandidate, GoalRouteTopology } from './architecture-goal-route-recovery';
import { recoverGoalRouteCandidate } from './architecture-goal-route-recovery';
import { cloneGoalCompletionJson, validateGoalCompletionState } from './architecture-goal-completion-state';
import { appendGoalSource } from './architecture-goal-source';
import { assertGoalProjectionHistory } from './architecture-goal-projection';
import { goalPhaseBinding } from './architecture-graph-goal-nodes';
import { inspectGoalCompletion } from './architecture-goal-completion';

type RunScope = Pick<ArchitectureRun, 'id' | 'rootSessionId' | 'schemaId'>;
export interface GoalRouteResumeHostPort {
  /** Required host authority: read complete durable run/root/schema-scoped records,
   * validate admission/readmission and reject missing/truncated records. Never
   * select a segment from caller events or infer readmission from goal-state ACK. */
  readAdmittedSegment(run: RunScope, signal: AbortSignal): Promise<{
    admissionCheckpointId: string;
    topology: GoalRouteTopology;
    events: Parameters<GoalRouteResumePort['resolve']>[0]['events'];
  }>;
  /** Resolve the actual required ACK, declared node and current source/successor
   * visits inside that admitted segment. A returned ID alone proves nothing. */
  verifyRequiredAnchorAndCurrentVisit(input: { run: RunScope; admissionCheckpointId: string;
    candidate: GoalRouteResumeCandidate; signal: AbortSignal }): Promise<{ checkpointId: string }>;
}
export type GoalRouteCompletionReplayPort = Pick<ArchitectureGoalCompletionAuthorizationService, 'verifyReplay'>;

function fail(): never { throw new Error('GOAL_ROUTE_RESUME_FAILED'); }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
/** Proxy traps are not JSON data. Inspect descriptors before the existing clone;
 * this adds no serialization/hash format and never clones object capabilities. */
function checkedClone<T>(value: T): T {
  const inspect = (item: unknown, ancestors: Set<object>): void => {
    if (!item || typeof item !== 'object') return;
    if (types.isProxy(item) || ancestors.has(item) || ancestors.size >= 100) return fail();
    ancestors.add(item);
    try {
      for (const key of Reflect.ownKeys(item)) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) return fail();
        inspect(descriptor.value, ancestors);
      }
    } finally { ancestors.delete(item); }
  };
  inspect(value, new Set());
  return cloneGoalCompletionJson(value);
}
/** Equality only; domain hashes remain owned by existing pure helpers. */
function equal(left: unknown, right: unknown): boolean {
  const encode = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
  return encode(left) === encode(right);
}
function projection(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || types.isProxy(raw) || Array.isArray(raw)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) return fail();
  for (const key of Reflect.ownKeys(raw)) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail();
  }
  return Object.fromEntries(keys.flatMap(key => {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    return descriptor?.value !== undefined ? [[key, checkedClone(descriptor.value)]] : [];
  }));
}
function exact(raw: object, keys: readonly string[]): boolean {
  return Reflect.ownKeys(raw).length === keys.length && keys.every(key => Object.hasOwn(raw, key));
}

/** No production registration/fallback. Injected host ports must be real durable
 * authorities. Fixture tests prove orchestration, not readmission/producer trust.
 * Parent still owns atomic stop/currentness checks when consuming the cursor and
 * the synchronous artifact publication barrier; this service never executes it. */
export class ArchitectureGoalRouteResumeService implements GoalRouteResumePort {
  constructor(private readonly repository: Pick<ArchitectureGoalRepository, 'load'>,
    private readonly host: GoalRouteResumeHostPort,
    private readonly completionHost: GoalCompletionReviewHostPort,
    private readonly completion: GoalRouteCompletionReplayPort) {}

  async resolve(input: Parameters<GoalRouteResumePort['resolve']>[0]): ReturnType<GoalRouteResumePort['resolve']> {
    try {
      // Caller events are advisory only. Only host-read durable records authorize.
      projection(input, []);
      const signal = Object.getOwnPropertyDescriptor(input, 'signal')?.value as unknown;
      if (!signal || typeof signal !== 'object' || types.isProxy(signal) || !(signal instanceof AbortSignal)) return fail();
      signal.throwIfAborted();
      if (!this.host || typeof this.host.readAdmittedSegment !== 'function'
        || typeof this.host.verifyRequiredAnchorAndCurrentVisit !== 'function') return fail();
      const initialRun = projection(input.run, ['id', 'rootSessionId', 'schemaId', 'executionMode', 'branchSessionIds', 'goalPacket']);
      const schema = checkedClone(input.schema);
      if (![initialRun.id, initialRun.rootSessionId, initialRun.schemaId].every(text)
        || initialRun.schemaId !== schema.id || initialRun.executionMode !== 'subagent_execution' || !initialRun.goalPacket) return fail();
      const scope: RunScope = { id: initialRun.id as string, rootSessionId: initialRun.rootSessionId as string, schemaId: initialRun.schemaId as string };
      const initial = this.read(scope);
      if (!equal(initial.packet, initialRun.goalPacket)) return fail();
      const current = (): void => {
        signal.throwIfAborted();
        projection(input, []);
        if (input.signal !== signal || !equal(projection(input.run, Object.keys(initialRun)), initialRun)
          || !equal(checkedClone(input.schema), schema) || !equal(this.read(scope), initial)) return fail();
      };
      const readSegment = async () => {
        const segment = checkedClone(await this.host.readAdmittedSegment(checkedClone(scope), signal));
        current();
        if (!segment || !exact(segment, ['admissionCheckpointId', 'topology', 'events'])
          || !text(segment.admissionCheckpointId) || !Array.isArray(segment.events)) return fail();
        return segment;
      };
      const segment = await readSegment();
      const recovered = recoverGoalRouteCandidate(schema, scope, segment.topology, segment.events);
      if (recovered.status !== 'candidate' || recovered.candidate.kind !== 'route') return fail();
      const candidate = recovered.candidate;
      if (!equal(candidate.goalBinding, goalPhaseBinding(initial))) return fail();
      const topology = segment.topology;
      for (const id of [topology.workerNodeId, topology.judgeNodeId]) {
        const node = schema.nodes.find(row => row.id === id);
        const branch = node?.roleSlotId && (initialRun.branchSessionIds as Record<string, unknown> | undefined)?.[node.roleSlotId];
        if (!node?.roleSlotId || !schema.roleSlots.some(slot => slot.id === node.roleSlotId) || !text(branch)) return fail();
      }
      const pending = candidate.cursorCandidate.pendingNodeIds[0];
      const accepted = initial.packet.projection.status === 'accepted';
      if (!accepted && (!candidate.goalBinding.proposalFingerprint || candidate.sourceNodeId !== topology.workerNodeId
        || pending !== topology.judgeNodeId)) return fail();
      if (accepted && candidate.goalBinding.proposalFingerprint) return fail();
      const requiresCompletion = !!candidate.completionBinding || accepted && candidate.sourceNodeId === topology.workerNodeId;
      const artifact = topology.completionNodeIds.includes(pending!);
      if (artifact && initial.completionAuthorization?.schemaVersion !== 2
        || !artifact && initial.completionAuthorization !== null) return fail();
      const anchor = checkedClone(await this.host.verifyRequiredAnchorAndCurrentVisit({ run: checkedClone(scope),
        admissionCheckpointId: segment.admissionCheckpointId, candidate: checkedClone(candidate), signal }));
      current();
      if (!anchor || !exact(anchor, ['checkpointId']) || !text(anchor.checkpointId)) return fail();
      let snapshot: Awaited<ReturnType<GoalCompletionReviewHostPort['readCurrent']>> | undefined;
      const readCompletion = async () => {
        if (!this.completionHost || typeof this.completionHost.readCurrent !== 'function') return fail();
        const value = checkedClone(await this.completionHost.readCurrent(scope.id, signal));
        current();
        const inventory = initial.evidenceInventory;
        if (!value || !exact(value, ['runId', 'rootSessionId', 'stateRevision', 'packet', 'host', 'criterionEvidenceIds', 'provenance'])
          || inventory?.schemaVersion !== 2 || value.runId !== scope.id || value.rootSessionId !== scope.rootSessionId
          || value.stateRevision !== initial.stateRevision || !equal(value.packet, initial.packet)
          || !equal(value.host, inventory.host) || !equal(value.provenance, inventory.provenance)) return fail();
        const inspected = inspectGoalCompletion(value.packet, value.criterionEvidenceIds, value.host,
          { runId: scope.id, rootSessionId: scope.rootSessionId!, provenance: value.provenance });
        if (candidate.completionBinding && !equal(inspected.binding, candidate.completionBinding)
          || candidate.criterionId && !inspected.activeCriterionIds.includes(candidate.criterionId)
          || artifact && !inspected.eligible) return fail();
        return value;
      };
      if (requiresCompletion) snapshot = await readCompletion();
      if (artifact) {
        if (!this.completion || typeof this.completion.verifyReplay !== 'function') return fail();
        const authorization = checkedClone(await this.completion.verifyReplay({ run: checkedClone(scope), expectedState: checkedClone(initial), signal }));
        current();
        if (!authorization || !exact(authorization, ['status', 'authorizedStateRevision', 'binding', 'checkpointId', 'replayed'])
          || authorization.status !== 'authorized' || authorization.replayed !== true
          || authorization.authorizedStateRevision !== initial.stateRevision
          || authorization.checkpointId !== `${scope.id}:goal-completion:${initial.stateRevision}`
          || !equal(authorization.binding, candidate.completionBinding)
          || !equal(authorization.binding, initial.completionAuthorization?.binding)
          || !equal(snapshot?.criterionEvidenceIds, initial.completionAuthorization?.criterionEvidenceIds)) return fail();
      }
      // Catch refs/provenance and admitted-segment drift even without revision changes.
      if (snapshot && !equal(await readCompletion(), snapshot)) return fail();
      if (!equal(await readSegment(), segment)) return fail();
      current();
      return checkedClone(candidate.cursorCandidate);
    } catch { return fail(); }
  }

  private read(scope: RunScope): ArchitectureGoalState {
    const loaded = this.repository.load(scope.id, scope.rootSessionId);
    if (!loaded) return fail();
    const state = checkedClone(loaded);
    if (state.runId !== scope.id || state.rootSessionId !== scope.rootSessionId
      || !Number.isSafeInteger(state.stateRevision) || state.stateRevision < 1) return fail();
    if (!equal(appendGoalSource(state.packet, state.packet.original), state.packet)) return fail();
    assertGoalProjectionHistory(state.packet);
    validateGoalCompletionState(state, state.evidenceInventory, state.completionAuthorization);
    return state;
  }
}

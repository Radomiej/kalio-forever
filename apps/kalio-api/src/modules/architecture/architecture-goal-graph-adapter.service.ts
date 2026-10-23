import type { ArchitectureRun } from '@kalio/types';
import type { GraphGoalProtocolAdapter, GoalPhaseBinding } from './architecture-graph-goal-nodes';
import type { ArchitectureGoalLifecycleService } from './architecture-goal-lifecycle.service';
import type { ArchitectureGoalRepository, ArchitectureGoalState } from './architecture-goal.repository';
import type { ArchitectureGoalAuditService } from './architecture-goal-audit.service';
import type { ArchitectureGoalProposalService } from './architecture-goal-proposal.service';
import type { ArchitectureGoalProjectionService, HostGoalPolicyFactory } from './architecture-goal-projection.service';
import { cloneGoalCompletionJson } from './architecture-goal-completion-state';
import { assertGoalProjectionHistory, prepareGoalProjection } from './architecture-goal-projection';
import { inspectGoalCompletion } from './architecture-goal-completion';
import type { ArchitectureGoalCompletionAuthorizationService } from './architecture-goal-completion-authorization.service';
import type { GoalCompletionReviewHostPort, GoalCompletionReviewSnapshot } from './architecture-goal-completion-review.service';
import { assertGoalArtifactAuthorization } from './architecture-graph-goal-completion';

export interface GoalGraphAdapterConfig {
  workerNodeId: string;
  judgeNodeId: string;
  completionNodeIds: readonly string[];
  /** Host-owned classifier; never provided by worker output. */
  hostPolicyFactory: HostGoalPolicyFactory;
}
type RunIdentity = Pick<ArchitectureRun, 'id' | 'rootSessionId' | 'schemaId'>;
function fail(): never { throw new Error('GOAL_GRAPH_ADAPTER_FAILED'); }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function fullState(state: unknown): string {
  return JSON.stringify(cloneGoalCompletionJson(state), (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    }
    return value;
  });
}

/** Concrete adapter factory only. Parent owns runtime/module wiring and pause storage. */
export class ArchitectureGoalGraphAdapterService {
  constructor(private readonly lifecycle: Pick<ArchitectureGoalLifecycleService, 'hydrate'>,
    private readonly repository: Pick<ArchitectureGoalRepository, 'load'>,
    private readonly audit: Pick<ArchitectureGoalAuditService, 'persistRequired'>,
    private readonly proposals: Pick<ArchitectureGoalProposalService, 'record'>,
    private readonly projections: Pick<ArchitectureGoalProjectionService, 'project'>,
    // TODO: legacy fallback — proposal/work construction predates completion ports;
    // completion never falls back when either dependency is absent.
    private readonly completion?: Pick<ArchitectureGoalCompletionAuthorizationService, 'authorize'>,
    private readonly completionHost?: GoalCompletionReviewHostPort) {}

  create(runPick: RunIdentity, config: GoalGraphAdapterConfig,
    persistPauseRequired: GraphGoalProtocolAdapter['persistPauseRequired']): GraphGoalProtocolAdapter {
    try {
      const rootSessionId = runPick.rootSessionId;
      if (!text(rootSessionId)) return fail();
      const identity = { id: runPick.id, rootSessionId, schemaId: runPick.schemaId };
      if (!Object.values(identity).every(text) || !config || !Array.isArray(config.completionNodeIds)
        || typeof config.hostPolicyFactory !== 'function' || typeof persistPauseRequired !== 'function') return fail();
      const ids = [config.workerNodeId, config.judgeNodeId, ...config.completionNodeIds];
      if (!ids.every(text) || new Set(ids).size !== ids.length) return fail();
      const workerNodeId = config.workerNodeId;
      const judgeNodeId = config.judgeNodeId;
      const completionNodeIds = Object.freeze([...config.completionNodeIds]);
      const hostPolicyFactory = config.hostPolicyFactory;
      const assertRun = (run: RunIdentity) => {
        if (!run || run.id !== identity.id || run.rootSessionId !== identity.rootSessionId || run.schemaId !== identity.schemaId) fail();
      };
      const checked = (value: ArchitectureGoalState | null): ArchitectureGoalState => {
        const state = cloneGoalCompletionJson(value);
        if (!state || state.runId !== identity.id || state.rootSessionId !== identity.rootSessionId
          || !Number.isSafeInteger(state.stateRevision) || state.stateRevision < 1) return fail();
        assertGoalProjectionHistory(state.packet);
        const projection = state.packet.projection;
        if (projection.status === 'pending' && projection.proposal) {
          const { proposalFingerprint, ...raw } = projection.proposal;
          if (prepareGoalProjection(state.packet, raw).proposalFingerprint !== proposalFingerprint) return fail();
        } else if (projection.status === 'accepted') {
          const superseded = new Set(projection.snapshot.criteria.flatMap(row => row.supersedes));
          const refs = Object.fromEntries(projection.snapshot.criteria.filter(row => !superseded.has(row.id)).map(row => [row.id, []]));
          inspectGoalCompletion(state.packet, refs, { evidenceById: {}, cliChildrenById: {} });
        }
        return state;
      };
      const currentPhase = (run: RunIdentity, binding: GoalPhaseBinding): ArchitectureGoalState => {
        assertRun(run);
        const state = checked(this.lifecycle.hydrate(identity.id, identity.rootSessionId, true));
        const loaded = checked(this.repository.load(identity.id, identity.rootSessionId));
        const proposalFingerprint = state.packet.projection.status === 'pending' ? state.packet.projection.proposal?.proposalFingerprint : undefined;
        if (fullState(loaded) !== fullState(state) || !binding || typeof binding !== 'object' || Array.isArray(binding)
          || (Object.getPrototypeOf(binding) !== Object.prototype && Object.getPrototypeOf(binding) !== null)
          || Reflect.ownKeys(binding).some(key => !Object.hasOwn(Object.getOwnPropertyDescriptor(binding, key) ?? {}, 'value'))
          || Reflect.ownKeys(binding).some(key => !['stateRevision', 'sourceVersion', 'sourceFingerprint', 'proposalFingerprint'].includes(String(key)))
          || !['stateRevision', 'sourceVersion', 'sourceFingerprint'].every(key => Object.hasOwn(binding, key))
          || binding.stateRevision !== state.stateRevision || binding.sourceVersion !== state.packet.version
          || binding.sourceFingerprint !== state.packet.sourceFingerprint
          || proposalFingerprint !== undefined && !Object.hasOwn(binding, 'proposalFingerprint')
          || binding.proposalFingerprint !== proposalFingerprint) return fail();
        return state;
      };
      const guarded = async <T>(signal: AbortSignal | undefined, action: () => Promise<T>): Promise<T> => {
        try { signal?.throwIfAborted(); return await action(); }
        catch { signal?.throwIfAborted(); return fail(); }
      };
      const completionSnapshot = async (state: ArchitectureGoalState, signal?: AbortSignal): Promise<GoalCompletionReviewSnapshot> => {
        if (!this.completionHost || typeof this.completionHost.readCurrent !== 'function') return fail();
        signal?.throwIfAborted();
        const snapshot = cloneGoalCompletionJson(await this.completionHost.readCurrent(identity.id, signal));
        signal?.throwIfAborted();
        const inventory = state.evidenceInventory;
        const keys = ['runId', 'rootSessionId', 'stateRevision', 'packet', 'host', 'criterionEvidenceIds', 'provenance'];
        if (!snapshot || Reflect.ownKeys(snapshot).length !== keys.length || !keys.every(key => Object.hasOwn(snapshot, key))
          || snapshot.runId !== identity.id || snapshot.rootSessionId !== identity.rootSessionId || snapshot.stateRevision !== state.stateRevision
          || inventory?.schemaVersion !== 2 || fullState(snapshot.packet) !== fullState(state.packet)
          || fullState(snapshot.host) !== fullState(inventory.host) || fullState(snapshot.provenance) !== fullState(inventory.provenance)
          || fullState(checked(this.repository.load(identity.id, identity.rootSessionId))) !== fullState(state)) return fail();
        inspectGoalCompletion(snapshot.packet, snapshot.criterionEvidenceIds, snapshot.host,
          { runId: identity.id, rootSessionId: identity.rootSessionId, provenance: snapshot.provenance });
        return snapshot;
      };
      const inspected = (snapshot: GoalCompletionReviewSnapshot) => inspectGoalCompletion(snapshot.packet, snapshot.criterionEvidenceIds, snapshot.host,
        { runId: identity.id, rootSessionId: identity.rootSessionId, provenance: snapshot.provenance });
      return Object.freeze({
        workerNodeId, judgeNodeId, completionNodeIds,
        beforeBatch: input => guarded(input.signal, async () => {
          assertRun(input.run);
          const initial = checked(this.lifecycle.hydrate(identity.id, identity.rootSessionId, true));
          const original = fullState(initial);
          input.signal?.throwIfAborted();
          await this.audit.persistRequired(identity, structuredClone(initial));
          input.signal?.throwIfAborted();
          assertRun(input.run);
          const state = checked(this.repository.load(identity.id, identity.rootSessionId));
          if (fullState(state) !== original) return fail();
          const projection = state.packet.projection;
          if (projection.status === 'pending') return { kind: projection.proposal ? 'projection_judge' : 'proposal', state };
          if (!input.readyNodeIds.includes(workerNodeId) && input.readyNodeIds.some(id => completionNodeIds.includes(id))) {
            if (!this.completion || typeof this.completion.authorize !== 'function') return fail();
            const snapshot = await completionSnapshot(state, input.signal);
            if (!state.completionAuthorization) return fail();
            const authorization = cloneGoalCompletionJson(await this.completion.authorize(identity, state.packet.version, input.signal));
            input.signal?.throwIfAborted();
            if (authorization.status !== 'authorized') return fail();
            const latest = checked(this.repository.load(identity.id, identity.rootSessionId));
            const current = await completionSnapshot(latest, input.signal);
            if (fullState(snapshot) !== fullState(current)) return fail();
            assertGoalArtifactAuthorization(latest, authorization);
            return { kind: 'artifact', state: latest, authorization, executableNodeIds: completionNodeIds };
          }
          if (!input.readyNodeIds.includes(workerNodeId) && input.readyNodeIds.includes(judgeNodeId)) return { kind: 'completion_judge', state };
          return { kind: 'work', state, executableNodeIds: [workerNodeId] };
        }),
        recordProposal: input => guarded(input.signal, async () => {
          const state = currentPhase(input.run, input.binding);
          if (state.packet.projection.status !== 'pending' || state.packet.projection.proposal) return fail();
          prepareGoalProjection(state.packet, input.output);
          input.signal?.throwIfAborted();
          const saved = await this.proposals.record(identity, input.output, state.stateRevision, input.signal);
          input.signal?.throwIfAborted(); assertRun(input.run);
          return checked(saved);
        }),
        judgeProjection: input => guarded(input.signal, async () => {
          const state = currentPhase(input.run, input.binding);
          if (state.packet.projection.status !== 'pending' || !state.packet.projection.proposal) return fail();
          const { proposalFingerprint, ...raw } = state.packet.projection.proposal;
          void proposalFingerprint;
          input.signal?.throwIfAborted();
          const result = await this.projections.project(structuredClone(input.run), raw, state.stateRevision, hostPolicyFactory, input.signal);
          input.signal?.throwIfAborted(); assertRun(input.run);
          return { ...result, state: checked(result.state) };
        }),
        judgeCompletion: input => guarded(input.signal, async () => {
          const initial = currentPhase(input.run, input.binding);
          if (initial.packet.projection.status !== 'accepted' || !this.completion || typeof this.completion.authorize !== 'function') return fail();
          const snapshot = await completionSnapshot(initial, input.signal);
          const selection = cloneGoalCompletionJson(await this.completion.authorize(identity, initial.packet.version, input.signal));
          input.signal?.throwIfAborted(); assertRun(input.run);
          const state = checked(this.repository.load(identity.id, identity.rootSessionId));
          const current = await completionSnapshot(state, input.signal);
          if (selection.status === 'authorized') {
            if (fullState(snapshot.packet) !== fullState(current.packet) || fullState(snapshot.host) !== fullState(current.host)
              || fullState(snapshot.provenance) !== fullState(current.provenance)
              || fullState(snapshot.criterionEvidenceIds) !== fullState(current.criterionEvidenceIds)) return fail();
            assertGoalArtifactAuthorization(state, selection);
            if (fullState(selection.binding) !== fullState(inspected(current).binding)) return fail();
          } else {
            if (fullState(state) !== fullState(initial) || fullState(snapshot) !== fullState(current)) return fail();
            if (selection.status === 'continue' && (selection.reviewedStateRevision !== state.stateRevision
              || fullState(selection.binding) !== fullState(inspected(current).binding)
              || !inspected(current).activeCriterionIds.includes(selection.criterionId))) return fail();
            if (selection.status !== 'continue' && selection.status !== 'needs_user') return fail();
          }
          return { state, selection };
        }),
        persistRouteRequired: (event, checkpointId, signal) => guarded(signal, async () => {
          if (event.runId !== identity.id || !event.data) return fail();
          const phase = event.data['goalBinding'];
          if (!phase || typeof phase !== 'object') return fail();
          const state = currentPhase(identity, phase as GoalPhaseBinding);
          const snapshot = event.data['completionBinding'] ? await completionSnapshot(state, signal) : undefined;
          if (snapshot && fullState(event.data['completionBinding']) !== fullState(inspected(snapshot).binding)) return fail();
          signal?.throwIfAborted();
          await persistPauseRequired(structuredClone(event), checkpointId);
          signal?.throwIfAborted();
          if (fullState(checked(this.repository.load(identity.id, identity.rootSessionId))) !== fullState(state)) return fail();
          if (snapshot && fullState(await completionSnapshot(state, signal)) !== fullState(snapshot)) return fail();
        }),
        persistPauseRequired: async (event, checkpointId) => {
          try { await persistPauseRequired(structuredClone(event), checkpointId); } catch { return fail(); }
        },
      } satisfies GraphGoalProtocolAdapter);
    } catch { return fail(); }
  }
}

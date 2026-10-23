import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureRun } from '@kalio/types';
import type { ArchitectureGoalState } from './architecture-goal.repository';
import { createGoalPacket, appendGoalSource } from './architecture-goal-source';
import { prepareGoalProjection, acceptGoalProjection, goalProjectionPolicyTargets } from './architecture-goal-projection';
import { ArchitectureGoalGraphAdapterService } from './architecture-goal-graph-adapter.service';

const run: ArchitectureRun = { id: 'run', rootSessionId: 'internal-root', schemaId: 'schema', prompt: 'ignored', executionMode: 'subagent_execution', status: 'running', createdAt: 1, updatedAt: 1 };
const raw = { sourceVersion: 1, criteria: [{ text: 'Build', sourceQuotes: [{ messageId: 'm1', quote: 'Build' }], supersedes: [] }] };
const policy = (rows: readonly { id: string }[]) => ({ requiredEvidenceKindsByCriterion: Object.fromEntries(rows.map(row => [row.id, ['BUILD_RESULT' as const]])) });
function harness() {
  let state: ArchitectureGoalState = { runId: run.id, rootSessionId: 'internal-root', stateRevision: 1, createdAt: 1, updatedAt: 1,
    packet: createGoalPacket({ messageId: 'm1', sessionId: 'host', turnId: 't1', content: 'Build', createdAt: 1 }), evidenceInventory: null, completionAuthorization: null };
  const hydrate = vi.fn(() => structuredClone(state)); const load = vi.fn(() => structuredClone(state));
  const persistRequired = vi.fn(async (): Promise<void> => undefined);
  const record = vi.fn(async () => structuredClone(state));
  const project = vi.fn(async () => ({ status: 'rejected' as const, state: structuredClone(state) }));
  const pause = vi.fn(async () => undefined);
  const factory = new ArchitectureGoalGraphAdapterService({ hydrate }, { load }, { persistRequired }, { record }, { project });
  const adapter = factory.create(run, { workerNodeId: 'worker', judgeNodeId: 'judge', completionNodeIds: ['done'], hostPolicyFactory: policy }, pause);
  const binding = () => ({ stateRevision: state.stateRevision, sourceVersion: state.packet.version, sourceFingerprint: state.packet.sourceFingerprint,
    proposalFingerprint: state.packet.projection.status === 'pending' ? state.packet.projection.proposal?.proposalFingerprint : undefined });
  return { adapter, hydrate, load, persistRequired, record, project, pause, binding, get state() { return state; }, set state(next: ArchitectureGoalState) { state = next; } };
}
describe('goal graph adapter focused ports (no live review proof)', () => {
  it('waits for required ACK before reloading and returning proposal directive', async () => {
    const h = harness(); let release!: () => void; h.persistRequired.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    let settled = false;
    const pending = h.adapter.beforeBatch({ run, readyNodeIds: ['worker'] }).then(result => { settled = true; return result; });
    await Promise.resolve(); expect(settled).toBe(false); expect(h.load).not.toHaveBeenCalled(); release();
    expect(await pending).toMatchObject({ kind: 'proposal' }); expect(h.load).toHaveBeenCalledOnce();
  });
  it('returns judge for attached proposal and only worker for accepted work, never completion', async () => {
    const h = harness(); const prepared = prepareGoalProjection(h.state.packet, raw);
    h.state.packet.projection = { status: 'pending', base: null, proposal: prepared };
    expect(await h.adapter.beforeBatch({ run, readyNodeIds: ['judge'] })).toHaveProperty('kind', 'projection_judge');
    const targets = goalProjectionPolicyTargets(h.state.packet, prepared);
    h.state.packet = acceptGoalProjection(h.state.packet, prepared, policy(targets), { sourceVersion: 1, sourceFingerprint: h.state.packet.sourceFingerprint, proposalFingerprint: prepared.proposalFingerprint, accepted: true });
    expect(await h.adapter.beforeBatch({ run, readyNodeIds: ['worker', 'done', 'judge'] })).toMatchObject({ kind: 'work', executableNodeIds: ['worker'] });
  });
  it.each(['revision', 'source', 'metadata'])('rejects full-state change across ACK %s', async change => {
    const h = harness(); h.persistRequired.mockImplementation(async () => {
      if (change === 'revision') h.state.stateRevision++;
      if (change === 'source') h.state.packet = appendGoalSource(h.state.packet, { messageId: 'm2', sessionId: 'host', turnId: 't2', content: 'Retry', createdAt: 2 });
      if (change === 'metadata') h.state.updatedAt++;
    });
    await expect(h.adapter.beforeBatch({ run, readyNodeIds: ['worker'] })).rejects.toThrow(/^GOAL_GRAPH_ADAPTER_FAILED$/);
  });
  it.each(['root', 'run', 'revision', 'source', 'proposal', 'extra'])('rejects stale or invalid phase binding %s before record', async part => {
    const h = harness(); const inputRun = structuredClone(run); const bound = h.binding();
    if (part === 'root') inputRun.rootSessionId = 'foreign';
    if (part === 'run') inputRun.id = 'foreign';
    if (part === 'revision') bound.stateRevision++;
    if (part === 'source') bound.sourceFingerprint = 'stale';
    if (part === 'proposal') bound.proposalFingerprint = 'foreign';
    if (part === 'extra') Reflect.set(bound, 'workerPolicy', true);
    await expect(h.adapter.recordProposal({ run: inputRun, binding: bound, output: raw })).rejects.toThrow(); expect(h.record).not.toHaveBeenCalled();
  });
  it('delegates exact current record revision to CAS/ACK service', async () => {
    const h = harness(); await h.adapter.recordProposal({ run, binding: h.binding(), output: raw });
    expect(h.record).toHaveBeenCalledWith({ id: 'run', rootSessionId: 'internal-root', schemaId: 'schema' }, raw, 1, undefined);
    expect(h.persistRequired).not.toHaveBeenCalled();
  });
  it('strips only host proposal fingerprint before judge and supplies host policy factory', async () => {
    const h = harness(); const prepared = prepareGoalProjection(h.state.packet, raw); h.state.packet.projection = { status: 'pending', base: null, proposal: prepared };
    await h.adapter.judgeProjection({ run, binding: h.binding() });
    expect(h.project).toHaveBeenCalledWith(run, { sourceVersion: 1, criteria: prepared.criteria }, 1, policy, undefined);
  });
  it('rejects replaced proposal binding before judge write', async () => {
    const h = harness(); const prepared = prepareGoalProjection(h.state.packet, raw); h.state.packet.projection = { status: 'pending', base: null, proposal: prepared };
    const stale = h.binding(); h.state.packet.projection.proposal = prepareGoalProjection(h.state.packet, { ...raw, criteria: [{ ...raw.criteria[0], text: 'Changed' }] });
    await expect(h.adapter.judgeProjection({ run, binding: stale })).rejects.toThrow(); expect(h.project).not.toHaveBeenCalled();
  });
  it('propagates stop after ACK and before record/judge writes', async () => {
    const h = harness(); const controller = new AbortController(); h.persistRequired.mockImplementation(async () => { controller.abort(); });
    await expect(h.adapter.beforeBatch({ run, readyNodeIds: ['worker'], signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(h.adapter.recordProposal({ run, binding: h.binding(), output: raw, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(h.adapter.judgeProjection({ run, binding: h.binding(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.record).not.toHaveBeenCalled(); expect(h.project).not.toHaveBeenCalled();
  });
  it('does not expose failed ACK raw errors or issue a directive', async () => {
    const h = harness(); h.persistRequired.mockRejectedValue(new Error('SECRET'));
    await expect(h.adapter.beforeBatch({ run, readyNodeIds: [] })).rejects.toThrow(/^GOAL_GRAPH_ADAPTER_FAILED$/); expect(h.load).not.toHaveBeenCalled();
  });
  it('rejects source changes without revision changes before either phase write', async () => {
    const h = harness(); const stale = h.binding();
    h.state.packet = appendGoalSource(h.state.packet, { messageId: 'm2', sessionId: 'host', turnId: 't2', content: 'Retry', createdAt: 2 });
    await expect(h.adapter.recordProposal({ run, binding: stale, output: raw })).rejects.toThrow(); expect(h.record).not.toHaveBeenCalled();
    await expect(h.adapter.judgeProjection({ run, binding: stale })).rejects.toThrow(); expect(h.project).not.toHaveBeenCalled();
  });
  it('rejects full-state hydrate/load disagreement before writes', async () => {
    const h = harness(); h.load.mockImplementation(() => ({ ...structuredClone(h.state), updatedAt: 99 }));
    await expect(h.adapter.recordProposal({ run, binding: h.binding(), output: raw })).rejects.toThrow(); expect(h.record).not.toHaveBeenCalled();
  });
  it('cannot judge an inherited fingerprint or record over an attached proposal', async () => {
    const h = harness(); const prepared = prepareGoalProjection(h.state.packet, raw); h.state.packet.projection = { status: 'pending', base: null, proposal: prepared };
    const binding = h.binding(); const inherited = Object.assign(Object.create({ proposalFingerprint: prepared.proposalFingerprint }), binding);
    Reflect.deleteProperty(inherited, 'proposalFingerprint');
    await expect(h.adapter.judgeProjection({ run, binding: inherited })).rejects.toThrow(); expect(h.project).not.toHaveBeenCalled();
    await expect(h.adapter.recordProposal({ run, binding, output: raw })).rejects.toThrow(); expect(h.record).not.toHaveBeenCalled();
  });
  it('does not cache state across batches and keeps source host distinct from internal root', async () => {
    const h = harness(); const first = await h.adapter.beforeBatch({ run, readyNodeIds: ['worker'] });
    first.state.packet.original.content = 'Caller mutation';
    h.state.stateRevision++;
    const second = await h.adapter.beforeBatch({ run, readyNodeIds: ['worker'] });
    expect(second.state.stateRevision).toBe(2); expect(second.state.packet.original.sessionId).toBe('host');
    expect(second.state.rootSessionId).toBe('internal-root'); expect(second.state.packet.original.content).toBe('Build');
  });
});

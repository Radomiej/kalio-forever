import { describe, expect, it } from 'vitest';
import { createGoalPacket } from './architecture-goal-source';
import { acceptGoalProjection, goalProjectionPolicyTargets, prepareGoalProjection } from './architecture-goal-projection';
import { prepareGoalCompletion } from './architecture-goal-completion';
import { validateGoalCompletionState, type GoalCompletionReceiptV1, type GoalEvidenceInventoryV1 } from './architecture-goal-completion-state';

function fixture() {
  const pending = createGoalPacket({ messageId: 'user', sessionId: 'host', turnId: 'turn', content: 'Build site', createdAt: 1 });
  const proposal = prepareGoalProjection(pending, { sourceVersion: 1, criteria: [{ text: 'Build site', sourceQuotes: [{ messageId: 'user', quote: 'Build site' }], supersedes: [] }] });
  pending.projection = { status: 'pending', base: null, proposal };
  const targets = goalProjectionPolicyTargets(pending, proposal);
  const packet = acceptGoalProjection(pending, proposal, { requiredEvidenceKindsByCriterion: { [targets[0].id]: ['BUILD_RESULT'] } },
    { sourceVersion: 1, sourceFingerprint: pending.sourceFingerprint, proposalFingerprint: proposal.proposalFingerprint, accepted: true });
  const context = { runId: 'run', rootSessionId: 'root', stateRevision: 3, packet };
  const inventory: GoalEvidenceInventoryV1 = { schemaVersion: 1, runId: 'run', rootSessionId: 'root', goalVersion: 1,
    sourceFingerprint: packet.sourceFingerprint, inventoryStateRevision: 2,
    host: { evidenceById: { build: { kind: 'BUILD_RESULT', status: 'passed', data: { exitCode: 0 } } }, cliChildrenById: { child: 'passed' } },
    evidenceRefsById: { build: { checkpointId: 'checkpoint', eventId: 'event', sequence: 1, evidenceIndex: 0 } },
    childRefsById: { child: { childId: 'child', sessionId: 'branch', lifecycleCheckpointId: 'child-checkpoint' } }, supersededEvidenceIds: {} };
  const candidate = prepareGoalCompletion(packet, { [targets[0].id]: ['build'] }, inventory.host);
  const receipt: GoalCompletionReceiptV1 = { schemaVersion: 1, runId: 'run', rootSessionId: 'root', goalVersion: 1,
    sourceFingerprint: packet.sourceFingerprint, reviewedStateRevision: 2, authorizedStateRevision: 3, inventoryStateRevision: 2,
    choice: 'complete', confidence: .95, ...candidate };
  return { context, inventory, receipt };
}

function v2Fixture() {
  const { context, inventory: legacy, receipt: oldReceipt } = fixture();
  if (context.packet.projection.status !== 'accepted') throw new Error('fixture');
  const provenance = { schemaVersion: 2 as const, runId: 'run', rootSessionId: 'root', goalVersion: 1,
    sourceFingerprint: context.packet.sourceFingerprint, goalFingerprint: context.packet.projection.snapshot.goalFingerprint,
    checkpoint: { checkpointId: 'seal', status: 'sealed' as const,
      admissions: [{ callId: 'call', sessionId: 'branch', turnId: 'bt', promptMessageId: 'bp', sequence: 1, admissionCheckpointId: 'admit' }],
      commits: [{ callId: 'call', sequence: 1, commitCheckpointId: 'checkpoint', resultMessageId: 'result', status: 'success' as const }],
      completedRunJournalRef: { checkpointId: 'journal', eventId: 'completed', sequence: 2 } },
    evidenceRefsById: { build: { ...legacy.evidenceRefsById.build!, dispatchCallId: 'call' } },
    childRefsById: { child: { ...legacy.childRefsById.child!, launchToolCallId: 'call', terminalToolCallId: 'call', terminalMessageId: 'terminal' } },
    supersededEvidenceIds: {}, buildExpectation: { approvedSource: { messageId: 'user', sessionId: 'host', turnId: 'turn' }, executable: 'npm', args: ['run', 'build'], canonicalCwd: 'E:\\project' } };
  const inventory = { schemaVersion: 2 as const, runId: legacy.runId, rootSessionId: legacy.rootSessionId, goalVersion: legacy.goalVersion,
    sourceFingerprint: legacy.sourceFingerprint, inventoryStateRevision: 2, host: legacy.host, provenance };
  const candidate = prepareGoalCompletion(context.packet, oldReceipt.criterionEvidenceIds, inventory.host,
    { runId: context.runId, rootSessionId: context.rootSessionId, provenance });
  const receipt = { ...oldReceipt, schemaVersion: 2 as const, ...candidate };
  return { context, inventory, receipt, legacy, oldReceipt };
}

describe('V2 completion storage', () => {
  it('round-trips sealed provenance using the same pure binding', () => {
    const { context, inventory, receipt } = v2Fixture();
    expect(validateGoalCompletionState(context, inventory, receipt)).toEqual({ evidenceInventory: inventory, completionAuthorization: receipt });
  });
  it.each(['inventory', 'receipt'])('rejects mixed version %s downgrade', mode => {
    const { context, inventory, receipt, legacy, oldReceipt } = v2Fixture();
    expect(() => validateGoalCompletionState(context, mode === 'inventory' ? legacy : inventory, mode === 'receipt' ? oldReceipt : receipt)).toThrow('GOAL_STATE_CORRUPT');
  });
  it.each(['missing', 'root', 'hash', 'build', 'refs', 'revision', 'extra'])('rejects altered V2 %s', mode => {
    const { context, inventory, receipt, oldReceipt } = v2Fixture();
    if (mode === 'missing') Reflect.deleteProperty(inventory, 'provenance');
    if (mode === 'root') inventory.provenance.rootSessionId = 'foreign';
    if (mode === 'hash') receipt.binding = oldReceipt.binding;
    if (mode === 'build') inventory.provenance.buildExpectation.canonicalCwd = 'E:\\other';
    if (mode === 'refs') inventory.provenance.evidenceRefsById.build.eventId = 'changed';
    if (mode === 'revision') inventory.inventoryStateRevision = 3;
    if (mode === 'extra') Reflect.set(inventory, 'evidenceRefsById', {});
    expect(() => validateGoalCompletionState(context, inventory, receipt)).toThrow('GOAL_STATE_CORRUPT');
  });
  it.each(['open', 'aborted'] as const)('loads %s without receipt but rejects completion', status => {
    const { context, inventory, receipt } = v2Fixture();
    Reflect.set(inventory.provenance.checkpoint, 'status', status);
    Reflect.set(inventory.provenance.checkpoint, 'completedRunJournalRef', null);
    expect(validateGoalCompletionState({ ...context, stateRevision: 2 }, inventory, null).evidenceInventory?.schemaVersion).toBe(2);
    expect(() => validateGoalCompletionState(context, inventory, receipt)).toThrow('GOAL_STATE_CORRUPT');
  });
});

describe('goal completion stored envelopes (consistency, not producer/Jev proof)', () => {
  it('permits explicit null state and clones accepted envelopes', () => {
    const { context, inventory, receipt } = fixture();
    expect(validateGoalCompletionState(context, null, null)).toEqual({ evidenceInventory: null, completionAuthorization: null });
    const state = validateGoalCompletionState(context, inventory, receipt);
    expect(state).toEqual({ evidenceInventory: inventory, completionAuthorization: receipt });
    expect(state.evidenceInventory).not.toBe(inventory);
  });
  it('permits structurally valid incomplete inventory without a receipt', () => {
    const { context, inventory } = fixture();
    inventory.host.evidenceById.build.status = 'failed';
    expect(validateGoalCompletionState({ ...context, stateRevision: 2 }, inventory, null).evidenceInventory?.host.evidenceById.build.status).toBe('failed');
  });
  it.each(['run', 'root', 'version', 'source', 'index', 'child', 'refs', 'cycle', 'unknown-field'])('rejects corrupt inventory: %s', (kind) => {
    const { context, inventory, receipt } = fixture();
    if (kind === 'run') Reflect.set(inventory, 'runId', 'foreign');
    if (kind === 'root') Reflect.set(inventory, 'rootSessionId', 'foreign');
    if (kind === 'version') Reflect.set(inventory, 'goalVersion', 2);
    if (kind === 'source') Reflect.set(inventory, 'sourceFingerprint', 'wrong');
    if (kind === 'index') Reflect.set(inventory.evidenceRefsById.build, 'evidenceIndex', -1);
    if (kind === 'child') Reflect.set(inventory.childRefsById.child, 'childId', 'foreign');
    if (kind === 'refs') Reflect.deleteProperty(inventory.evidenceRefsById, 'build');
    if (kind === 'cycle') Reflect.set(inventory.supersededEvidenceIds, 'old', 'old');
    if (kind === 'unknown-field') Reflect.set(inventory, 'prompt', 'PRIVATE');
    expect(() => validateGoalCompletionState(context, inventory, receipt)).toThrow('GOAL_STATE_CORRUPT');
  });
  it.each(['orphan', 'revision', 'future-inventory', 'binding', 'confidence', 'choice', 'failed', 'refs'])('rejects invalid authorization: %s', (kind) => {
    const { context, inventory, receipt } = fixture();
    if (kind === 'revision') Reflect.set(receipt, 'authorizedStateRevision', 4);
    if (kind === 'future-inventory') Reflect.set(receipt, 'inventoryStateRevision', 3);
    if (kind === 'binding') receipt.binding.evidenceFingerprint = 'forged';
    if (kind === 'confidence') Reflect.set(receipt, 'confidence', NaN);
    if (kind === 'choice') Reflect.set(receipt, 'choice', 'continue:criterion');
    if (kind === 'failed') inventory.host.evidenceById.build.status = 'failed';
    if (kind === 'refs') Reflect.set(receipt, 'criterionEvidenceIds', {});
    expect(() => validateGoalCompletionState(context, kind === 'orphan' ? null : inventory, receipt)).toThrow('GOAL_STATE_CORRUPT');
  });
  it('rejects getters and undefined without silently omitting them or exposing content', () => {
    const { context, inventory } = fixture();
    const malformed = { ...inventory, get extra(): string { throw new Error('PRIVATE'); } };
    expect(() => validateGoalCompletionState(context, malformed, null)).toThrow('GOAL_STATE_CORRUPT');
    expect(() => validateGoalCompletionState(context, undefined, null)).toThrow('GOAL_STATE_CORRUPT');
  });
  it('retains explicit old evidence provenance but selects only the active replacement', () => {
    const { context, inventory, receipt } = fixture();
    Reflect.set(inventory.supersededEvidenceIds, 'old-build', 'build');
    Reflect.set(inventory.evidenceRefsById, 'old-build', { checkpointId: 'old-checkpoint', eventId: 'old-event', sequence: 1, evidenceIndex: 0 });
    Reflect.set(inventory.evidenceRefsById.build, 'sequence', 2);
    const loaded = validateGoalCompletionState(context, inventory, receipt).evidenceInventory;
    expect(loaded?.schemaVersion === 1 ? loaded.supersededEvidenceIds : null).toEqual({ 'old-build': 'build' });
  });
  it('rejects a cycle even when all provenance references exist', () => {
    const { context, inventory } = fixture();
    Reflect.set(inventory.supersededEvidenceIds, 'old-a', 'old-b'); Reflect.set(inventory.supersededEvidenceIds, 'old-b', 'old-a');
    Reflect.set(inventory.evidenceRefsById, 'old-a', { checkpointId: 'a', eventId: 'a', sequence: 2, evidenceIndex: 0 });
    Reflect.set(inventory.evidenceRefsById, 'old-b', { checkpointId: 'b', eventId: 'b', sequence: 3, evidenceIndex: 0 });
    expect(() => validateGoalCompletionState({ ...context, stateRevision: 2 }, inventory, null)).toThrow('GOAL_STATE_CORRUPT');
  });
});

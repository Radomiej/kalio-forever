import { describe, expect, it } from 'vitest';
import { createGoalPacket } from './architecture-goal-source';
import { prepareGoalProjection, goalProjectionPolicyTargets, acceptGoalProjection } from './architecture-goal-projection';
import { validateGoalCompletionProvenance } from './architecture-goal-provenance';

function fixture() {
  const pending = createGoalPacket({ messageId: 'm', sessionId: 'host', turnId: 't', content: 'Build project.', createdAt: 1 });
  const proposal = prepareGoalProjection(pending, { sourceVersion: 1, criteria: [{ text: 'Build', sourceQuotes: [{ messageId: 'm', quote: 'Build project.' }], supersedes: [] }] });
  pending.projection = { status: 'pending', base: null, proposal };
  const id = goalProjectionPolicyTargets(pending, proposal)[0]!.id;
  const packet = acceptGoalProjection(pending, proposal, { requiredEvidenceKindsByCriterion: { [id]: ['BUILD_RESULT'] } }, { sourceVersion: 1, sourceFingerprint: pending.sourceFingerprint, proposalFingerprint: proposal.proposalFingerprint, accepted: true });
  if (packet.projection.status !== 'accepted') throw new Error('fixture');
  const host = { evidenceById: { build: { kind: 'BUILD_RESULT' as const, status: 'passed' as const } }, cliChildrenById: { child: 'passed' as const } };
  const raw = {
    schemaVersion: 2, runId: 'run', rootSessionId: 'root', goalVersion: packet.version,
    sourceFingerprint: packet.sourceFingerprint, goalFingerprint: packet.projection.snapshot.goalFingerprint,
    checkpoint: { checkpointId: 'cp', status: 'sealed',
      admissions: [{ callId: 'call', sessionId: 'worker', turnId: 'turn', promptMessageId: 'prompt', sequence: 1, admissionCheckpointId: 'admit' }],
      commits: [{ callId: 'call', sequence: 1, commitCheckpointId: 'commit', resultMessageId: 'result', status: 'success' }],
      completedRunJournalRef: { checkpointId: 'journal', eventId: 'done', sequence: 2 } },
    evidenceRefsById: { build: { checkpointId: 'commit', eventId: 'event', sequence: 1, evidenceIndex: 0, dispatchCallId: 'call' } },
    childRefsById: { child: { childId: 'child', sessionId: 'child-session', lifecycleCheckpointId: 'life', launchToolCallId: 'call', terminalToolCallId: 'call', terminalMessageId: 'terminal' } },
    supersededEvidenceIds: {} as Record<string, string>,
    buildExpectation: { approvedSource: { messageId: 'm', sessionId: 'host', turnId: 't' }, executable: 'npm', args: ['run', 'build'], canonicalCwd: 'E:\\Projects\\generic' },
  };
  return { context: { runId: 'run', rootSessionId: 'root', packet, host }, raw };
}

describe('V2 provenance structural boundary', () => {
  it('clones a complete seal without asserting trust or eligibility', () => {
    const { context, raw } = fixture(); const parsed = validateGoalCompletionProvenance(context, raw);
    expect(parsed).toEqual(raw); expect(parsed).not.toBe(raw);
    expect(parsed).not.toHaveProperty('eligible'); expect(parsed).not.toHaveProperty('trusted');
    raw.checkpoint.commits[0]!.resultMessageId = 'changed';
    expect(parsed.checkpoint.commits[0]!.resultMessageId).toBe('result');
  });
  it.each(['open', 'aborted'] as const)('allows incomplete %s but no completed journal', status => {
    const { context, raw } = fixture(); Reflect.set(raw.checkpoint, 'status', status);
    raw.checkpoint.commits = []; raw.evidenceRefsById = {} as typeof raw.evidenceRefsById;
    raw.childRefsById = {} as typeof raw.childRefsById;
    Reflect.set(raw.checkpoint, 'completedRunJournalRef', null);
    context.host.evidenceById = {} as typeof context.host.evidenceById;
    context.host.cliChildrenById = {} as typeof context.host.cliChildrenById;
    expect(validateGoalCompletionProvenance(context, raw).checkpoint.status).toBe(status);
  });
  it.each(['runId', 'rootSessionId', 'sourceFingerprint', 'goalFingerprint', 'goalVersion', 'schemaVersion'])('rejects foreign %s', key => {
    const { context, raw } = fixture(); Reflect.set(raw, key, key.endsWith('Version') ? 99 : 'foreign');
    expect(() => validateGoalCompletionProvenance(context, raw)).toThrow('GOAL_PROVENANCE_INVALID');
  });
  it.each(['missing-commit', 'foreign-commit', 'gap', 'duplicate', 'no-journal', 'extra-field', 'wrong-ref', 'wrong-child', 'wrong-source', 'empty-cwd', 'cycle'])('rejects %s', mode => {
    const { context, raw } = fixture();
    if (mode === 'missing-commit') raw.checkpoint.commits = [];
    if (mode === 'foreign-commit') raw.checkpoint.commits[0]!.callId = 'foreign';
    if (mode === 'gap') raw.checkpoint.admissions[0]!.sequence = 2;
    if (mode === 'duplicate') raw.checkpoint.admissions.push({ ...raw.checkpoint.admissions[0]! });
    if (mode === 'no-journal') Reflect.set(raw.checkpoint, 'completedRunJournalRef', null);
    if (mode === 'extra-field') Reflect.set(raw, 'trusted', true);
    if (mode === 'wrong-ref') raw.evidenceRefsById.build.dispatchCallId = 'foreign';
    if (mode === 'wrong-child') raw.childRefsById.child.terminalToolCallId = 'foreign';
    if (mode === 'wrong-source') raw.buildExpectation.approvedSource.sessionId = 'root';
    if (mode === 'empty-cwd') raw.buildExpectation.canonicalCwd = '';
    if (mode === 'cycle') raw.supersededEvidenceIds = { old: 'old' };
    expect(() => validateGoalCompletionProvenance(context, raw)).toThrow('GOAL_PROVENANCE_INVALID');
  });
  it('rejects accessors before invoking them', () => {
    const { context, raw } = fixture(); let reads = 0;
    Object.defineProperty(raw.checkpoint, 'status', { enumerable: true, get() { reads++; return 'sealed'; } });
    expect(() => validateGoalCompletionProvenance(context, raw)).toThrow('GOAL_PROVENANCE_INVALID');
    expect(reads).toBe(0);
  });
  it.each(['missing-build-policy', 'reused-journal-checkpoint'])('rejects %s', mode => {
    const { context, raw } = fixture();
    if (mode === 'missing-build-policy') Reflect.set(raw, 'buildExpectation', null);
    else raw.checkpoint.completedRunJournalRef.checkpointId = 'commit';
    expect(() => validateGoalCompletionProvenance(context, raw)).toThrow('GOAL_PROVENANCE_INVALID');
  });
  it.each(['undefined', 'nan', 'symbol', 'hidden', 'hole', 'cycle', 'class', 'toJSON'])('rejects non-JSON %s without coercion', mode => {
    const { context, raw } = fixture(); let reads = 0;
    if (mode === 'undefined') Reflect.set(raw, 'buildExpectation', undefined);
    if (mode === 'nan') raw.goalVersion = NaN;
    if (mode === 'symbol') Reflect.set(raw, Symbol('hidden'), 1);
    if (mode === 'hidden') Object.defineProperty(raw, 'hidden', { value: 1 });
    if (mode === 'hole') delete raw.checkpoint.admissions[0];
    if (mode === 'cycle') Reflect.set(raw, 'cycle', raw);
    if (mode === 'class') Reflect.set(raw, 'buildExpectation', new Date());
    if (mode === 'toJSON') Reflect.set(raw, 'toJSON', () => { reads++; return {}; });
    expect(() => validateGoalCompletionProvenance(context, raw)).toThrow('GOAL_PROVENANCE_INVALID'); expect(reads).toBe(0);
  });
  it('allows commits to arrive out of admission order, while retaining exact sequences', () => {
    const { context, raw } = fixture();
    raw.checkpoint.admissions.push({ ...raw.checkpoint.admissions[0]!, callId: 'second', sequence: 2, admissionCheckpointId: 'admit2' });
    raw.checkpoint.commits.unshift({ ...raw.checkpoint.commits[0]!, callId: 'second', sequence: 2, commitCheckpointId: 'commit2', resultMessageId: 'result2' });
    expect(validateGoalCompletionProvenance(context, raw).checkpoint.commits[0]!.sequence).toBe(2);
  });
  it.each(['missing-evidence', 'extra-evidence', 'negative-index', 'missing-child', 'terminal-message', 'commit-sequence', 'status', 'journal-shape'])('rejects corrupt %s', mode => {
    const { context, raw } = fixture();
    if (mode === 'missing-evidence') Reflect.deleteProperty(raw.evidenceRefsById, 'build');
    if (mode === 'extra-evidence') Reflect.set(raw.evidenceRefsById, 'foreign', raw.evidenceRefsById.build);
    if (mode === 'negative-index') raw.evidenceRefsById.build.evidenceIndex = -1;
    if (mode === 'missing-child') Reflect.deleteProperty(raw.childRefsById, 'child');
    if (mode === 'terminal-message') raw.childRefsById.child.terminalMessageId = '';
    if (mode === 'commit-sequence') raw.checkpoint.commits[0]!.sequence = 2;
    if (mode === 'status') raw.checkpoint.commits[0]!.status = 'passed';
    if (mode === 'journal-shape') Reflect.set(raw.checkpoint.completedRunJournalRef, 'content', 'secret');
    expect(() => validateGoalCompletionProvenance(context, raw)).toThrow('GOAL_PROVENANCE_INVALID');
  });
  it('validates supersession refs without treating old IDs as active evidence', () => {
    const { context, raw } = fixture(); raw.supersededEvidenceIds = { old: 'build' };
    Reflect.set(raw.evidenceRefsById, 'old', { ...raw.evidenceRefsById.build, eventId: 'old-event' });
    expect(validateGoalCompletionProvenance(context, raw).supersededEvidenceIds).toEqual({ old: 'build' });
    Reflect.set(raw.evidenceRefsById, 'old', { ...raw.evidenceRefsById.build });
    expect(() => validateGoalCompletionProvenance(context, raw)).toThrow('GOAL_PROVENANCE_INVALID');
  });
});

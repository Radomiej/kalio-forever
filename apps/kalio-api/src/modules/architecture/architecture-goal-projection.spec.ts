import { describe, expect, it } from 'vitest';
import type { ArchitectureGoalCompletionPolicyV1 } from '@kalio/types';
import { appendGoalSource, createGoalPacket } from './architecture-goal-source';
import { acceptGoalProjection, assertGoalProjectionHistory, goalProjectionPolicyTargets, prepareGoalProjection } from './architecture-goal-projection';

function packet() {
  return createGoalPacket({ messageId: 'm1', sessionId: 'host', turnId: 't1', content: 'Build accessible settings. Preserve providers.', createdAt: 1 });
}
function raw(sourceVersion = 1) {
  return { sourceVersion, criteria: [{ text: 'Accessible settings', sourceQuotes: [{ messageId: 'm1', quote: 'Build accessible settings.' }], supersedes: [] }] };
}
function ready(input = packet(), proposal = raw(input.version)) {
  const prepared = prepareGoalProjection(input, proposal);
  input.projection = { status: 'pending', base: input.projection.status === 'pending' ? input.projection.base : null, proposal: prepared };
  const policy: ArchitectureGoalCompletionPolicyV1 = { requiredEvidenceKindsByCriterion: Object.fromEntries(goalProjectionPolicyTargets(input, prepared).map(({ id }) => [id, ['FINAL_ARTIFACT']])) };
  const review = { sourceVersion: input.version, sourceFingerprint: input.sourceFingerprint, proposalFingerprint: prepared.proposalFingerprint, accepted: true as const };
  return { input, prepared, policy, review };
}
describe('architecture goal projection', () => {
  it('prepares without accepting, assigns host hash and owns all nested references', () => {
    const input = packet(); const worker = raw(); const before = structuredClone(input);
    const prepared = prepareGoalProjection(input, worker);
    expect(prepared.proposalFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.criteria[0]).not.toHaveProperty('id');
    expect(input).toEqual(before); expect(input.projection.status).toBe('pending');
    worker.criteria[0]!.sourceQuotes[0]!.quote = 'mutated';
    expect(prepared.criteria[0]!.sourceQuotes[0]!.quote).toBe('Build accessible settings.');
  });
  it.each(['id', 'proposalFingerprint', 'completionPolicy', 'expectedEvidenceKind', 'additional'])('rejects top-level worker injection %s', (key) => {
    expect(() => prepareGoalProjection(packet(), { ...raw(), [key]: 'secret' })).toThrow('Invalid goal proposal.');
  });
  it.each(['id', 'expectedEvidenceKind', 'evidencePolicy', 'additional'])('rejects criterion injection %s', (key) => {
    const worker = raw(); expect(() => prepareGoalProjection(packet(), { ...worker, criteria: [{ ...worker.criteria[0], [key]: 'secret' }] })).toThrow('Invalid goal proposal.');
  });
  it.each([null, [], {}, { sourceVersion: NaN, criteria: [] }, { sourceVersion: 1, criteria: [] }, { ...raw(), sourceVersion: 2 }])('rejects invalid shape, empty or stale proposal', (worker) => {
    expect(() => prepareGoalProjection(packet(), worker)).toThrow('Invalid goal proposal.');
  });
  it('rejects more than 32 criteria and empty text or quotes', () => {
    for (const criteria of [Array.from({ length: 33 }, () => raw().criteria[0]), [{ ...raw().criteria[0], text: ' ' }], [{ ...raw().criteria[0], sourceQuotes: [] }]]) {
      expect(() => prepareGoalProjection(packet(), { sourceVersion: 1, criteria })).toThrow('Invalid goal proposal.');
    }
  });
  it.each([{ messageId: 'foreign', quote: 'Build accessible settings.' }, { messageId: 'm1', quote: 'Build Accessible settings.' }, { messageId: 'm1', quote: ' ' }, { messageId: 'm1', quote: 'Build', id: 'worker' }])('rejects foreign, changed, empty or injected source quotes', (quote) => {
    expect(() => prepareGoalProjection(packet(), { sourceVersion: 1, criteria: [{ ...raw().criteria[0], sourceQuotes: [quote] }] })).toThrow('Invalid goal proposal.');
  });
  it('requires quote coverage of original and every update, without claiming semantic completeness', () => {
    const input = appendGoalSource(packet(), { messageId: 'm2', sessionId: 'host', turnId: 't2', content: 'Add retry.', createdAt: 2 });
    expect(() => prepareGoalProjection(input, raw(2))).toThrow('Invalid goal proposal.');
    const worker = raw(2); worker.criteria[0]!.sourceQuotes.push({ messageId: 'm2', quote: 'retry' });
    expect(prepareGoalProjection(input, worker)).toHaveProperty('proposalFingerprint');
    expect(() => acceptGoalProjection(input, prepareGoalProjection(input, worker), { requiredEvidenceKindsByCriterion: {} }, { sourceVersion: 2, sourceFingerprint: input.sourceFingerprint, proposalFingerprint: '', accepted: false })).toThrow();
  });
  it('rejects duplicate criteria, quotes and unknown supersession IDs', () => {
    const worker = raw();
    for (const criteria of [[worker.criteria[0], worker.criteria[0]], [{ ...worker.criteria[0], supersedes: ['worker-id'] }], [{ ...worker.criteria[0], sourceQuotes: [worker.criteria[0]!.sourceQuotes[0], worker.criteria[0]!.sourceQuotes[0]] }]]) {
      expect(() => prepareGoalProjection(packet(), { sourceVersion: 1, criteria })).toThrow('Invalid goal proposal.');
    }
  });
  it('canonicalizes object/set ordering with stable host IDs and hashes', () => {
    const input = packet(); const a = prepareGoalProjection(input, raw());
    const b = prepareGoalProjection(input, { criteria: [{ supersedes: [], sourceQuotes: [{ quote: 'Build accessible settings.', messageId: 'm1' }], text: 'Accessible settings' }], sourceVersion: 1 });
    expect(a).toEqual(b); expect(goalProjectionPolicyTargets(input, a)).toEqual(goalProjectionPolicyTargets(input, b));
    expect(goalProjectionPolicyTargets(input, a)[0]!.id).toMatch(/^c-[a-f0-9]{64}$/);
  });
  it('accepts only a current attached proposal, preserves sources and clones the entire snapshot', () => {
    const { input, prepared, policy, review } = ready(); const before = structuredClone(input);
    const result = acceptGoalProjection(input, prepared, policy, review);
    expect(result.projection.status).toBe('accepted'); expect(result.original).toEqual(input.original);
    expect(result.completionPolicy).toEqual(policy); expect(input).toEqual(before);
    result.original.content = 'mutated'; Reflect.set(result.completionPolicy.requiredEvidenceKindsByCriterion, 'foreign', []);
    expect(input).toEqual(before); expect(policy.requiredEvidenceKindsByCriterion).not.toHaveProperty('foreign');
  });
  it.each(['sourceVersion', 'sourceFingerprint', 'proposalFingerprint', 'accepted'])('rejects stale or unaccepted review %s', (key) => {
    const { input, prepared, policy, review } = ready();
    expect(() => acceptGoalProjection(input, prepared, policy, { ...review, [key]: key === 'sourceVersion' ? 2 : key === 'accepted' ? false : 'stale' })).toThrow('Invalid goal acceptance.');
  });
  it('rejects missing/current mismatch, edited proposal hashes, and already accepted packets', () => {
    const { input, prepared, policy, review } = ready();
    const missing = packet(); expect(() => acceptGoalProjection(missing, prepared, policy, review)).toThrow();
    const edited = structuredClone(prepared); edited.criteria[0]!.text = 'secret changed';
    expect(() => acceptGoalProjection(input, edited, policy, review)).toThrow();
    input.projection = { status: 'pending', base: null, proposal: { ...prepared, proposalFingerprint: 'stale' } };
    expect(() => acceptGoalProjection(input, prepared, policy, review)).toThrow();
  });
  it('rejects missing/foreign/empty/unknown/duplicate host evidence policies', () => {
    const { input, prepared, review } = ready(); const id = goalProjectionPolicyTargets(input, prepared)[0]!.id;
    for (const policy of [{ requiredEvidenceKindsByCriterion: {} }, { requiredEvidenceKindsByCriterion: { [id]: ['FINAL_ARTIFACT'], foreign: ['FINAL_ARTIFACT'] } }, { requiredEvidenceKindsByCriterion: { [id]: [] } }, { requiredEvidenceKindsByCriterion: { [id]: ['worker-kind'] } }, { requiredEvidenceKindsByCriterion: { [id]: ['FINAL_ARTIFACT', 'FINAL_ARTIFACT'] } }, { requiredEvidenceKindsByCriterion: { [id]: ['FINAL_ARTIFACT'] }, injected: true }]) {
      expect(() => acceptGoalProjection(input, prepared, policy, review)).toThrow('Invalid goal acceptance.');
    }
  });
  it('retains historical criteria and unsuperseded active IDs when applying an update', () => {
    const initial = ready(); const accepted = acceptGoalProjection(initial.input, initial.prepared, initial.policy, initial.review);
    if (accepted.projection.status !== 'accepted') throw new Error('Fixture failed.');
    const old = accepted.projection.snapshot.criteria[0]!;
    const input = appendGoalSource(accepted, { messageId: 'm2', sessionId: 'host', turnId: 't2', content: 'Replace settings with accessible retry.', createdAt: 2 });
    const worker = { sourceVersion: 2, criteria: [{ text: 'Accessible retry', sourceQuotes: [{ messageId: 'm1', quote: 'accessible settings' }, { messageId: 'm2', quote: 'accessible retry' }], supersedes: [old.id] }] };
    const prepared = prepareGoalProjection(input, worker); input.projection = { status: 'pending', base: accepted.projection.snapshot, proposal: prepared };
    const ids = goalProjectionPolicyTargets(input, prepared).map((row) => row.id);
    const result = acceptGoalProjection(input, prepared, { requiredEvidenceKindsByCriterion: { [ids[0]!]: ['FINAL_ARTIFACT'] } }, { sourceVersion: 2, sourceFingerprint: input.sourceFingerprint, proposalFingerprint: prepared.proposalFingerprint, accepted: true });
    if (result.projection.status !== 'accepted') throw new Error('Fixture failed.');
    expect(result.projection.snapshot.criteria).toHaveLength(2); expect(result.projection.snapshot.criteria[0]).toEqual(old);
    expect(ids).not.toContain(old.id);
    const noSupersedes = prepareGoalProjection(input, { ...worker, criteria: [{ ...worker.criteria[0], supersedes: [] }] });
    expect(goalProjectionPolicyTargets(input, noSupersedes).map((row) => row.id)).toContain(old.id);
    for (const supersedes of [[old.id, old.id], ['future'], [old.id, 'future']]) {
      expect(() => prepareGoalProjection(input, { ...worker, criteria: [{ ...worker.criteria[0], supersedes }] })).toThrow();
    }
  });
  it('never includes raw secret input in error messages', () => {
    expect(() => prepareGoalProjection(packet(), { sourceVersion: 1, criteria: [{ text: 'SECRET', sourceQuotes: [{ messageId: 'm1', quote: 'SECRET' }], supersedes: [] }] })).toThrow(/^Invalid goal proposal\.$/);
  });
  it('rejects a valid replacement pending proposal and an already accepted packet', () => {
    const fixture = ready();
    const replacement = prepareGoalProjection(fixture.input, { ...raw(), criteria: [{ ...raw().criteria[0], text: 'Replacement' }] });
    fixture.input.projection = { status: 'pending', base: null, proposal: replacement };
    expect(() => acceptGoalProjection(fixture.input, fixture.prepared, fixture.policy, fixture.review)).toThrow('Invalid goal acceptance.');
    const current = ready();
    const accepted = acceptGoalProjection(current.input, current.prepared, current.policy, current.review);
    expect(() => prepareGoalProjection(accepted, raw())).toThrow('Invalid goal proposal.');
    expect(() => acceptGoalProjection(accepted, current.prepared, current.policy, current.review)).toThrow('Invalid goal acceptance.');
  });
  it('clones candidate targets and mutable input policy before returning accepted truth', () => {
    const fixture = ready();
    const targets = goalProjectionPolicyTargets(fixture.input, fixture.prepared);
    targets[0]!.sourceQuotes[0]!.quote = 'mutation';
    expect(goalProjectionPolicyTargets(fixture.input, fixture.prepared)[0]!.sourceQuotes[0]!.quote).toBe('Build accessible settings.');
    const result = acceptGoalProjection(fixture.input, fixture.prepared, fixture.policy, fixture.review);
    Reflect.set(fixture.policy.requiredEvidenceKindsByCriterion, targets[0]!.id, ['BUILD_RESULT']);
    fixture.prepared.criteria[0]!.text = 'mutation';
    expect(result.completionPolicy.requiredEvidenceKindsByCriterion[targets[0]!.id]).toEqual(['FINAL_ARTIFACT']);
    if (result.projection.status !== 'accepted') throw new Error('Fixture failed.');
    expect(result.projection.snapshot.criteria[0]!.text).toBe('Accessible settings');
  });
  it('requires newer-source provenance for every superseding criterion and unique targets', () => {
    const fixture = ready();
    const accepted = acceptGoalProjection(fixture.input, fixture.prepared, fixture.policy, fixture.review);
    if (accepted.projection.status !== 'accepted') throw new Error('Fixture failed.');
    const oldId = accepted.projection.snapshot.criteria[0]!.id;
    const input = appendGoalSource(accepted, { messageId: 'm2', sessionId: 'host', turnId: 't2', content: 'Add retry.', createdAt: 2 });
    const oldQuote = { ...raw().criteria[0]!, supersedes: [oldId] };
    const newQuote = { text: 'Retry', sourceQuotes: [{ messageId: 'm2', quote: 'retry' }], supersedes: [] as string[] };
    expect(() => prepareGoalProjection(input, { sourceVersion: 2, criteria: [oldQuote, newQuote] })).toThrow();
    const first = { ...oldQuote, sourceQuotes: [...oldQuote.sourceQuotes, ...newQuote.sourceQuotes] };
    expect(() => prepareGoalProjection(input, { sourceVersion: 2, criteria: [first, { ...first, text: 'Duplicate target' }] })).toThrow();
  });
  it.each(['duplicate', 'dangling', 'self', 'cycle'])('rejects malformed historical supersession %s', (mode) => {
    const input = appendGoalSource(packet(), { messageId: 'm2', sessionId: 'host', turnId: 't2', content: 'Add retry.', createdAt: 2 });
    const first = { id: 'old-a', ...raw().criteria[0]!, supersedes: mode === 'self' ? ['old-a'] : mode === 'cycle' ? ['old-b'] : mode === 'dangling' ? ['missing'] : [] };
    const second = { ...first, id: mode === 'duplicate' ? 'old-a' : 'old-b', supersedes: mode === 'cycle' ? ['old-a'] : [] };
    input.projection = { status: 'pending', base: { sourceVersion: 1, criteria: [first, second], goalFingerprint: 'historical' } };
    const worker = raw(2); worker.criteria[0]!.sourceQuotes.push({ messageId: 'm2', quote: 'retry' });
    expect(() => prepareGoalProjection(input, worker)).toThrow('Invalid goal proposal.');
    expect(() => assertGoalProjectionHistory(input)).toThrow('Invalid goal proposal.');
  });
  it('validates accepted snapshots and pending history without mutating the packet', () => {
    const fixture = ready();
    const accepted = acceptGoalProjection(fixture.input, fixture.prepared, fixture.policy, fixture.review);
    const before = structuredClone(accepted);
    expect(() => assertGoalProjectionHistory(accepted)).not.toThrow();
    expect(accepted).toEqual(before);
    const pending = appendGoalSource(accepted, { messageId: 'm2', sessionId: 'host', turnId: 't2', content: 'Add retry.', createdAt: 2 });
    expect(() => assertGoalProjectionHistory(pending)).not.toThrow();
  });
  it('uses static errors even when unknown input access throws secret content', () => {
    const worker = { ...raw(), get sourceVersion(): number { throw new Error('SECRET'); } };
    expect(() => prepareGoalProjection(packet(), worker)).toThrow(/^Invalid goal proposal\.$/);
  });
  it('rejects a deterministic host-ID collision with a different historical row', () => {
    const input = appendGoalSource(packet(), { messageId: 'm2', sessionId: 'host', turnId: 't2', content: 'Add retry.', createdAt: 2 });
    const worker = raw(2); worker.criteria[0]!.sourceQuotes.push({ messageId: 'm2', quote: 'retry' });
    const prepared = prepareGoalProjection(input, worker);
    const id = goalProjectionPolicyTargets(input, prepared)[0]!.id;
    input.projection = { status: 'pending', base: { sourceVersion: 1, goalFingerprint: 'historical', criteria: [{ id, ...raw().criteria[0]!, text: 'Different historical criterion' }] } };
    expect(() => goalProjectionPolicyTargets(input, prepared)).toThrow('Invalid goal proposal.');
  });
  it.each(['id', 'fingerprint', 'future-source'])('rejects corrupt persisted base %s', (corruption) => {
    const fixture = ready();
    const accepted = acceptGoalProjection(fixture.input, fixture.prepared, fixture.policy, fixture.review);
    const input = appendGoalSource(accepted, { messageId: 'm2', sessionId: 'host', turnId: 't2', content: 'Add retry.', createdAt: 2 });
    if (input.projection.status !== 'pending' || !input.projection.base) throw new Error('Fixture failed.');
    if (corruption === 'id') input.projection.base.criteria[0]!.id = 'arbitrary';
    if (corruption === 'fingerprint') input.projection.base.goalFingerprint = 'tampered';
    if (corruption === 'future-source') {
      input.projection.base.criteria[0]!.sourceQuotes[0]!.messageId = 'm2';
      input.projection.base.criteria[0]!.sourceQuotes[0]!.quote = 'retry';
    }
    const worker = raw(2); worker.criteria[0]!.sourceQuotes.push({ messageId: 'm2', quote: 'retry' });
    expect(() => prepareGoalProjection(input, worker)).toThrow('Invalid goal proposal.');
  });
});

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { GoalCompletionProvenanceV2 } from './architecture-goal-provenance';
import type { WorkflowEvidence } from '@kalio/types';
import { createGoalPacket, appendGoalSource } from './architecture-goal-source';
import { prepareGoalProjection, goalProjectionPolicyTargets, acceptGoalProjection } from './architecture-goal-projection';
import { inspectGoalCompletion, prepareGoalCompletion, assertGoalCompletion, type GoalCompletionHostEvidence } from './architecture-goal-completion';

function fixture() {
  const pending = createGoalPacket({ messageId: 'm1', sessionId: 'host', turnId: 't1', content: 'Build settings.', createdAt: 1 });
  const prepared = prepareGoalProjection(pending, { sourceVersion: 1, criteria: [{ text: 'Settings', sourceQuotes: [{ messageId: 'm1', quote: 'Build settings.' }], supersedes: [] }] });
  pending.projection = { status: 'pending', base: null, proposal: prepared };
  const id = goalProjectionPolicyTargets(pending, prepared)[0]!.id;
  const packet = acceptGoalProjection(pending, prepared, { requiredEvidenceKindsByCriterion: { [id]: ['BUILD_RESULT', 'FINAL_ARTIFACT'] } }, { sourceVersion: 1, sourceFingerprint: pending.sourceFingerprint, proposalFingerprint: prepared.proposalFingerprint, accepted: true });
  const host: GoalCompletionHostEvidence = { evidenceById: {
    build: { kind: 'BUILD_RESULT', status: 'passed', source: 'tool', data: { exitCode: 0 } },
    artifact: { kind: 'FINAL_ARTIFACT', status: 'passed', data: { path: 'settings.ts' } },
  }, cliChildrenById: { child: 'passed' } };
  return { packet, host, refs: { [id]: ['build', 'artifact'] }, id };
}
describe('pure goal completion guard', () => {
  function v2(input = fixture()) {
    const { packet } = input;
    if (packet.projection.status !== 'accepted') throw new Error('Fixture failed.');
    const provenance: GoalCompletionProvenanceV2 = { schemaVersion: 2, runId: 'run', rootSessionId: 'internal-root', goalVersion: packet.version,
      sourceFingerprint: packet.sourceFingerprint, goalFingerprint: packet.projection.snapshot.goalFingerprint,
      checkpoint: { checkpointId: 'dispatch', status: 'sealed', admissions: [{ callId: 'call', sessionId: 'host', turnId: 'turn', promptMessageId: 'prompt', sequence: 1, admissionCheckpointId: 'admit' }],
        commits: [{ callId: 'call', sequence: 1, commitCheckpointId: 'commit', resultMessageId: 'result', status: 'success' }], completedRunJournalRef: { checkpointId: 'done', eventId: 'done-event', sequence: 2 } },
      evidenceRefsById: { build: { checkpointId: 'commit', eventId: 'event', sequence: 1, evidenceIndex: 0, dispatchCallId: 'call' }, artifact: { checkpointId: 'commit', eventId: 'event', sequence: 1, evidenceIndex: 1, dispatchCallId: 'call' } },
      childRefsById: { child: { childId: 'child', sessionId: 'child-session', lifecycleCheckpointId: 'lifecycle', launchToolCallId: 'call', terminalToolCallId: 'call', terminalMessageId: 'terminal' } }, supersededEvidenceIds: {},
      buildExpectation: { approvedSource: { messageId: packet.original.messageId, sessionId: packet.original.sessionId, turnId: packet.original.turnId }, executable: 'pnpm', args: ['build'], canonicalCwd: 'C:/project' } };
    return { ...input, envelope: { runId: 'run', rootSessionId: 'internal-root', provenance } };
  }
  it('preserves legacy hash bytes exactly when provenance is omitted', () => {
    const { packet, host, refs, id } = fixture();
    const binding = inspectGoalCompletion(packet, refs, host).binding;
    const expectedEvidence = JSON.stringify({ cliChildrenById: { child: 'passed' }, criterionEvidenceIds: { [id]: ['artifact', 'build'] }, evidenceById: {
      artifact: { data: { path: 'settings.ts' }, kind: 'FINAL_ARTIFACT', status: 'passed' }, build: { data: { exitCode: 0 }, kind: 'BUILD_RESULT', source: 'tool', status: 'passed' } } });
    const expectedPolicy = JSON.stringify({ requiredEvidenceKindsByCriterion: { [id]: ['BUILD_RESULT', 'FINAL_ARTIFACT'] } });
    expect(binding.evidenceFingerprint).toBe(createHash('sha256').update(expectedEvidence).digest('hex'));
    expect(binding.policyFingerprint).toBe(createHash('sha256').update(expectedPolicy).digest('hex'));
  });
  it('binds full sealed provenance and approved build expectation with explicit internal root', () => {
    const { packet, host, refs, envelope } = v2();
    const inspected = inspectGoalCompletion(packet, refs, host, envelope);
    const candidate = prepareGoalCompletion(packet, refs, host, envelope);
    expect(inspected.eligible).toBe(true); expect(candidate.binding).toEqual(inspected.binding);
    expect(() => assertGoalCompletion(packet, candidate, host, { ...candidate.binding, accepted: true }, envelope)).not.toThrow();
    const legacy = prepareGoalCompletion(packet, refs, host);
    expect(candidate.binding.evidenceFingerprint).not.toBe(legacy.binding.evidenceFingerprint);
    expect(candidate.binding.policyFingerprint).not.toBe(legacy.binding.policyFingerprint);
    expect(() => assertGoalCompletion(packet, legacy, host, { ...legacy.binding, accepted: true }, envelope)).toThrow();
    expect(() => assertGoalCompletion(packet, candidate, host, { ...candidate.binding, accepted: true })).toThrow();
  });
  it.each([null, {}, { trusted: true }, { schemaVersion: 2 }, 'SECRET'])('validates unknown provenance rather than trusting the caller type', (provenance) => {
    const { packet, host, refs, envelope } = v2();
    expect(() => inspectGoalCompletion(packet, refs, host, { ...envelope, provenance })).toThrow(/^Invalid goal completion\.$/);
  });
  it('binds explicit run/root scope and does not invoke provenance accessors', () => {
    const { packet, host, refs, envelope } = v2(); const candidate = prepareGoalCompletion(packet, refs, host, envelope);
    const other = { runId: 'other-run', rootSessionId: 'other-root', provenance: { ...envelope.provenance, runId: 'other-run', rootSessionId: 'other-root' } };
    expect(inspectGoalCompletion(packet, refs, host, other).binding.evidenceFingerprint).not.toBe(candidate.binding.evidenceFingerprint);
    let accessed = false;
    const malicious = { ...envelope, get provenance(): unknown { accessed = true; throw new Error('SECRET'); } };
    expect(() => inspectGoalCompletion(packet, refs, host, malicious)).toThrow(/^Invalid goal completion\.$/);
    expect(accessed).toBe(false);
  });
  it.each(['open', 'aborted'] as const)('binds valid %s provenance but never permits completion', (status) => {
    const { packet, host, refs, envelope } = v2();
    const provenance = { ...envelope.provenance, checkpoint: { ...envelope.provenance.checkpoint, status, completedRunJournalRef: null } };
    expect(inspectGoalCompletion(packet, refs, host, { ...envelope, provenance }).eligible).toBe(false);
    expect(() => prepareGoalCompletion(packet, refs, host, { ...envelope, provenance })).toThrow();
  });
  it.each(['run', 'root', 'goal', 'source', 'missing-ref', 'extra'])('rejects malformed or mismatched provenance %s', (part) => {
    const { packet, host, refs, envelope } = v2();
    if (part === 'run') envelope.runId = 'foreign';
    if (part === 'root') envelope.rootSessionId = packet.original.sessionId;
    if (part === 'goal') Reflect.set(envelope.provenance, 'goalVersion', 2);
    if (part === 'source') Reflect.set(envelope.provenance, 'sourceFingerprint', 'foreign');
    if (part === 'missing-ref') Reflect.deleteProperty(envelope.provenance.evidenceRefsById, 'artifact');
    if (part === 'extra') Reflect.set(envelope, 'trustedProducer', true);
    expect(() => inspectGoalCompletion(packet, refs, host, envelope)).toThrow(/^Invalid goal completion\.$/);
  });
  it.each(['checkpoint', 'admission', 'commit', 'journal', 'evidence', 'child', 'supersession', 'build'])('binds provenance changes to %s', (part) => {
    const { packet, host, refs, envelope } = v2(); const candidate = prepareGoalCompletion(packet, refs, host, envelope);
    const before = candidate.binding;
    if (part === 'checkpoint') Reflect.set(envelope.provenance.checkpoint, 'checkpointId', 'other-dispatch');
    if (part === 'admission') Reflect.set(envelope.provenance.checkpoint.admissions[0]!, 'admissionCheckpointId', 'other-admit');
    if (part === 'commit') Reflect.set(envelope.provenance.checkpoint.commits[0]!, 'resultMessageId', 'other-result');
    if (part === 'journal') Reflect.set(envelope.provenance.checkpoint.completedRunJournalRef!, 'eventId', 'other-done');
    if (part === 'evidence') Reflect.set(envelope.provenance.evidenceRefsById.build!, 'eventId', 'other-event');
    if (part === 'child') Reflect.set(envelope.provenance.childRefsById.child!, 'lifecycleCheckpointId', 'other-lifecycle');
    if (part === 'supersession') {
      Reflect.set(envelope.provenance.supersededEvidenceIds, 'old', 'build');
      Reflect.set(envelope.provenance.evidenceRefsById, 'old', { checkpointId: 'commit', eventId: 'old-event', sequence: 1, evidenceIndex: 0, dispatchCallId: 'call' });
    }
    if (part === 'build') Reflect.set(envelope.provenance.buildExpectation!, 'args', ['build', '--strict']);
    const next = inspectGoalCompletion(packet, refs, host, envelope);
    expect(next.binding.evidenceFingerprint).not.toBe(before.evidenceFingerprint);
    expect(next.binding.policyFingerprint === before.policyFingerprint).toBe(part !== 'build');
    expect(() => assertGoalCompletion(packet, candidate, host, { ...before, accepted: true }, envelope)).toThrow();
  });
  it('returns the same binding and refs as strict prepare when eligible', () => {
    const { packet, host, refs, id } = fixture();
    const strict = prepareGoalCompletion(packet, refs, host);
    expect(inspectGoalCompletion(packet, refs, host)).toEqual({ ...strict, activeCriterionIds: [id], eligible: true });
    expect(inspectGoalCompletion(packet, refs, host)).not.toHaveProperty('accepted');
  });
  it.each(['empty', 'missing-kind', 'failed-build', 'unknown-build', 'failed-cli', 'unknown-cli', 'blocked-cli-evidence'])('binds valid incomplete inventory %s but strict prepare rejects it', (mode) => {
    const { packet, host, refs, id } = fixture();
    if (mode === 'empty') refs[id] = [];
    if (mode === 'missing-kind') refs[id] = ['artifact'];
    if (mode === 'failed-build') host.evidenceById.build!.status = 'failed';
    if (mode === 'unknown-build') host.evidenceById.build!.status = 'unknown';
    if (mode === 'failed-cli') Reflect.set(host.cliChildrenById, 'child', 'failed');
    if (mode === 'unknown-cli') Reflect.set(host.cliChildrenById, 'child', 'unknown');
    if (mode === 'blocked-cli-evidence') Reflect.set(host.evidenceById, 'cli', { kind: 'CLI_CHILD', status: 'blocked' });
    const inspected = inspectGoalCompletion(packet, refs, host);
    expect(inspected.eligible).toBe(false); expect(inspected.activeCriterionIds).toEqual([id]);
    expect(inspected.binding.sourceFingerprint).toBe(packet.sourceFingerprint);
    expect(inspected.binding.evidenceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(() => prepareGoalCompletion(packet, refs, host)).toThrow();
  });
  it('binds all incomplete CLI states and empty refs canonically without mutation', () => {
    const { packet, host, id } = fixture(); const refs = { [id]: [] };
    const a = { ...host, cliChildrenById: { second: 'blocked' as const, first: 'unknown' as const } };
    const b = { ...host, cliChildrenById: { first: 'unknown' as const, second: 'blocked' as const } };
    const before = structuredClone({ packet, a, refs });
    const inspected = inspectGoalCompletion(packet, refs, a);
    expect(inspectGoalCompletion(packet, refs, b)).toEqual(inspected);
    expect({ packet, a, refs }).toEqual(before);
    Reflect.set(a.cliChildrenById, 'first', 'failed');
    expect(inspectGoalCompletion(packet, refs, a).binding.evidenceFingerprint).not.toBe(inspected.binding.evidenceFingerprint);
  });
  it('keeps missing or foreign refs and unknown runtime strings structurally invalid', () => {
    const { packet, host, id } = fixture();
    for (const refs of [{}, { foreign: [] }, { [id]: ['missing'] }]) {
      expect(() => inspectGoalCompletion(packet, refs, host)).toThrow('Invalid goal completion.');
    }
    Reflect.set(host.cliChildrenById, 'child', 'completed');
    expect(() => inspectGoalCompletion(packet, { [id]: [] }, host)).toThrow();
  });
  it('prepares only a candidate and verifies the authorized caller assertion without mutation', () => {
    const { packet, host, refs } = fixture(); const before = structuredClone({ packet, host, refs });
    const candidate = prepareGoalCompletion(packet, refs, host);
    expect(candidate.binding).toMatchObject({ goalVersion: packet.version, sourceFingerprint: packet.sourceFingerprint });
    expect(() => assertGoalCompletion(packet, candidate, host, { ...candidate.binding, accepted: true })).not.toThrow();
    expect({ packet, host, refs }).toEqual(before); expect(packet.projection.status).toBe('accepted');
    expect(candidate).not.toHaveProperty('accepted');
  });
  it('rejects pending packets', () => {
    const { packet, host, refs } = fixture();
    const pending = appendGoalSource(packet, { messageId: 'm2', sessionId: 'host', turnId: 't2', content: 'Add retry.', createdAt: 2 });
    expect(() => prepareGoalCompletion(pending, refs, host)).toThrow('Invalid goal completion.');
  });
  it.each(['missing', 'foreign', 'empty', 'duplicate', 'unknown-ref', 'wrong-kind'])('rejects invalid criterion refs %s', (mode) => {
    const { packet, host, refs, id } = fixture();
    const altered = mode === 'missing' ? {} : mode === 'foreign' ? { ...refs, foreign: ['build'] } : { [id]: mode === 'empty' ? [] : mode === 'duplicate' ? ['build', 'build', 'artifact'] : mode === 'unknown-ref' ? ['missing', 'artifact'] : ['artifact'] };
    expect(() => prepareGoalCompletion(packet, altered, host)).toThrow('Invalid goal completion.');
  });
  it.each(['failed', 'blocked', 'unknown'] as const)('rejects nonpassed referenced evidence %s', (status) => {
    const { packet, host, refs } = fixture(); host.evidenceById.build!.status = status;
    expect(() => prepareGoalCompletion(packet, refs, host)).toThrow('Invalid goal completion.');
  });
  it('blocks an authoritative failed build even with another passed build', () => {
    const { packet, host, refs } = fixture();
    Reflect.set(host.evidenceById, 'failed-build', { kind: 'BUILD_RESULT', status: 'failed' });
    expect(() => prepareGoalCompletion(packet, refs, host)).toThrow('Invalid goal completion.');
  });
  it.each(['failed', 'blocked', 'unknown', 'completed', 'exited', null])('blocks unresolved or invalid CLI status %s', (status) => {
    const { packet, host, refs } = fixture(); Reflect.set(host.cliChildrenById, 'child', status);
    expect(() => prepareGoalCompletion(packet, refs, host)).toThrow('Invalid goal completion.');
  });
  it.each(['goalVersion', 'goalFingerprint', 'sourceFingerprint', 'evidenceFingerprint', 'policyFingerprint', 'accepted'])('rejects stale caller binding %s', (field) => {
    const { packet, host, refs } = fixture(); const candidate = prepareGoalCompletion(packet, refs, host);
    const caller = { ...candidate.binding, accepted: true as const }; Reflect.set(caller, field, 'stale');
    expect(() => assertGoalCompletion(packet, candidate, host, caller)).toThrow('Invalid goal completion.');
  });
  it.each(['data', 'inventory', 'refs', 'policy', 'source', 'goal'])('rejects mutation after preparing %s', (mode) => {
    const { packet, host, refs, id } = fixture(); const candidate = prepareGoalCompletion(packet, refs, host);
    const caller = { ...candidate.binding, accepted: true as const };
    if (mode === 'data') host.evidenceById.build!.data = { exitCode: 0, changed: true };
    if (mode === 'inventory') Reflect.set(host.evidenceById, 'new', { kind: 'GIT_STATUS', status: 'passed' });
    if (mode === 'refs') Reflect.set(candidate.criterionEvidenceIds, id, ['artifact']);
    if (mode === 'policy') Reflect.set(packet.completionPolicy.requiredEvidenceKindsByCriterion, id, ['FINAL_ARTIFACT']);
    if (mode === 'source') packet.sourceFingerprint = 'stale';
    if (mode === 'goal' && packet.projection.status === 'accepted') packet.projection.snapshot.goalFingerprint = 'stale';
    expect(() => assertGoalCompletion(packet, candidate, host, caller)).toThrow('Invalid goal completion.');
  });
  it('canonicalizes all inventory/data/map/set insertion ordering', () => {
    const { packet, host, refs, id } = fixture(); host.evidenceById.build!.data = { a: 1, b: { z: 2, y: 3 } };
    const first = prepareGoalCompletion(packet, refs, host);
    const reverse: GoalCompletionHostEvidence = { evidenceById: { artifact: host.evidenceById.artifact!, build: { ...host.evidenceById.build!, data: { b: { y: 3, z: 2 }, a: 1 } } }, cliChildrenById: { child: 'passed' } };
    expect(prepareGoalCompletion(packet, { [id]: ['artifact', 'build'] }, reverse)).toEqual(first);
  });
  it.each([NaN, Infinity, undefined, BigInt(1), () => 'secret', Symbol('secret'), new Date(), new Map()])('rejects nonfinite or unserializable nested evidence data', (value) => {
    const { packet, host, refs } = fixture(); host.evidenceById.build!.data = { value };
    expect(() => prepareGoalCompletion(packet, refs, host)).toThrow(/^Invalid goal completion\.$/);
  });
  it('rejects cycles and getter errors without leaking raw content', () => {
    const { packet, host, refs } = fixture(); const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    host.evidenceById.build!.data = cyclic;
    expect(() => prepareGoalCompletion(packet, refs, host)).toThrow(/^Invalid goal completion\.$/);
    host.evidenceById.build!.data = { get secret(): string { throw new Error('SECRET'); } };
    expect(() => prepareGoalCompletion(packet, refs, host)).toThrow(/^Invalid goal completion\.$/);
  });
  it.each(['empty', 'foreign', 'duplicate', 'invalid', 'extra'])('independently rejects invalid active policy %s', (mode) => {
    const { packet, host, refs, id } = fixture();
    if (mode === 'extra') Reflect.set(packet.completionPolicy, 'worker', true);
    else Reflect.set(packet.completionPolicy, 'requiredEvidenceKindsByCriterion', mode === 'foreign' ? { foreign: ['BUILD_RESULT'] } : { [id]: mode === 'empty' ? [] : mode === 'duplicate' ? ['BUILD_RESULT', 'BUILD_RESULT'] : ['invalid'] });
    expect(() => prepareGoalCompletion(packet, refs, host)).toThrow();
  });
  it('clones refs and binds unreferenced inventory statuses and data', () => {
    const { packet, host, refs, id } = fixture();
    const first = prepareGoalCompletion(packet, refs, host); refs[id]!.push('mutation');
    expect(first.criterionEvidenceIds[id]).toEqual(['artifact', 'build']);
    const extra: WorkflowEvidence = { kind: 'TOOL_RESULT', status: 'unknown', data: { details: 'pending' } };
    Reflect.set(host.evidenceById, 'extra', extra);
    expect(prepareGoalCompletion(packet, first.criterionEvidenceIds, host).binding.evidenceFingerprint).not.toBe(first.binding.evidenceFingerprint);
  });
  it('leaves recovery selection to host, and only blocks failed builds when build is required', () => {
    const { packet, host, refs, id } = fixture();
    Reflect.set(host.evidenceById, 'old-failed-build', { kind: 'BUILD_RESULT', status: 'failed' });
    expect(() => prepareGoalCompletion(packet, refs, host)).toThrow();
    const recovered = { evidenceById: { build: host.evidenceById.build!, artifact: host.evidenceById.artifact! }, cliChildrenById: host.cliChildrenById };
    expect(() => prepareGoalCompletion(packet, refs, recovered)).not.toThrow();
    packet.completionPolicy = { requiredEvidenceKindsByCriterion: { [id]: ['FINAL_ARTIFACT'] } };
    expect(() => prepareGoalCompletion(packet, { [id]: ['artifact'] }, host)).not.toThrow();
  });
  it.each([{ kind: 'foreign', status: 'passed' }, { kind: 'BUILD_RESULT', status: 'completed' }, { kind: 'BUILD_RESULT', status: 'passed', id: 'worker' }, { kind: 'BUILD_RESULT', status: 'passed', data: [] }, { kind: 'BUILD_RESULT', status: 'passed', source: 4 }])('rejects malformed evidence rows', (row) => {
    const { packet, host, refs } = fixture(); Reflect.set(host.evidenceById, 'build', row);
    expect(() => prepareGoalCompletion(packet, refs, host)).toThrow(/^Invalid goal completion\.$/);
  });
  it('rejects CLI evidence unknown status independently of the children map', () => {
    const { packet, host, refs } = fixture(); Reflect.set(host.evidenceById, 'cli', { kind: 'CLI_CHILD', status: 'unknown' });
    expect(() => prepareGoalCompletion(packet, refs, host)).toThrow();
  });
  it('rejects stale superseded criterion refs and policy while retaining accepted history', () => {
    const initial = fixture();
    const pending = appendGoalSource(initial.packet, { messageId: 'm2', sessionId: 'host', turnId: 't2', content: 'Replace with retry.', createdAt: 2 });
    const proposal = prepareGoalProjection(pending, { sourceVersion: 2, criteria: [{ text: 'Retry', sourceQuotes: [{ messageId: 'm1', quote: 'Build settings.' }, { messageId: 'm2', quote: 'retry' }], supersedes: [initial.id] }] });
    if (pending.projection.status !== 'pending') throw new Error('Fixture failed.');
    pending.projection.proposal = proposal;
    const newId = goalProjectionPolicyTargets(pending, proposal)[0]!.id;
    const updated = acceptGoalProjection(pending, proposal, { requiredEvidenceKindsByCriterion: { [newId]: ['FINAL_ARTIFACT'] } }, { sourceVersion: 2, sourceFingerprint: pending.sourceFingerprint, proposalFingerprint: proposal.proposalFingerprint, accepted: true });
    expect(() => prepareGoalCompletion(updated, initial.refs, initial.host)).toThrow();
    expect(() => prepareGoalCompletion(updated, { [newId]: ['artifact'] }, initial.host)).not.toThrow();
    Reflect.set(updated.completionPolicy.requiredEvidenceKindsByCriterion, initial.id, ['BUILD_RESULT']);
    expect(() => prepareGoalCompletion(updated, { [newId]: ['artifact'] }, initial.host)).toThrow();
  });
  it('rejects sparse arrays, symbol keys, nonenumerable fields and prototype tricks', () => {
    const { packet, host, refs } = fixture();
    const nonenumerable = Object.defineProperty({}, 'hidden', { value: 'secret' });
    for (const value of [Array(1), { [Symbol('secret')]: true }, nonenumerable, Object.create({ inherited: true })]) {
      host.evidenceById.build!.data = { value };
      expect(() => prepareGoalCompletion(packet, refs, host)).toThrow();
    }
  });
  it('binds CLI membership and unreferenced status changes, and rejects caller getters', () => {
    const { packet, host, refs } = fixture();
    Reflect.set(host.evidenceById, 'extra', { kind: 'TOOL_RESULT', status: 'unknown' });
    const candidate = prepareGoalCompletion(packet, refs, host);
    const caller = { ...candidate.binding, accepted: true as const };
    Reflect.set(host.cliChildrenById, 'second', 'passed');
    expect(() => assertGoalCompletion(packet, candidate, host, caller)).toThrow();
    Reflect.deleteProperty(host.cliChildrenById, 'second');
    host.evidenceById.extra!.status = 'passed';
    expect(() => assertGoalCompletion(packet, candidate, host, caller)).toThrow();
    host.evidenceById.extra!.status = 'unknown';
    const getter = { ...caller, get accepted(): true { return true; } };
    expect(() => assertGoalCompletion(packet, candidate, host, getter)).toThrow();
  });
});

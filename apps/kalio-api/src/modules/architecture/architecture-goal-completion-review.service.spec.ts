import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecisionSettingsPort } from '@kalio/types';
import { JevDecisionsClient } from '../../common/jev-decisions.client';
import { createGoalPacket } from './architecture-goal-source';
import { prepareGoalProjection, goalProjectionPolicyTargets, acceptGoalProjection } from './architecture-goal-projection';
import { ArchitectureGoalCompletionReviewService, type GoalCompletionReviewSnapshot } from './architecture-goal-completion-review.service';
import type { GoalCompletionProvenanceV2 } from './architecture-goal-provenance';
import { prepareGoalCompletion } from './architecture-goal-completion';

function fixture(content = 'Build settings.', sourceSessionId = 'root') {
  const packet = createGoalPacket({ messageId: 'm1', sessionId: sourceSessionId, turnId: 't1', content, createdAt: 1 });
  const prepared = prepareGoalProjection(packet, { sourceVersion: 1, criteria: [{ text: 'Settings', sourceQuotes: [{ messageId: 'm1', quote: 'Build' }], supersedes: [] }] });
  packet.projection = { status: 'pending', base: null, proposal: prepared };
  const id = goalProjectionPolicyTargets(packet, prepared)[0]!.id;
  const accepted = acceptGoalProjection(packet, prepared, { requiredEvidenceKindsByCriterion: { [id]: ['BUILD_RESULT'] } }, { sourceVersion: 1, sourceFingerprint: packet.sourceFingerprint, proposalFingerprint: prepared.proposalFingerprint, accepted: true });
  const snapshot: GoalCompletionReviewSnapshot = { runId: 'run', rootSessionId: 'root', stateRevision: 1, packet: accepted,
    host: { evidenceById: { build: { kind: 'BUILD_RESULT', status: 'passed', data: { exitCode: 0 } } }, cliChildrenById: {} }, criterionEvidenceIds: { [id]: ['build'] } };
  return { snapshot, id };
}
function answer(choice = 'complete', confidence = 0.95) { return Response.json({ answers: { goal_completion: { type: 'choice', choice, confidence } } }); }
function harness(snapshot: GoalCompletionReviewSnapshot) {
  const resolve = vi.fn(async () => ({ apiKey: 'PRIVATE', endpoint: 'https://decision.invalid', model: 'test' }));
  const settings: DecisionSettingsPort = { resolve, getConfig: vi.fn(), updateConfig: vi.fn() };
  const readCurrent = vi.fn(async (_runId: string, _signal?: AbortSignal) => structuredClone(snapshot));
  const http = vi.fn<typeof fetch>().mockImplementation(async () => answer()); vi.stubGlobal('fetch', http);
  return { service: new ArchitectureGoalCompletionReviewService(settings, new JevDecisionsClient(), { readCurrent }), http, resolve, readCurrent };
}
function v2() {
  const input = fixture(); const { snapshot } = input;
  if (snapshot.packet.projection.status !== 'accepted') throw new Error('Fixture failed.');
  const provenance: GoalCompletionProvenanceV2 = {
    schemaVersion: 2, runId: snapshot.runId, rootSessionId: snapshot.rootSessionId,
    goalVersion: snapshot.packet.version, sourceFingerprint: snapshot.packet.sourceFingerprint,
    goalFingerprint: snapshot.packet.projection.snapshot.goalFingerprint,
    checkpoint: { checkpointId: 'dispatch', status: 'sealed', admissions: [{ callId: 'call', sessionId: 'host', turnId: 'turn', promptMessageId: 'prompt', sequence: 1, admissionCheckpointId: 'admit' }],
      commits: [{ callId: 'call', sequence: 1, commitCheckpointId: 'commit', resultMessageId: 'result', status: 'success' }], completedRunJournalRef: { checkpointId: 'done', eventId: 'done-event', sequence: 2 } },
    evidenceRefsById: { build: { checkpointId: 'commit', eventId: 'event', sequence: 1, evidenceIndex: 0, dispatchCallId: 'call' } },
    childRefsById: {}, supersededEvidenceIds: {}, buildExpectation: { approvedSource: { messageId: 'm1', sessionId: 'root', turnId: 't1' }, executable: 'pnpm', args: ['build'], canonicalCwd: 'C:/project' },
  };
  return { ...input, provenance };
}
afterEach(() => vi.unstubAllGlobals());
describe('completion semantic choice service', () => {
  it('forwards the same signal to every initial and current host verification', async () => {
    const { service, readCurrent } = harness(fixture().snapshot); const controller = new AbortController();
    expect(await service.select('run', 'root', 1, controller.signal)).toHaveProperty('status', 'complete');
    expect(readCurrent).toHaveBeenCalledTimes(3);
    for (const call of readCurrent.mock.calls) expect(call).toEqual(['run', controller.signal]);
  });
  it('propagates abort during a signal-honoring host read without invoking Jev', async () => {
    const { service, readCurrent, http, resolve } = harness(fixture().snapshot); const controller = new AbortController();
    let received: AbortSignal | undefined;
    readCurrent.mockImplementation((_runId, signal) => {
      received = signal;
      if (!signal) return Promise.reject(new Error('Missing abort signal.'));
      return new Promise((_accept, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const pending = service.select('run', 'root', 1, controller.signal);
    controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(received).toBe(controller.signal);
    expect(http).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
  });
  it('reviews full sealed V2 provenance and returns the same V2 completion binding', async () => {
    const { snapshot, provenance } = v2(); Reflect.set(snapshot, 'provenance', provenance);
    const { service, http } = harness(snapshot);
    const result = await service.select('run', 'root', 1);
    expect(result).toMatchObject({ status: 'complete', reviewedStateRevision: 1 });
    const expected = prepareGoalCompletion(snapshot.packet, snapshot.criterionEvidenceIds, snapshot.host,
      { runId: snapshot.runId, rootSessionId: snapshot.rootSessionId, provenance });
    expect(result).toMatchObject({ binding: expected.binding, candidate: expected, callerBinding: { ...expected.binding, accepted: true } });
    expect(JSON.parse(String(http.mock.calls[0]![1]!.body)).state.provenance).toEqual(provenance);
  });
  it.each(['open', 'aborted'] as const)('offers only continue for V2 %s', async status => {
    const { snapshot, id, provenance } = v2();
    Reflect.set(snapshot, 'provenance', { ...provenance, checkpoint: { ...provenance.checkpoint, status, completedRunJournalRef: null } });
    const { service, http } = harness(snapshot); http.mockResolvedValue(answer(`continue:${id}`));
    expect(await service.select('run', 'root', 1)).toHaveProperty('status', 'continue');
    expect(JSON.parse(String(http.mock.calls[0]![1]!.body)).questions.goal_completion.criteria).not.toHaveProperty('complete');
  });
  it.each(['runId', 'rootSessionId'])('rejects foreign V2 %s before HTTP', async key => {
    const { snapshot, provenance } = v2(); Reflect.set(provenance, key, 'foreign'); Reflect.set(snapshot, 'provenance', provenance);
    const { service, http } = harness(snapshot);
    expect(await service.select('run', 'root', 1)).toMatchObject({ status: 'needs_user', reason: 'invalid_input' }); expect(http).not.toHaveBeenCalled();
  });
  it.each(['checkpoint', 'refs', 'build', 'downgrade'])('rejects post-Jev V2 mutation %s without revision change', async part => {
    const { snapshot, provenance } = v2(); Reflect.set(snapshot, 'provenance', provenance);
    const { service, http } = harness(snapshot); http.mockImplementation(async () => {
      if (part === 'checkpoint') Reflect.set(provenance.checkpoint, 'checkpointId', 'other');
      if (part === 'refs') Reflect.set(provenance.evidenceRefsById.build!, 'eventId', 'other');
      if (part === 'build') Reflect.set(provenance.buildExpectation!, 'args', ['build', '--strict']);
      if (part === 'downgrade') Reflect.deleteProperty(snapshot, 'provenance');
      return answer();
    });
    expect(await service.select('run', 'root', 1)).toMatchObject({ status: 'needs_user', reason: 'stale_input' });
  });
  it('rejects initial and post-resolve snapshot getters without invoking them', async () => {
    for (const stage of ['initial', 'after-resolve']) {
      const { snapshot } = fixture(); const { service, readCurrent, resolve, http } = harness(snapshot);
      let accessed = false;
      const malicious = Object.defineProperty(snapshot, 'provenance', { enumerable: true, get() { accessed = true; throw new Error('SECRET'); } });
      readCurrent.mockImplementation(async () => stage === 'initial' ? malicious : fixture().snapshot);
      if (stage === 'after-resolve') resolve.mockImplementation(async () => {
        readCurrent.mockImplementation(async () => malicious); return { apiKey: 'PRIVATE', endpoint: 'https://decision.invalid', model: 'test' };
      });
      expect(await service.select('run', 'root', 1)).toHaveProperty('status', 'needs_user');
      expect(accessed).toBe(false); expect(http).not.toHaveBeenCalled();
    }
  });
  it('rejects provenance changes after connection resolution without transmitting a stale request', async () => {
    const { snapshot, provenance } = v2(); snapshot.provenance = provenance;
    const { service, resolve, http } = harness(snapshot);
    resolve.mockImplementation(async () => {
      Reflect.set(provenance.buildExpectation!, 'canonicalCwd', 'C:/changed');
      return { apiKey: 'PRIVATE', endpoint: 'https://decision.invalid', model: 'test' };
    });
    expect(await service.select('run', 'root', 1)).toMatchObject({ status: 'needs_user', reason: 'stale_input' }); expect(http).not.toHaveBeenCalled();
  });
  it('does not transmit sanitized provenance even when structurally sealed', async () => {
    const { snapshot, provenance } = v2(); Reflect.set(provenance.buildExpectation!, 'args', ['--token hidden-secret']); snapshot.provenance = provenance;
    const { service, http, resolve } = harness(snapshot);
    expect(await service.select('run', 'root', 1)).toMatchObject({ status: 'needs_user', reason: 'transport_changed' });
    expect(http).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
  });
  it.each(['complete', 'continue'] as const)('accepts host source distinct from internal architecture root for %s', async (selection) => {
    const { snapshot, id } = fixture('Build settings.', 'host');
    snapshot.rootSessionId = 'internal-root';
    if (selection === 'continue') snapshot.criterionEvidenceIds = { [id]: [] };
    const { service, http } = harness(snapshot);
    http.mockResolvedValue(answer(selection === 'complete' ? 'complete' : `continue:${id}`));
    expect(await service.select('run', 'internal-root', 1)).toMatchObject({ status: selection, reviewedStateRevision: 1 });
    expect(http).toHaveBeenCalledOnce();
  });
  it('binds real parsed complete choice with reviewed revision and no receipt claim', async () => {
    const { snapshot, id } = fixture(); const { service, http, readCurrent } = harness(snapshot);
    const result = await service.select('run', 'root', 1);
    expect(result).toMatchObject({ status: 'complete', reviewedStateRevision: 1, binding: { goalVersion: 1, sourceFingerprint: snapshot.packet.sourceFingerprint }, callerBinding: { accepted: true } });
    expect(result).not.toHaveProperty('receipt'); expect(readCurrent).toHaveBeenCalledTimes(3);
    const body = JSON.parse(String(http.mock.calls[0]![1]!.body));
    expect(Object.keys(body.questions.goal_completion.criteria)).toEqual(['complete', `continue:${id}`]);
    expect(body.state.original.content).toBe('Build settings.');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('offers continue always but not complete when valid inventory is incomplete', async () => {
    const { snapshot, id } = fixture(); snapshot.criterionEvidenceIds = { [id]: [] }; snapshot.host.cliChildrenById = { child: 'unknown' };
    const { service, http } = harness(snapshot); http.mockResolvedValue(answer(`continue:${id}`));
    expect(await service.select('run', 'root', 1)).toMatchObject({ status: 'continue', criterionId: id, reviewedStateRevision: 1, binding: { goalVersion: 1 } });
    const body = JSON.parse(String(http.mock.calls[0]![1]!.body)); expect(body.questions.goal_completion.criteria).not.toHaveProperty('complete');
  });
  it.each([0.9499, NaN, 1.1, -1])('does not fallback for invalid/uncertain confidence %s', async (confidence) => {
    const { service, http } = harness(fixture().snapshot); http.mockResolvedValue(answer('complete', confidence));
    expect(await service.select('run', 'root', 1)).toHaveProperty('status', 'needs_user');
  });
  it('uses the real client parser to reject choice not in the offered candidates', async () => {
    const { service, http } = harness(fixture().snapshot); http.mockResolvedValue(answer('continue:foreign'));
    expect(await service.select('run', 'root', 1)).toMatchObject({ status: 'needs_user', reason: 'provider_error' });
  });
  it.each(['revision', 'root', 'refs', 'inventory', 'source'])('rejects changed post-resolve snapshot %s before HTTP', async (change) => {
    const { snapshot, id } = fixture(); const { service, resolve, http } = harness(snapshot);
    resolve.mockImplementation(async () => {
      if (change === 'revision') snapshot.stateRevision++;
      if (change === 'root') snapshot.rootSessionId = 'foreign';
      if (change === 'refs') snapshot.criterionEvidenceIds = { [id]: [] };
      if (change === 'inventory') snapshot.host.evidenceById.build!.data = { exitCode: 0, changed: true };
      if (change === 'source') snapshot.packet.original.content = 'Changed';
      return { apiKey: 'PRIVATE', endpoint: 'https://decision.invalid', model: 'test' };
    });
    expect(await service.select('run', 'root', 1)).toMatchObject({ status: 'needs_user', reason: 'stale_input' }); expect(http).not.toHaveBeenCalled();
  });
  it('rejects post-Jev change even when chosen result is valid', async () => {
    const { snapshot } = fixture(); const { service, http } = harness(snapshot);
    http.mockImplementation(async () => { snapshot.stateRevision++; return answer(); });
    expect(await service.select('run', 'root', 1)).toMatchObject({ status: 'needs_user', reason: 'stale_input' });
  });
  it.each([0, -1, 1.5, Infinity])('rejects invalid stateRevision %s', async (stateRevision) => {
    const { snapshot } = fixture(); snapshot.stateRevision = stateRevision; const { service, http } = harness(snapshot);
    expect(await service.select('run', 'root', 1)).toHaveProperty('status', 'needs_user'); expect(http).not.toHaveBeenCalled();
  });
  it('does not transmit redacted or truncated full source', async () => {
    for (const content of ['Build sk-abcdefghijklmnop', 'Build ' + 'x'.repeat(70_000)]) {
      const { service, http, resolve } = harness(fixture(content).snapshot);
      expect(await service.select('run', 'root', 1)).toMatchObject({ status: 'needs_user', reason: 'transport_changed' });
      expect(http).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
    }
  });
  it('preserves safe source over 2000 chars and enforces UTF8 full wire budget', async () => {
    const content = 'Build ' + 'safe '.repeat(600); const { service, http } = harness(fixture(content).snapshot);
    expect(await service.select('run', 'root', 1)).toHaveProperty('status', 'complete');
    const body = String(http.mock.calls[0]![1]!.body); expect(JSON.parse(body).state.original.content).toBe(content);
    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(65_536);
    const large = harness(fixture('Build ' + '界'.repeat(23_000)).snapshot);
    expect(await large.service.select('run', 'root', 1)).toMatchObject({ status: 'needs_user', reason: 'budget_limit' }); expect(large.http).not.toHaveBeenCalled();
  });
  it('propagates abort before call and after response without selection', async () => {
    const { service, http } = harness(fixture().snapshot); const controller = new AbortController(); controller.abort();
    await expect(service.select('run', 'root', 1, controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(http).not.toHaveBeenCalled();
    const second = new AbortController(); http.mockImplementation(async () => { second.abort(); return answer(); });
    await expect(service.select('run', 'root', 1, second.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it.each(['run', 'root', 'version'])('rejects mismatched initial identity %s', async (part) => {
    const { snapshot } = fixture(); const { service, http } = harness(snapshot);
    expect(await service.select(part === 'run' ? 'foreign' : 'run', part === 'root' ? 'foreign' : 'root', part === 'version' ? 2 : 1)).toMatchObject({ status: 'needs_user', reason: 'invalid_input' });
    expect(http).not.toHaveBeenCalled();
  });
  it.each(['refs', 'inventory', 'policy', 'root'])('rejects post-Jev snapshot change without revision bump %s', async (part) => {
    const { snapshot, id } = fixture(); const { service, http } = harness(snapshot);
    http.mockImplementation(async () => {
      if (part === 'refs') snapshot.criterionEvidenceIds = { [id]: [] };
      if (part === 'inventory') snapshot.host.evidenceById.build!.data = { exitCode: 0, changed: true };
      if (part === 'policy') snapshot.packet.completionPolicy = { requiredEvidenceKindsByCriterion: { [id]: ['FINAL_ARTIFACT'] } };
      if (part === 'root') snapshot.rootSessionId = 'foreign';
      return answer();
    });
    expect(await service.select('run', 'root', 1)).toMatchObject({ status: 'needs_user', reason: 'stale_input' });
  });
  it('rejects provider errors and complete when not offered without fallback', async () => {
    const { snapshot, id } = fixture(); snapshot.criterionEvidenceIds = { [id]: [] };
    const { service, http } = harness(snapshot);
    expect(await service.select('run', 'root', 1)).toMatchObject({ status: 'needs_user', reason: 'provider_error' });
    http.mockRejectedValue(new Error('PRIVATE'));
    const result = await service.select('run', 'root', 1);
    expect(result).toMatchObject({ status: 'needs_user', reason: 'provider_error' }); expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('propagates abort after resolve before HTTP', async () => {
    const { service, resolve, http } = harness(fixture().snapshot); const controller = new AbortController();
    resolve.mockImplementation(async () => { controller.abort(); return { apiKey: 'PRIVATE', endpoint: 'https://decision.invalid', model: 'test' }; });
    await expect(service.select('run', 'root', 1, controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(http).not.toHaveBeenCalled();
  });
});

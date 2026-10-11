import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecisionSettingsPort } from '@kalio/types';
import { JevDecisionsClient } from '../../common/jev-decisions.client';
import { createGoalPacket, appendGoalSource } from './architecture-goal-source';
import { acceptGoalProjection, goalProjectionPolicyTargets, prepareGoalProjection } from './architecture-goal-projection';
import { ArchitectureGoalReviewService } from './architecture-goal-review.service';

const ids = ['source_complete', 'scope_faithful', 'supersession_valid'];
function fixture(content = 'Build the home site.') {
  const packet = createGoalPacket({ messageId: 'user-1', sessionId: 'session-1', turnId: 'turn-1', content, createdAt: 1 });
  const prepared = prepareGoalProjection(packet, { sourceVersion: packet.version, criteria: [
    { text: 'Build the home site.', sourceQuotes: [{ messageId: 'user-1', quote: 'Build' }], supersedes: [] },
  ] });
  packet.projection = { status: 'pending', base: null, proposal: prepared };
  return { packet, prepared };
}
function response(probabilities = [0.95, 0.95, 0.95]) {
  return Response.json({ answers: Object.fromEntries(ids.map((id, i) => [id, { type: 'noul', noul: probabilities[i] }])) });
}
function harness() {
  const resolve = vi.fn(async () => ({ endpoint: 'https://decision.invalid/review', model: 'jev-test', apiKey: 'connection-private' }));
  const settings: DecisionSettingsPort = { resolve, getConfig: vi.fn(), updateConfig: vi.fn() };
  const http = vi.fn<typeof fetch>().mockImplementation(async () => response());
  vi.stubGlobal('fetch', http);
  const client = new JevDecisionsClient();
  return { service: new ArchitectureGoalReviewService(settings, client), client, http, resolve };
}
afterEach(() => vi.unstubAllGlobals());

describe('ArchitectureGoalReviewService', () => {
  it('binds only a parsed complete three-noul response at the inclusive .95 boundary', async () => {
    const { packet, prepared } = fixture();
    const { service, http, resolve } = harness();
    const result = await service.review(packet, prepared);
    expect(result.status).toBe('accepted');
    expect(result).toMatchObject({ binding: { accepted: true, sourceVersion: 1, sourceFingerprint: packet.sourceFingerprint,
      proposalFingerprint: prepared.proposalFingerprint }, disclosure: { transport: 'unchanged' } });
    expect(resolve).toHaveBeenCalledOnce();
    const request = JSON.parse(String(http.mock.calls[0][1]?.body));
    expect(Object.keys(request.questions)).toEqual(ids);
    expect(Object.values(request.questions)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'noul' })]));
    expect(request.state.original).toEqual(packet.original);
    expect(request.state.candidateCriteria).toEqual(prepared.criteria);
    expect(request.state).not.toHaveProperty('apiKey');
    expect(JSON.stringify(result)).not.toContain(packet.original.content);
    expect(JSON.stringify(result)).not.toContain('connection-private');
  });

  it.each([[0.949999, 1, 1], [1, 0.5, 1], [1, 1, 0.050001]])('requires user for uncertain probabilities %j', async (...values) => {
    const { service, http } = harness(); const { packet, prepared } = fixture();
    http.mockResolvedValue(response(values));
    expect(await service.review(packet, prepared)).toMatchObject({ status: 'needs_user', reason: 'uncertain' });
    expect(await service.review(packet, prepared)).not.toHaveProperty('binding');
  });
  it.each([0, 1, 2])('rejects a clear negative at .05 for question %i without binding', async (index) => {
    const { service, http } = harness(); const { packet, prepared } = fixture();
    const values = [1, 1, 1]; values[index] = 0.05; http.mockResolvedValue(response(values));
    const result = await service.review(packet, prepared);
    expect(result.status).toBe('rejected'); expect(result).not.toHaveProperty('binding');
  });
  it.each(['Build sk-abcdefghijklmnop', 'Build ' + 'x'.repeat(70000)])('does not transmit altered source %#', async (content) => {
    const { service, http, resolve } = harness(); const { packet, prepared } = fixture(content);
    const result = await service.review(packet, prepared);
    expect(result).toMatchObject({ status: 'needs_user', reason: 'transport_changed', disclosure: { transport: 'changed', attemptedRequestBytes: 0 } });
    expect(result).not.toHaveProperty('binding'); expect(http).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(content);
  });
  it('reviews a complete safe source over 2000 characters without chunking or omission', async () => {
    const content = 'Build ' + 'safe content '.repeat(400);
    const { service, http } = harness(); const { packet, prepared } = fixture(content);
    const result = await service.review(packet, prepared);
    expect(result.status).toBe('accepted'); expect(result).toHaveProperty('binding');
    const body = String(http.mock.calls[0][1]?.body);
    expect(JSON.parse(body).state.original.content).toBe(content);
    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(65536);
    expect(result.disclosure.attemptedRequestBytes).toBe(new TextEncoder().encode(body).byteLength);
  });
  it('redacts a secret after character 2000 and makes no request', async () => {
    const content = 'Build ' + 'safe '.repeat(600) + 'Bearer private-value-123456';
    const { service, http, resolve } = harness(); const { packet, prepared } = fixture(content);
    const result = await service.review(packet, prepared);
    expect(result).toMatchObject({ status: 'needs_user', reason: 'transport_changed' });
    expect(result).not.toHaveProperty('binding'); expect(http).not.toHaveBeenCalled(); expect(resolve).not.toHaveBeenCalled();
  });
  it('rejects multibyte full-wire overflow even when sanitized character budget fits', async () => {
    const { service, http } = harness(); const { packet, prepared } = fixture('Build ' + '界'.repeat(23000));
    const result = await service.review(packet, prepared);
    expect(result).toMatchObject({ status: 'needs_user', reason: 'budget_limit' });
    expect(result).not.toHaveProperty('binding'); expect(http).not.toHaveBeenCalled();
  });
  it('does not transmit redacted candidate even when sources are unchanged', async () => {
    const { service, http } = harness(); const { packet } = fixture();
    const prepared = prepareGoalProjection(packet, { sourceVersion: 1, criteria: [{ text: 'Use Bearer abcdefghijk',
      sourceQuotes: [{ messageId: 'user-1', quote: 'Build' }], supersedes: [] }] });
    packet.projection = { status: 'pending', base: null, proposal: prepared };
    expect(await service.review(packet, prepared)).toMatchObject({ reason: 'transport_changed' }); expect(http).not.toHaveBeenCalled();
  });
  it('detects silent array truncation of quotes', async () => {
    const { service, http } = harness(); const { packet } = fixture('Build ' + 'a'.repeat(100));
    const prepared = prepareGoalProjection(packet, { sourceVersion: 1, criteria: [{ text: 'Build', supersedes: [],
      sourceQuotes: Array.from({ length: 51 }, (_, i) => ({ messageId: 'user-1', quote: 'a'.repeat(i + 1) })) }] });
    packet.projection = { status: 'pending', base: null, proposal: prepared };
    expect(await service.review(packet, prepared)).toMatchObject({ reason: 'transport_changed' }); expect(http).not.toHaveBeenCalled();
  });
  it('detects whole-state budget truncation rather than approving a prefix', async () => {
    const { service, http } = harness(); const { packet } = fixture('Build ' + 'z'.repeat(1800));
    const prepared = prepareGoalProjection(packet, { sourceVersion: 1, criteria: Array.from({ length: 8 }, (_, i) => ({
      text: `${i} ${'z'.repeat(9000)}`, sourceQuotes: [{ messageId: 'user-1', quote: 'Build' }], supersedes: [] })) });
    packet.projection = { status: 'pending', base: null, proposal: prepared };
    expect(await service.review(packet, prepared)).toMatchObject({ reason: 'transport_changed' }); expect(http).not.toHaveBeenCalled();
  });
  it.each(['fingerprint', 'missing', 'attached', 'accepted', 'source'])('rejects invalid current input: %s', async (kind) => {
    const { service, http } = harness(); const { packet, prepared } = fixture();
    if (kind === 'fingerprint') prepared.proposalFingerprint = 'forged';
    if (kind === 'missing') packet.projection = { status: 'pending', base: null };
    if (kind === 'attached') packet.projection = { status: 'pending', base: null, proposal: { ...prepared, proposalFingerprint: 'other' } };
    if (kind === 'accepted') packet.projection = { status: 'accepted', snapshot: { sourceVersion: 1, criteria: [], goalFingerprint: 'forged' } };
    if (kind === 'source') packet.original.content = 'Changed';
    expect(await service.review(packet, prepared)).toMatchObject({ reason: 'invalid_input' }); expect(http).not.toHaveBeenCalled();
  });
  it.each([{ answers: {} }, { answers: Object.fromEntries(ids.map(id => [id, { type: 'choice', noul: 1 }])) },
    { answers: Object.fromEntries(ids.map(id => [id, { type: 'noul', noul: '1' }])) },
    { answers: Object.fromEntries(ids.map(id => [id, { type: 'noul', noul: 1.1 }])) }])('real parser refuses malformed batch %#', async (body) => {
    const { service, http } = harness(); const { packet, prepared } = fixture(); http.mockResolvedValue(Response.json(body));
    const result = await service.review(packet, prepared);
    expect(result).toMatchObject({ reason: 'provider_error', status: 'needs_user' }); expect(result).not.toHaveProperty('binding');
  });
  it('does not expose driver errors or secrets', async () => {
    const { service, resolve } = harness(); const { packet, prepared } = fixture(); resolve.mockRejectedValue(new Error('raw source connection-private'));
    expect(await service.review(packet, prepared)).toMatchObject({ reason: 'provider_error' });
    expect(JSON.stringify(await service.review(packet, prepared))).not.toContain('connection-private');
  });
  it.each([1.01, Number.NaN, Number.POSITIVE_INFINITY, -0.01])('refuses malformed direct-client probability %s', async (probability) => {
    const { service, client } = harness(); const { packet, prepared } = fixture();
    vi.spyOn(client, 'decideNoulBatch').mockResolvedValue({ answers: {
      source_complete: { probability }, scope_faithful: { probability: 1 }, supersession_valid: { probability: 1 },
    } });
    const result = await service.review(packet, prepared);
    expect(result).toMatchObject({ status: 'needs_user', reason: 'provider_error' });
    expect(result).not.toHaveProperty('binding');
  });
  it('refuses missing direct-client answers', async () => {
    const { service, client } = harness(); const { packet, prepared } = fixture();
    vi.spyOn(client, 'decideNoulBatch').mockResolvedValue({ answers: { source_complete: { probability: 1 } } });
    const result = await service.review(packet, prepared);
    expect(result).toMatchObject({ status: 'needs_user', reason: 'provider_error' }); expect(result).not.toHaveProperty('binding');
  });
  it('refuses arbitrary source fields rather than transmitting model context', async () => {
    const { service, http } = harness(); const { packet, prepared } = fixture();
    Object.assign(packet.original, { toolArgs: { privateInput: 'not-authoritative' } });
    expect(await service.review(packet, prepared)).toMatchObject({ reason: 'invalid_input' });
    expect(http).not.toHaveBeenCalled();
  });
  it('preflights the full serialized request byte budget', async () => {
    const { service, http, resolve } = harness(); const { packet, prepared } = fixture();
    resolve.mockResolvedValue({ endpoint: 'https://decision.invalid', model: 'x'.repeat(65536), apiKey: '' });
    expect(await service.review(packet, prepared)).toMatchObject({ reason: 'budget_limit' });
    expect(http).not.toHaveBeenCalled();
  });
  it('invalidates changes while resolving settings without sending a stale request', async () => {
    const { service, http, resolve } = harness(); const { packet, prepared } = fixture();
    resolve.mockImplementation(async () => { packet.original.content = 'Changed'; return { endpoint: 'https://decision.invalid', model: 'jev', apiKey: '' }; });
    expect(await service.review(packet, prepared)).toMatchObject({ reason: 'stale_input' }); expect(http).not.toHaveBeenCalled();
  });
  it('keeps the in-flight HTTP snapshot independent from input mutation', async () => {
    const { service, http } = harness(); const { packet, prepared } = fixture();
    http.mockImplementation(async (_url, options) => {
      packet.original.content = 'Changed';
      expect(JSON.parse(String(options?.body)).state.original.content).toBe('Build the home site.');
      return response();
    });
    expect(await service.review(packet, prepared)).toMatchObject({ reason: 'stale_input' });
  });
  it('reviews historical criteria and update-backed supersession and supplies the existing acceptance binding', async () => {
    const { service, http } = harness(); let { packet, prepared } = fixture();
    const first = await service.review(packet, prepared);
    expect(first.status).toBe('accepted');
    if (first.status !== 'accepted') throw new Error('Expected acceptance.');
    const targets = goalProjectionPolicyTargets(packet, prepared);
    packet = acceptGoalProjection(packet, prepared, { requiredEvidenceKindsByCriterion: Object.fromEntries(targets.map(row => [row.id, ['BUILD_RESULT']])) }, first.binding);
    const historical = packet.projection.status === 'accepted' ? packet.projection.snapshot.criteria : [];
    packet = appendGoalSource(packet, { messageId: 'user-2', sessionId: 'session-1', turnId: 'turn-2', content: 'Replace the home site with a contact page.', createdAt: 2 });
    prepared = prepareGoalProjection(packet, { sourceVersion: 2, criteria: [{ text: 'Build the contact page instead', supersedes: [historical[0].id],
      sourceQuotes: [{ messageId: 'user-1', quote: 'Build' }, { messageId: 'user-2', quote: 'Replace the home site with a contact page.' }] }] });
    packet.projection = { status: 'pending', base: packet.projection.status === 'pending' ? packet.projection.base : null, proposal: prepared };
    const result = await service.review(packet, prepared);
    expect(result.status).toBe('accepted');
    const state = JSON.parse(String(http.mock.calls[1][1]?.body)).state;
    expect(state.historicalCriteria).toEqual(historical);
    expect(state.candidateCriteria[0].supersedes).toEqual([historical[0].id]);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.disclosure)).toBe(true);
    if (result.status === 'accepted') expect(Object.isFrozen(result.binding)).toBe(true);
  });
  it.each(['source', 'proposal'])('invalidates %s changed during the request', async (kind) => {
    const { service, http } = harness(); const { packet, prepared } = fixture();
    http.mockImplementation(async () => {
      if (kind === 'source') packet.original.content = 'Changed'; else prepared.proposalFingerprint = 'changed';
      return response([1, 1, 1]);
    });
    const result = await service.review(packet, prepared);
    expect(result).toMatchObject({ reason: 'stale_input', status: 'needs_user' }); expect(result).not.toHaveProperty('binding');
  });
  it('transmits every full update with a shallow candidate and does not mutate input', async () => {
    const { service, http } = harness(); let { packet } = fixture();
    packet = appendGoalSource(packet, { messageId: 'user-2', sessionId: 'session-1', turnId: 'turn-2', content: 'Add contact.', createdAt: 2 });
    const prepared = prepareGoalProjection(packet, { sourceVersion: 2, criteria: [{ text: 'Build with contact', supersedes: [],
      sourceQuotes: [{ messageId: 'user-1', quote: 'Build' }, { messageId: 'user-2', quote: 'contact' }] }] });
    packet.projection = { status: 'pending', base: null, proposal: prepared }; const before = JSON.stringify(packet);
    expect((await service.review(packet, prepared)).status).toBe('accepted');
    expect(JSON.parse(String(http.mock.calls[0][1]?.body)).state.updates).toEqual(packet.updates);
    expect(JSON.stringify(packet)).toBe(before);
  });
  it.each(['before', 'settings', 'http'])('propagates abort at %s', async (stage) => {
    const { service, http, resolve } = harness(); const { packet, prepared } = fixture(); const abort = new AbortController();
    if (stage === 'before') abort.abort();
    if (stage === 'settings') resolve.mockImplementation(async () => { abort.abort(); return { endpoint: 'https://decision.invalid', model: 'jev', apiKey: '' }; });
    if (stage === 'http') http.mockImplementation(async () => { abort.abort(); return response(); });
    await expect(service.review(packet, prepared, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

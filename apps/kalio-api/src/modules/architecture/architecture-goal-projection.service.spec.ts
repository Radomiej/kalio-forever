import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArchitectureRun } from '@kalio/types';
import type { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { ArchitectureGoalRepository } from './architecture-goal.repository';
import { ArchitectureGoalLifecycleService } from './architecture-goal-lifecycle.service';
import type { ArchitectureGoalReviewService } from './architecture-goal-review.service';
import type { ArchitectureGoalAuditService } from './architecture-goal-audit.service';
import { createGoalPacket, appendGoalSource } from './architecture-goal-source';
import { prepareGoalProjection } from './architecture-goal-projection';
import { ArchitectureGoalProjectionService, type HostGoalPolicyFactory } from './architecture-goal-projection.service';

const clients: Database.Database[] = [];
afterEach(() => clients.splice(0).forEach(client => client.close()));
const original = { messageId: 'prompt', sessionId: 'host', turnId: 'turn', content: 'Build feature', createdAt: 1 };
const raw = { sourceVersion: 1, criteria: [{ text: 'Build feature', sourceQuotes: [{ messageId: 'prompt', quote: 'Build feature' }], supersedes: [] }] };
const run: ArchitectureRun = { id: 'run', rootSessionId: 'root', schemaId: 'schema', prompt: 'Model paraphrase', executionMode: 'session_branches', status: 'running', createdAt: 1, updatedAt: 1 };
const hostPolicy: HostGoalPolicyFactory = rows => ({ requiredEvidenceKindsByCriterion: Object.fromEntries(rows.map(row => [row.id, ['BUILD_RESULT']])) });
function fixture() {
  const client = new Database(':memory:'); clients.push(client);
  const db = drizzle(client, { schema });
  migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
  const repo = new ArchitectureGoalRepository({ db } as unknown as DrizzleService);
  repo.create({ runId: 'run', rootSessionId: 'root', packet: createGoalPacket(original), createdAt: 1, updatedAt: 1 });
  const lifecycle = new ArchitectureGoalLifecycleService(repo, { read: async () => null });
  const review = vi.fn<ArchitectureGoalReviewService['review']>(async (packet, proposal) => ({
    status: 'accepted', binding: { accepted: true, sourceVersion: packet.version, sourceFingerprint: packet.sourceFingerprint, proposalFingerprint: proposal.proposalFingerprint },
    probabilities: { source_complete: 1, scope_faithful: 1, supersession_valid: 1 }, disclosure: { transport: 'unchanged', attemptedRequestBytes: 100 },
  }));
  const persistRequired = vi.fn<ArchitectureGoalAuditService['persistRequired']>(async () => undefined);
  const service = new ArchitectureGoalProjectionService(lifecycle, repo, { persistRequired }, { review });
  return { repo, lifecycle, review, persistRequired, service };
}

describe('ArchitectureGoalProjectionService SQLite coordination (injected review; no LLM proof)', () => {
  it('persists pending proposal then reviewed acceptance with two required audit ACKs and detached policy targets', async () => {
    const { service, repo, persistRequired, review } = fixture();
    const before = structuredClone(run);
    const policy: HostGoalPolicyFactory = rows => {
      const result = hostPolicy(rows);
      rows[0]!.text = 'Mutated callback target';
      return result;
    };
    const result = await service.project(run, raw, 1, policy);
    expect(result.status).toBe('accepted');
    expect(result.state.stateRevision).toBe(3);
    expect(result.state.packet.projection.status).toBe('accepted');
    expect(persistRequired).toHaveBeenCalledTimes(2);
    expect(persistRequired.mock.calls[0]![1].packet.projection.status).toBe('pending');
    expect(review).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(repo.load('run')!.packet)).not.toContain('Mutated callback target');
    expect(run).toEqual(before);
    result.state.packet.original.content = 'Caller mutation';
    expect(repo.load('run')!.packet.original.content).toBe('Build feature');
  });
  it.each(['rejected', 'needs_user'] as const)('never writes accepted truth for %s review', async status => {
    const { service, repo, review, persistRequired } = fixture();
    review.mockResolvedValue(status === 'rejected'
      ? { status, probabilities: { source_complete: 0, scope_faithful: 1, supersession_valid: 1 }, disclosure: { transport: 'unchanged', attemptedRequestBytes: 100 } }
      : { status, reason: 'uncertain', disclosure: { transport: 'unchanged', attemptedRequestBytes: 100 } });
    const result = await service.project(run, raw, 1, hostPolicy);
    expect(result.status).toBe(status);
    expect(result.state.stateRevision).toBe(2);
    expect(repo.load('run')!.packet.projection.status).toBe('pending');
    expect(persistRequired).toHaveBeenCalledTimes(1);
  });
  it('does not invoke review until pending audit ACK, or return accepted before accepted audit ACK', async () => {
    const { service, repo, review, persistRequired } = fixture();
    let ack!: () => void;
    persistRequired.mockImplementation(() => new Promise<void>(resolve => { ack = resolve; }));
    let settled = false;
    const pending = service.project(run, raw, 1, hostPolicy).then(result => { settled = true; return result; });
    await Promise.resolve();
    expect(review).not.toHaveBeenCalled();
    expect(repo.load('run')!.packet.projection.status).toBe('pending');
    ack();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(repo.load('run')!.packet.projection.status).toBe('accepted');
    expect(settled).toBe(false);
    ack();
    expect((await pending).status).toBe('accepted');
  });
  it.each(['source', 'revision', 'proposal'] as const)('rejects a %s race while review is deferred without acceptance', async race => {
    const { service, repo, review } = fixture();
    let finish!: (value: Awaited<ReturnType<ArchitectureGoalReviewService['review']>>) => void;
    review.mockImplementation((packet, proposal) => new Promise(resolve => {
      finish = value => resolve(value);
      void packet; void proposal;
    }));
    const pending = service.project(run, raw, 1, hostPolicy);
    const rejection = expect(pending).rejects.toThrow(/^GOAL_PROJECTION_FAILED$/);
    await Promise.resolve(); await Promise.resolve();
    const state = repo.load('run')!;
    const packet = race === 'source'
      ? appendGoalSource(state.packet, { ...original, messageId: 'update', turnId: 'next', content: 'New goal', createdAt: 2 })
      : structuredClone(state.packet);
    if (race === 'proposal' && packet.projection.status === 'pending' && packet.projection.proposal) {
      packet.projection.proposal = prepareGoalProjection(packet, { ...raw, criteria: [{ ...raw.criteria[0]!, text: 'Build requested feature' }] });
    }
    repo.compareAndSwap('run', 2, { rootSessionId: 'root', packet, updatedAt: 2 });
    const args = review.mock.calls[0]!;
    finish({ status: 'accepted', binding: { accepted: true, sourceVersion: args[0].version, sourceFingerprint: args[0].sourceFingerprint, proposalFingerprint: args[1].proposalFingerprint },
      probabilities: { source_complete: 1, scope_faithful: 1, supersession_valid: 1 }, disclosure: { transport: 'unchanged', attemptedRequestBytes: 100 } });
    await rejection;
    expect(repo.load('run')!.packet.projection.status).toBe('pending');
  });
  it('rejects worker IDs/policy and malformed host policy without accepted storage', async () => {
    const { service, repo, review } = fixture();
    await expect(service.project(run, { ...raw, completionPolicy: {} }, 1, hostPolicy)).rejects.toThrow('GOAL_PROJECTION_FAILED');
    expect(repo.load('run')!.stateRevision).toBe(1);
    expect(review).not.toHaveBeenCalled();
    await expect(service.project(run, raw, 1, () => ({ requiredEvidenceKindsByCriterion: {} }))).rejects.toThrow('GOAL_PROJECTION_FAILED');
    expect(repo.load('run')!.packet.projection.status).toBe('pending');
  });
  it.each([1, 2])('fails on required audit #%s without leaking raw errors or claiming a receipt', async failureCall => {
    const { service, repo, review, persistRequired } = fixture();
    let calls = 0;
    persistRequired.mockImplementation(async () => { if (++calls === failureCall) throw new Error('secret canonical SQL'); });
    await expect(service.project(run, raw, 1, hostPolicy)).rejects.toThrow(/^GOAL_PROJECTION_FAILED$/);
    expect(repo.load('run')!.packet.projection.status).toBe(failureCall === 1 ? 'pending' : 'accepted');
    if (failureCall === 1) expect(review).not.toHaveBeenCalled();
  });
  it('honors stop before writes and after deferred review even if review returns accepted', async () => {
    const { service, repo, review } = fixture();
    const controller = new AbortController(); controller.abort(new Error('secret reason'));
    await expect(service.project(run, raw, 1, hostPolicy, controller.signal)).rejects.toThrow(/^GOAL_PROJECTION_FAILED$/);
    expect(repo.load('run')!.stateRevision).toBe(1);
    const live = new AbortController();
    const implementation = review.getMockImplementation()!;
    review.mockImplementation(async (...args) => { live.abort(new Error('secret reason')); return implementation(...args); });
    await expect(service.project(run, raw, 1, hostPolicy, live.signal)).rejects.toThrow(/^GOAL_PROJECTION_FAILED$/);
    expect(repo.load('run')!.packet.projection.status).toBe('pending');
  });
  it('rejects stale initial revision, foreign root and CAS conflict without retries', async () => {
    const { service, repo, review } = fixture();
    await expect(service.project(run, raw, 2, hostPolicy)).rejects.toThrow('GOAL_PROJECTION_FAILED');
    await expect(service.project({ ...run, rootSessionId: 'foreign' }, raw, 1, hostPolicy)).rejects.toThrow('GOAL_PROJECTION_FAILED');
    const cas = vi.spyOn(repo, 'compareAndSwap').mockImplementation(() => { throw new Error('secret SQL conflict'); });
    await expect(service.project(run, raw, 1, hostPolicy)).rejects.toThrow(/^GOAL_PROJECTION_FAILED$/);
    expect(cas).toHaveBeenCalledTimes(1);
    expect(review).not.toHaveBeenCalled();
  });
  it('does not manufacture an acceptance binding or accept a wrong review fingerprint', async () => {
    const { service, repo, review } = fixture();
    const implementation = review.getMockImplementation()!;
    review.mockImplementation(async (...args) => {
      const result = await implementation(...args);
      return result.status === 'accepted' ? { ...result, binding: { ...result.binding, proposalFingerprint: 'forged' } } : result;
    });
    await expect(service.project(run, raw, 1, hostPolicy)).rejects.toThrow(/^GOAL_PROJECTION_FAILED$/);
    expect(repo.load('run')!.stateRevision).toBe(2);
    expect(repo.load('run')!.packet.projection.status).toBe('pending');
  });
  it('handles an accepted-state CAS conflict without returning accepted or retrying', async () => {
    const { service, repo, persistRequired } = fixture();
    const implementation = repo.compareAndSwap.bind(repo);
    const cas = vi.spyOn(repo, 'compareAndSwap').mockImplementation((id, expected, next) => {
      if (expected === 2) throw new Error('secret SQL accepted conflict');
      return implementation(id, expected, next);
    });
    await expect(service.project(run, raw, 1, hostPolicy)).rejects.toThrow(/^GOAL_PROJECTION_FAILED$/);
    expect(cas).toHaveBeenCalledTimes(2);
    expect(repo.load('run')!.packet.projection.status).toBe('pending');
    expect(persistRequired).toHaveBeenCalledTimes(1);
  });
});

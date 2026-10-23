import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import type { ArchitectureRun } from '@kalio/types';
import type { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { AuditService } from '../chat/audit.service';
import type { AuditLogInput } from '../chat/audit.service';
import type { ArchitectureGoalState } from './architecture-goal.repository';
import { ArchitectureGoalAuditService } from './architecture-goal-audit.service';
import { createGoalPacket } from './architecture-goal-source';

const run: Pick<ArchitectureRun, 'id' | 'rootSessionId' | 'schemaId'> = { id: 'run', rootSessionId: 'root', schemaId: 'schema' };
function state(): ArchitectureGoalState {
  const packet = createGoalPacket({ messageId: 'message', sessionId: 'host', turnId: 'turn',
    content: 'secret raw goal', createdAt: 1 });
  // Disclosure stays allowlisted even if the canonical packet carries heavy sensitive fields.
  packet.projection = { status: 'accepted', snapshot: { sourceVersion: 1, goalFingerprint: 'goal-hash',
    criteria: [{ id: 'criterion', text: 'secret criterion', sourceQuotes: [{ messageId: 'message', quote: 'secret quote' }], supersedes: [] }] } };
  packet.completionPolicy = { requiredEvidenceKindsByCriterion: { criterion: ['BUILD_RESULT'] } };
  return { runId: 'run', rootSessionId: 'root', stateRevision: 3, packet, createdAt: 1, updatedAt: 2,
    evidenceInventory: null, completionAuthorization: null };
}

function writer(logRequired: (id: string, input: AuditLogInput) => Promise<void>) {
  return new ArchitectureGoalAuditService({ logRequired } as unknown as AuditService);
}

describe('ArchitectureGoalAuditService', () => {
  it('awaits durable acknowledgement and sends exactly the allowlisted metadata', async () => {
    let acknowledge: () => void = () => { throw new Error('No pending acknowledgement'); };
    const acknowledgement = new Promise<void>(resolve => { acknowledge = resolve; });
    const logRequired = vi.fn((_id: string, _input: AuditLogInput) => acknowledgement);
    const current = state();
    let completed = false;
    let failure: unknown;
    const persisted = writer(logRequired).persistRequired(run, current).then(
      () => { completed = true; }, error => { failure = error; },
    );
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(logRequired).toHaveBeenCalledWith('run:goal-state:3', {
      sessionId: 'root', type: 'architecture_event', label: 'architecture_event:goal_protocol',
      data: { domain: 'architecture', kind: 'architecture_event', eventType: 'goal_protocol', schemaVersion: 1,
        runId: 'run', rootSessionId: 'root', schemaId: 'schema', stateRevision: 3, sourceVersion: 1,
        projectionStatus: 'accepted', sourceFingerprint: current.packet.sourceFingerprint,
        goalFingerprint: 'goal-hash', sourceMessageIds: ['message'] },
    });
    expect(JSON.stringify(logRequired.mock.calls)).not.toContain('secret');
    acknowledge();
    await persisted;
    expect(failure).toBeUndefined();
    expect(completed).toBe(true);
  });

  it('records pending with null goal fingerprint and source message IDs only', async () => {
    const current = state();
    current.packet.projection = { status: 'pending', base: null, proposal: { sourceVersion: 1,
      criteria: [{ text: 'secret proposal', sourceQuotes: [{ messageId: 'message', quote: 'secret quote' }], supersedes: [] }], proposalFingerprint: 'proposal-hash' } };
    current.packet.updates = [{ ...current.packet.original, messageId: 'update', content: 'secret update' }];
    current.packet.version = 2;
    const logRequired = vi.fn(async (_id: string, _input: AuditLogInput) => undefined);
    await writer(logRequired).persistRequired(run, current);
    expect(logRequired.mock.calls[0]?.[1].data).toMatchObject({ projectionStatus: 'pending',
      goalFingerprint: null, sourceVersion: 2, sourceMessageIds: ['message', 'update'] });
    expect(JSON.stringify(logRequired.mock.calls)).not.toContain('secret');
    expect(JSON.stringify(logRequired.mock.calls)).not.toContain('proposal-hash');
  });

  it.each([{ ...run, id: 'foreign' }, { ...run, rootSessionId: 'foreign' }, { ...run, rootSessionId: undefined }])(
    'rejects mismatched run/root before any write', async mismatch => {
      const logRequired = vi.fn(async (_id: string, _input: AuditLogInput) => undefined);
      await expect(writer(logRequired).persistRequired(mismatch, state())).rejects.toThrow('GOAL_AUDIT_STATE_MISMATCH');
      expect(logRequired).not.toHaveBeenCalled();
    },
  );

  it('fails closed when required audit dependency is missing', async () => {
    await expect(new ArchitectureGoalAuditService().persistRequired(run, state())).rejects.toThrow('GOAL_AUDIT_UNAVAILABLE');
  });

  it('does not expose driver errors or raw content on write failure', async () => {
    const logRequired = vi.fn(async (_id: string, _input: AuditLogInput) => { throw new Error('secret raw goal: driver parameters'); });
    await expect(writer(logRequired).persistRequired(run, state())).rejects.toThrow(/^GOAL_AUDIT_WRITE_FAILED$/);
  });

  it('uses a stable idempotent checkpoint key with real SQLite AuditService', async () => {
    const client = new Database(':memory:');
    try {
      const db = drizzle(client, { schema });
      migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
      const audit = new AuditService({ db } as unknown as DrizzleService);
      const service = new ArchitectureGoalAuditService(audit);
      await service.persistRequired(run, state());
      await service.persistRequired(run, state());
      const rows = client.prepare('SELECT id, data FROM audit_log').all() as { id: string; data: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe('run:goal-state:3');
      expect(rows[0]?.data).not.toContain('secret');
      const conflict = state();
      conflict.packet.sourceFingerprint = 'different';
      await expect(service.persistRequired(run, conflict)).rejects.toThrow(/^GOAL_AUDIT_WRITE_FAILED$/);
      expect(client.prepare('SELECT id, data FROM audit_log').all()).toEqual(rows);
    } finally { client.close(); }
  });
});

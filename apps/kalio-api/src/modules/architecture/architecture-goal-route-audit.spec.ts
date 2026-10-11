import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import type { ArchitectureExecutionEvent, ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import { AuditService } from '../chat/audit.service';
import type { SessionsService } from '../chat/sessions.service';
import type { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { ArchitectureRuntimeAuditWriterService } from './architecture-runtime-audit.service';
import { ArchitectureRuntimeAuditRecoveryService } from './architecture-runtime-audit-recovery.service';
import { architectureAuditAutoRoutingData } from './architecture-runtime-audit-recovery.utils';

const fingerprint = 'a'.repeat(64);
function metadata() {
  return {
    goalBinding: { stateRevision: 3, sourceVersion: 1, sourceFingerprint: fingerprint },
    completionBinding: { goalVersion: 1, goalFingerprint: fingerprint, sourceFingerprint: fingerprint,
      evidenceFingerprint: fingerprint, policyFingerprint: fingerprint },
    criterionId: `c-${fingerprint}`,
  };
}
async function write(data: Record<string, unknown>, goalStop = false) {
  const logRequired = vi.fn(async (_id: string, _input: unknown) => undefined);
  const writer = new ArchitectureRuntimeAuditWriterService({ logRequired } as unknown as AuditService);
  await writer.logRouteDecisionRequired({ id: 'schema' } as ArchitectureSchema,
    { id: 'run', schemaId: 'schema', prompt: 'Goal', executionMode: 'subagent_execution',
      status: 'running', createdAt: 1, updatedAt: 1, rootSessionId: 'root',
      context: { parentSessionId: 'human-source', ...(goalStop ? { goalProtocol: true } : {}) } },
    { id: 'event', runId: 'run', sequence: 4, createdAt: 1,
      type: goalStop ? 'run_stopped' : 'router_decision', nodeId: 'judge',
      message: 'Goal host branch selected.', data: { pendingNodeIds: ['worker'], visitCounts: { worker: 1, judge: 1 }, ...data },
      route: { source: 'runtime_fallback', fromNodeId: 'judge', selectedNodeIds: ['worker'], nextNodeId: 'worker' },
    } as ArchitectureExecutionEvent, 'opaque-checkpoint');
  // The SQLite JSON column omits undefined legacy fields before recovery reads it.
  return JSON.parse(JSON.stringify(logRequired.mock.calls[0]?.[1])) as { sessionId: string; data: Record<string, unknown> };
}

describe('goal route audit persistence boundary', () => {
  it('marks required goal stop proof without replacing its lifecycle type', async () => {
    const saved = await write({}, true);
    expect(saved.sessionId).toBe('root');
    expect(saved.data).toMatchObject({ goalProtocol: true, eventType: 'run_stopped' });
  });
  it('does not mark legacy routing as goal proof', async () => {
    const saved = await write({});
    expect(saved.sessionId).toBe('human-source');
    expect(saved.data).not.toHaveProperty('goalProtocol');
  });
  it('owns required goal route proof under internal root, not human source session', async () => {
    expect((await write(metadata())).sessionId).toBe('root');
  });
  it('round-trips full bindings through real SQLite audit and a fresh recovery instance', async () => {
    const client = new Database(':memory:');
    try {
      const db = drizzle(client, { schema });
      migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
      const audit = new AuditService({ db } as unknown as DrizzleService);
      const writer = new ArchitectureRuntimeAuditWriterService(audit);
      const data = metadata();
      await writer.logRouteDecisionRequired({ id: 'schema' } as ArchitectureSchema,
        { id: 'run', rootSessionId: 'root' } as ArchitectureRun,
        { id: 'event', runId: 'run', sequence: 4, createdAt: 1, type: 'router_decision', nodeId: 'judge',
          message: 'Goal host branch selected.', data: { ...data, pendingNodeIds: ['worker'], visitCounts: { judge: 1 } },
          route: { source: 'runtime_fallback', fromNodeId: 'judge', selectedNodeIds: ['worker'], nextNodeId: 'worker' },
        } as ArchitectureExecutionEvent, 'opaque-checkpoint');
      await writer.logRouteDecisionRequired({ id: 'schema' } as ArchitectureSchema,
        { id: 'run', schemaId: 'schema', prompt: 'Goal', executionMode: 'subagent_execution',
          status: 'cancelled', createdAt: 1, updatedAt: 1, rootSessionId: 'root',
          context: { parentSessionId: 'human-source', goalProtocol: true } },
        { id: 'stop-event', runId: 'run', sequence: 5, createdAt: 2,
          type: 'run_stopped', message: 'Stopped.', status: 'cancelled' }, 'stop-checkpoint');
      const proof = await audit.readGoalProofExact({ id: 'stop-checkpoint', runId: 'run',
        rootSessionId: 'root', label: 'architecture_event:run_stopped:runtime' });
      expect(proof.data).toMatchObject({ goalProtocol: true, eventType: 'run_stopped' });
      await expect(audit.update('stop-checkpoint', { data: {} })).rejects.toThrow('AUDIT_PROOF_IMMUTABLE');
      data.goalBinding.stateRevision = 99;
      const recovery = new ArchitectureRuntimeAuditRecoveryService({} as SessionsService, audit);
      const events = await recovery.reconstructEvents('run');
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ id: 'event', nodeId: 'judge', sequence: 4, data: {
        ...metadata(), pendingNodeIds: ['worker'], visitCounts: { judge: 1 },
      } });
    } finally { client.close(); }
  });

  it('preserves exact full typed bindings through required write and recovery', async () => {
    const data = metadata();
    const saved = await write(data);
    expect(saved.data).toMatchObject(data);
    expect(architectureAuditAutoRoutingData(saved.data)).toMatchObject({ ...data, pendingNodeIds: ['worker'], nodeId: 'judge' });
    data.goalBinding.stateRevision = 99;
    expect(saved.data.goalBinding).toMatchObject({ stateRevision: 3 });
    expect(saved.data).not.toHaveProperty('prompt');
  });

  it.each([
    { ...metadata(), goalBinding: { ...metadata().goalBinding, stateRevision: 0 } },
    { ...metadata(), goalBinding: { ...metadata().goalBinding, sourceFingerprint: 'invalid' } },
    { ...metadata(), goalBinding: { ...metadata().goalBinding, rawGoal: 'private' } },
    { ...metadata(), completionBinding: { ...metadata().completionBinding, goalVersion: 2 } },
    { ...metadata(), completionBinding: { ...metadata().completionBinding, evidenceFingerprint: '' } },
    { ...metadata(), completionBinding: { ...metadata().completionBinding, accepted: true } },
    { ...metadata(), criterionId: '' },
    { criterionId: 'criterion' },
  ])('rejects malformed metadata in the required writer and recovery', async data => {
    await expect(write(data)).rejects.toThrow('GOAL_ROUTE_AUDIT_INVALID');
    expect(() => architectureAuditAutoRoutingData(data)).toThrow('GOAL_ROUTE_AUDIT_INVALID');
  });

  it('does not invoke getter-bearing goal bindings', async () => {
    const getter = vi.fn(() => metadata().goalBinding);
    const data = Object.defineProperty({}, 'goalBinding', { enumerable: true, get: getter });
    expect(() => architectureAuditAutoRoutingData(data)).toThrow('GOAL_ROUTE_AUDIT_INVALID');
    expect(getter).not.toHaveBeenCalled();
  });

  it('keeps legacy non-goal metadata unchanged', () => {
    const old = { eventType: 'participant_output', messagePreview: 'Legacy' };
    expect(architectureAuditAutoRoutingData(old)).toEqual(old);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import type { ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import type { DrizzleService } from '../../database/drizzle.service';
import * as tables from '../../database/schema';
import { AuditService } from '../chat/audit.service';
import type { SessionsService } from '../chat/sessions.service';
import type { SessionManagerService } from '../chat/session-manager.service';
import { ArchitectureGoalRepository } from './architecture-goal.repository';
import { createGoalPacket } from './architecture-goal-source';
import { acceptGoalProjection, goalProjectionPolicyTargets, prepareGoalProjection } from './architecture-goal-projection';
import { ArchitectureRegistryService } from './architecture-registry.service';
import { DEVIN_JEV_GOAL_LOOP } from './architecture-seed-schemas.devin-jev';
import { ArchitectureRuntimeService } from './architecture-runtime.service';
import type { ArchitectureRoleExecutor } from './architecture-role-executor';
import type { ArchitectureRunPreparationService } from './architecture-run-preparation.service';
import type { ArchitectureRuntimeChatProjectionService } from './architecture-runtime-chat-projection.service';

const clients: Database.Database[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.close()); });

describe('actual ArchitectureRuntimeService accepted-goal entry', () => {
  it('starts the accepted canonical goal worker through public createRun', async () => {
    const client = new Database(':memory:'); clients.push(client);
    const db = drizzle(client, { schema: tables });
    migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
    const dependency = { db } as unknown as DrizzleService;
    const repository = new ArchitectureGoalRepository(dependency);
    const audit = new AuditService(dependency);
    const pending = createGoalPacket({ messageId: 'human', sessionId: 'host', turnId: 'human-turn',
      content: 'Build the approved home site.', createdAt: 1 });
    const proposal = prepareGoalProjection(pending, { sourceVersion: 1, criteria: [
      { text: 'Build the approved home site', sourceQuotes: [{ messageId: 'human', quote: 'Build the approved home site' }], supersedes: [] },
    ] });
    pending.projection = { status: 'pending', base: null, proposal };
    const criterionId = goalProjectionPolicyTargets(pending, proposal)[0]!.id;
    const packet = acceptGoalProjection(pending, proposal,
      { requiredEvidenceKindsByCriterion: { [criterionId]: ['BUILD_RESULT', 'QUALITY_GATE'] } },
      { sourceVersion: 1, sourceFingerprint: pending.sourceFingerprint, proposalFingerprint: proposal.proposalFingerprint, accepted: true });
    repository.create({ runId: 'goal-entry', rootSessionId: 'root', packet, createdAt: 1, updatedAt: 1 });
    const stored = repository.load('goal-entry', 'root')!;
    expect(stored.packet.projection.status).toBe('accepted');
    expect(stored.evidenceInventory).toBeNull();
    expect(stored.completionAuthorization).toBeNull();

    const registry = new ArchitectureRegistryService();
    const schema: ArchitectureSchema = structuredClone(DEVIN_JEV_GOAL_LOOP);
    const run: ArchitectureRun = { id: 'goal-entry', rootSessionId: 'root', schemaId: schema.id,
      prompt: stored.packet.original.content, goalPacket: stored.packet, context: { goalProtocol: 1 },
      executionMode: 'subagent_execution', branchSessionIds: { worker: 'worker-session', judge: 'judge-session' },
      status: 'running', createdAt: 1, updatedAt: 1 };
    // Deterministic execution boundary only: no fabricated receipt, evidence, judge or completion authority.
    const execute = vi.fn<ArchitectureRoleExecutor['execute']>(async () => {
      throw new Error('Worker entered; host receipt composition is the next production tranche');
    });
    // Reuse runtime.jev's prepared-run/projection boundary; graph and audit stay real.
    // This first regression targets executePreparedRun, not admission/preparation or Nest DI.
    const runtime = new ArchitectureRuntimeService(registry, {} as SessionsService, {} as SessionManagerService,
      { execute }, audit, undefined, undefined, undefined,
      { prepareRun: async () => ({ schema, run, hydration: null }) } as unknown as ArchitectureRunPreparationService,
      undefined, undefined,
      { persistParent: async () => undefined, persistParentSafely: async () => undefined } as unknown as ArchitectureRuntimeChatProjectionService);

    const result = await runtime.createRun({ schemaId: schema.id, prompt: run.prompt, executionMode: 'subagent_execution', context: { goalProtocol: 1 } });
    const events = runtime.getEvents(run.id);
    expect(db.select().from(tables.auditLog).all().length).toBeGreaterThan(0);
    expect(execute.mock.calls.filter(([input]) => input.node?.id === 'devin-worker'),
      `Actual runtime ended ${result.status}/${result.errorCode}; events: ${events.map(event => `${event.type}:${event.message}`).join(' | ')}`,
    ).toHaveLength(1);
  });
});

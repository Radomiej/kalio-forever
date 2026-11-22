import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import type { ArchitectureExecutionEvent, ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import type { DrizzleService } from '../../database/drizzle.service';
import * as databaseSchema from '../../database/schema';
import { AuditService } from '../chat/audit.service';
import type { SessionsService } from '../chat/sessions.service';
import { ArchitectureRuntimeAuditWriterService } from './architecture-runtime-audit.service';
import { ArchitectureRuntimeAuditRecoveryService } from './architecture-runtime-audit-recovery.service';
import { assertSavedStatusRoutingDecision, statusRoutingDecision } from './architecture-status-routing';
import { recoverAutoRoutingCursor } from './architecture-runtime-auto-routing-recovery.utils';

function fixture(): ArchitectureSchema {
  return {
    id: 'status-audit', name: 'Status audit', description: '', version: '1',
    roleSlots: [{ id: 'worker', label: 'Worker', description: '', slotType: 'participant',
      defaultPersonaId: 'p', allowedPersonaTags: [], required: true, canOverrideAtRunStart: true }],
    nodes: [
      { id: 'worker', kind: 'role', label: 'Worker', roleSlotId: 'worker' },
      { id: 'if', kind: 'status_router', label: 'If', statusRouting: { sourceNodeId: 'worker', expectedStatus: 'completed' } },
      { id: 'yes', kind: 'parallel', label: 'Yes' }, { id: 'no', kind: 'parallel', label: 'No' },
    ],
    edges: [
      { id: 'in', fromNodeId: 'worker', toNodeId: 'if' },
      { id: 'yes-edge', fromNodeId: 'if', toNodeId: 'yes', selection: 'choice' },
      { id: 'no-edge', fromNodeId: 'if', toNodeId: 'no', selection: 'default' },
    ],
    routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: true, canReturnNeedsMoreResearch: true },
    contextPolicy: { includeUserTask: true, includeProjectMemory: false, includeBrowserSession: false, includePriorDecisions: false },
    memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true }, outputArtifactSchema: 'markdown',
  };
}

function event(sequence: number, type: ArchitectureExecutionEvent['type'], patch: Partial<ArchitectureExecutionEvent> = {}): ArchitectureExecutionEvent {
  return { id: `opaque/${sequence}`, runId: 'run', sequence, type, nodeId: 'worker',
    message: 'Display text is not evidence', createdAt: sequence, ...patch };
}

describe('status routing real SQLite audit reload', () => {
  it.each([
    { recoveredFailure: false, stopped: false }, { recoveredFailure: true, stopped: false },
    { recoveredFailure: false, stopped: true }, { recoveredFailure: true, stopped: true },
  ])('preserves full source binding and branch, %j', async ({ recoveredFailure, stopped }) => {
    const client = new Database(':memory:');
    try {
      const db = drizzle(client, { schema: databaseSchema });
      migrate(db, { migrationsFolder: resolve(__dirname, '../../database/migrations') });
      const dependency = { db } as unknown as DrizzleService;
      const audit = new AuditService(dependency);
      const writes = vi.spyOn(audit, 'log');
      const writer = new ArchitectureRuntimeAuditWriterService(audit);
      const schema = fixture();
      const run: ArchitectureRun = { id: 'run', schemaId: schema.id, rootSessionId: 'root', prompt: 'Test',
        executionMode: 'subagent_execution', status: 'running', createdAt: 1, updatedAt: 1 };
      const source = [event(1, 'node_started')];
      if (recoveredFailure) source.push(event(2, 'participant_output', {
        errorCode: 'TIMEOUT', failure: { code: 'TIMEOUT', message: 'Provider timeout', retryable: true },
        data: { runtimeGuard: 'recoverable_node_error', incompleteReason: 'No final answer' },
      }));
      source.push(event(3, 'node_completed'), event(4, 'node_started', { nodeId: 'if' }));
      const decision = statusRoutingDecision(schema, schema.nodes[1]!, source, run.id);
      const selected = [decision.edge.toNodeId];
      const checkpoint = event(5, 'router_decision', {
        id: 'durable-route:event', nodeId: 'if',
        route: { source: 'status_condition', fromNodeId: 'if', selectedEdgeId: decision.edge.id,
          selectedNodeIds: selected, rejectedNodeIds: [recoveredFailure ? 'yes' : 'no'], nextNodeId: selected[0] },
        data: { kind: 'auto_routing_decision', autoRoutingVisit: 1, selectedEdgeId: decision.edge.id,
          selectedNodeIds: selected, pendingNodeIds: selected, visitCounts: { worker: 1, if: 1 },
          statusRoutingDecision: { ...decision.binding } },
      });
      source.forEach(row => writer.logEvent(schema, run, row));
      await Promise.all(writes.mock.results.map(result => result.value));
      await writer.logRouteDecisionRequired(schema, run, checkpoint, 'durable-route');
      // Later source history must not rebind the first persisted router decision.
      writer.logEvent(schema, run, event(6, 'node_started'));
      writer.logEvent(schema, run, event(7, recoveredFailure ? 'node_completed' : 'node_failed'));
      if (stopped) writer.logEvent(schema, run, event(8, 'run_stopped', {
        nodeId: undefined, status: 'cancelled', lifecycle: 'cancelled',
      }));
      await Promise.all(writes.mock.results.map(result => result.value));
      const freshAudit = new AuditService(dependency);
      const reader = new ArchitectureRuntimeAuditRecoveryService(
        { listChildren: vi.fn().mockResolvedValue([]) } as unknown as SessionsService, freshAudit,
      );
      const loaded = await reader.reconstructEvents(run.id);
      if (stopped) expect(await reader.reconstructRun(run.id)).toMatchObject({ status: 'cancelled' });
      const saved = loaded.find(row => row.id === checkpoint.id)!;
      expect(saved.route).toEqual(checkpoint.route);
      expect(saved.data).toMatchObject(checkpoint.data!);
      expect(saved.data?.statusRoutingDecision).toEqual(decision.binding);
      if (recoveredFailure) {
        expect(loaded.find(row => row.id === 'opaque/2')).toMatchObject({
          errorCode: 'TIMEOUT', failure: source[1]!.failure,
          data: { runtimeGuard: 'recoverable_node_error', incompleteReason: 'No final answer' },
        });
      }
      const prefix = loaded.filter(row => row.sequence < saved.sequence);
      expect(assertSavedStatusRoutingDecision(schema, saved, prefix).id).toBe(decision.edge.id);
      expect(statusRoutingDecision(schema, schema.nodes[1]!, prefix, run.id).binding).toEqual(decision.binding);
      expect(recoverAutoRoutingCursor(schema, loaded)).toMatchObject({ pendingNodeIds: selected, visitCounts: { if: 1 } });
      expect(() => assertSavedStatusRoutingDecision(schema, {
        ...saved, data: { ...saved.data, statusRoutingDecision: { ...decision.binding, sourceStartedEventId: 'wrong-visit' } },
      }, prefix)).toThrow('source visit');
      const changed = fixture();
      changed.nodes[1]!.statusRouting!.expectedStatus = 'failed';
      expect(() => recoverAutoRoutingCursor(changed, loaded)).toThrow('source visit');
    } finally { client.close(); }
  });
});

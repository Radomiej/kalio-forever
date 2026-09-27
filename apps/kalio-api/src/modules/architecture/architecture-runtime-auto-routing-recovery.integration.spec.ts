import type { ArchitectureExecutionEvent, ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../chat/audit.service';
import type { SessionsService } from '../chat/sessions.service';
import { ArchitectureRuntimeAuditRecoveryService } from './architecture-runtime-audit-recovery.service';
import { ArchitectureRuntimeAuditWriterService } from './architecture-runtime-audit.service';
import { recoverAutoRoutingCursor } from './architecture-runtime-auto-routing-recovery.utils';

describe('Auto-routing durable recovery', () => {
  it('reconstructs the audit writer checkpoint shape and restores the selected edge', async () => {
    const rows: Array<Record<string, unknown>> = [];
    const audit = {
      logRequired: vi.fn(async (id: string, entry: { sessionId: string; type: string; label: string; data?: Record<string, unknown> }) => {
        rows.push({ id, ...entry, createdAt: 3 });
      }),
      listEntries: vi.fn(async (query: { limit: number; offset?: number }) => {
        const ordered = [...rows].sort((left, right) => (
          Number(right['createdAt']) - Number(left['createdAt'])
          || String(right['id']).localeCompare(String(left['id']))
        ));
        return ordered.slice(query.offset ?? 0, (query.offset ?? 0) + query.limit).reverse();
      }),
    };
    const schema: ArchitectureSchema = {
      id: 'schema',
      name: 'Auto-routing recovery',
      description: '',
      version: '1',
      roleSlots: [],
      nodes: [
        { id: 'auto', label: 'Auto-routing', kind: 'auto_router' },
        { id: 'agent', label: 'Agent', kind: 'artifact' },
        { id: 'default', label: 'Default', kind: 'artifact' },
      ],
      edges: [
        { id: 'edge-agent', fromNodeId: 'auto', toNodeId: 'agent', selection: 'choice' },
        { id: 'edge-default', fromNodeId: 'auto', toNodeId: 'default', selection: 'default' },
      ],
      routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: false, canReturnNeedsMoreResearch: false },
      contextPolicy: { includeUserTask: true, includeProjectMemory: false, includeBrowserSession: false, includePriorDecisions: false },
      memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true },
      outputArtifactSchema: 'markdown',
    };
    const run: ArchitectureRun = {
      id: 'run', schemaId: schema.id, prompt: 'Choose a branch.', executionMode: 'session_branches', status: 'running', createdAt: 1, updatedAt: 1,
    };
    const event: ArchitectureExecutionEvent = {
      id: 'architecture-route:run:auto:1:event',
      runId: run.id,
      sequence: 3,
      type: 'router_decision',
      nodeId: 'auto',
      message: 'Selected Agent.',
      route: { source: 'jev_choice', fromNodeId: 'auto', selectedNodeIds: ['agent'], nextNodeId: 'agent', selectedEdgeId: 'edge-agent', confidence: 0.93, decisionReason: 'confidence_met' },
      data: { kind: 'auto_routing_decision', autoRoutingVisit: 1, selectedEdgeId: 'edge-agent', pendingNodeIds: ['agent'], visitCounts: { auto: 1 } },
      createdAt: 3,
    };
    const writer = new ArchitectureRuntimeAuditWriterService(audit as unknown as AuditService);
    await writer.logRouteDecisionRequired(schema, run, event, 'architecture-route:run:auto:1');
    for (let index = 0; index < 5_000; index += 1) {
      rows.push({
        id: `later-${index}`,
        sessionId: 'session-1',
        type: 'architecture_event',
        label: `architecture_event:participant_output:${index}`,
        data: {
          kind: 'architecture_event',
          runId: run.id,
          architectureRunId: run.id,
          eventId: `run:event:${index + 1}`,
          eventType: 'participant_output',
          sequence: index + 4,
          nodeId: 'agent',
          messagePreview: 'Later event.',
        },
        createdAt: index + 4,
      });
    }
    const recovery = new ArchitectureRuntimeAuditRecoveryService(
      { listChildren: vi.fn().mockResolvedValue([]) } as unknown as SessionsService,
      audit as unknown as AuditService,
    );

    const reconstructed = await recovery.reconstructEvents(run.id);

    expect(reconstructed).toHaveLength(5_001);
    expect(reconstructed.find((candidate) => candidate.type === 'router_decision')?.data).toMatchObject({
      kind: 'architecture_event',
      eventType: 'router_decision',
      autoRoutingVisit: 1,
      selectedEdgeId: 'edge-agent',
      pendingNodeIds: ['agent'],
    });
    expect(recoverAutoRoutingCursor(schema, reconstructed)).toMatchObject({
      reason: 'runtime_recovery',
      pendingNodeIds: ['agent'],
      visitCounts: { auto: 1 },
    });
    expect(audit.listEntries).toHaveBeenCalledTimes(2);
    expect(audit.listEntries).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 5_000 }));
  });
});

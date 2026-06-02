import type { ArchitectureRoleExecutor } from './architecture-role-executor';
import type { ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import { describe, expect, it, vi } from 'vitest';
import { createArchitectureGraphEvents } from './architecture-graph-runtime';

describe('createArchitectureGraphEvents max visit guards', () => {
  it('pauses on a selected return-to-orchestrator edge instead of executing the next node', async () => {
    const schema: ArchitectureSchema = {
      id: 'return-to-orchestrator-runtime',
      name: 'Return To Orchestrator Runtime',
      description: 'Schema that pauses before rerunning implementer.',
      version: '0.1.0',
      roleSlots: [
        {
          id: 'goal_master',
          label: 'Goal Master',
          description: 'Routes back for another implementation pass.',
          slotType: 'judge',
          defaultPersonaId: 'orchestrator',
          allowedPersonaTags: ['review'],
          required: true,
          canOverrideAtRunStart: true,
        },
        {
          id: 'implementer',
          label: 'Implementer',
          description: 'Should not run until the orchestrator resumes the flow.',
          slotType: 'participant',
          defaultPersonaId: 'dev',
          allowedPersonaTags: ['implementation'],
          required: true,
          canOverrideAtRunStart: true,
        },
      ],
      nodes: [
        { id: 'goal-master', label: 'Goal Master', kind: 'router', roleSlotId: 'goal_master', behavior: { mode: 'choose_one' } },
        { id: 'implementer', label: 'Implementer', kind: 'role', roleSlotId: 'implementer' },
      ],
      edges: [
        {
          id: 'goal-master-implementer',
          fromNodeId: 'goal-master',
          toNodeId: 'implementer',
          returnToOrchestrator: true,
        },
      ],
      routerPolicy: {
        mode: 'evidence_first',
        mustAddressCriticFindings: true,
        canReturnNeedsMoreResearch: true,
      },
      contextPolicy: {
        includeUserTask: true,
        includeProjectMemory: false,
        includeBrowserSession: false,
        includePriorDecisions: false,
      },
      memoryPolicy: {
        persistFinalArtifact: true,
        persistRouterDecision: true,
      },
      outputArtifactSchema: 'runtime-test',
    };
    const run: ArchitectureRun = {
      id: 'run-return-to-orchestrator',
      schemaId: schema.id,
      prompt: 'Pause after Goal Master routes back.',
      executionMode: 'subagent_execution',
      context: { enableReturnToOrchestratorPause: true, maxArchitectureSteps: 10 },
      rootSessionId: 'root-return-to-orchestrator',
      branchSessionIds: {
        goal_master: 'arch-run-return-goal-master',
        implementer: 'arch-run-return-implementer',
      },
      status: 'running',
      createdAt: 100,
      updatedAt: 100,
    };
    const roleExecutor: ArchitectureRoleExecutor = {
      execute: vi.fn(async ({ slot }) => {
        if (slot.id === 'implementer') {
          return {
            message: 'Implementer should not run before resume.',
            data: {},
          };
        }
        return {
          message: 'Goal Master requires another implementation pass.',
          data: {
            routeToNodeId: 'implementer',
            response: 'needs another pass',
          },
        };
      }),
    };

    const events = await createArchitectureGraphEvents({
      schema,
      run,
      now: run.createdAt,
      roleExecutor,
      personaForSlot: () => 'dev',
    });

    expect(roleExecutor.execute).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'router_decision',
      message: expect.stringContaining('returned control to the orchestrator'),
      nodeId: 'goal-master',
      data: expect.objectContaining({
        pendingNodeIds: ['implementer'],
        returnToOrchestrator: true,
        visitCounts: { 'goal-master': 1 },
      }),
    }));
  });

  it('emits a terminal guard event when maxNodeVisits prevents a routed continuation', async () => {
    const schema: ArchitectureSchema = {
      id: 'self-looping-runtime',
      name: 'Self Looping Runtime',
      description: 'Schema that loops until node visits are exhausted.',
      version: '0.1.0',
      roleSlots: [{
        id: 'worker',
        label: 'Worker',
        description: 'Loops back to itself.',
        slotType: 'participant',
        defaultPersonaId: 'dev',
        allowedPersonaTags: ['implementation'],
        required: true,
        canOverrideAtRunStart: true,
      }],
      nodes: [{
        id: 'worker',
        label: 'Worker',
        kind: 'role',
        roleSlotId: 'worker',
      }],
      edges: [{
        id: 'worker-worker',
        fromNodeId: 'worker',
        toNodeId: 'worker',
      }],
      routerPolicy: {
        mode: 'evidence_first',
        mustAddressCriticFindings: true,
        canReturnNeedsMoreResearch: true,
      },
      contextPolicy: {
        includeUserTask: true,
        includeProjectMemory: false,
        includeBrowserSession: false,
        includePriorDecisions: false,
      },
      memoryPolicy: {
        persistFinalArtifact: true,
        persistRouterDecision: true,
      },
      outputArtifactSchema: 'runtime-test',
    };
    const run: ArchitectureRun = {
      id: 'run-max-visits',
      schemaId: schema.id,
      prompt: 'Loop once then hit visit cap.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureSteps: 10,
        maxArchitectureNodeVisits: 1,
      },
      rootSessionId: 'root-run-max-visits',
      branchSessionIds: { worker: 'arch-run-max-visits-worker' },
      status: 'running',
      createdAt: 100,
      updatedAt: 100,
    };
    const roleExecutor: ArchitectureRoleExecutor = {
      execute: vi.fn(async ({ branchSessionId, personaId, run: activeRun, slot }) => ({
        message: 'Worker needs another pass. route_to(worker, continue)',
        data: {
          branchSessionId,
          personaId,
          rootSessionId: activeRun.rootSessionId,
          slotType: slot.slotType,
          executionMode: activeRun.executionMode,
          routeToNodeId: 'worker',
          response: 'continue',
        },
      })),
    };

    const events = await createArchitectureGraphEvents({
      schema,
      run,
      now: run.createdAt,
      roleExecutor,
      personaForSlot: () => 'dev',
    });

    expect(events).toContainEqual(expect.objectContaining({
      type: 'router_decision',
      message: expect.stringContaining('max node visits'),
      data: expect.objectContaining({
        maxNodeVisits: 1,
        pendingNodeIds: ['worker'],
        visitCounts: { worker: 1 },
      }),
    }));
  });
});

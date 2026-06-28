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
      reasonCode: 'return_to_orchestrator',
      data: expect.objectContaining({
        reasonCode: 'return_to_orchestrator',
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
        message: 'Worker needs another pass.',
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
      reasonCode: 'max_node_visits',
      data: expect.objectContaining({
        reasonCode: 'max_node_visits',
        maxNodeVisits: 1,
        pendingNodeIds: ['worker'],
        visitCounts: { worker: 1 },
      }),
    }));
  });

  it('surfaces branch budget approvals as human gate events before timeout fallback', async () => {
    const schema: ArchitectureSchema = {
      id: 'budget-human-gate-runtime',
      name: 'Budget Human Gate Runtime',
      description: 'Schema that exposes branch budget approvals as architecture events.',
      version: '0.1.0',
      roleSlots: [
        {
          id: 'orchestrator',
          label: 'Orchestrator',
          description: 'Routes the next branch.',
          slotType: 'judge',
          defaultPersonaId: 'orchestrator',
          allowedPersonaTags: ['review'],
          required: true,
          canOverrideAtRunStart: true,
        },
        {
          id: 'researcher',
          label: 'Researcher',
          description: 'Collects the evidence.',
          slotType: 'participant',
          defaultPersonaId: 'researcher',
          allowedPersonaTags: ['research'],
          required: true,
          canOverrideAtRunStart: true,
        },
      ],
      nodes: [
        { id: 'orchestrator', label: 'Orchestrator', kind: 'router', roleSlotId: 'orchestrator', behavior: { mode: 'choose_one' } },
        { id: 'researcher', label: 'Researcher', kind: 'role', roleSlotId: 'researcher' },
      ],
      edges: [
        { id: 'orchestrator-researcher', fromNodeId: 'orchestrator', toNodeId: 'researcher' },
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
      id: 'run-budget-human-gate',
      schemaId: schema.id,
      prompt: 'Expose budget requests immediately.',
      executionMode: 'subagent_execution',
      context: { maxArchitectureSteps: 10 },
      rootSessionId: 'root-budget-human-gate',
      branchSessionIds: {
        orchestrator: 'arch-run-budget-human-gate-orchestrator',
        researcher: 'arch-run-budget-human-gate-researcher',
      },
      status: 'running',
      createdAt: 100,
      updatedAt: 100,
    };
    const roleExecutor: ArchitectureRoleExecutor = {
      execute: vi.fn(async ({ branchSessionId, emit, personaId, run: activeRun, slot }) => {
        if (slot.id === 'orchestrator') {
          emit?.('agent:budget_required', {
            requestId: 'budget-1',
            sessionId: branchSessionId,
            scope: 'agent-flow-branch',
            usedIterations: 8,
            currentLimit: 8,
            suggestedNextLimit: 18,
            requestedBy: 'orchestrator',
          });
        }
        return {
          message: slot.id === 'orchestrator'
            ? 'Orchestrator routes the next branch.'
            : 'Researcher completed the bounded pass.',
          data: {
            branchSessionId,
            personaId,
            rootSessionId: activeRun.rootSessionId,
            slotType: slot.slotType,
            executionMode: activeRun.executionMode,
            ...(slot.id === 'orchestrator' ? { routeToNodeId: 'researcher', response: 'continue' } : {}),
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

    expect(events).toContainEqual(expect.objectContaining({
      type: 'human_gate',
      nodeId: 'orchestrator',
      roleSlotId: 'orchestrator',
      actionSummary: 'Waiting for budget approval.',
      message: 'Orchestrator requested more tool budget (8/8).',
      data: expect.objectContaining({
        kind: 'branch_stream',
        event: 'agent:budget_required',
        usedIterations: 8,
        currentLimit: 8,
        requestedBy: 'orchestrator',
      }),
    }));
  });
});

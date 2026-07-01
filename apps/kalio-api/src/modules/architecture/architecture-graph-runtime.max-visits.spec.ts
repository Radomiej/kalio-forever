import type { ArchitectureRoleExecutor } from './architecture-role-executor';
import type { ArchitectureRouterOutput, ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import { describe, expect, it, vi } from 'vitest';
import { createArchitectureGraphEvents } from './architecture-graph-runtime';

describe('createArchitectureGraphEvents max visit guards', () => {
  it('emits typed contract failure when a tool executor finishes without required tool evidence', async () => {
    const schema: ArchitectureSchema = {
      id: 'tool-evidence-contract-runtime',
      name: 'Tool Evidence Contract Runtime',
      description: 'Tool executor nodes must produce structured tool evidence.',
      version: '0.1.0',
      roleSlots: [{
        id: 'implementer',
        label: 'Implementer',
        description: 'Must use tools and return evidence.',
        slotType: 'tool_executor',
        defaultPersonaId: 'agent-implementer',
        allowedPersonaTags: ['implementation'],
        required: true,
        canOverrideAtRunStart: true,
      }],
      nodes: [
        { id: 'implementer', label: 'Implementer', kind: 'role', roleSlotId: 'implementer' },
      ],
      edges: [],
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
      id: 'run-tool-evidence-contract',
      schemaId: schema.id,
      prompt: 'Do implementation work.',
      executionMode: 'subagent_execution',
      context: { maxArchitectureSteps: 10 },
      rootSessionId: 'root-tool-evidence-contract',
      branchSessionIds: { implementer: 'branch-implementer' },
      status: 'running',
      createdAt: 100,
      updatedAt: 100,
    };
    const roleExecutor: ArchitectureRoleExecutor = {
      execute: vi.fn(async () => ({
        message: 'Implementation complete.',
        data: { response: 'Implementation complete.' },
      })),
    };
    const liveEvents: Array<Awaited<ReturnType<typeof createArchitectureGraphEvents>>[number]> = [];

    await expect(createArchitectureGraphEvents({
      schema,
      run,
      now: run.createdAt,
      roleExecutor,
      personaForSlot: () => 'agent-implementer',
      onEvent: (event) => liveEvents.push(event),
    })).rejects.toThrow('completed without required tool evidence');

    expect(liveEvents).toContainEqual(expect.objectContaining({
      type: 'node_failed',
      nodeId: 'implementer',
      roleSlotId: 'implementer',
      status: 'failed',
      errorCode: 'CONTRACT_VIOLATION',
      failure: expect.objectContaining({
        code: 'CONTRACT_VIOLATION',
        source: 'architecture-graph-runtime',
        retryable: false,
      }),
    }));
  });

  it('emits typed node_failed before unrecoverable branch errors reject the graph run', async () => {
    const schema: ArchitectureSchema = {
      id: 'typed-branch-failure-runtime',
      name: 'Typed Branch Failure Runtime',
      description: 'Schema where provider branch failures must become typed node failures.',
      version: '0.1.0',
      roleSlots: [{
        id: 'orchestrator',
        label: 'Orchestrator',
        description: 'Fails with provider structured output code.',
        slotType: 'router',
        defaultPersonaId: 'orchestrator',
        allowedPersonaTags: ['routing'],
        required: true,
        canOverrideAtRunStart: true,
      }],
      nodes: [
        { id: 'orchestrator', label: 'Orchestrator', kind: 'router', roleSlotId: 'orchestrator' },
      ],
      edges: [],
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
      id: 'run-typed-branch-failure',
      schemaId: schema.id,
      prompt: 'Provider wording must not drive graph status.',
      executionMode: 'subagent_execution',
      context: { maxArchitectureSteps: 10 },
      rootSessionId: 'root-typed-branch-failure',
      branchSessionIds: { orchestrator: 'arch-run-typed-branch-failure-orchestrator' },
      status: 'running',
      createdAt: 100,
      updatedAt: 100,
    };
    const providerError = Object.assign(new Error('provider wording changed'), {
      code: 'LLM_BAD_STRUCTURED_OUTPUT',
    });
    const roleExecutor: ArchitectureRoleExecutor = {
      execute: vi.fn(async ({ emit }) => {
        emit?.('agent:start', { sessionId: 'arch-run-typed-branch-failure-orchestrator' });
        throw providerError;
      }),
    };
    const liveEvents: Array<Awaited<ReturnType<typeof createArchitectureGraphEvents>>[number]> = [];

    await expect(createArchitectureGraphEvents({
      schema,
      run,
      now: run.createdAt,
      roleExecutor,
      personaForSlot: () => 'orchestrator',
      onEvent: (event) => liveEvents.push(event),
    })).rejects.toThrow('provider wording changed');

    expect(liveEvents).toContainEqual(expect.objectContaining({
      type: 'node_failed',
      nodeId: 'orchestrator',
      roleSlotId: 'orchestrator',
      status: 'failed',
      errorCode: 'CONTRACT_VIOLATION',
      failure: expect.objectContaining({
        code: 'CONTRACT_VIOLATION',
        source: 'llm-provider',
        retryable: false,
        message: 'provider wording changed',
      }),
    }));
  });

  it('ignores legacy routeToNodeId data without typed routerOutput', async () => {
    const schema: ArchitectureSchema = {
      id: 'legacy-route-data-runtime',
      name: 'Legacy Route Data Runtime',
      description: 'Schema where legacy route fields must not drive graph routing.',
      version: '0.1.0',
      roleSlots: [{
        id: 'router',
        label: 'Router',
        description: 'Returns legacy route data only.',
        slotType: 'router',
        defaultPersonaId: 'orchestrator',
        allowedPersonaTags: ['routing'],
        required: true,
        canOverrideAtRunStart: true,
      }],
      nodes: [
        { id: 'router', label: 'Router', kind: 'router', roleSlotId: 'router', behavior: { mode: 'choose_one' } },
        { id: 'fallback', label: 'Fallback', kind: 'artifact' },
        { id: 'legacy-target', label: 'Legacy Target', kind: 'artifact' },
      ],
      edges: [
        { id: 'router-fallback', fromNodeId: 'router', toNodeId: 'fallback' },
        { id: 'router-legacy', fromNodeId: 'router', toNodeId: 'legacy-target' },
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
      id: 'run-legacy-route-data',
      schemaId: schema.id,
      prompt: 'Ignore legacy route data.',
      executionMode: 'subagent_execution',
      context: { maxArchitectureSteps: 10 },
      rootSessionId: 'root-legacy-route-data',
      branchSessionIds: { router: 'arch-run-legacy-route-data-router' },
      status: 'running',
      createdAt: 100,
      updatedAt: 100,
    };
    const roleExecutor: ArchitectureRoleExecutor = {
      execute: vi.fn(async () => ({
        message: 'Legacy route field should be display-only.',
        data: {
          routeToNodeId: 'legacy-target',
          response: 'legacy route request',
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
      nodeId: 'router',
      route: expect.objectContaining({
        source: 'router',
        selectedNodeIds: ['fallback'],
        nextNodeId: 'fallback',
      }),
      data: expect.objectContaining({
        selectedNodeIds: ['fallback'],
      }),
    }));
  });

  it('does not let display-only incompleteReason override typed route output', async () => {
    const schema: ArchitectureSchema = {
      id: 'display-incomplete-route-runtime',
      name: 'Display Incomplete Route Runtime',
      description: 'Schema where display-only incomplete text must not drive routing.',
      version: '0.1.0',
      roleSlots: [{
        id: 'worker',
        label: 'Worker',
        description: 'Returns typed route output plus display text.',
        slotType: 'participant',
        defaultPersonaId: 'dev',
        allowedPersonaTags: ['dev'],
        required: true,
        canOverrideAtRunStart: true,
      }],
      nodes: [
        { id: 'worker', label: 'Worker', kind: 'role', roleSlotId: 'worker' },
        { id: 'fallback', label: 'Fallback', kind: 'artifact' },
        { id: 'typed-target', label: 'Typed Target', kind: 'artifact' },
      ],
      edges: [
        { id: 'worker-fallback', fromNodeId: 'worker', toNodeId: 'fallback' },
        { id: 'worker-target', fromNodeId: 'worker', toNodeId: 'typed-target' },
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
      id: 'run-display-incomplete-route',
      schemaId: schema.id,
      prompt: 'Use typed route output.',
      executionMode: 'subagent_execution',
      context: { maxArchitectureSteps: 10 },
      rootSessionId: 'root-display-incomplete-route',
      branchSessionIds: { worker: 'arch-run-display-incomplete-route-worker' },
      status: 'running',
      createdAt: 100,
      updatedAt: 100,
    };
    const roleExecutor: ArchitectureRoleExecutor = {
      execute: vi.fn(async () => ({
        message: 'Worker produced a typed route.',
        data: {
          incompleteReason: 'Display-only note that should not route the graph.',
          routerOutput: {
            selectedStrategy: 'typed-route',
            mergedDecision: 'Route to typed target.',
            acceptedInputs: [],
            rejectedInputs: [],
            unresolvedConflicts: [],
            risks: [],
            confidence: 0.91,
            nextAction: 'route_to',
            targetNodeId: 'typed-target',
            response: 'typed route wins',
          } satisfies ArchitectureRouterOutput,
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
      type: 'participant_output',
      nodeId: 'worker',
      route: expect.objectContaining({
        source: 'agent',
        selectedNodeIds: ['typed-target'],
        nextNodeId: 'typed-target',
        response: 'typed route wins',
      }),
      data: expect.objectContaining({
        selectedNodeIds: ['typed-target'],
      }),
    }));
  });

  it('uses explicit edge selection metadata for convergence routing', async () => {
    const schema: ArchitectureSchema = {
      id: 'edge-selection-convergence-runtime',
      name: 'Edge Selection Convergence Runtime',
      description: 'Schema where edge metadata owns convergence routing.',
      version: '0.1.0',
      roleSlots: [],
      nodes: [
        { id: 'router', label: 'Router', kind: 'router', behavior: { mode: 'rank_then_merge' } },
        { id: 'decoy', label: 'Decoy', kind: 'artifact' },
        { id: 'artifact', label: 'Artifact', kind: 'artifact' },
      ],
      edges: [
        { id: 'router-decoy', fromNodeId: 'router', toNodeId: 'decoy' },
        { id: 'router-artifact', fromNodeId: 'router', toNodeId: 'artifact', selection: 'converge' },
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
      id: 'run-edge-selection-convergence',
      schemaId: schema.id,
      prompt: 'Use edge selection metadata.',
      executionMode: 'subagent_execution',
      context: { maxArchitectureSteps: 10 },
      rootSessionId: 'root-edge-selection-convergence',
      branchSessionIds: {},
      status: 'running',
      createdAt: 100,
      updatedAt: 100,
    };
    const roleExecutor: ArchitectureRoleExecutor = {
      execute: vi.fn(),
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
      nodeId: 'router',
      route: expect.objectContaining({
        source: 'router',
        selectedNodeIds: ['artifact'],
        rejectedNodeIds: ['decoy'],
        nextNodeId: 'artifact',
      }),
      data: expect.objectContaining({
        selectedNodeIds: ['artifact'],
      }),
    }));
  });

  it('does not use node-level convergeToNodeId as routing fallback without edge selection metadata', async () => {
    const legacyBehavior = { mode: 'rank_then_merge' as const, convergeToNodeId: 'artifact' };
    const schema: ArchitectureSchema = {
      id: 'legacy-node-convergence-runtime',
      name: 'Legacy Node Convergence Runtime',
      description: 'Schema where legacy node convergence hints are display-only without edge metadata.',
      version: '0.1.0',
      roleSlots: [],
      nodes: [
        {
          id: 'router',
          label: 'Router',
          kind: 'router',
          behavior: legacyBehavior,
        },
        { id: 'decoy', label: 'Decoy', kind: 'artifact' },
        { id: 'artifact', label: 'Artifact', kind: 'artifact' },
      ],
      edges: [
        { id: 'router-decoy', fromNodeId: 'router', toNodeId: 'decoy' },
        { id: 'router-artifact', fromNodeId: 'router', toNodeId: 'artifact' },
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
      id: 'run-legacy-node-convergence',
      schemaId: schema.id,
      prompt: 'Ignore node-level convergence fallback.',
      executionMode: 'subagent_execution',
      context: { maxArchitectureSteps: 10 },
      rootSessionId: 'root-legacy-node-convergence',
      branchSessionIds: {},
      status: 'running',
      createdAt: 100,
      updatedAt: 100,
    };
    const roleExecutor: ArchitectureRoleExecutor = {
      execute: vi.fn(),
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
      nodeId: 'router',
      route: expect.objectContaining({
        source: 'router',
        selectedNodeIds: ['decoy'],
        rejectedNodeIds: ['artifact'],
        nextNodeId: 'decoy',
      }),
      data: expect.objectContaining({
        selectedNodeIds: ['decoy'],
      }),
    }));
    const routerEvent = events.find((event) => event.type === 'router_decision' && event.nodeId === 'router');
    expect(routerEvent?.route?.convergeToNodeId).toBeUndefined();
    expect(routerEvent?.data).not.toMatchObject({
      convergeToNodeId: 'artifact',
    });
  });

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
            ...routerData('implementer', 'needs another pass'),
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
          ...routerData('worker', 'continue'),
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
            ...(slot.id === 'orchestrator' ? routerData('researcher', 'continue') : {}),
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

  it('surfaces tool confirmation requests as human gate events with explicit summary', async () => {
    const schema: ArchitectureSchema = {
      id: 'tool-confirmation-human-gate-runtime',
      name: 'Tool Confirmation Human Gate Runtime',
      description: 'Schema that exposes branch tool confirmation as architecture events.',
      version: '0.1.0',
      roleSlots: [{
        id: 'orchestrator',
        label: 'Orchestrator',
        description: 'Requests a destructive tool confirmation.',
        slotType: 'judge',
        defaultPersonaId: 'orchestrator',
        allowedPersonaTags: ['review'],
        required: true,
        canOverrideAtRunStart: true,
      }],
      nodes: [
        { id: 'orchestrator', label: 'Orchestrator', kind: 'router', roleSlotId: 'orchestrator', behavior: { mode: 'choose_one' } },
        { id: 'final', label: 'Final', kind: 'artifact' },
      ],
      edges: [
        { id: 'orchestrator-final', fromNodeId: 'orchestrator', toNodeId: 'final' },
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
      id: 'run-tool-confirmation-human-gate',
      schemaId: schema.id,
      prompt: 'Expose tool confirmation requests immediately.',
      executionMode: 'subagent_execution',
      context: { maxArchitectureSteps: 10 },
      rootSessionId: 'root-tool-confirmation-human-gate',
      branchSessionIds: {
        orchestrator: 'arch-run-tool-confirmation-human-gate-orchestrator',
      },
      status: 'running',
      createdAt: 100,
      updatedAt: 100,
    };
    const roleExecutor: ArchitectureRoleExecutor = {
      execute: vi.fn(async ({ branchSessionId, emit }) => {
        emit?.('tool:confirmation_required', {
          requestId: 'confirm-1',
          sessionId: branchSessionId,
          toolName: 'vfs_delete',
          args: {
            path: 'C:\\Projekty\\kalio-forever\\tmp\\stale.txt',
          },
        });
        return {
          message: 'Orchestrator is waiting for confirmation.',
          data: routerData('final', 'pause for confirmation'),
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
      actionSummary: 'Waiting for tool confirmation.',
      message: 'Orchestrator requested HITL approval for vfs_delete.',
      data: expect.objectContaining({
        kind: 'branch_stream',
        event: 'tool:confirmation_required',
        sessionId: 'arch-run-tool-confirmation-human-gate-orchestrator',
        toolName: 'vfs_delete',
        toolPath: 'C:\\Projekty\\kalio-forever\\tmp\\stale.txt',
      }),
    }));
  });

  it('omits invalid budget counters from branch human gate summaries and data', async () => {
    const schema: ArchitectureSchema = {
      id: 'budget-human-gate-invalid-counters-runtime',
      name: 'Budget Human Gate Invalid Counters Runtime',
      description: 'Schema that ignores invalid branch budget counters in human-gate summaries.',
      version: '0.1.0',
      roleSlots: [{
        id: 'orchestrator',
        label: 'Orchestrator',
        description: 'Requests more budget with malformed counters.',
        slotType: 'judge',
        defaultPersonaId: 'orchestrator',
        allowedPersonaTags: ['review'],
        required: true,
        canOverrideAtRunStart: true,
      }],
      nodes: [
        { id: 'orchestrator', label: 'Orchestrator', kind: 'router', roleSlotId: 'orchestrator', behavior: { mode: 'choose_one' } },
        { id: 'final', label: 'Final', kind: 'artifact' },
      ],
      edges: [
        { id: 'orchestrator-final', fromNodeId: 'orchestrator', toNodeId: 'final' },
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
      id: 'run-budget-human-gate-invalid-counters',
      schemaId: schema.id,
      prompt: 'Ignore malformed budget counters.',
      executionMode: 'subagent_execution',
      context: { maxArchitectureSteps: 10 },
      rootSessionId: 'root-budget-human-gate-invalid-counters',
      branchSessionIds: {
        orchestrator: 'arch-run-budget-human-gate-invalid-counters-orchestrator',
      },
      status: 'running',
      createdAt: 100,
      updatedAt: 100,
    };
    const roleExecutor: ArchitectureRoleExecutor = {
      execute: vi.fn(async ({ branchSessionId, emit }) => {
        emit?.('agent:budget_required', {
          requestId: 'budget-invalid-1',
          sessionId: branchSessionId,
          scope: 'agent-flow-branch',
          usedIterations: Number.POSITIVE_INFINITY,
          currentLimit: '8',
          suggestedNextLimit: 18,
          requestedBy: 'orchestrator',
        });
        return {
          message: 'Orchestrator requested more tool budget.',
          data: routerData('final', 'pause for budget approval'),
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
      message: 'Orchestrator requested more tool budget.',
      data: expect.objectContaining({
        kind: 'branch_stream',
        event: 'agent:budget_required',
        requestedBy: 'orchestrator',
        suggestedNextLimit: 18,
      }),
    }));
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'human_gate',
      message: expect.stringContaining('(Infinity/8)'),
    }));

    const budgetGate = events.find((event) => (
      event.type === 'human_gate'
      && event.nodeId === 'orchestrator'
      && event.data?.['event'] === 'agent:budget_required'
    ));
    expect(budgetGate?.data).toEqual(expect.not.objectContaining({
      usedIterations: expect.any(Number),
      currentLimit: expect.anything(),
    }));
  });
});

function routerData(targetNodeId: string, response = targetNodeId): { routerOutput: ArchitectureRouterOutput } {
  return {
    routerOutput: {
      selectedStrategy: targetNodeId,
      mergedDecision: response,
      acceptedInputs: [],
      rejectedInputs: [],
      unresolvedConflicts: [],
      risks: [],
      confidence: 1,
      nextAction: 'route_to',
      targetNodeId,
      response,
    },
  };
}

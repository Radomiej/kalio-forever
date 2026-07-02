import type { ArchitectureExecutionEvent, ArchitectureSchema } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import { buildArchitectureGraphProjection } from './architecture-graph-projection';

describe('buildArchitectureGraphProjection', () => {
  it('carries terminal run status so failed runs do not look live in graph projections', () => {
    const schema: ArchitectureSchema = {
      id: 'test-schema',
      name: 'Test Schema',
      description: 'Test schema',
      version: '0.1.0',
      roleSlots: [],
      nodes: [{ id: 'implementer', label: 'Implementer', kind: 'role' }],
      edges: [],
      routerPolicy: {
        mode: 'rank_then_merge',
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
      outputArtifactSchema: 'test',
    };

    const graph = buildArchitectureGraphProjection('run-1', schema, [], 'failed');

    expect(graph.status).toBe('failed');
    expect(graph.schemaId).toBe('test-schema');
    expect(graph.schemaName).toBe('Test Schema');
    expect(graph.nodes[0]?.sessionId).toBe('arch-run-1-implementer');
    expect(graph.nodes[0]?.status).toBe('pending');
  });

  it('marks a role node running from start-only events', () => {
    const schema: ArchitectureSchema = {
      id: 'test-schema',
      name: 'Test Schema',
      description: 'Test schema',
      version: '0.1.0',
      roleSlots: [],
      nodes: [{ id: 'agent', label: 'Agent', kind: 'role' }],
      edges: [],
      routerPolicy: {
        mode: 'rank_then_merge',
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
      outputArtifactSchema: 'test',
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-1',
        runId: 'run-1',
        sequence: 1,
        type: 'node_started',
        message: 'Agent started.',
        nodeId: 'agent',
        createdAt: 1,
      },
      {
        id: 'event-2',
        runId: 'run-1',
        sequence: 2,
        type: 'agent_started',
        message: 'Agent subagent started.',
        nodeId: 'agent',
        createdAt: 2,
      },
    ];

    const graph = buildArchitectureGraphProjection('run-1', schema, events);

    expect(graph.nodes[0]).toMatchObject({
      id: 'agent',
      status: 'running',
      visitCount: 1,
      eventIds: ['event-1', 'event-2'],
    });
  });

  it('marks a node failed from typed node failure events instead of leaving it running', () => {
    const schema: ArchitectureSchema = {
      id: 'test-schema',
      name: 'Test Schema',
      description: 'Test schema',
      version: '0.1.0',
      roleSlots: [],
      nodes: [{ id: 'agent', label: 'Agent', kind: 'role' }],
      edges: [],
      routerPolicy: {
        mode: 'rank_then_merge',
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
      outputArtifactSchema: 'test',
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-1',
        runId: 'run-1',
        sequence: 1,
        type: 'node_started',
        message: 'Agent started.',
        nodeId: 'agent',
        createdAt: 1,
      },
      {
        id: 'event-2',
        runId: 'run-1',
        sequence: 2,
        type: 'agent_started',
        message: 'Agent subagent started.',
        nodeId: 'agent',
        createdAt: 2,
      },
      {
        id: 'event-3',
        runId: 'run-1',
        sequence: 3,
        type: 'node_failed',
        message: 'Agent failed.',
        nodeId: 'agent',
        status: 'failed',
        errorCode: 'CONTRACT_VIOLATION',
        failure: {
          code: 'CONTRACT_VIOLATION',
          source: 'llm-provider',
          retryable: false,
          message: 'structured output was malformed',
        },
        createdAt: 3,
      },
    ];

    const graph = buildArchitectureGraphProjection('run-1', schema, events, 'failed');

    expect(graph.nodes[0]).toMatchObject({
      id: 'agent',
      status: 'failed',
      action: 'node_failed',
      detail: 'structured output was malformed',
      eventIds: ['event-1', 'event-2', 'event-3'],
    });
  });

  it('projects run-level typed failures onto active nodes so they do not stay running', () => {
    const schema: ArchitectureSchema = {
      id: 'test-schema',
      name: 'Test Schema',
      description: 'Test schema',
      version: '0.1.0',
      roleSlots: [],
      nodes: [{ id: 'orchestrator', roleSlotId: 'orchestrator', label: 'Orchestrator', kind: 'router' }],
      edges: [],
      routerPolicy: {
        mode: 'rank_then_merge',
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
      outputArtifactSchema: 'test',
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-1',
        runId: 'run-1',
        sequence: 1,
        type: 'node_started',
        message: 'Orchestrator started.',
        nodeId: 'orchestrator',
        roleSlotId: 'orchestrator',
        createdAt: 1,
      },
      {
        id: 'event-2',
        runId: 'run-1',
        sequence: 2,
        type: 'tool_call',
        message: 'Provider call started.',
        nodeId: 'orchestrator',
        roleSlotId: 'orchestrator',
        createdAt: 2,
      },
      {
        id: 'event-3',
        runId: 'run-1',
        sequence: 3,
        type: 'router_decision',
        action: 'router_selected',
        message: 'Run failed.',
        errorCode: 'CONTRACT_VIOLATION',
        failure: {
          code: 'CONTRACT_VIOLATION',
          source: 'llm-provider',
          retryable: false,
          message: 'structured output was malformed',
        },
        createdAt: 3,
      },
    ];

    const graph = buildArchitectureGraphProjection('run-1', schema, events, 'failed');

    expect(graph.nodes[0]).toMatchObject({
      id: 'orchestrator',
      status: 'failed',
      action: 'node_failed',
      detail: 'structured output was malformed',
      eventIds: ['event-1', 'event-2', 'event-3'],
    });
  });

  it('cancels unvisited downstream nodes when an upstream node fails the run', () => {
    const schema: ArchitectureSchema = {
      id: 'test-schema',
      name: 'Test Schema',
      description: 'Test schema',
      version: '0.1.0',
      roleSlots: [],
      nodes: [
        { id: 'router', roleSlotId: 'router', label: 'Router', kind: 'router' },
        { id: 'final-artifact', roleSlotId: 'finalizer', label: 'Final Artifact', kind: 'artifact' },
      ],
      edges: [{ id: 'router-final-artifact', fromNodeId: 'router', toNodeId: 'final-artifact' }],
      routerPolicy: {
        mode: 'rank_then_merge',
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
      outputArtifactSchema: 'test',
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-1',
        runId: 'run-1',
        sequence: 1,
        type: 'node_started',
        message: 'Router started.',
        nodeId: 'router',
        roleSlotId: 'router',
        createdAt: 1,
      },
      {
        id: 'event-2',
        runId: 'run-1',
        sequence: 2,
        type: 'node_failed',
        message: 'Router failed.',
        nodeId: 'router',
        roleSlotId: 'router',
        status: 'failed',
        errorCode: 'CONTRACT_VIOLATION',
        failure: {
          code: 'CONTRACT_VIOLATION',
          source: 'llm-provider',
          retryable: false,
          message: 'structured output was malformed',
        },
        createdAt: 2,
      },
      {
        id: 'event-3',
        runId: 'run-1',
        sequence: 3,
        type: 'router_decision',
        action: 'node_failed',
        message: 'Run failed.',
        errorCode: 'CONTRACT_VIOLATION',
        failure: {
          code: 'CONTRACT_VIOLATION',
          source: 'llm-provider',
          retryable: false,
          message: 'structured output was malformed',
        },
        createdAt: 3,
      },
    ];

    const graph = buildArchitectureGraphProjection('run-1', schema, events, 'failed');

    expect(graph.nodes.find((node) => node.id === 'router')).toMatchObject({
      status: 'failed',
      action: 'node_failed',
      detail: 'structured output was malformed',
      errorCode: 'CONTRACT_VIOLATION',
      failure: {
        code: 'CONTRACT_VIOLATION',
        source: 'llm-provider',
        retryable: false,
      },
    });
    expect(graph.nodes.find((node) => node.id === 'final-artifact')).toMatchObject({
      status: 'cancelled',
      action: 'node_failed',
      detail: 'Skipped because an upstream workflow node failed before this node started.',
      eventIds: ['event-3'],
      errorCode: 'CONTRACT_VIOLATION',
    });
  });

  it('cancels pending nodes when a typed max-step terminal event stops the run', () => {
    const schema: ArchitectureSchema = {
      id: 'test-schema',
      name: 'Test Schema',
      description: 'Test schema',
      version: '0.1.0',
      roleSlots: [],
      nodes: [
        { id: 'router', roleSlotId: 'router', label: 'Router', kind: 'router' },
        { id: 'final-artifact', roleSlotId: 'finalizer', label: 'Final Artifact', kind: 'artifact' },
      ],
      edges: [{ id: 'router-final-artifact', fromNodeId: 'router', toNodeId: 'final-artifact' }],
      routerPolicy: {
        mode: 'rank_then_merge',
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
      outputArtifactSchema: 'test',
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-1',
        runId: 'run-1',
        sequence: 1,
        type: 'router_output',
        message: 'Router selected final artifact.',
        nodeId: 'router',
        roleSlotId: 'router',
        status: 'done',
        createdAt: 1,
      },
      {
        id: 'event-2',
        runId: 'run-1',
        sequence: 2,
        type: 'router_decision',
        message: 'Run stopped after reaching the maximum step limit.',
        reasonCode: 'max_steps',
        data: {
          reasonCode: 'max_steps',
          pendingNodeIds: ['final-artifact'],
        },
        createdAt: 2,
      },
    ];

    const graph = buildArchitectureGraphProjection('run-1', schema, events, 'failed');

    expect(graph.nodes.find((node) => node.id === 'router')).toMatchObject({
      status: 'completed',
    });
    expect(graph.nodes.find((node) => node.id === 'final-artifact')).toMatchObject({
      status: 'cancelled',
      action: 'node_failed',
      detail: 'Skipped because the workflow stopped before this node started.',
      eventIds: ['event-2'],
    });
  });

  it('lets later completed evidence recover a node after an earlier branch error', () => {
    const schema: ArchitectureSchema = {
      id: 'test-schema',
      name: 'Test Schema',
      description: 'Test schema',
      version: '0.1.0',
      roleSlots: [],
      nodes: [{ id: 'agent', label: 'Agent', kind: 'role' }],
      edges: [],
      routerPolicy: {
        mode: 'rank_then_merge',
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
      outputArtifactSchema: 'test',
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-1',
        runId: 'run-1',
        sequence: 1,
        type: 'node_failed',
        message: 'Agent failed.',
        nodeId: 'agent',
        status: 'failed',
        errorCode: 'TIMEOUT',
        failure: {
          code: 'TIMEOUT',
          source: 'llm-provider',
          retryable: true,
          message: 'provider timeout',
        },
        createdAt: 1,
      },
      {
        id: 'event-2',
        runId: 'run-1',
        sequence: 2,
        type: 'node_completed',
        message: 'Agent completed.',
        nodeId: 'agent',
        status: 'done',
        createdAt: 2,
      },
    ];

    const graph = buildArchitectureGraphProjection('run-1', schema, events, 'completed');

    expect(graph.nodes[0]).toMatchObject({
      id: 'agent',
      status: 'completed',
    });
  });

  it('projects incomplete architecture evidence onto graph nodes', () => {
    const schema: ArchitectureSchema = {
      id: 'test-schema',
      name: 'Test Schema',
      description: 'Test schema',
      version: '0.1.0',
      roleSlots: [],
      nodes: [{ id: 'goal-master', label: 'Goal Master', kind: 'router' }],
      edges: [],
      routerPolicy: {
        mode: 'rank_then_merge',
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
      outputArtifactSchema: 'test',
    };
    const events: ArchitectureExecutionEvent[] = [{
      id: 'event-1',
      runId: 'run-1',
      sequence: 1,
      type: 'router_decision',
      message: 'Architecture route fell back.',
      nodeId: 'goal-master',
      data: {
        incompleteReason: 'Subagent exhausted its tool loop without producing a final answer.',
      },
      createdAt: 1,
    }];

    const graph = buildArchitectureGraphProjection('run-1', schema, events);

    expect(graph.nodes[0]).toMatchObject({
      id: 'goal-master',
      incompleteReason: 'Subagent exhausted its tool loop without producing a final answer.',
      action: 'router_incomplete',
      detail: 'Subagent exhausted its tool loop without producing a final answer.',
    });
  });

  it('projects stable action/detail from latest participant, router, and finalizer events', () => {
    const schema: ArchitectureSchema = {
      id: 'test-schema',
      name: 'Test Schema',
      description: 'Test schema',
      version: '0.1.0',
      roleSlots: [],
      nodes: [
        { id: 'implementer', label: 'Implementer', kind: 'role' },
        { id: 'goal-master', label: 'Goal Master', kind: 'router', behavior: { mode: 'choose_one' } },
        { id: 'final-artifact', label: 'Final Artifact', kind: 'artifact' },
      ],
      edges: [],
      routerPolicy: {
        mode: 'rank_then_merge',
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
      outputArtifactSchema: 'test',
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-participant',
        runId: 'run-1',
        sequence: 1,
        type: 'participant_output',
        message: 'Implementer prepared the patch.',
        nodeId: 'implementer',
        route: {
          source: 'agent',
          fromNodeId: 'implementer',
          selectedNodeIds: ['goal-master'],
          nextNodeId: 'goal-master',
        },
        createdAt: 1,
      },
      {
        id: 'event-router',
        runId: 'run-1',
        sequence: 2,
        type: 'router_output',
        message: 'Goal Master merged the branch outputs.',
        nodeId: 'goal-master',
        routerOutput: {
          selectedStrategy: 'ship',
          mergedDecision: 'Ship the implementer patch.',
          acceptedInputs: [],
          rejectedInputs: [],
          unresolvedConflicts: [],
          risks: [],
          confidence: 0.8,
          nextAction: 'finalize',
        },
        createdAt: 2,
      },
      {
        id: 'event-finalizer',
        runId: 'run-1',
        sequence: 3,
        type: 'final_artifact',
        message: 'Final answer ready.',
        nodeId: 'final-artifact',
        createdAt: 3,
      },
    ];

    const graph = buildArchitectureGraphProjection('run-1', schema, events);

    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'implementer',
        action: 'participant_completed',
        detail: 'Ready for goal-master.',
      }),
      expect.objectContaining({
        id: 'goal-master',
        action: 'router_synthesized',
        detail: 'Next action: finalize.',
      }),
      expect.objectContaining({
        id: 'final-artifact',
        action: 'finalizer_completed',
        detail: 'Final answer ready.',
      }),
    ]));
  });

  it('projects durable CLI agents as runtime child-agent nodes', () => {
    const schema: ArchitectureSchema = {
      id: 'test-schema',
      name: 'Test Schema',
      description: 'Test schema',
      version: '0.1.0',
      roleSlots: [],
      nodes: [{ id: 'implementer', label: 'Implementer', kind: 'role', roleSlotId: 'implementer' }],
      edges: [],
      routerPolicy: {
        mode: 'rank_then_merge',
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
      outputArtifactSchema: 'test',
    };
    const events: ArchitectureExecutionEvent[] = [{
      id: 'event-cli',
      runId: 'run-1',
      sequence: 1,
      type: 'participant_output',
      message: 'Implementer spawned Copilot child.',
      nodeId: 'implementer',
      roleSlotId: 'implementer',
      data: {
        toolEvidence: {
          toolCallCount: 1,
          toolResultCount: 1,
          toolNames: ['spawn_cli_agent'],
          successfulToolNames: ['spawn_cli_agent'],
          targetPaths: ['C:\\Projekty\\TurboProject2'],
          childCliSessions: [{
            childSessionId: 'cli-child-1',
            agentId: 'copilot',
            workdir: 'C:\\Projekty\\TurboProject2',
            status: 'running',
          }],
        },
      },
      createdAt: 1,
    }];

    const graph = buildArchitectureGraphProjection('run-1', schema, events);

    expect(graph.childAgents).toEqual([{
      id: 'cli-child-1',
      parentNodeId: 'implementer',
      parentRoleSlotId: 'implementer',
      parentEventId: 'event-cli',
      kind: 'cli-agent',
      backend: 'copilot',
      status: 'running',
      toolName: 'spawn_cli_agent',
      workdir: 'C:\\Projekty\\TurboProject2',
      targetPaths: ['C:\\Projekty\\TurboProject2'],
      updatedAt: 1,
    }]);
  });

  it('stops running child agents when the parent architecture run is terminal', () => {
    const schema: ArchitectureSchema = {
      id: 'test-schema',
      name: 'Test Schema',
      description: 'Test schema',
      version: '0.1.0',
      roleSlots: [],
      nodes: [{ id: 'implementer', label: 'Implementer', kind: 'role', roleSlotId: 'implementer' }],
      edges: [],
      routerPolicy: {
        mode: 'rank_then_merge',
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
      outputArtifactSchema: 'test',
    };
    const events: ArchitectureExecutionEvent[] = [{
      id: 'event-cli',
      runId: 'run-1',
      sequence: 1,
      type: 'participant_output',
      message: 'Implementer spawned Copilot child.',
      nodeId: 'implementer',
      roleSlotId: 'implementer',
      data: {
        toolEvidence: {
          successfulToolNames: ['spawn_cli_agent'],
          childCliSessions: [{
            childSessionId: 'cli-child-1',
            agentId: 'copilot',
            workdir: 'C:\\Projekty\\TurboProject2',
            status: 'running',
          }],
        },
      },
      createdAt: 1,
    }];

    const graph = buildArchitectureGraphProjection('run-1', schema, events, 'failed');

    expect(graph.childAgents?.[0]).toMatchObject({
      id: 'cli-child-1',
      status: 'stopped',
    });
  });
});

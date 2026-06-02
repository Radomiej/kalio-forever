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
      nodes: [{ id: 'materializer', label: 'Materializer', kind: 'role' }],
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
    });
  });

  it('projects durable CLI agents as runtime child-agent nodes', () => {
    const schema: ArchitectureSchema = {
      id: 'test-schema',
      name: 'Test Schema',
      description: 'Test schema',
      version: '0.1.0',
      roleSlots: [],
      nodes: [{ id: 'materializer', label: 'Materializer', kind: 'role', roleSlotId: 'materializer' }],
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
      message: 'Materializer spawned Copilot child.',
      nodeId: 'materializer',
      roleSlotId: 'materializer',
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
      parentNodeId: 'materializer',
      parentRoleSlotId: 'materializer',
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
});

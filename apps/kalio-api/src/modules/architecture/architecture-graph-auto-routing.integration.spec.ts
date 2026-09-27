import type { ArchitectureExecutionEvent, ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import type { ArchitectureRoleExecutor } from './architecture-role-executor';
import { describe, expect, it, vi } from 'vitest';
import { createArchitectureGraphEvents } from './architecture-graph-runtime';
import { recoverAutoRoutingCursor } from './architecture-runtime-auto-routing-recovery.utils';

const schema: ArchitectureSchema = {
  id: 'auto-routing-runtime',
  name: 'Auto-routing runtime',
  description: 'Small graph for route checkpoint integration tests.',
  version: '1.0.0',
  roleSlots: [],
  nodes: [
    { id: 'auto', label: 'Auto-routing', kind: 'auto_router', autoRouting: { confidenceThreshold: 0.8, instructions: '' } },
    { id: 'agent', label: 'Agent branch', kind: 'artifact' },
    { id: 'default', label: 'Default node', kind: 'artifact' },
  ],
  edges: [
    { id: 'edge-agent', fromNodeId: 'auto', toNodeId: 'agent', selection: 'choice', label: 'Agent' },
    { id: 'edge-default', fromNodeId: 'auto', toNodeId: 'default', selection: 'default', label: 'Fallback' },
  ],
  routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: false, canReturnNeedsMoreResearch: false },
  contextPolicy: { includeUserTask: true, includeProjectMemory: false, includeBrowserSession: false, includePriorDecisions: false },
  memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true },
  outputArtifactSchema: 'markdown',
};

const run: ArchitectureRun = {
  id: 'run-auto-routing',
  schemaId: schema.id,
  prompt: 'Choose a branch.',
  executionMode: 'session_branches',
  status: 'running',
  createdAt: 100,
  updatedAt: 100,
};

const roleExecutor: ArchitectureRoleExecutor = { execute: vi.fn() };

describe('Auto-routing graph runtime', () => {
  it('persists the selected route before starting its successor', async () => {
    const order: string[] = [];
    const chooseAutoRoute = vi.fn().mockResolvedValue({
      edgeId: 'edge-agent',
      source: 'jev_choice',
      confidence: 0.91,
      reason: 'confidence_met',
    });

    const events = await createArchitectureGraphEvents({
      schema,
      run,
      now: run.createdAt,
      roleExecutor,
      personaForSlot: () => 'unused',
      chooseAutoRoute,
      persistAutoRouteDecision: async (event, checkpointId) => {
        order.push('persist');
        expect(checkpointId).toBe('architecture-route:run-auto-routing:auto:1');
        expect(event.id).toBe(`${checkpointId}:event`);
        expect(event.route?.selectedEdgeId).toBe('edge-agent');
      },
      onEvent: (event) => {
        if (event.type === 'router_decision' && event.nodeId === 'auto') order.push('route_event');
        if (event.type === 'node_started' && event.nodeId === 'agent') order.push('successor');
      },
    });

    expect(events.find((event) => event.type === 'router_decision' && event.nodeId === 'auto')?.route)
      .toMatchObject({ source: 'jev_choice', selectedEdgeId: 'edge-agent', nextNodeId: 'agent' });
    expect(order.indexOf('persist')).toBeLessThan(order.indexOf('route_event'));
    expect(order.indexOf('route_event')).toBeLessThan(order.indexOf('successor'));
    expect(events.filter((event) => event.type === 'node_started' && event.nodeId === 'agent')).toHaveLength(1);
  });

  it('does not start any successor when the durable checkpoint fails', async () => {
    const startedNodeIds: string[] = [];
    await expect(createArchitectureGraphEvents({
      schema,
      run,
      now: run.createdAt,
      roleExecutor,
      personaForSlot: () => 'unused',
      chooseAutoRoute: async () => ({ edgeId: 'edge-agent', source: 'jev_choice', confidence: 0.93, reason: 'confidence_met' }),
      persistAutoRouteDecision: async () => { throw new Error('sqlite is unavailable'); },
      onEvent: (event) => {
        if (event.type === 'node_started' && event.nodeId) startedNodeIds.push(event.nodeId);
      },
    })).rejects.toThrow('sqlite is unavailable');

    expect(startedNodeIds).toEqual(['auto']);
  });

  it('reuses a saved route on replay without another Jev call or a duplicate successor start', async () => {
    const firstRunEvents: ArchitectureExecutionEvent[] = [];
    const chooseAutoRoute = vi.fn().mockResolvedValue({
      edgeId: 'edge-agent',
      source: 'jev_choice',
      confidence: 0.9,
      reason: 'confidence_met',
    });
    await createArchitectureGraphEvents({
      schema,
      run,
      now: run.createdAt,
      roleExecutor,
      personaForSlot: () => 'unused',
      chooseAutoRoute,
      persistAutoRouteDecision: async () => undefined,
      onEvent: (event) => firstRunEvents.push(event),
    });
    const routeIndex = firstRunEvents.findIndex((event) => event.type === 'router_decision' && event.nodeId === 'auto');
    const autoCompletedIndex = firstRunEvents.findIndex((event, index) => index > routeIndex && event.type === 'node_completed' && event.nodeId === 'auto');
    const durableHistory = firstRunEvents.slice(0, autoCompletedIndex + 1);
    expect(routeIndex).toBeGreaterThanOrEqual(0);
    expect(autoCompletedIndex).toBeGreaterThan(routeIndex);
    const recoveryCursor = recoverAutoRoutingCursor(schema, durableHistory);
    expect(recoveryCursor).toMatchObject({ reason: 'runtime_recovery', pendingNodeIds: ['agent'] });

    const replaySuccessors: string[] = [];
    const replayChooser = vi.fn();
    const replayEvents = await createArchitectureGraphEvents({
      schema,
      run,
      now: run.createdAt,
      roleExecutor,
      personaForSlot: () => 'unused',
      priorEvents: durableHistory,
      resumeFrom: recoveryCursor,
      chooseAutoRoute: replayChooser,
      persistAutoRouteDecision: vi.fn(async () => undefined),
      onEvent: (event) => {
        if (event.type === 'node_started' && event.nodeId === 'agent') replaySuccessors.push(event.nodeId);
      },
    });

    expect(replayChooser).not.toHaveBeenCalled();
    expect(replayEvents.filter((event) => event.type === 'node_started' && event.nodeId === 'agent')).toHaveLength(1);
    expect(replaySuccessors).toEqual(['agent']);
  });

  it('does not rerun a successor that completed after its saved route checkpoint', async () => {
    const firstRunEvents: ArchitectureExecutionEvent[] = [];
    await createArchitectureGraphEvents({
      schema,
      run,
      now: run.createdAt,
      roleExecutor,
      personaForSlot: () => 'unused',
      chooseAutoRoute: vi.fn().mockResolvedValue({ edgeId: 'edge-agent', source: 'jev_choice', confidence: 0.9, reason: 'confidence_met' }),
      persistAutoRouteDecision: vi.fn(async () => undefined),
      onEvent: (event) => firstRunEvents.push(event),
    });
    const recoveryCursor = recoverAutoRoutingCursor(schema, firstRunEvents);
    expect(recoveryCursor).toMatchObject({ reason: 'runtime_recovery', pendingNodeIds: [] });

    const replayChooser = vi.fn();
    const replayStarts: string[] = [];
    await createArchitectureGraphEvents({
      schema,
      run,
      now: run.createdAt,
      roleExecutor,
      personaForSlot: () => 'unused',
      priorEvents: firstRunEvents,
      resumeFrom: recoveryCursor,
      chooseAutoRoute: replayChooser,
      persistAutoRouteDecision: vi.fn(async () => undefined),
      onEvent: (event) => {
        if (event.type === 'node_started' && event.nodeId) replayStarts.push(event.nodeId);
      },
    });

    expect(replayChooser).not.toHaveBeenCalled();
    expect(replayStarts).toEqual([]);
  });

  it('resumes a stopped auto-router visit without restarting completed upstream nodes', async () => {
    const priorEvents: ArchitectureExecutionEvent[] = [
      { id: 'run:event:1', runId: run.id, sequence: 1, type: 'node_completed', nodeId: 'upstream', message: 'Upstream completed.', createdAt: 1 },
      { id: 'run:event:2', runId: run.id, sequence: 2, type: 'node_started', nodeId: 'auto', message: 'Auto-routing started.', createdAt: 2 },
    ];
    const recoveryCursor = recoverAutoRoutingCursor(schema, priorEvents);
    const chooseAutoRoute = vi.fn().mockResolvedValue({
      edgeId: 'edge-agent', source: 'jev_choice', confidence: 0.9, reason: 'confidence_met',
    });
    const started: string[] = [];

    const events = await createArchitectureGraphEvents({
      schema,
      run,
      now: run.createdAt,
      roleExecutor,
      personaForSlot: () => 'unused',
      priorEvents,
      resumeFrom: recoveryCursor,
      chooseAutoRoute,
      persistAutoRouteDecision: vi.fn(async () => undefined),
      onEvent: (event) => {
        if (event.type === 'node_started' && event.nodeId) started.push(event.nodeId);
      },
    });

    expect(chooseAutoRoute).toHaveBeenCalledTimes(1);
    expect(started).not.toContain('upstream');
    expect(started).not.toContain('auto');
    expect(events.filter((event) => event.type === 'node_started' && event.nodeId === 'agent')).toHaveLength(1);
  });

  it('keeps concurrent auto-router checkpoints distinct by node and visit', async () => {
    const concurrentSchema: ArchitectureSchema = {
      ...schema,
      nodes: [
        { id: 'auto-a', label: 'Route A', kind: 'auto_router' },
        { id: 'auto-b', label: 'Route B', kind: 'auto_router' },
        { id: 'agent-a', label: 'Agent A', kind: 'artifact' },
        { id: 'agent-b', label: 'Agent B', kind: 'artifact' },
        { id: 'default-a', label: 'Default A', kind: 'artifact' },
        { id: 'default-b', label: 'Default B', kind: 'artifact' },
      ],
      edges: [
        { id: 'choice-a', fromNodeId: 'auto-a', toNodeId: 'agent-a', selection: 'choice' },
        { id: 'default-a-edge', fromNodeId: 'auto-a', toNodeId: 'default-a', selection: 'default' },
        { id: 'choice-b', fromNodeId: 'auto-b', toNodeId: 'agent-b', selection: 'choice' },
        { id: 'default-b-edge', fromNodeId: 'auto-b', toNodeId: 'default-b', selection: 'default' },
      ],
    };
    const routeEvents: ArchitectureExecutionEvent[] = [];

    await createArchitectureGraphEvents({
      schema: concurrentSchema,
      run: { ...run, id: 'run-concurrent' },
      now: run.createdAt,
      roleExecutor,
      personaForSlot: () => 'unused',
      chooseAutoRoute: async ({ node }) => ({
        edgeId: node.id === 'auto-a' ? 'choice-a' : 'choice-b',
        source: 'jev_choice',
        confidence: 0.9,
        reason: 'confidence_met',
      }),
      persistAutoRouteDecision: vi.fn(async () => undefined),
      onEvent: (event) => {
        if (event.type === 'router_decision' && event.nodeId?.startsWith('auto-')) routeEvents.push(event);
      },
    });

    expect(routeEvents).toHaveLength(2);
    expect(new Set(routeEvents.map((event) => event.id)).size).toBe(2);
    expect(routeEvents.map((event) => event.id)).toEqual(expect.arrayContaining([
      'architecture-route:run-concurrent:auto-a:1:event',
      'architecture-route:run-concurrent:auto-b:1:event',
    ]));
  });
});

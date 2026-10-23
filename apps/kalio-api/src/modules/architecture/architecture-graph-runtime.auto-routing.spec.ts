import type { ArchitectureExecutionEvent, ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import { describe, expect, it, vi } from 'vitest';
import { createArchitectureGraphEvents } from './architecture-graph-runtime';
import type { ArchitectureAutoRoutingInput } from './architecture-auto-routing.service';
import type { ArchitectureRuntimeResumeCursor } from './architecture-runtime-auto-routing-recovery.utils';
import { createWorkflowError } from '../../common/utils/workflow-error.util';

function fixture() {
  const schema: ArchitectureSchema = {
    id: 'auto', name: 'Auto', description: 'Durable routing', version: '1', roleSlots: [],
    nodes: [
      { id: 'route', label: 'Route', kind: 'auto_router' },
      { id: 'chosen', label: 'Chosen', kind: 'role' },
      { id: 'fallback', label: 'Fallback', kind: 'role' },
    ],
    edges: [
      { id: 'choice', fromNodeId: 'route', toNodeId: 'chosen', selection: 'choice' },
      { id: 'default', fromNodeId: 'route', toNodeId: 'fallback', selection: 'default' },
    ],
    routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: true, canReturnNeedsMoreResearch: true },
    contextPolicy: { includeUserTask: true, includeProjectMemory: false, includeBrowserSession: false, includePriorDecisions: false },
    memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true }, outputArtifactSchema: 'test',
  };
  const run: ArchitectureRun = {
    id: 'run', schemaId: schema.id, prompt: 'Route', executionMode: 'subagent_execution',
    rootSessionId: 'root', status: 'running', createdAt: 100, updatedAt: 100,
  };
  const chooseAutoRoute = vi.fn(async (_input: ArchitectureAutoRoutingInput) => ({
    edgeId: 'choice', source: 'jev_choice' as const, reason: 'confidence_met' as const, confidence: 0.95,
  }));
  const persistAutoRouteDecision = vi.fn(async (_event: ArchitectureExecutionEvent, _checkpointId: string) => undefined);
  return { schema, run, now: 100, roleExecutor: { execute: vi.fn() }, personaForSlot: () => 'persona', chooseAutoRoute, persistAutoRouteDecision };
}

function event(type: ArchitectureExecutionEvent['type'], nodeId: string, sequence: number): ArchitectureExecutionEvent {
  return { id: `prior-${sequence}`, runId: 'run', type, nodeId, sequence, message: type, createdAt: sequence };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('bounded graph auto-routing', () => {
  it('persists before emitting or dispatching and passes all current events', async () => {
    const options = fixture();
    const live: ArchitectureExecutionEvent[] = [];
    const checkpoint = deferred();
    const entered = deferred();
    options.persistAutoRouteDecision.mockImplementation(async () => { entered.resolve(); await checkpoint.promise; });
    const execution = createArchitectureGraphEvents({ ...options, onEvent: (value) => live.push(value) });
    await entered.promise;
    expect(live.some((value) => value.type === 'router_decision')).toBe(false);
    expect(live.some((value) => value.nodeId === 'chosen')).toBe(false);
    expect(options.chooseAutoRoute.mock.calls[0]?.[0].incomingEvents).toContainEqual(expect.objectContaining({ type: 'node_started', nodeId: 'route' }));
    checkpoint.resolve();
    const events = await execution;
    expect(options.persistAutoRouteDecision).toHaveBeenCalledWith(expect.objectContaining({
      id: 'architecture-route:run:route:1:event', route: expect.objectContaining({ selectedEdgeId: 'choice' }),
    }), 'architecture-route:run:route:1');
    expect(events.filter((value) => value.type === 'node_started').map((value) => value.nodeId)).toEqual(['route', 'chosen']);
  });

  it('fails closed without durable storage before asking Jev', async () => {
    const options = fixture();
    await expect(createArchitectureGraphEvents({ ...options, persistAutoRouteDecision: undefined })).rejects.toThrow('Durable route decision storage');
    expect(options.chooseAutoRoute).not.toHaveBeenCalled();
  });

  it('does not emit or dispatch a decision whose persistence failed', async () => {
    const options = fixture();
    options.persistAutoRouteDecision.mockRejectedValue(new Error('storage failed'));
    const live: ArchitectureExecutionEvent[] = [];
    await expect(createArchitectureGraphEvents({ ...options, onEvent: (value) => live.push(value) })).rejects.toThrow('storage failed');
    expect(live.some((value) => value.type === 'router_decision' || value.nodeId === 'chosen')).toBe(false);
  });

  it('does not convert a retryable storage error into a routing fallback', async () => {
    const options = fixture();
    const failure = createWorkflowError('TIMEOUT', 'checkpoint timeout', { source: 'test' });
    options.persistAutoRouteDecision.mockRejectedValue(failure);
    const live: ArchitectureExecutionEvent[] = [];
    await expect(createArchitectureGraphEvents({ ...options, onEvent: (value) => live.push(value) })).rejects.toBe(failure);
    expect(live.some((value) => value.type === 'router_decision' || value.nodeId === 'chosen' || value.nodeId === 'fallback')).toBe(false);
    expect(live).toContainEqual(expect.objectContaining({ type: 'node_failed', nodeId: 'route', errorCode: 'TIMEOUT' }));
  });

  it('persists the safe default when the chooser is unavailable', async () => {
    const options = fixture();
    const events = await createArchitectureGraphEvents({ ...options, chooseAutoRoute: undefined });
    expect(options.persistAutoRouteDecision).toHaveBeenCalledOnce();
    expect(events).toContainEqual(expect.objectContaining({ type: 'router_decision', route: expect.objectContaining({ source: 'runtime_fallback', selectedEdgeId: 'default' }) }));
    expect(events.filter((value) => value.type === 'node_started').map((value) => value.nodeId)).toEqual(['route', 'fallback']);
  });

  it('keeps the existing finalization gate after Jev selects a complete edge', async () => {
    const options = fixture();
    options.schema.nodes[1] = { id: 'chosen', label: 'Complete', kind: 'artifact', roleSlotId: 'finalizer' };
    options.schema.roleSlots = [{
      id: 'finalizer', label: 'Finalizer', description: 'Finalize', slotType: 'finalizer',
      defaultPersonaId: 'finalizer', allowedPersonaTags: [], required: true, canOverrideAtRunStart: true,
    }];
    options.run.branchSessionIds = { finalizer: 'finalizer-session' };
    options.run.context = { externalQualityGate: { source: 'build', status: 'failed', blocking: true } };
    const live: ArchitectureExecutionEvent[] = [];
    await expect(createArchitectureGraphEvents({ ...options, onEvent: (value) => live.push(value) })).rejects.toThrow('Architecture finalization blocked');
    expect(options.persistAutoRouteDecision).toHaveBeenCalledOnce();
    expect(options.roleExecutor.execute).not.toHaveBeenCalled();
    expect(live.some((value) => value.type === 'final_artifact')).toBe(false);
    expect(live).toContainEqual(expect.objectContaining({ type: 'node_failed', nodeId: 'chosen' }));
  });

  it('replays a saved visit without asking Jev or persisting twice', async () => {
    const options = fixture();
    const first = await createArchitectureGraphEvents(options);
    const checkpointIndex = first.findIndex((value) => value.type === 'router_decision');
    const priorEvents = first.slice(0, checkpointIndex + 1);
    options.chooseAutoRoute.mockClear();
    options.persistAutoRouteDecision.mockClear();
    const resumeFrom: ArchitectureRuntimeResumeCursor = { reason: 'runtime_recovery', pendingNodeIds: ['route'], visitCounts: {}, resumeStartedNodeIds: ['route'] };
    const replayed = await createArchitectureGraphEvents({ ...options, priorEvents, resumeFrom });
    expect(options.chooseAutoRoute).not.toHaveBeenCalled();
    expect(options.persistAutoRouteDecision).not.toHaveBeenCalled();
    expect(replayed.filter((value) => value.type === 'node_started' && value.nodeId === 'route')).toHaveLength(1);
    expect(replayed.filter((value) => value.type === 'router_decision')).toHaveLength(1);
  });

  it('does not restart roots for an empty runtime recovery queue', async () => {
    const options = fixture();
    const resumeFrom: ArchitectureRuntimeResumeCursor = { reason: 'runtime_recovery', pendingNodeIds: [], visitCounts: {} };
    expect(await createArchitectureGraphEvents({ ...options, resumeFrom })).toEqual([]);
    expect(options.chooseAutoRoute).not.toHaveBeenCalled();
  });

  it('resumes an interrupted started router without duplicating its start', async () => {
    const options = fixture();
    const started = event('node_started', 'route', 10);
    const unrelatedEvidence = event('participant_output', 'other-branch', 9);
    const resumeFrom: ArchitectureRuntimeResumeCursor = { reason: 'runtime_recovery', pendingNodeIds: ['route'], resumeStartedNodeIds: ['route'], visitCounts: {} };
    const events = await createArchitectureGraphEvents({ ...options, priorEvents: [unrelatedEvidence, started], resumeFrom });
    expect(events.filter((value) => value.type === 'node_started' && value.nodeId === 'route')).toEqual([started]);
    expect(options.chooseAutoRoute).toHaveBeenCalledOnce();
    expect(options.chooseAutoRoute.mock.calls[0]?.[0].incomingEvents).toContain(unrelatedEvidence);
    expect(events.find((value) => value.type === 'router_decision')?.sequence).toBe(11);
  });

  it('makes one durable decision per visit and terminates a selected self loop at the visit cap', async () => {
    const options = fixture();
    options.schema.edges[0]!.toNodeId = 'route';
    options.run.context = { maxArchitectureNodeVisits: 2 };
    const resumeFrom: ArchitectureRuntimeResumeCursor = { reason: 'runtime_recovery', pendingNodeIds: ['route'], visitCounts: {} };
    const events = await createArchitectureGraphEvents({ ...options, resumeFrom });
    expect(options.chooseAutoRoute).toHaveBeenCalledTimes(2);
    expect(options.persistAutoRouteDecision.mock.calls.map((call) => call[1])).toEqual(['architecture-route:run:route:1', 'architecture-route:run:route:2']);
    expect(events).toContainEqual(expect.objectContaining({ reasonCode: 'max_node_visits' }));
    expect(events.filter((value) => value.type === 'node_completed' && value.nodeId === 'route')).toHaveLength(2);
  });

  it('merges completed counts with cursor counts even without prior events', async () => {
    for (const priorEvents of [[], [event('node_completed', 'route', 1)]]) {
      const options = fixture();
      options.run.context = { maxArchitectureNodeVisits: 1 };
      const resumeFrom: ArchitectureRuntimeResumeCursor = { reason: 'runtime_recovery', pendingNodeIds: ['route'], visitCounts: priorEvents.length ? {} : { route: 1 } };
      const events = await createArchitectureGraphEvents({ ...options, priorEvents, resumeFrom });
      expect(events).toContainEqual(expect.objectContaining({ reasonCode: 'max_node_visits' }));
      expect(options.chooseAutoRoute).not.toHaveBeenCalled();
    }
  });

  it('retains a checkpoint finishing after Stop and blocks successors', async () => {
    const options = fixture();
    const checkpoint = deferred();
    const entered = deferred();
    options.persistAutoRouteDecision.mockImplementation(async () => { entered.resolve(); await checkpoint.promise; });
    const execution = createArchitectureGraphEvents(options);
    await entered.promise;
    options.run.status = 'cancelled';
    checkpoint.resolve();
    const events = await execution;
    expect(events).toContainEqual(expect.objectContaining({ type: 'router_decision', nodeId: 'route' }));
    expect(events.some((value) => value.type === 'node_started' && value.nodeId !== 'route')).toBe(false);
  });

  it('blocks successors when onEvent stops immediately after the durable decision', async () => {
    const options = fixture();
    const events = await createArchitectureGraphEvents({ ...options, onEvent: (value) => {
      if (value.type === 'router_decision') options.run.status = 'cancelled';
    } });
    expect(options.persistAutoRouteDecision).toHaveBeenCalledOnce();
    expect(events.some((value) => value.type === 'node_started' && value.nodeId !== 'route')).toBe(false);
  });

  it('honors the parent stop callback without requiring mutation of the graph run object', async () => {
    const options = fixture();
    let stopped = true;
    expect(await createArchitectureGraphEvents({ ...options, isStopped: () => stopped })).toEqual([]);
    expect(options.chooseAutoRoute).not.toHaveBeenCalled();
    stopped = false;
    const events = await createArchitectureGraphEvents({ ...options, isStopped: () => stopped,
      onEvent: (value) => { if (value.type === 'router_decision') stopped = true; },
    });
    expect(options.run.status).toBe('running');
    expect(options.persistAutoRouteDecision).toHaveBeenCalledOnce();
    expect(events.some((value) => value.type === 'node_started' && value.nodeId !== 'route')).toBe(false);
  });

  it('drains every started branch before propagating a parallel error', async () => {
    const options = fixture();
    const drained = deferred();
    const entered = deferred();
    const live: ArchitectureExecutionEvent[] = [];
    options.schema.nodes = ['fast', 'slow'].map((id) => ({ id, label: id, kind: 'role', roleSlotId: id }));
    options.schema.edges = [];
    options.schema.roleSlots = ['fast', 'slow'].map((id) => ({
      id, label: id, description: id, slotType: 'participant', defaultPersonaId: id,
      allowedPersonaTags: [], required: true, canOverrideAtRunStart: true,
    }));
    options.run.branchSessionIds = { fast: 'fast-session', slow: 'slow-session' };
    let settled = false;
    const failure = new Error('branch failed');
    const execution = createArchitectureGraphEvents({ ...options,
      roleExecutor: { execute: async ({ node }) => {
        if (node?.id === 'fast') throw failure;
        entered.resolve();
        await drained.promise;
        return { message: 'slow completed', data: {} };
      } },
      onEvent: (value) => live.push(value),
    }).then(() => { settled = true; return undefined; }, (error: unknown) => { settled = true; return error; });
    await entered.promise;
    await vi.waitFor(() => expect(live).toContainEqual(expect.objectContaining({ type: 'node_failed', nodeId: 'fast' })));
    expect(settled).toBe(false);
    drained.resolve();
    expect(await execution).toBe(failure);
    expect(live).toContainEqual(expect.objectContaining({ type: 'node_completed', nodeId: 'slow' }));
  });
});

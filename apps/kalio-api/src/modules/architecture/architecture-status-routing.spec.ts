import type { ArchitectureExecutionEvent, ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import { describe, expect, it, vi } from 'vitest';
import { statusRoutingDecision } from './architecture-status-routing';
import { hasValidStatusRoutingTopology } from './architecture-status-routing.schema';
import { createArchitectureGraphEvents } from './architecture-graph-runtime';
import { recoverAutoRoutingCursor } from './architecture-runtime-auto-routing-recovery.utils';
import { createWorkflowError } from '../../common/utils/workflow-error.util';

function fixture() {
  const schema: ArchitectureSchema = {
    id: 'status-test', name: 'Status', version: '1', description: '',
    roleSlots: [{ id: 'worker', label: 'Worker', description: '', slotType: 'participant', defaultPersonaId: 'p', allowedPersonaTags: [], required: true, canOverrideAtRunStart: true }],
    nodes: [
      { id: 'worker', label: 'Worker', kind: 'role', roleSlotId: 'worker' },
      { id: 'if', label: 'If completed', kind: 'status_router', statusRouting: { sourceNodeId: 'worker', expectedStatus: 'completed' } },
      { id: 'yes', label: 'Yes', kind: 'parallel' }, { id: 'no', label: 'Else', kind: 'parallel' },
    ],
    edges: [
      { id: 'in', fromNodeId: 'worker', toNodeId: 'if' },
      { id: 'yes-edge', fromNodeId: 'if', toNodeId: 'yes', selection: 'choice' },
      { id: 'no-edge', fromNodeId: 'if', toNodeId: 'no', selection: 'default' },
    ],
    routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: true, canReturnNeedsMoreResearch: true },
    contextPolicy: { includeUserTask: true, includeProjectMemory: false, includeBrowserSession: false, includePriorDecisions: false },
    memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true }, outputArtifactSchema: 'test',
  };
  const run: ArchitectureRun = { id: 'run', schemaId: schema.id, prompt: 'Test', status: 'running',
    executionMode: 'subagent_execution', rootSessionId: 'root', branchSessionIds: { worker: 'worker-session' }, createdAt: 1, updatedAt: 1 };
  return { schema, run, now: 1, personaForSlot: () => 'p',
    roleExecutor: { execute: vi.fn(async () => ({ message: 'Done', data: {} })) },
    chooseAutoRoute: vi.fn(),
    persistAutoRouteDecision: vi.fn(async (_event: ArchitectureExecutionEvent, _checkpoint: string) => undefined) };
}

function event(sequence: number, type: ArchitectureExecutionEvent['type'], extra: Partial<ArchitectureExecutionEvent> = {}): ArchitectureExecutionEvent {
  return { id: 'e' + sequence, runId: 'run', sequence, type, nodeId: 'worker', message: type, createdAt: sequence, ...extra };
}

describe('deterministic status routing', () => {
  it.each(['completed', 'failed'] as const)('compares both expected values against %s without LLM', status => {
    const { schema } = fixture();
    const events = [event(1, 'node_started'), event(2, status === 'failed' ? 'node_failed' : 'node_completed')];
    for (const expectedStatus of ['completed', 'failed'] as const) {
      const node = schema.nodes[1]!;
      node.statusRouting = { sourceNodeId: 'worker', expectedStatus };
      expect(statusRoutingDecision(schema, node, events, 'run').edge.id).toBe(status === expectedStatus ? 'yes-edge' : 'no-edge');
    }
  });

  it('scopes to the latest source visit and rejects missing or conflicting terminals', () => {
    const { schema } = fixture(); const node = schema.nodes[1]!;
    const old = [event(1, 'node_started'), event(2, 'node_failed')];
    expect(() => statusRoutingDecision(schema, node, [...old, event(3, 'node_started')], 'run')).toThrow('terminal');
    expect(statusRoutingDecision(schema, node, [...old, event(3, 'node_started'), event(4, 'node_completed')], 'run').matched).toBe(true);
    expect(() => statusRoutingDecision(schema, node, [event(1, 'node_started'), event(2, 'node_completed'), event(3, 'node_failed')], 'run')).toThrow('terminal');
    expect(() => statusRoutingDecision(schema, node, [event(1, 'node_started', { runId: 'other' })], 'run')).toThrow('started');
  });

  it('treats recovered source failure as failed, while a nested tool error does not define source outcome', () => {
    const { schema } = fixture(); const node = schema.nodes[1]!;
    const events = [event(1, 'node_started'), event(2, 'participant_output', { data: { runtimeGuard: 'recoverable_node_error' } }), event(3, 'node_completed')];
    expect(statusRoutingDecision(schema, node, events, 'run').binding.observedStatus).toBe('failed');
    events[1] = event(2, 'tool_call', { errorCode: 'TIMEOUT' });
    expect(statusRoutingDecision(schema, node, events, 'run').binding.observedStatus).toBe('completed');
  });

  it('requires exactly one source and one Yes/Else route with different targets', () => {
    const { schema } = fixture();
    expect(hasValidStatusRoutingTopology(schema.nodes, schema.edges)).toBe(true);
    expect(hasValidStatusRoutingTopology(schema.nodes, [...schema.edges, { ...schema.edges[0]!, id: 'in2' }])).toBe(false);
    expect(hasValidStatusRoutingTopology(schema.nodes, [...schema.edges, {
      id: 'bypass', fromNodeId: 'worker', toNodeId: 'no', selection: 'continuation',
    }])).toBe(false);
    expect(hasValidStatusRoutingTopology(schema.nodes, schema.edges.map(edge => ({ ...edge, selection: 'choice' })))).toBe(false);
  });

  it('rejects a forged timeout marker without the canonical participant timeout identity', () => {
    const { schema } = fixture();
    expect(() => statusRoutingDecision(schema, schema.nodes[1]!, [
      event(1, 'node_started'), event(2, 'tool_call', { data: { runtimeGuard: 'tool_timeout_recovery' } }),
    ], 'run')).toThrow('terminal');
    expect(() => statusRoutingDecision(schema, schema.nodes[1]!, [
      event(1, 'node_started'), event(2, 'participant_output', { data: { runtimeGuard: 'tool_timeout_recovery' } }),
    ], 'run')).toThrow('terminal');
  });

  it.each([false, true])('runs exactly one branch, checkpoints before dispatch and replays (failure=%s)', async failed => {
    const options = fixture();
    if (failed) options.roleExecutor.execute.mockRejectedValue(createWorkflowError('TIMEOUT', 'timed out', { source: 'test' }));
    const events = await createArchitectureGraphEvents(options);
    const decision = events.find(row => row.nodeId === 'if' && row.type === 'router_decision')!;
    expect(decision.route?.selectedNodeIds).toEqual([failed ? 'no' : 'yes']);
    expect(options.chooseAutoRoute).not.toHaveBeenCalled();
    expect(options.roleExecutor.execute).toHaveBeenCalledTimes(1);
    expect(options.persistAutoRouteDecision).toHaveBeenCalledTimes(1);
    const prefix = events.slice(0, events.indexOf(decision) + 1);
    const cursor = recoverAutoRoutingCursor(options.schema, prefix)!;
    expect(cursor.pendingNodeIds).toEqual([failed ? 'no' : 'yes']);
    const replay = await createArchitectureGraphEvents({ ...options, priorEvents: prefix, resumeFrom: cursor });
    expect(replay.filter(row => row.type === 'node_started' && row.nodeId === (failed ? 'no' : 'yes'))).toHaveLength(1);
    expect(options.persistAutoRouteDecision).toHaveBeenCalledTimes(1);
    const changed = structuredClone(options.schema); changed.nodes[1]!.statusRouting!.expectedStatus = 'failed';
    expect(() => recoverAutoRoutingCursor(changed, prefix)).toThrow('condition');
  });

  it('preserves contract failures and checkpoint failures as terminal', async () => {
    const options = fixture();
    options.roleExecutor.execute.mockRejectedValue(createWorkflowError('CONTRACT_VIOLATION', 'bad contract', { source: 'test' }));
    await expect(createArchitectureGraphEvents(options)).rejects.toThrow('bad contract');
    expect(options.persistAutoRouteDecision).not.toHaveBeenCalled();
    options.roleExecutor.execute.mockResolvedValue({ message: 'Done', data: {} });
    options.persistAutoRouteDecision.mockRejectedValue(createWorkflowError('TIMEOUT', 'save timeout', { source: 'test' }));
    const live: ArchitectureExecutionEvent[] = [];
    await expect(createArchitectureGraphEvents({ ...options, onEvent: row => live.push(row) })).rejects.toThrow('save timeout');
    expect(live.some(row => row.nodeId === 'yes' || row.nodeId === 'no')).toBe(false);
  });

  it('routes an exhausted tool-executor timeout through its explicit condition', async () => {
    const options = fixture();
    options.schema.roleSlots[0]!.slotType = 'tool_executor';
    options.roleExecutor.execute.mockResolvedValue({
      message: 'Timed out', data: { errorCode: 'SUBAGENT_TIMEOUT', recoverableRuntimeError: 'Tool deadline exceeded' },
    });
    const events = await createArchitectureGraphEvents(options);
    expect(events.find(row => row.nodeId === 'if' && row.type === 'router_decision')?.route?.nextNodeId).toBe('no');
    expect(options.chooseAutoRoute).not.toHaveBeenCalled();
  });

  it('recovers an interrupted status evaluation and refuses missing storage', async () => {
    const options = fixture();
    const prior = [event(1, 'node_started'), event(2, 'participant_output'), event(3, 'node_completed'),
      event(4, 'node_started', { nodeId: 'if' })];
    const cursor = recoverAutoRoutingCursor(options.schema, prior)!;
    expect(cursor.reason === 'runtime_recovery' ? cursor.resumeStartedNodeIds : undefined).toEqual(['if']);
    const events = await createArchitectureGraphEvents({ ...options, priorEvents: prior, resumeFrom: cursor });
    expect(events.filter(row => row.nodeId === 'worker' && row.type === 'node_started')).toHaveLength(1);
    expect(options.roleExecutor.execute).not.toHaveBeenCalled();
    expect(events.find(row => row.nodeId === 'if' && row.type === 'router_decision')?.route?.nextNodeId).toBe('yes');
    await expect(createArchitectureGraphEvents({ ...fixture(), persistAutoRouteDecision: undefined })).rejects.toThrow('Durable route');
  });

  it('does not publish a branch when stopped during checkpoint persistence', async () => {
    const options = fixture(); const live: ArchitectureExecutionEvent[] = [];
    options.persistAutoRouteDecision.mockImplementation(async () => { options.run.status = 'cancelled'; });
    await createArchitectureGraphEvents({ ...options, onEvent: row => live.push(row) });
    expect(live.some(row => row.nodeId === 'yes' || row.nodeId === 'no' || row.type === 'router_decision')).toBe(false);
  });
});

import type { ArchitectureExecutionEvent, ArchitectureRoleSlot, ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import { describe, expect, it, vi } from 'vitest';
import { ArchitectureGraphContext } from './architecture-graph-runtime.context';
import { executeNode } from './architecture-graph-runtime.nodes';
import { ArchitectureRoleObjective } from './architecture-role-objective';
import { statusRoutingDecision } from './architecture-status-routing';
import { recoverAutoRoutingCursor } from './architecture-runtime-auto-routing-recovery.utils';
import { createArchitectureGraphEvents } from './architecture-graph-runtime';

function slot(id: string, slotType: ArchitectureRoleSlot['slotType']): ArchitectureRoleSlot {
  return { id, label: id, slotType, description: '', defaultPersonaId: 'p', allowedPersonaTags: [], required: true, canOverrideAtRunStart: true };
}
function fixture() {
  const schema: ArchitectureSchema = { id: 'handoff', name: 'Handoff', version: '1', description: '',
    roleSlots: [slot('core', 'tool_executor'), slot('orchestrator', 'router'), slot('ux', 'participant')],
    nodes: [{ id: 'core', label: 'Core', kind: 'role', roleSlotId: 'core' },
      { id: 'if', label: 'IF Core completed', kind: 'status_router', statusRouting: { sourceNodeId: 'core', expectedStatus: 'completed' } },
      { id: 'orchestrator', label: 'Orchestrator', kind: 'router', roleSlotId: 'orchestrator' },
      { id: 'ux', label: 'UX', kind: 'role', roleSlotId: 'ux' }, { id: 'end', label: 'End', kind: 'parallel' }],
    edges: [{ id: 'core-if', fromNodeId: 'core', toNodeId: 'if' },
      { id: 'if-yes', fromNodeId: 'if', toNodeId: 'ux', selection: 'choice' },
      { id: 'if-else', fromNodeId: 'if', toNodeId: 'orchestrator', selection: 'default' },
      { id: 'orchestrator-end', fromNodeId: 'orchestrator', toNodeId: 'end' }],
    routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: false, canReturnNeedsMoreResearch: false },
    contextPolicy: { includeUserTask: true, includeProjectMemory: false, includeBrowserSession: false, includePriorDecisions: false },
    memoryPolicy: { persistFinalArtifact: false, persistRouterDecision: true }, outputArtifactSchema: 'Artifact' };
  const run: ArchitectureRun = { id: 'run', schemaId: schema.id, prompt: 'Verify Town', executionMode: 'subagent_execution',
    status: 'running', rootSessionId: 'root', branchSessionIds: { core: 'core-session', orchestrator: 'orchestrator-session', ux: 'ux-session' }, createdAt: 1, updatedAt: 1 };
  const objectives: string[] = [];
  const roleExecutor = { execute: vi.fn(async (input: Parameters<ArchitectureRoleObjective['buildObjective']>[0]) => {
    objectives.push(new ArchitectureRoleObjective().buildObjective(input));
    return { message: 'Routed', data: {} };
  }) };
  return { schema, run, objectives, roleExecutor, now: 1, personaForSlot: () => 'p',
    persistAutoRouteDecision: vi.fn(async () => undefined) };
}
function event(sequence: number, type: ArchitectureExecutionEvent['type'], extra: Partial<ArchitectureExecutionEvent> = {}): ArchitectureExecutionEvent {
  return { id: `run:event:${sequence}`, runId: 'run', sequence, type, nodeId: 'core', roleSlotId: 'core', message: type, createdAt: sequence, ...extra };
}
function visit(options: ReturnType<typeof fixture>, start: number, terminal: number, results: number, failed = true,
  prior: ArchitectureExecutionEvent[] = []): ArchitectureExecutionEvent[] {
  const output = event(terminal, 'participant_output', { message: failed ? `Recoverable timeout; partial evidence ${results}` : 'Core completed with real files',
    ...(failed ? { errorCode: 'SUBAGENT_TIMEOUT' as const } : {}),
    data: { ...(failed ? { runtimeGuard: 'tool_timeout_recovery', recoverableRuntimeError: 'Sub-agent timed out after 300000ms' } : {}),
      toolEvidence: { toolCallCount: results, toolResultCount: results, toolNames: ['fs_write'], successfulToolNames: ['fs_write'], targetPaths: [`src/modes/town/visit-${results}.ts`] } } });
  const before = [...prior, event(start, 'node_started'), output,
    ...(!failed ? [event(terminal + 1, 'node_completed')] : [])];
  const decision = statusRoutingDecision(options.schema, options.schema.nodes[1]!, before, 'run');
  const checkpoint = event(terminal + 2, 'router_decision', { nodeId: 'if', roleSlotId: undefined,
    message: failed ? 'Core failed. Else.' : 'Core completed. Yes.',
    route: { source: 'status_condition', fromNodeId: 'if', selectedEdgeId: decision.edge.id,
      nextNodeId: decision.edge.toNodeId, selectedNodeIds: [decision.edge.toNodeId], rejectedNodeIds: [] },
    data: { kind: 'auto_routing_decision', autoRoutingVisit: prior.length ? 2 : 1,
      selectedEdgeId: decision.edge.id, pendingNodeIds: [decision.edge.toNodeId], statusRoutingDecision: decision.binding } });
  return [...before, checkpoint];
}
function context(options: ReturnType<typeof fixture>, events: ArchitectureExecutionEvent[]) {
  const ctx = new ArchitectureGraphContext({ ...options, priorEvents: events });
  ctx.seedPriorEvents();
  return ctx;
}
function inputs(ctx: ArchitectureGraphContext, receiver = 'orchestrator') {
  const receiverSlot = ctx.options.schema.roleSlots.find(candidate => candidate.id === receiver)!;
  return ctx.incomingEventsForSlot(receiverSlot, ['if'], receiver);
}

describe('status gate source contribution handoff', () => {
  it('passes original failed partial evidence and gate decision to the real router objective path', async () => {
    const options = fixture(); const events = visit(options, 44, 136, 38);
    const ctx = context(options, events); const receiver = options.schema.nodes[2]!;
    await executeNode(ctx, receiver, ['if'], ['end'], new Map(options.schema.nodes.map(node => [node.id, node])));
    const incoming = options.roleExecutor.execute.mock.calls[0]![0].incomingEvents!;
    expect(incoming).toContain(events.find(e => e.sequence === 136));
    expect(incoming).toContain(events.at(-1));
    expect(options.objectives[0]).toContain('38 result(s)');
    expect(options.objectives[0]).toContain('src/modes/town/visit-38.ts');
    expect(options.objectives[0]).toContain('Recoverable timeout');
    expect(incoming.find(e => e.sequence === 136)?.errorCode).toBe('SUBAGENT_TIMEOUT');
  });

  it('forwards only the current source visit, not stale or cross-run partial evidence', () => {
    const options = fixture(); const first = visit(options, 44, 136, 38);
    const events = visit(options, 202, 286, 23, true, first);
    events.push(event(300, 'participant_output', { runId: 'foreign', message: 'foreign', data: { toolEvidence: { toolResultCount: 999 } } }));
    const selected = inputs(context(options, events));
    expect(selected.filter(e => e.nodeId === 'core').map(e => e.sequence)).toEqual([286]);
    expect(selected.find(e => e.sequence === 286)?.data?.toolEvidence).toMatchObject({ toolResultCount: 23 });
    expect(selected.some(e => e.runId === 'foreign')).toBe(false);
  });

  it('passes the completed source contribution on Yes but not to the non-selected Else receiver', () => {
    const options = fixture(); const events = visit(options, 44, 136, 7, false);
    expect(inputs(context(options, events), 'ux').filter(e => e.nodeId === 'core').map(e => e.sequence)).toEqual([136]);
    expect(inputs(context(options, events)).some(e => e.nodeId === 'core')).toBe(false);
  });

  it('does not fall back to a previous Else visit after the latest checkpoint selected Yes', () => {
    const options = fixture(); const first = visit(options, 44, 136, 38);
    const events = visit(options, 202, 286, 23, false, first);
    expect(inputs(context(options, events)).some(e => e.nodeId === 'core')).toBe(false);
  });

  it.each(['sourceTerminalEventId', 'sourceStartedEventId'] as const)('rejects forged %s binding', key => {
    const options = fixture(); const events = visit(options, 44, 136, 38);
    const checkpoint = events.at(-1)!;
    checkpoint.data = { ...checkpoint.data, statusRoutingDecision: { ...(checkpoint.data?.statusRoutingDecision as Record<string, unknown>), [key]: 'foreign-event' } };
    expect(() => inputs(context(options, events))).toThrow();
  });

  it('rejects stale source binding when a newer source visit has started without a terminal', () => {
    const options = fixture(); const events = visit(options, 44, 136, 38);
    events.push(event(202, 'node_started'));
    expect(() => inputs(context(options, events))).toThrow();
  });

  it('reconstructs identical current-visit input after durable checkpoint recovery', async () => {
    const options = fixture(); const events = visit(options, 44, 136, 38);
    const cursor = recoverAutoRoutingCursor(options.schema, events)!;
    await createArchitectureGraphEvents({ ...options, priorEvents: JSON.parse(JSON.stringify(events)), resumeFrom: cursor });
    expect(options.objectives[0]).toContain('38 result(s)');
    expect(options.objectives[0]).toContain('src/modes/town/visit-38.ts');
    expect(options.roleExecutor.execute).toHaveBeenCalledTimes(1);
    expect(options.persistAutoRouteDecision).not.toHaveBeenCalled();
  });

  it('rejects missing and cross-run checkpoint provenance instead of dropping source evidence silently', () => {
    const options = fixture(); const events = visit(options, 44, 136, 38);
    expect(() => inputs(context(options, events.slice(0, -1)))).toThrow('durable decision');
    const foreign = [...events.slice(0, -1), { ...events.at(-1)!, runId: 'foreign' }];
    expect(() => inputs(context(options, foreign))).toThrow('durable decision');
    expect(() => context(options, events).incomingEventsForSlot(options.schema.roleSlots[1]!, ['if']))
      .toThrow('explicit receiver');
  });

  it('deduplicates original source contributions when already present among direct inputs', () => {
    const options = fixture(); const events = visit(options, 44, 136, 38);
    const ctx = context(options, events);
    const selected = ctx.incomingEventsForSlot(options.schema.roleSlots[1]!, ['core', 'if'], 'orchestrator');
    expect(selected.filter(e => e.sequence === 136)).toHaveLength(1);
  });

  it('leaves ordinary direct router inputs and judge/finalizer selectors unchanged', () => {
    const options = fixture(); const events = [event(1, 'participant_output'), event(2, 'tool_call')];
    const ctx = context(options, events);
    expect(ctx.incomingEventsForSlot(options.schema.roleSlots[1]!, ['core'], 'orchestrator')).toEqual(events);
    for (const kind of ['judge', 'finalizer'] as const) {
      expect(ctx.incomingEventsForSlot(slot('review', kind), ['if'], 'review')).toEqual([events[0]]);
    }
  });
});

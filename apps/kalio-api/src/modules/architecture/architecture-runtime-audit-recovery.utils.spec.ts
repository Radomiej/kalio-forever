import type { ArchitectureExecutionEvent } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import {
  architectureAuditExecutionMode,
  architectureAuditAutoRoutingData,
  architectureAuditRouteDecisionField,
  architectureAuditPromptFromRecords,
  statusFromArchitectureAuditEventSummary,
  statusFromArchitectureEvents,
  architectureAuditLifecycleField,
  architectureAuditStatusField,
} from './architecture-runtime-audit-recovery.utils';

describe('architecture runtime audit recovery utils', () => {
  it.each(['queued', 'running', 'waiting_on_orchestrator', 'done', 'failed', 'cancelled', 'blocked'] as const)(
    'TASK59 preserves recognized status %s', status => {
      expect(architectureAuditStatusField({ status })).toBe(status);
    },
  );
  it.each(['started', 'node_started', 'node_completed', 'edge_taken', 'guard_result', 'tool_called',
    'return_to_orchestrator', 'waiting_on_orchestrator', 'resume_input', 'done', 'blocked', 'failed',
    'cancelled', 'runtime_missing', 'runtime_stalled', 'copy_back'] as const)(
    'TASK59 preserves recognized lifecycle %s', lifecycle => {
      expect(architectureAuditLifecycleField({ lifecycle })).toBe(lifecycle);
    },
  );
  it.each([undefined, null, 23, {}, 'future-state', 'completed'])(
    'TASK59 omits unknown lifecycle/status %j', value => {
      expect(architectureAuditStatusField({ status: value })).toBeUndefined();
      expect(architectureAuditLifecycleField({ lifecycle: value })).toBeUndefined();
    },
  );
  it.each([
    { terminal: { type: 'node_failed' }, expected: 'failed' },
    { terminal: { type: 'router_decision', status: 'failed' as const }, expected: 'failed' },
    { terminal: { type: 'router_decision', status: 'blocked' as const }, expected: 'failed' },
    { terminal: { type: 'router_decision', status: 'cancelled' as const }, expected: 'cancelled' },
    { terminal: { type: 'run_stopped' }, expected: 'cancelled' },
    { terminal: { type: 'router_decision', reasonCode: 'max_steps' as const }, expected: 'failed' },
    { terminal: { type: 'router_decision', reasonCode: 'max_node_visits' as const }, expected: 'failed' },
  ])('TASK59 keeps $expected through neutral progress after $terminal', ({ terminal, expected }) => {
    expect(statusFromArchitectureAuditEventSummary([
      terminal, { type: 'router_decision' }, { type: 'node_started', status: 'running' },
    ])).toBe(expected);
    expect(statusFromArchitectureAuditEventSummary([
      terminal, { type: 'final_artifact' }, { type: 'router_decision' },
    ])).toBe('completed');
  });
  it.each([
    { type: 'run_stopped' as const },
    { type: 'node_started' as const, status: 'cancelled' as const },
  ])('uses later typed cancellation after a final artifact (%j)', (cancellation) => {
    const events = [
      architectureEvent({ type: 'final_artifact', sequence: 1, createdAt: 1 }),
      architectureEvent({ ...cancellation, sequence: 2, createdAt: 2 }),
    ];
    expect(statusFromArchitectureEvents(events)).toBe('cancelled');
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it('keeps the latest final artifact completed and preserves later failure statuses', () => {
    expect(statusFromArchitectureEvents([
      architectureEvent({ type: 'run_stopped', sequence: 1 }),
      architectureEvent({ type: 'final_artifact', sequence: 2 }),
    ])).toBe('completed');
    expect(statusFromArchitectureEvents([architectureEvent({ type: 'final_artifact' })])).toBe('completed');
    expect(statusFromArchitectureEvents([
      architectureEvent({ type: 'final_artifact', sequence: 1 }),
      architectureEvent({ type: 'node_completed', sequence: 2 }),
    ])).toBe('completed');
    expect(statusFromArchitectureEvents([
      architectureEvent({ type: 'final_artifact', sequence: 1 }),
      architectureEvent({ type: 'run_stopped', sequence: 2 }),
      architectureEvent({ type: 'node_completed', sequence: 3 }),
    ])).toBe('cancelled');
    for (const status of ['failed', 'blocked'] as const) {
      expect(statusFromArchitectureEvents([
        architectureEvent({ type: 'final_artifact', sequence: 1 }),
        architectureEvent({ type: 'node_failed', status, sequence: 2 }),
      ])).toBe('failed');
    }
  });

  it('accepts typed Jev route fields and rejects malformed decision metadata', () => {
    const route = { source: 'jev_choice', fromNodeId: 'auto', selectedNodeIds: ['next'],
      selectedEdgeId: 'edge', nextNodeId: 'next', confidence: 0.9, decisionReason: 'selected' };
    expect(architectureAuditRouteDecisionField({ route }, 'route')).toEqual(route);
    for (const patch of [{ confidence: NaN }, { confidence: 1.1 }, { confidence: -0.1 },
      { selectedEdgeId: 42 }, { decisionReason: {} }]) {
      expect(architectureAuditRouteDecisionField({ route: { ...route, ...patch } }, 'route')).toBeUndefined();
    }
  });

  it('preserves ordinary event data and fails closed when only a partial checkpoint remains', () => {
    const ordinary = { kind: 'architecture_event', eventType: 'router_decision', messagePreview: 'auto_routing_decision' };
    expect(architectureAuditAutoRoutingData(ordinary)).toBe(ordinary);
    expect(() => architectureAuditAutoRoutingData({ ...ordinary, autoRoutingVisit: 1 })).toThrow(/checkpoint/);
    expect(() => architectureAuditAutoRoutingData({ ...ordinary, selectedEdgeId: 'edge' })).toThrow(/checkpoint/);
    expect(() => architectureAuditAutoRoutingData({ ...ordinary, route: { source: 'jev_choice' } })).toThrow(/checkpoint/);
    expect(() => architectureAuditAutoRoutingData({ ...ordinary, route: { selectedEdgeId: 'edge' } })).toThrow(/checkpoint/);
  });

  it.each(['router', 'runtime_fallback'] as const)('preserves ordinary %s handoff metadata without auto-routing markers', (source) => {
    const record = {
      kind: 'architecture_event', eventType: 'router_decision', reasonCode: 'runtime_pause',
      route: { source, fromNodeId: 'router', selectedNodeIds: ['next'], nextNodeId: 'next' },
      pendingNodeIds: ['next'], visitCounts: { router: 2 },
    };
    expect(architectureAuditAutoRoutingData(record)).toBe(record);
    expect(architectureAuditAutoRoutingData(record).kind).toBe('architecture_event');
  });

  it('derives terminal run status from typed event fields', () => {
    expect(statusFromArchitectureEvents([
      architectureEvent({ type: 'router_decision' }),
      architectureEvent({ type: 'final_artifact' }),
    ])).toBe('completed');

    expect(statusFromArchitectureAuditEventSummary([
      { type: 'router_decision', reasonCode: 'max_steps' },
    ])).toBe('failed');

    expect(statusFromArchitectureAuditEventSummary([
      { type: 'node_completed' },
      { type: 'node_started', status: 'cancelled' },
    ])).toBe('cancelled');

    expect(statusFromArchitectureAuditEventSummary([
      { type: 'node_completed' },
    ])).toBe('running');
  });

  it('recovers display prompt and execution mode without parsing runtime status text', () => {
    expect(architectureAuditPromptFromRecords([
      { eventType: 'run_created', prompt: 'Review workflow runtime' },
    ])).toBe('Review workflow runtime');

    expect(architectureAuditPromptFromRecords([
      {
        eventType: 'run_created',
        messagePreview: 'Architecture run created for: Legacy prompt',
      },
    ])).toBe('Legacy prompt');

    expect(architectureAuditExecutionMode({ executionMode: 'subagent_execution' })).toBe('subagent_execution');
    expect(architectureAuditExecutionMode({ executionMode: 'not-valid' })).toBe('session_branches');
  });
});

function architectureEvent(
  overrides: Pick<ArchitectureExecutionEvent, 'type'> & Partial<ArchitectureExecutionEvent>,
): ArchitectureExecutionEvent {
  return {
    id: `${overrides.type}-event`,
    runId: 'run-audit',
    sequence: 1,
    message: overrides.message ?? overrides.type,
    createdAt: 1,
    ...overrides,
  };
}

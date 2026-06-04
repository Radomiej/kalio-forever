import type { AgentFlowLifecycleEvent, ArchitectureExecutionEvent } from '@kalio/types';

export function normalizeFlowEventType(event: ArchitectureExecutionEvent): string {
  if (event.type === 'run_stopped') return 'flow:stopped';
  if (event.type === 'node_started') return 'flow:node_start';
  if (event.type === 'node_completed' || event.type === 'participant_output') {
    return 'flow:node_result';
  }
  if (event.type === 'router_decision' || event.type === 'router_output') {
    return event.data?.returnToOrchestrator === true
      || event.roleSlotId === 'goal_master'
      || event.nodeId === 'goal-master'
      ? 'flow:guard_result'
      : 'flow:edge_taken';
  }
  if (event.type === 'final_artifact') return 'flow:final_artifact';
  return `flow:${event.type}`;
}

export function normalizeFlowLifecycle(event: ArchitectureExecutionEvent): AgentFlowLifecycleEvent | undefined {
  if (event.type === 'run_created') return 'started';
  if (event.type === 'run_stopped') return 'cancelled';
  if (event.type === 'node_started') return 'node_started';
  if (event.type === 'node_completed' || event.type === 'participant_output') return 'node_completed';
  if (event.type === 'tool_call') return 'tool_called';
  if (event.type === 'router_decision' || event.type === 'router_output') {
    if (event.data?.returnToOrchestrator === true) return 'return_to_orchestrator';
    if (event.roleSlotId === 'goal_master' || event.nodeId === 'goal-master') return 'guard_result';
    return 'edge_taken';
  }
  if (event.type === 'final_artifact') return 'done';
  return undefined;
}

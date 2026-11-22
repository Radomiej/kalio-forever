import type { ArchitectureExecutionEvent, ArchitectureSchema } from '@kalio/types';
import { assertSavedStatusRoutingDecision, statusRoutingDecision } from './architecture-status-routing';

/** Status gates are control nodes: keep the selected source visit's original contribution. */
export function statusRoutingInputEvents(
  schema: ArchitectureSchema,
  events: readonly ArchitectureExecutionEvent[],
  runId: string,
  incomingNodeIds: readonly string[],
  receiverNodeId?: string,
): ArchitectureExecutionEvent[] {
  const runEvents = events.filter((event) => event.runId === runId).sort((a, b) => a.sequence - b.sequence);
  const incoming = new Set(incomingNodeIds);
  const selected = new Map(runEvents.filter((event) => event.nodeId && incoming.has(event.nodeId))
    .map((event) => [event.id, event]));

  for (const node of schema.nodes.filter((candidate) => incoming.has(candidate.id) && candidate.kind === 'status_router')) {
    if (!receiverNodeId) throw new Error(`Status input ${node.id} requires an explicit receiver.`);
    const checkpoint = runEvents.filter((event) => event.nodeId === node.id && event.type === 'router_decision').at(-1);
    if (!checkpoint) throw new Error(`Status input ${node.id} has no durable decision.`);
    const prior = runEvents.filter((event) => event.sequence < checkpoint.sequence);
    const edge = assertSavedStatusRoutingDecision(schema, checkpoint, prior);
    if (edge.toNodeId !== receiverNodeId) continue;
    const { binding } = statusRoutingDecision(schema, node, prior, runId);
    const latestStart = runEvents.filter((event) => event.nodeId === binding.sourceNodeId && event.type === 'node_started').at(-1);
    if (latestStart?.id !== binding.sourceStartedEventId) {
      throw new Error(`Status input ${node.id} does not match the current source visit.`);
    }
    const terminal = prior.find((event) => event.id === binding.sourceTerminalEventId)!;
    const contributions = prior.filter((event) => event.nodeId === binding.sourceNodeId
      && event.type === 'participant_output'
      && event.sequence > latestStart.sequence && event.sequence <= terminal.sequence);
    for (const contribution of contributions.length ? contributions : [terminal]) {
      selected.set(contribution.id, contribution);
    }
  }
  return [...selected.values()].sort((a, b) => a.sequence - b.sequence);
}

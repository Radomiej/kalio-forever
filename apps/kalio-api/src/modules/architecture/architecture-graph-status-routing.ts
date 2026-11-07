import type { ArchitectureSchemaNode } from '@kalio/types';
import type { ArchitectureGraphContext } from './architecture-graph-runtime.context';
import { architectureAutoRouteCheckpointId } from './architecture-graph-auto-routing.utils';
import { assertSavedStatusRoutingDecision, statusRoutingDecision } from './architecture-status-routing';

export async function executeStatusRoutingNode(ctx: ArchitectureGraphContext, node: ArchitectureSchemaNode): Promise<string[]> {
  if (ctx.isStopped()) return [];
  if (!ctx.options.persistAutoRouteDecision) throw new Error('Durable route decision storage is unavailable.');
  const visit = ctx.visitCount(node.id) + 1;
  const saved = [...ctx.events].reverse().find(event => event.type === 'router_decision'
    && event.nodeId === node.id && event.runId === ctx.options.run.id && event.data?.autoRoutingVisit === visit);
  if (saved) {
    const prior = ctx.events.filter(event => event.sequence < saved.sequence);
    return [assertSavedStatusRoutingDecision(ctx.options.schema, saved, prior).toNodeId];
  }
  const { edge, binding, matched } = statusRoutingDecision(ctx.options.schema, node, ctx.events, ctx.options.run.id);
  const selected = [edge.toNodeId];
  const checkpointId = architectureAutoRouteCheckpointId(ctx.options.run.id, node.id, visit);
  const event = ctx.createEvent('router_decision',
    `${node.label}: ${binding.sourceNodeId} ${binding.observedStatus}. ${matched ? 'Yes' : 'Else'}.`, {
      nodeId: node.id,
      actionSummary: 'Status condition selected one branch.',
      route: {
        source: 'status_condition', fromNodeId: node.id, selectedEdgeId: edge.id, nextNodeId: edge.toNodeId,
        selectedNodeIds: selected,
        rejectedNodeIds: ctx.options.schema.edges.filter(candidate => candidate.fromNodeId === node.id && candidate.id !== edge.id).map(candidate => candidate.toNodeId),
      },
      data: {
        kind: 'auto_routing_decision', autoRoutingVisit: visit, selectedEdgeId: edge.id,
        pendingNodeIds: selected, selectedNodeIds: selected,
        visitCounts: { ...Object.fromEntries(ctx.nodeVisitCounts), [node.id]: visit },
        statusRoutingDecision: binding,
      },
    });
  event.id = `${checkpointId}:event`;
  await ctx.options.persistAutoRouteDecision(event, checkpointId);
  if (ctx.isStopped()) return [];
  ctx.appendEvent(event);
  return selected;
}

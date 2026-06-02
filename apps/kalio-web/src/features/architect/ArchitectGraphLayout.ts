import type { ArchitectureSchemaEdge } from '@kalio/types';
import type { ArchitectNode } from './architect.types';

const ORIGIN_X = 120;
const ORIGIN_Y = 120;
const COLUMN_GAP = 240;
const ROW_GAP = 132;

export function layoutGraphNodes(
  nodes: ArchitectNode[],
  edges: ArchitectureSchemaEdge[],
): ArchitectNode[] {
  if (nodes.length === 0) {
    return nodes;
  }
  const ranks = rankNodes(nodes, edges);
  const groups = groupNodesByRank(nodes, ranks);
  const maxRows = Math.max(...[...groups.values()].map((group) => group.length), 1);
  const centerY = ORIGIN_Y + ((maxRows - 1) * ROW_GAP) / 2;

  return nodes.map((node) => {
    const rank = ranks.get(node.id) ?? 0;
    const group = groups.get(rank) ?? [node];
    const row = group.findIndex((candidate) => candidate.id === node.id);
    const groupStartY = centerY - ((group.length - 1) * ROW_GAP) / 2;
    return {
      ...node,
      x: ORIGIN_X + rank * COLUMN_GAP,
      y: Math.round(groupStartY + Math.max(0, row) * ROW_GAP),
    };
  });
}

export function layoutMissingNodePositions(
  nodes: ArchitectNode[],
  edges: ArchitectureSchemaEdge[],
  missingPositionIds: Set<string>,
): ArchitectNode[] {
  if (missingPositionIds.size === 0) {
    return nodes;
  }
  const layoutById = new Map(layoutGraphNodes(nodes, edges).map((node) => [node.id, node]));

  return nodes.map((node) => {
    if (!missingPositionIds.has(node.id)) {
      return node;
    }
    return layoutById.get(node.id) ?? node;
  });
}

function groupNodesByRank(nodes: ArchitectNode[], ranks: Map<string, number>): Map<number, ArchitectNode[]> {
  const groups = new Map<number, ArchitectNode[]>();
  for (const node of nodes) {
    const rank = ranks.get(node.id) ?? 0;
    groups.set(rank, [...(groups.get(rank) ?? []), node]);
  }
  return groups;
}

function rankNodes(nodes: ArchitectNode[], edges: ArchitectureSchemaEdge[]): Map<string, number> {
  const ids = new Set(nodes.map((node) => node.id));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of nodes) {
    incoming.set(node.id, 0);
    outgoing.set(node.id, []);
  }
  for (const edge of edges) {
    if (!ids.has(edge.fromNodeId) || !ids.has(edge.toNodeId)) {
      continue;
    }
    outgoing.set(edge.fromNodeId, [...(outgoing.get(edge.fromNodeId) ?? []), edge.toNodeId]);
    incoming.set(edge.toNodeId, (incoming.get(edge.toNodeId) ?? 0) + 1);
  }

  const queue = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id);
  const ranks = new Map(nodes.map((node) => [node.id, 0]));
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    const currentRank = ranks.get(id) ?? 0;
    for (const targetId of outgoing.get(id) ?? []) {
      ranks.set(targetId, Math.max(ranks.get(targetId) ?? 0, currentRank + 1));
      incoming.set(targetId, (incoming.get(targetId) ?? 1) - 1);
      if ((incoming.get(targetId) ?? 0) === 0) {
        queue.push(targetId);
      }
    }
  }
  return ranks;
}

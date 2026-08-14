import type { ArchitectureExecutionEvent, ArchitectureSchema, ArchitectureSchemaNode } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import {
  groupArchitectureEdges,
  incomingNodeIdsFor,
  isNodeReady,
  markActiveIncoming,
  returnToOrchestratorNodeIds,
  rootArchitectureNodes,
  selectedNodeIdsFromEvent,
} from './architecture-graph-topology.utils';

const nodes: ArchitectureSchemaNode[] = [
  { id: 'root', label: 'Root', kind: 'router' },
  { id: 'branch-a', label: 'Branch A', kind: 'role', roleSlotId: 'branch-a' },
  { id: 'branch-b', label: 'Branch B', kind: 'role', roleSlotId: 'branch-b' },
  { id: 'final', label: 'Final', kind: 'role', roleSlotId: 'final' },
];

const schema: ArchitectureSchema = {
  id: 'schema-topology',
  name: 'Topology Test',
  description: 'Topology helper fixture',
  version: '1',
  roleSlots: [],
  nodes,
  edges: [
    { id: 'e1', fromNodeId: 'root', toNodeId: 'branch-a', returnToOrchestrator: true },
    { id: 'e2', fromNodeId: 'root', toNodeId: 'branch-b' },
    { id: 'e3', fromNodeId: 'branch-a', toNodeId: 'final' },
    { id: 'e4', fromNodeId: 'branch-b', toNodeId: 'final' },
  ],
  routerPolicy: {
    mode: 'rank_then_merge',
    mustAddressCriticFindings: false,
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
  outputArtifactSchema: 'text',
};

function event(partial: Partial<ArchitectureExecutionEvent>): ArchitectureExecutionEvent {
  return {
    id: partial.id ?? 'event-1',
    runId: partial.runId ?? 'run-1',
    sequence: partial.sequence ?? 1,
    type: partial.type ?? 'node_completed',
    message: partial.message ?? 'completed',
    createdAt: partial.createdAt ?? 1,
    ...partial,
  };
}

describe('architecture graph topology helpers', () => {
  it('groups static edges and finds roots from incoming topology', () => {
    const incoming = groupArchitectureEdges(schema, 'toNodeId');
    const outgoing = groupArchitectureEdges(schema, 'fromNodeId');

    expect(incoming.get('final')).toEqual(['branch-a', 'branch-b']);
    expect(outgoing.get('root')).toEqual(['branch-a', 'branch-b']);
    expect(rootArchitectureNodes(schema, incoming).map((node) => node.id)).toEqual(['root']);
  });

  it('extracts selected node ids from typed route before legacy data fallback', () => {
    expect(selectedNodeIdsFromEvent(event({
      route: {
        source: 'router',
        fromNodeId: 'root',
        selectedNodeIds: ['branch-a', 'branch-b'],
      },
      data: { selectedNodeIds: ['legacy-only'] },
    }))).toEqual(['branch-a', 'branch-b']);

    expect(selectedNodeIdsFromEvent(event({
      data: { selectedNodeIds: ['branch-a', '', 123] },
    }))).toEqual(['branch-a']);
  });

  it('reconstructs active incoming state from prior selected node ids', () => {
    const activeNodeIds = new Set(['root']);
    const activeIncomingNodeIds = new Map<string, Set<string>>();

    for (const selectedNodeId of ['branch-a', 'branch-b']) {
      markActiveIncoming(activeIncomingNodeIds, selectedNodeId, 'root');
      activeNodeIds.add(selectedNodeId);
    }

    expect(incomingNodeIdsFor({
      schema,
      nodeId: 'branch-a',
      activeNodeIds,
      activeIncomingNodeIds,
    })).toEqual(['root']);
    expect(Array.from(activeIncomingNodeIds.get('branch-b') ?? [])).toEqual(['root']);
  });

  it('uses active incoming nodes for readiness instead of requiring inactive static branches', () => {
    const incoming = groupArchitectureEdges(schema, 'toNodeId');
    const activeNodeIds = new Set(['branch-a']);
    const activeIncomingNodeIds = new Map<string, Set<string>>();
    markActiveIncoming(activeIncomingNodeIds, 'final', 'branch-a');

    expect(incomingNodeIdsFor({
      schema,
      nodeId: 'final',
      fallback: incoming,
      activeNodeIds,
      activeIncomingNodeIds,
    })).toEqual(['branch-a']);
    expect(isNodeReady({
      schema,
      nodeId: 'final',
      fallback: incoming,
      activeNodeIds,
      activeIncomingNodeIds,
      visitCount: (nodeId) => nodeId === 'branch-a' ? 1 : 0,
    })).toBe(true);
  });

  it('returns orchestrator handoff targets only when pause is enabled', () => {
    expect(returnToOrchestratorNodeIds({
      schema,
      fromNodeId: 'root',
      selectedNodeIds: ['branch-a', 'branch-b'],
      pauseEnabled: false,
    })).toEqual([]);

    expect(returnToOrchestratorNodeIds({
      schema,
      fromNodeId: 'root',
      selectedNodeIds: ['branch-a', 'branch-b'],
      pauseEnabled: true,
    })).toEqual(['branch-a']);
  });
});

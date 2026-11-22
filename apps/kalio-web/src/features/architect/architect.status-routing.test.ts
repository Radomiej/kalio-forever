import { describe, expect, it } from 'vitest';
import { applyGraphDraft, createDraftNode, EMPTY_GRAPH_DRAFT, toSchemaNodes } from './ArchitectPage.graph';
import { normalizeArchitectureSchema } from './architect.schema';
import { readStatusRoutingConfig, validateArchitectStatusRouting } from './architect.status-routing';
import { edgeKind } from './ArchitectGraphCanvas.model';

function fixture() {
  return {
    id: 'status', name: 'Status',
    nodes: [
      { id: 'source', label: 'Source', kind: 'role', roleSlotId: 'worker' },
      { id: 'condition', label: 'Condition', kind: 'status_router', statusRouting: { sourceNodeId: 'source', expectedStatus: 'failed' } },
      { id: 'yes', label: 'Yes', kind: 'artifact' },
      { id: 'else', label: 'Else', kind: 'artifact' },
    ],
    edges: [
      { id: 'incoming', fromNodeId: 'source', toNodeId: 'condition' },
      { id: 'yes-edge', fromNodeId: 'condition', toNodeId: 'yes', selection: 'choice' },
      { id: 'else-edge', fromNodeId: 'condition', toNodeId: 'else', selection: 'default' },
    ],
  };
}

describe('status condition draft and validation', () => {
  it('retains independently cloned status configuration across draft, serialization and reload', () => {
    const original = normalizeArchitectureSchema(fixture());
    const drafted = applyGraphDraft(original, {}, {
      ...EMPTY_GRAPH_DRAFT, nodeStatusRouting: { condition: { sourceNodeId: 'source', expectedStatus: 'completed' } },
    })!;
    const serialized = toSchemaNodes(drafted);
    const reloaded = normalizeArchitectureSchema(JSON.parse(JSON.stringify({ ...drafted, nodes: serialized })));
    expect(reloaded.nodes[1]?.kind).toBe('status_router');
    expect(reloaded.nodes[1]?.statusRouting).toEqual({ sourceNodeId: 'source', expectedStatus: 'completed' });
    expect(serialized[1]?.statusRouting).not.toBe(drafted.nodes[1]?.statusRouting);
    expect(original.nodes[1]?.statusRouting?.expectedStatus).toBe('failed');
    expect(edgeKind(reloaded.nodes[1]!)).toBe('routing');
  });

  it('creates a slot-free node and roundtrips edits of newly added nodes', () => {
    const original = normalizeArchitectureSchema(fixture());
    const node = createDraftNode(original.nodes, { x: 20, y: 30 }, 'status_router');
    expect(node.roleSlotId).toBeUndefined();
    expect(node.slots).toEqual([]);
    const drafted = applyGraphDraft(original, {}, { ...EMPTY_GRAPH_DRAFT, addedNodes: [node],
      nodeStatusRouting: { [node.id]: { sourceNodeId: 'source', expectedStatus: 'failed' } },
    })!;
    expect(toSchemaNodes(drafted).at(-1)?.statusRouting).toEqual({ sourceNodeId: 'source', expectedStatus: 'failed' });
    expect(node.statusRouting?.sourceNodeId).toBe('');
  });

  it('clears LLM settings on conversion to status condition and stale condition settings on conversion back', () => {
    const original = normalizeArchitectureSchema(fixture());
    original.nodes[0] = { ...original.nodes[0]!, personaId: 'worker', maxToolAttempts: 10,
      autoRouting: { confidenceThreshold: 0.7, instructions: 'Old route' },
      behavior: { mode: 'choose_one' }, toolOverride: { allowedToolNames: ['fs_read'] } };
    const drafted = applyGraphDraft(original, { source: 'status_router' }, { ...EMPTY_GRAPH_DRAFT,
      nodeStatusRouting: { source: { sourceNodeId: 'yes', expectedStatus: 'completed' } },
    })!;
    expect(drafted.nodes[0]?.roleSlotId).toBeUndefined();
    expect(drafted.nodes[0]?.slots).toEqual([]);
    expect(drafted.nodes[0]?.personaId).toBeUndefined();
    expect(drafted.nodes[0]?.autoRouting).toBeUndefined();
    expect(drafted.nodes[0]?.behavior).toBeUndefined();
    expect(drafted.nodes[0]?.toolOverride).toBeUndefined();
    expect(drafted.nodes[0]?.maxToolAttempts).toBeUndefined();
    const back = applyGraphDraft(original, { condition: 'artifact' }, EMPTY_GRAPH_DRAFT)!;
    expect(toSchemaNodes(back)[1]?.statusRouting).toBeUndefined();
  });

  it.each([null, {}, { sourceNodeId: '', expectedStatus: 'completed' },
    { sourceNodeId: 'source', expectedStatus: 'running' },
    { sourceNodeId: 'source', expectedStatus: 'completed', extra: true },
  ])('rejects malformed configuration %j', (config) => {
    expect(() => readStatusRoutingConfig(config)).toThrow();
  });

  it.each(['continuation', 'default', 'choice'] as const)('rejects an additional source outgoing %s edge that bypasses the condition', (selection) => {
    const original = normalizeArchitectureSchema(fixture());
    expect(() => validateArchitectStatusRouting(original)).not.toThrow();
    const bypass = { id: 'source-bypass', fromNodeId: 'source', toNodeId: 'else', selection };
    expect(() => validateArchitectStatusRouting({ ...original, edges: [...original.edges, bypass] }))
      .toThrow('requires exactly one incoming edge from its source role node');
    const raw = fixture();
    expect(() => normalizeArchitectureSchema({ ...raw, edges: [...raw.edges, bypass] }))
      .toThrow('requires exactly one incoming edge from its source role node');
  });

  it('rejects missing config, non-role source, missing incoming edge, duplicate and invalid routes', () => {
    const original = normalizeArchitectureSchema(fixture());
    for (const config of [undefined, { sourceNodeId: 'condition', expectedStatus: 'failed' as const },
      { sourceNodeId: 'yes', expectedStatus: 'failed' as const }]) {
      expect(() => validateArchitectStatusRouting({ ...original,
        nodes: original.nodes.map((node) => node.id === 'condition' ? { ...node, statusRouting: config } : node),
      })).toThrow();
    }
    expect(() => validateArchitectStatusRouting({ ...original, edges: original.edges.slice(1) })).toThrow();
    expect(() => validateArchitectStatusRouting({ ...original, edges: original.edges.map((edge) =>
      edge.id === 'else-edge' ? { ...edge, selection: 'choice' } : edge) })).toThrow();
    expect(() => validateArchitectStatusRouting({ ...original, edges: original.edges.map((edge) =>
      edge.id === 'else-edge' ? { ...edge, toNodeId: 'yes' } : edge) })).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import type { ArchitectSchema } from './architect.types';
import { applyGraphDraft, createDraftNode, EMPTY_GRAPH_DRAFT, setEdgeLabel, setEdgeSelection, toSchemaNodes } from './ArchitectPage.graph';

describe('ArchitectPage graph draft', () => {
  it('preserves explicit node tool overrides when building runtime schema nodes', () => {
    const schema = makeSchema();
    const drafted = applyGraphDraft(schema, {}, {
      ...EMPTY_GRAPH_DRAFT,
      nodeToolOverrides: {
        orchestrator: { allowedToolNames: ['run_subagent', 'fs_read'] },
      },
    });

    expect(drafted?.nodes[0]?.toolOverride).toEqual({
      allowedToolNames: ['run_subagent', 'fs_read'],
    });
    expect(toSchemaNodes(drafted as ArchitectSchema)[0]?.toolOverride).toEqual({
      allowedToolNames: ['run_subagent', 'fs_read'],
    });
  });

  it('updates edge selection metadata without using node behavior convergence fields', () => {
    const schema = makeSchema();
    const selected = setEdgeSelection(schema, null, 'orchestrator', 'artifact', 'converge');

    expect(selected).toEqual([{
      id: 'orchestrator-artifact',
      fromNodeId: 'orchestrator',
      toNodeId: 'artifact',
      selection: 'converge',
    }]);

    expect(setEdgeSelection({ ...schema, edges: selected }, selected, 'orchestrator', 'artifact', undefined)).toEqual([{
      id: 'orchestrator-artifact',
      fromNodeId: 'orchestrator',
      toNodeId: 'artifact',
    }]);
  });

  it('creates and serializes an auto-routing node with its Jev threshold and instructions', () => {
    const schema = makeSchema();
    const node = createDraftNode(schema.nodes, { x: 600, y: 240 }, 'auto_router');
    const drafted = applyGraphDraft(schema, {}, {
      ...EMPTY_GRAPH_DRAFT,
      addedNodes: [node],
    });

    expect(node).toMatchObject({
      kind: 'auto_router',
      autoRouting: { confidenceThreshold: 0.8, instructions: '' },
    });
    expect(node).not.toHaveProperty('roleSlotId');
    expect(toSchemaNodes(drafted as ArchitectSchema).at(-1)?.autoRouting).toEqual({
      confidenceThreshold: 0.8,
      instructions: '',
    });
  });

  it('changes an auto-router default by stable edge ID and turns the previous default into a choice', () => {
    const schema = makeSchema();
    schema.nodes[0] = { ...schema.nodes[0], kind: 'auto_router' };
    const edges = [
      { id: 'agent-route', fromNodeId: 'orchestrator', toNodeId: 'artifact', selection: 'default' as const },
      { id: 'fallback-route', fromNodeId: 'orchestrator', toNodeId: 'artifact', selection: 'choice' as const },
    ];

    expect(setEdgeSelection(schema, edges, 'orchestrator', 'artifact', 'default', 'fallback-route')).toEqual([
      { ...edges[0], selection: 'choice' },
      { ...edges[1], selection: 'default' },
    ]);
  });

  it('edits a Jev choice label by stable edge ID', () => {
    const schema = makeSchema();
    const edges = [{ id: 'choice-agent', fromNodeId: 'orchestrator', toNodeId: 'artifact', selection: 'choice' as const }];

    expect(setEdgeLabel(schema, edges, 'choice-agent', 'Use the implementation agent')).toEqual([
      { ...edges[0], label: 'Use the implementation agent' },
    ]);
    expect(setEdgeLabel(schema, edges, 'missing', 'Ignored')).toEqual(edges);
  });
});

function makeSchema(): ArchitectSchema {
  return {
    id: 'schema-1',
    name: 'Schema 1',
    description: '',
    version: '1.0.0',
    roleSlots: [],
    nodes: [
      {
        id: 'orchestrator',
        label: 'Orchestrator',
        kind: 'router',
        x: 120,
        y: 90,
        slots: [],
        connections: [],
      },
      {
        id: 'artifact',
        label: 'Artifact',
        kind: 'artifact',
        x: 320,
        y: 90,
        slots: [],
        connections: [],
      },
    ],
    edges: [],
    routerPolicy: {
      mode: 'rank_then_merge',
      mustAddressCriticFindings: false,
      canReturnNeedsMoreResearch: false,
    },
    contextPolicy: {
      includeUserTask: true,
      includeProjectMemory: false,
      includeBrowserSession: false,
      includePriorDecisions: false,
    },
    memoryPolicy: {
      persistFinalArtifact: false,
      persistRouterDecision: false,
    },
    outputArtifactSchema: 'Artifact',
  };
}

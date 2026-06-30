import { describe, expect, it } from 'vitest';
import type { ArchitectSchema } from './architect.types';
import { applyGraphDraft, EMPTY_GRAPH_DRAFT, setEdgeSelection, toSchemaNodes } from './ArchitectPage.graph';

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

import { describe, expect, it } from 'vitest';
import { normalizeArchitectureSchema } from './architect.schema';

describe('normalizeArchitectureSchema', () => {
  it('lays out unpositioned graph nodes into readable columns and stacked parallel branches', () => {
    const schema = normalizeArchitectureSchema({
      id: 'layout-schema',
      name: 'Layout Schema',
      roleSlots: [],
      nodes: [
        { id: 'start', label: 'Start', kind: 'parallel' },
        { id: 'left', label: 'Left', kind: 'role' },
        { id: 'right', label: 'Right', kind: 'role' },
        { id: 'merge', label: 'Merge', kind: 'router' },
      ],
      edges: [
        { id: 'start-left', fromNodeId: 'start', toNodeId: 'left' },
        { id: 'start-right', fromNodeId: 'start', toNodeId: 'right' },
        { id: 'left-merge', fromNodeId: 'left', toNodeId: 'merge' },
        { id: 'right-merge', fromNodeId: 'right', toNodeId: 'merge' },
      ],
    });

    const start = schema.nodes.find((node) => node.id === 'start');
    const left = schema.nodes.find((node) => node.id === 'left');
    const right = schema.nodes.find((node) => node.id === 'right');
    const merge = schema.nodes.find((node) => node.id === 'merge');

    expect(start?.x).toBe(120);
    expect(left?.x).toBeGreaterThan(start?.x ?? 0);
    expect(right?.x).toBe(left?.x);
    expect(right?.y).toBeGreaterThan(left?.y ?? 0);
    expect(merge?.x).toBeGreaterThan(left?.x ?? 0);
  });

  it('preserves per-slot context policy overrides from registry schemas', () => {
    const schema = normalizeArchitectureSchema({
      id: 'policy-schema',
      name: 'Policy Schema',
      description: 'Schema with slot context policies.',
      version: '1.0.0',
      roleSlots: [],
      nodes: [],
      edges: [],
      contextPolicy: {
        includeUserTask: true,
        includeProjectMemory: true,
        includeBrowserSession: false,
        includePriorDecisions: true,
        includeOtherAgentOutputs: true,
        perSlotOverrides: {
          pragmatist: {
            includeOtherAgentOutputs: false,
            includeBrowserSession: false,
          },
          router: {
            contextCompression: 'evidence_only',
            includeToolResults: true,
          },
        },
      },
    });

    expect(schema.contextPolicy).toMatchObject({
      includeUserTask: true,
      includeProjectMemory: true,
      includeBrowserSession: false,
      includePriorDecisions: true,
      includeOtherAgentOutputs: true,
      perSlotOverrides: {
        pragmatist: {
          includeOtherAgentOutputs: false,
          includeBrowserSession: false,
        },
        router: {
          contextCompression: 'evidence_only',
          includeToolResults: true,
        },
      },
    });
  });

  it('preserves explicit node tool permission overrides from registry schemas', () => {
    const schema = normalizeArchitectureSchema({
      id: 'tool-policy-schema',
      name: 'Tool Policy Schema',
      roleSlots: [],
      nodes: [{
        id: 'orchestrator',
        label: 'Orchestrator',
        kind: 'router',
        toolOverride: {
          allowedToolNames: ['run_subagent', 'fs_read', 42, ''],
        },
      }],
      edges: [],
    });

    expect(schema.nodes[0]?.toolOverride).toEqual({
      allowedToolNames: ['run_subagent', 'fs_read'],
    });
  });

  it('ignores legacy node-level convergeToNodeId and preserves edge selection metadata', () => {
    const schema = normalizeArchitectureSchema({
      id: 'edge-selection-schema',
      name: 'Edge Selection Schema',
      roleSlots: [],
      nodes: [{
        id: 'router',
        label: 'Router',
        kind: 'router',
        behavior: {
          mode: 'rank_then_merge',
          convergeToNodeId: 'legacy-artifact',
        },
      }, {
        id: 'artifact',
        label: 'Artifact',
        kind: 'artifact',
      }],
      edges: [{
        id: 'router-artifact',
        fromNodeId: 'router',
        toNodeId: 'artifact',
        selection: 'converge',
      }],
    });

    expect(schema.nodes[0]?.behavior).toEqual({
      mode: 'rank_then_merge',
    });
    expect(schema.edges[0]).toMatchObject({
      selection: 'converge',
    });
  });
});

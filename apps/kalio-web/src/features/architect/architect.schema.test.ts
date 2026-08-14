import { describe, expect, it } from 'vitest';
import { normalizeArchitectureSchema, normalizeArchitectureSchemas } from './architect.schema';

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

  it('returns safe defaults for malformed schema input and normalizes schema collections', () => {
    const fallback = normalizeArchitectureSchema(null, 2);

    expect(fallback).toMatchObject({
      id: 'schema-3',
      name: 'Schema 3',
      version: '0.0.0',
      roleSlots: [],
      nodes: [],
      edges: [],
      outputArtifactSchema: 'Artifact',
    });
    expect(normalizeArchitectureSchemas({ schemas: [null, { id: 'one', nodes: [] }] })).toHaveLength(2);
    expect(normalizeArchitectureSchemas({ invalid: true })).toEqual([]);
    expect(normalizeArchitectureSchemas('invalid')).toEqual([]);
  });

  it('normalizes node, slot, behavior, connection, and policy variants', () => {
    const schema = normalizeArchitectureSchema({
      id: 'rich-schema',
      title: 'Rich schema',
      summary: 'Description fallback',
      version: '2.0.0',
      outputArtifactSchema: 'Decision',
      roleSlots: [
        {
          key: 'judge-slot',
          title: 'Judge',
          type: 'judge',
          persona: 'judge-persona',
          allowedPersonaTags: ['reviewer', 42],
          required: true,
          canOverrideAtRunStart: true,
          summary: 'Judge description',
        },
        { name: 'participant-slot' },
      ],
      contextPolicy: {
        includeUserTask: false,
        includeProjectMemory: true,
        includeBrowserSession: true,
        includePriorDecisions: true,
        includeOtherAgentOutputs: false,
        includeToolResults: true,
        contextCompression: 'summary',
        perSlotOverrides: {
          'judge-slot': {
            includeUserTask: false,
            includeProjectMemory: true,
            includeBrowserSession: true,
            includePriorDecisions: false,
            includeOtherAgentOutputs: true,
            includeToolResults: false,
            contextCompression: 'none',
          },
          ignored: 'invalid',
        },
      },
      nodes: [
        null,
        {
          key: 'parallel-node',
          title: 'Parallel',
          role: 'parallel',
          roleSlotId: 'judge-slot',
          x: 10,
          y: 20,
          maxToolAttempts: 3,
          toolOverride: { allowedToolNames: [' fs_read ', '', 42] },
          behavior: { mode: 'fan_out_all', fanOut: 'parallel', maxBranches: 2, scoringPolicy: 'confidence', description: 'Fan out' },
          slots: [{ name: 'nested-slot', slotType: 'critic', personaId: 'critic', required: false }],
          connections: ['router-node', { targetId: 'artifact-node' }, { to: 'ignored?' }, 42],
        },
        { id: 'role-node', type: 'role', behavior: { mode: 'choose_one', fanOut: 'sequential', scoringPolicy: 'risk' } },
        { id: 'router-node', kind: 'router', behavior: { mode: 'rank_then_merge', scoringPolicy: 'cost' }, targets: [{ to: 'artifact-node' }] },
        { id: 'artifact-node', kind: 'artifact', behavior: { mode: 'merge_inputs', scoringPolicy: 'custom' }, outgoing: ['final-node'] },
        { id: 'final-node', kind: 'unknown', behavior: { mode: 'finalize', fanOut: 'unknown', scoringPolicy: 'unknown' } },
        { id: 'invalid-behavior', behavior: { mode: 'unknown' }, toolOverride: { allowedToolNames: [] }, connections: [] },
      ],
      edges: [
        { source: 'parallel-node', target: 'role-node', selection: 'default', returnToOrchestrator: true },
        { fromNodeId: 'role-node', toNodeId: 'router-node', selection: 'continuation' },
        { from: 'router-node', to: 'artifact-node', selection: 'invalid' },
        { source: 'missing-target' },
        'invalid-edge',
      ],
    });

    expect(schema).toMatchObject({
      id: 'rich-schema',
      name: 'Rich schema',
      description: 'Description fallback',
      version: '2.0.0',
      outputArtifactSchema: 'Decision',
      contextPolicy: {
        includeUserTask: false,
        includeProjectMemory: true,
        includeBrowserSession: true,
        includePriorDecisions: true,
        includeOtherAgentOutputs: false,
        includeToolResults: true,
        contextCompression: 'summary',
      },
    });
    expect(schema.roleSlots[0]).toMatchObject({ id: 'judge-slot', slotType: 'judge', defaultPersonaId: 'judge-persona', required: true });
    expect(schema.nodes.find((node) => node.id === 'parallel-node')).toMatchObject({
      kind: 'parallel',
      roleSlotId: 'judge-slot',
      personaId: 'judge-persona',
      maxToolAttempts: 3,
      toolOverride: { allowedToolNames: ['fs_read'] },
      behavior: { mode: 'fan_out_all', fanOut: 'parallel', maxBranches: 2, scoringPolicy: 'confidence' },
    });
    expect(schema.nodes.find((node) => node.id === 'role-node')?.behavior).toMatchObject({ mode: 'choose_one', fanOut: 'sequential', scoringPolicy: 'risk' });
    expect(schema.nodes.find((node) => node.id === 'router-node')?.connections).toContain('artifact-node');
    expect(schema.nodes.find((node) => node.id === 'artifact-node')?.connections).toContain('final-node');
    expect(schema.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ selection: 'default', returnToOrchestrator: true }),
      expect.objectContaining({ selection: 'continuation' }),
      expect.objectContaining({ selection: undefined }),
    ]));
  });
});

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
});

import { describe, expect, it } from 'vitest';
import { validatePersonaGraphConfig } from './persona-graph-config';

describe('validatePersonaGraphConfig', () => {
  it('accepts a minimal valid graph', () => {
    const result = validatePersonaGraphConfig({
      version: 1,
      entryNodeId: 'router-1',
      maxSteps: 6,
      nodes: [
        { id: 'router-1', type: 'router', label: 'Router' },
        { id: 'persona-1', type: 'persona', label: 'Researcher', personaId: 'research' },
        { id: 'final-1', type: 'final', label: 'Done' },
      ],
      edges: [
        { id: 'edge-1', sourceNodeId: 'router-1', targetNodeId: 'persona-1' },
        { id: 'edge-2', sourceNodeId: 'persona-1', targetNodeId: 'final-1' },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects duplicate node ids', () => {
    const result = validatePersonaGraphConfig({
      version: 1,
      entryNodeId: 'router-1',
      maxSteps: 4,
      nodes: [
        { id: 'router-1', type: 'router', label: 'Router' },
        { id: 'router-1', type: 'final', label: 'Duplicate' },
      ],
      edges: [],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'DUPLICATE_NODE_ID', path: 'nodes[1].id' }),
      ]),
    );
  });

  it('rejects a missing entry node', () => {
    const result = validatePersonaGraphConfig({
      version: 1,
      entryNodeId: 'router-missing',
      maxSteps: 4,
      nodes: [{ id: 'final-1', type: 'final', label: 'Done' }],
      edges: [],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ENTRY_NODE_NOT_FOUND', path: 'entryNodeId' }),
      ]),
    );
  });

  it('rejects edges that target missing nodes', () => {
    const result = validatePersonaGraphConfig({
      version: 1,
      entryNodeId: 'router-1',
      maxSteps: 4,
      nodes: [{ id: 'router-1', type: 'router', label: 'Router' }],
      edges: [{ id: 'edge-1', sourceNodeId: 'router-1', targetNodeId: 'missing-node' }],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'EDGE_TARGET_NOT_FOUND', path: 'edges[0].targetNodeId' }),
      ]),
    );
  });

  it('rejects persona nodes without personaId', () => {
    const result = validatePersonaGraphConfig({
      version: 1,
      entryNodeId: 'router-1',
      maxSteps: 4,
      nodes: [
        { id: 'router-1', type: 'router', label: 'Router' },
        { id: 'persona-1', type: 'persona', label: 'Researcher' },
      ],
      edges: [{ id: 'edge-1', sourceNodeId: 'router-1', targetNodeId: 'persona-1' }],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'INVALID_PERSONA_NODE', path: 'nodes[1].personaId' }),
      ]),
    );
  });

  it('rejects tool nodes without toolName', () => {
    const result = validatePersonaGraphConfig({
      version: 1,
      entryNodeId: 'router-1',
      maxSteps: 4,
      nodes: [
        { id: 'router-1', type: 'router', label: 'Router' },
        { id: 'tool-1', type: 'tool', label: 'Search' },
      ],
      edges: [{ id: 'edge-1', sourceNodeId: 'router-1', targetNodeId: 'tool-1' }],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'INVALID_TOOL_NODE', path: 'nodes[1].toolName' }),
      ]),
    );
  });
});
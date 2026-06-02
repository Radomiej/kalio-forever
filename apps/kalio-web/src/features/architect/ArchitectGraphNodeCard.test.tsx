import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArchitectGraphNodeCard } from './ArchitectGraphNodeCard';
import type { ArchitectNode } from './architect.types';

function makeNode(overrides: Partial<ArchitectNode> = {}): ArchitectNode {
  return {
    id: 'router',
    label: 'Router',
    kind: 'router',
    x: 100,
    y: 120,
    slots: [],
    connections: [],
    ...overrides,
  };
}

describe('ArchitectGraphNodeCard', () => {
  it('renders explicit input and output pins for router nodes', () => {
    render(
      <ArchitectGraphNodeCard
        node={makeNode()}
        selectedNodeId={null}
        selectedSlotId={null}
        connectSourceId={null}
        onNodeClick={vi.fn()}
        onSlotClick={vi.fn()}
        onDragStart={vi.fn()}
        onDragMove={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );

    expect(screen.getByTestId('architect-router-input-pin-router')).toBeInTheDocument();
    expect(screen.getByTestId('architect-router-output-pin-router')).toBeInTheDocument();
  });

  it('renders generic input and output pins for role nodes', () => {
    render(
      <ArchitectGraphNodeCard
        node={makeNode({ id: 'agent', label: 'Agent', kind: 'role' })}
        selectedNodeId={null}
        selectedSlotId={null}
        connectSourceId={null}
        onNodeClick={vi.fn()}
        onSlotClick={vi.fn()}
        onDragStart={vi.fn()}
        onDragMove={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );

    expect(screen.getByTestId('architect-node-input-pin-agent')).toBeInTheDocument();
    expect(screen.getByTestId('architect-node-output-pin-agent')).toBeInTheDocument();
  });
});

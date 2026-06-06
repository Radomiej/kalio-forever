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
        connectionDropTarget={false}
        zoom={1}
        onNodeClick={vi.fn()}
        onSlotClick={vi.fn()}
        onStartConnection={vi.fn()}
        onCompleteConnection={vi.fn()}
        onStartConnectionDrag={vi.fn()}
        onMoveConnectionDrag={vi.fn()}
        onEndConnectionDrag={vi.fn()}
        onDragStart={vi.fn()}
        onDragMove={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );

    expect(screen.getByTestId('architect-router-input-pin-router')).toBeInTheDocument();
    expect(screen.getByTestId('architect-router-output-pin-router')).toBeInTheDocument();
    expect(screen.getByTestId('architect-router-input-pin-router')).toHaveClass('h-14', 'w-14', 'bg-transparent');
    expect(screen.getByTestId('architect-router-output-pin-router')).toHaveClass('h-14', 'w-14', 'bg-transparent');
    expect(screen.getByRole('button', { name: 'Connect to Router' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect from Router' })).toBeInTheDocument();
  });

  it('renders generic input and output pins for role nodes', () => {
    render(
      <ArchitectGraphNodeCard
        node={makeNode({ id: 'agent', label: 'Agent', kind: 'role' })}
        selectedNodeId={null}
        selectedSlotId={null}
        connectSourceId={null}
        connectionDropTarget={false}
        zoom={1}
        onNodeClick={vi.fn()}
        onSlotClick={vi.fn()}
        onStartConnection={vi.fn()}
        onCompleteConnection={vi.fn()}
        onStartConnectionDrag={vi.fn()}
        onMoveConnectionDrag={vi.fn()}
        onEndConnectionDrag={vi.fn()}
        onDragStart={vi.fn()}
        onDragMove={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );

    expect(screen.getByTestId('architect-node-input-pin-agent')).toBeInTheDocument();
    expect(screen.getByTestId('architect-node-output-pin-agent')).toBeInTheDocument();
  });

  it('marks the card and input hitbox while it is a connection drop target', () => {
    render(
      <ArchitectGraphNodeCard
        node={makeNode({ id: 'agent', label: 'Agent', kind: 'role' })}
        selectedNodeId={null}
        selectedSlotId={null}
        connectSourceId={null}
        connectionDropTarget={true}
        zoom={0.5}
        onNodeClick={vi.fn()}
        onSlotClick={vi.fn()}
        onStartConnection={vi.fn()}
        onCompleteConnection={vi.fn()}
        onStartConnectionDrag={vi.fn()}
        onMoveConnectionDrag={vi.fn()}
        onEndConnectionDrag={vi.fn()}
        onDragStart={vi.fn()}
        onDragMove={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );

    expect(screen.getByTestId('architect-node-card-agent')).toHaveAttribute('data-architect-connection-drop-target', 'true');
    expect(screen.getByTestId('architect-node-input-pin-agent')).toHaveClass('ring-2');
    expect(screen.getByTestId('architect-node-input-pin-agent')).toHaveStyle({ height: '112px', width: '112px' });
  });

  it('keeps connector hitboxes touch-safe at high zoom while the visible dot stays small', () => {
    render(
      <ArchitectGraphNodeCard
        node={makeNode({ id: 'agent', label: 'Agent', kind: 'role' })}
        selectedNodeId={null}
        selectedSlotId={null}
        connectSourceId={null}
        connectionDropTarget={false}
        zoom={1.6}
        onNodeClick={vi.fn()}
        onSlotClick={vi.fn()}
        onStartConnection={vi.fn()}
        onCompleteConnection={vi.fn()}
        onStartConnectionDrag={vi.fn()}
        onMoveConnectionDrag={vi.fn()}
        onEndConnectionDrag={vi.fn()}
        onDragStart={vi.fn()}
        onDragMove={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );

    const outputPin = screen.getByTestId('architect-node-output-pin-agent');

    expect(outputPin).toHaveStyle({ height: '48px', width: '48px' });
    expect(outputPin.firstElementChild).toHaveClass('h-1.5', 'w-1.5');
  });
});

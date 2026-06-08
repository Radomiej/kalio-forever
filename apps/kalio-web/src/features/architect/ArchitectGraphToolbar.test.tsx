import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ArchitectGraphToolbar } from './ArchitectGraphToolbar';

function renderToolbar(overrides: Partial<ComponentProps<typeof ArchitectGraphToolbar>> = {}) {
  const props: ComponentProps<typeof ArchitectGraphToolbar> = {
    addNodeKind: 'role',
    editMode: 'select',
    zoom: 0.82,
    onAutoLayout: vi.fn(),
    onModeChange: vi.fn(),
    onResetViewport: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    ...overrides,
  };

  render(<ArchitectGraphToolbar {...props} />);
  return props;
}

describe('ArchitectGraphToolbar', () => {
  it('gives icon-only editing modes accessible names', () => {
    const props = renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: 'Select and move nodes' }));
    expect(props.onModeChange).toHaveBeenCalledWith('select');

    fireEvent.click(screen.getByRole('button', { name: 'Connect or disconnect nodes' }));
    expect(props.onModeChange).toHaveBeenCalledWith('connect');
  });

  it('keeps secondary graph controls in an overflow menu', () => {
    const props = renderToolbar();

    expect(screen.queryByTestId('architect-gesture-guide')).toBeNull();
    expect(screen.queryByTestId('architect-mode-add-node')).toBeNull();
    expect(screen.queryByTestId('architect-auto-layout')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'More graph controls' }));

    expect(screen.getByTestId('architect-graph-controls-menu')).toHaveTextContent('Add node');
    fireEvent.click(screen.getByTestId('architect-mode-add-node'));
    expect(props.onModeChange).toHaveBeenCalledWith('add', 'role');

    fireEvent.click(screen.getByRole('button', { name: 'More graph controls' }));
    fireEvent.click(screen.getByTestId('architect-auto-layout'));
    expect(props.onAutoLayout).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'More graph controls' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset viewport' }));
    expect(props.onResetViewport).toHaveBeenCalled();
  });

  it('shows a compact gesture guide without exposing it by default', () => {
    renderToolbar();

    expect(screen.queryByTestId('architect-gesture-guide')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'More graph controls' }));

    expect(screen.getByTestId('architect-gesture-guide')).toHaveTextContent('hold Space over nodes to pan');
    expect(screen.getByTestId('architect-gesture-guide')).toHaveTextContent('Drag the node icon handle');
    expect(screen.getByTestId('architect-gesture-guide')).toHaveTextContent('Drag from output dot to input dot');
  });
});

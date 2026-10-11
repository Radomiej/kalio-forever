import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ArchitectInspector } from './ArchitectInspector';

function renderInspector(editable = true) {
  const onAutoRoutingOverride = vi.fn();
  const props: ComponentProps<typeof ArchitectInspector> = {
    node: { id: 'auto', label: 'Auto', kind: 'auto_router', x: 0, y: 0, slots: [], connections: [], autoRouting: { confidenceThreshold: 0.7, instructions: 'Choose.' } },
    slot: null, schema: null, personas: [], personaOverrides: {}, nodeKindOverrides: {},
    onPersonaOverride: vi.fn(), onNodeKindOverride: vi.fn(), onNodeBehaviorOverride: vi.fn(),
    onNodeMaxToolAttemptsOverride: vi.fn(), onNodeToolOverride: vi.fn(),
    onEdgeSelectionOverride: vi.fn(), onContextPolicyOverride: vi.fn(), onAutoRoutingOverride: editable ? onAutoRoutingOverride : undefined,
  };
  render(<ArchitectInspector {...props} />);
  fireEvent.click(screen.getByTestId('architect-node-properties-open'));
  return onAutoRoutingOverride;
}

describe('ArchitectInspector auto routing', () => {
  it('disables settings when the parent has not provided an edit callback', () => {
    renderInspector(false);
    expect(screen.getByLabelText('Confidence threshold')).toBeDisabled();
    expect(screen.getByLabelText('Routing instructions')).toBeDisabled();
  });
  it('exposes the kind and emits settings through the schema callback', () => {
    const change = renderInspector();
    expect(screen.getByLabelText('Processing type')).toHaveValue('auto_router');
    fireEvent.change(screen.getByLabelText('Confidence threshold'), { target: { value: '0.9' } });
    expect(change).toHaveBeenLastCalledWith('auto', { confidenceThreshold: 0.9, instructions: 'Choose.' });
    fireEvent.change(screen.getByLabelText('Routing instructions'), { target: { value: 'Prefer verification.' } });
    expect(change).toHaveBeenLastCalledWith('auto', { confidenceThreshold: 0.7, instructions: 'Prefer verification.' });
    expect(screen.getByLabelText('Routing instructions')).toHaveAttribute('maxlength', '2000');
  });

  it('does not emit empty or out-of-range thresholds', () => {
    const change = renderInspector();
    for (const value of ['', '-1', '2']) {
      fireEvent.change(screen.getByLabelText('Confidence threshold'), { target: { value } });
    }
    expect(change).not.toHaveBeenCalled();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArchitectStatusRoutingControls } from './ArchitectStatusRoutingControls';

const nodes = [
  { id: 'role', label: 'Worker', kind: 'role' as const, roleSlotId: 'worker' },
  { id: 'router', label: 'Router', kind: 'router' as const },
  { id: 'no-slot', label: 'Role without slot', kind: 'role' as const },
  { id: 'condition', label: 'Condition', kind: 'status_router' as const },
];

describe('status routing controls', () => {
  it('offers only source roles with slots and emits both settings', () => {
    const onChange = vi.fn();
    render(<ArchitectStatusRoutingControls nodeId="condition" nodes={nodes} onChange={onChange} />);
    expect(screen.getByRole('option', { name: 'Worker' })).toBeInTheDocument();
    for (const name of ['Router', 'Role without slot', 'Condition']) {
      expect(screen.queryByRole('option', { name })).not.toBeInTheDocument();
    }
    fireEvent.change(screen.getByLabelText('Source node'), { target: { value: 'role' } });
    expect(onChange).toHaveBeenLastCalledWith('condition', { sourceNodeId: 'role', expectedStatus: 'completed' });
    fireEvent.change(screen.getByLabelText('Expected status'), { target: { value: 'failed' } });
    expect(onChange).toHaveBeenLastCalledWith('condition', { sourceNodeId: '', expectedStatus: 'failed' });
  });

  it('preserves a missing source visibly and disables read-only controls', () => {
    render(<ArchitectStatusRoutingControls nodeId="condition" nodes={nodes}
      value={{ sourceNodeId: 'missing', expectedStatus: 'failed' }} />);
    expect(screen.getByLabelText('Source node')).toHaveValue('missing');
    expect(screen.getByRole('option', { name: 'Missing source: missing' })).toBeInTheDocument();
    expect(screen.getByLabelText('Source node')).toBeDisabled();
    expect(screen.getByLabelText('Expected status')).toBeDisabled();
  });
});

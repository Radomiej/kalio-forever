import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ArchitectStatusRoutingControls } from './ArchitectStatusRoutingControls';

const nodes = [
  { id: 'role', label: 'Worker', kind: 'role' as const, roleSlotId: 'worker' },
  { id: 'router', label: 'Router', kind: 'router' as const },
  { id: 'no-slot', label: 'Role without slot', kind: 'role' as const },
  { id: 'condition', label: 'Condition', kind: 'status_router' as const },
];

describe('status routing controls', () => {
  it('reveals the execution-status distinction by keyboard without changing the selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ArchitectStatusRoutingControls nodeId="condition" nodes={nodes} onChange={onChange} />);
    const info = screen.getByRole('button', { name: 'About status routing' });
    expect(info).toHaveAttribute('aria-expanded', 'false');
    await user.tab();
    await user.tab();
    expect(info).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(info).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Branches on step execution status. QA verdicts are evaluated separately. Stop ends the run.')).toBeVisible();
    expect(screen.getByLabelText('When status is')).toHaveValue('completed');
    expect(screen.getByLabelText('When status is')).toHaveAccessibleDescription('Branches on step execution status. QA verdicts are evaluated separately. Stop ends the run.');
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard(' ');
    expect(info).toHaveAttribute('aria-expanded', 'false');
  });

  it('offers only source roles with slots and emits both settings', () => {
    const onChange = vi.fn();
    render(<ArchitectStatusRoutingControls nodeId="condition" nodes={nodes} onChange={onChange} />);
    expect(screen.getByRole('option', { name: 'Worker' })).toBeInTheDocument();
    for (const name of ['Router', 'Role without slot', 'Condition']) {
      expect(screen.queryByRole('option', { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('option', { name: 'Select a source step' })).toBeInTheDocument();
    expect(screen.getByText('Connect a Yes route and an Else route.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Source step'), { target: { value: 'role' } });
    expect(onChange).toHaveBeenLastCalledWith('condition', { sourceNodeId: 'role', expectedStatus: 'completed' });
    fireEvent.change(screen.getByLabelText('When status is'), { target: { value: 'failed' } });
    expect(onChange).toHaveBeenLastCalledWith('condition', { sourceNodeId: '', expectedStatus: 'failed' });
  });

  it('preserves a missing source visibly and disables read-only controls', () => {
    render(<ArchitectStatusRoutingControls nodeId="condition" nodes={nodes}
      value={{ sourceNodeId: 'missing', expectedStatus: 'failed' }} />);
    expect(screen.getByLabelText('Source step')).toHaveValue('missing');
    expect(screen.getByRole('option', { name: 'Missing source: missing' })).toBeInTheDocument();
    expect(screen.getByLabelText('Source step')).toBeDisabled();
    expect(screen.getByLabelText('When status is')).toBeDisabled();
  });
});

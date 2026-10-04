import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NativeIntegrationResetDialog } from './NativeIntegrationResetDialog';

describe('NativeIntegrationResetDialog', () => {
  it('focuses Cancel, cycles keyboard focus, and restores the trigger', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const view = render(<NativeIntegrationResetDialog name="Codex" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Reset server' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    view.unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('cancels on Escape without closing the surrounding Settings', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const surroundingEscape = vi.fn();
    window.addEventListener('keydown', surroundingEscape);
    try {
      render(<NativeIntegrationResetDialog name="Codex" onCancel={onCancel} onConfirm={onConfirm} />);
      fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
      expect(onCancel).toHaveBeenCalledOnce();
      expect(onConfirm).not.toHaveBeenCalled();
      expect(surroundingEscape).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', surroundingEscape);
    }
  });

  it('escapes clipped Settings containers and makes the parent dialog inert', () => {
    const parent = document.createElement('div');
    parent.setAttribute('role', 'dialog');
    const trigger = document.createElement('button');
    const mount = document.createElement('div');
    parent.append(trigger, mount);
    document.body.append(parent);
    trigger.focus();
    const view = render(<NativeIntegrationResetDialog name="Codex" onCancel={vi.fn()} onConfirm={vi.fn()} />, { container: mount });
    const dialog = screen.getByRole('dialog', { name: 'Reset Codex server' });
    expect(parent.contains(dialog)).toBe(false);
    expect(parent.inert).toBe(true);
    view.unmount();
    expect(parent.inert).not.toBe(true);
    parent.remove();
  });
});

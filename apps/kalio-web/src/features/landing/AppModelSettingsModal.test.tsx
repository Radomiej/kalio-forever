import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ExecutionProfile } from '@kalio/types';
import { AppModelSettingsModal } from './AppModelSettingsModal';

const profiles = [
  { id: 'a', name: 'Agent A', model: 'model-a', enabled: true },
  { id: 'b', name: 'Agent B', model: 'model-b', enabled: true },
  { id: 'c', name: 'Disabled', enabled: false },
] as ExecutionProfile[];
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  HTMLDialogElement.prototype.close = vi.fn();
});

describe('AppModelSettingsModal', () => {
  it('edits ordered preferences and saves without launching', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    render(<AppModelSettingsModal appName="Q&A" profiles={profiles} executionProfileIds={['a', 'b']} onSave={save} onClose={close} />);
    expect(screen.getByRole('dialog', { name: 'Models for Q&A' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Disabled/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move model 2 up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(['b', 'a']));
    expect(close).toHaveBeenCalledOnce();
  });

  it('adds and removes rows and saves empty inheritance', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<AppModelSettingsModal appName="Q&A" profiles={profiles} executionProfileIds={[]} onSave={save} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add model' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Preferred model' }), { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove model 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith([]));
  });

  it('cancels via button or Escape without save and restores trigger focus on unmount', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const save = vi.fn();
    const close = vi.fn();
    const view = render(<AppModelSettingsModal appName="Q&A" profiles={profiles} executionProfileIds={['a']} onSave={save} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(close).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
    view.unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('keeps failed save visible and retains the draft', async () => {
    const close = vi.fn();
    render(<AppModelSettingsModal appName="Q&A" profiles={profiles} executionProfileIds={['missing']} onSave={vi.fn().mockRejectedValue(new Error('Offline'))} onClose={close} />);
    expect(screen.getByRole('option', { name: /Unavailable profile/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
    expect(close).not.toHaveBeenCalled();
  });
});

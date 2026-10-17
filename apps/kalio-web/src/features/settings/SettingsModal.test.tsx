import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useSettingsStore } from './settingsStore';

vi.mock('./registry', () => ({
  SETTINGS_BLOCKS: [
    {
      id: 'llm',
      label: 'LLM Settings',
      icon: <span>llm</span>,
      component: () => <div>LLM panel</div>,
    },
    {
      id: 'runtime',
      label: 'Runtime Settings',
      icon: <span>runtime</span>,
      component: () => <div>Runtime panel</div>,
    },
    {
      id: 'tools',
      label: 'CLI Agents',
      icon: <span>tools</span>,
      component: () => <div>
        Tools panel
        <input aria-label="Tool name" />
        <button type="button">Panel action</button>
        <button type="button" disabled>Disabled action</button>
        <fieldset disabled><button type="button">Disabled fieldset action</button></fieldset>
        <div hidden><button type="button">Hidden action</button></div>
        <div style={{ display: 'none' }}><button type="button">Hidden by style</button></div>
      </div>,
    },
  ],
}));

import { SettingsModal } from './SettingsModal';
import { NativeIntegrationResetDialog } from './NativeIntegrationResetDialog';

function SettingsHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open settings</button>
    {open && <SettingsModal initialTab="tools" onClose={() => { onClose(); setOpen(false); }} />}
    <button type="button">Background action</button>
  </>;
}

describe('SettingsModal', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      requestedSettingsTab: null,
      runtimeModelFocusRequest: 0,
    });
  });

  it('renders the requested initial tab and switches panels when another tab is clicked', () => {
    render(<SettingsModal onClose={() => undefined} initialTab="tools" />);

    expect(screen.getByText('Tools panel')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('settings-tab-llm'));
    expect(screen.getByText('LLM panel')).toBeInTheDocument();
  });

  it('falls back to the first registry tab when the initial tab is unknown', () => {
    render(<SettingsModal onClose={() => undefined} initialTab="missing" />);

    expect(screen.getByText('LLM panel')).toBeInTheDocument();
  });

  it('keeps desktop scrolling in the active panel instead of the settings navigation', () => {
    render(<SettingsModal onClose={() => undefined} />);

    expect(screen.getByTestId('settings-navigation')).toHaveClass('lg:overflow-visible');
    expect(screen.getByTestId('settings-panel-scroll')).toHaveClass('overflow-y-auto');
  });

  it('moves focus into the modal when it opens', () => {
    render(<SettingsModal onClose={() => undefined} />);

    expect(screen.getByTestId('settings-close')).toHaveFocus();
  });

  it('contains Tab and Shift+Tab while keeping panel inputs and navigation usable', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsHarness onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Panel action' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close settings' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: /LLM Settings$/ })).toHaveFocus();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Tool name' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: /LLM Settings$/ }));
    expect(screen.getByText('LLM panel')).toBeVisible();
    screen.getByRole('button', { name: /CLI Agents$/ }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close settings' })).toHaveFocus();
    // Backdrop clicks retain the existing non-dismissable behavior.
    await user.click(screen.getByTestId('settings-modal'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(['button', 'Escape'])('restores opener focus after closing with %s', async (method) => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsHarness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Open settings' });
    await user.click(opener);
    expect(screen.getByRole('button', { name: 'Close settings' })).toHaveFocus();
    if (method === 'Escape') await user.keyboard('{Escape}');
    else await user.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledOnce();
    expect(opener).toHaveFocus();
  });

  it('lets the portalled reset dialog own keyboard focus and Escape while Settings is inert', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const cancelReset = vi.fn();
    const confirmReset = vi.fn();
    const view = render(<><SettingsModal onClose={onClose} /></>);
    const lastTab = screen.getByRole('button', { name: /CLI Agents$/ });
    lastTab.focus();
    view.rerender(<>
      <SettingsModal onClose={onClose} />
      <NativeIntegrationResetDialog name="Test runtime" onCancel={cancelReset} onConfirm={confirmReset} />
    </>);
    expect(screen.getByTestId('settings-modal').inert).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Reset server' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(cancelReset).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(confirmReset).not.toHaveBeenCalled();
    view.rerender(<><SettingsModal onClose={onClose} /></>);
    expect(lastTab).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close settings' })).toHaveFocus();
  });

  it.each(['nested', 'portalled'])('defers Tab and Escape to a %s native dialog without explicit Settings inertness', (location) => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    const nested = document.createElement('dialog');
    const nestedAction = document.createElement('button');
    nestedAction.textContent = 'Nested action';
    nested.append(nestedAction);
    (location === 'nested' ? screen.getByTestId('settings-modal') : document.body).append(nested);
    try {
      // jsdom lacks showModal's top layer; represent its open state without setting parent.inert.
      nested.setAttribute('open', '');
      nestedAction.focus();
      expect(screen.getByTestId('settings-modal').inert).not.toBe(true);
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      fireEvent(nestedAction, tab);
      expect(tab.defaultPrevented).toBe(false);
      expect(nestedAction).toHaveFocus();
      fireEvent.keyDown(nestedAction, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      nested.remove();
    }
  });

  it('leaves Escape to an expanded combobox before closing Settings', () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    const combobox = document.createElement('input');
    combobox.setAttribute('role', 'combobox');
    combobox.setAttribute('aria-expanded', 'true');
    screen.getByTestId('settings-modal').append(combobox);
    combobox.focus();
    fireEvent.keyDown(combobox, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    combobox.setAttribute('aria-expanded', 'false');
    fireEvent.keyDown(combobox, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('consumes runtime tab requests from the settings store', async () => {
    useSettingsStore.getState().requestSettingsTab('runtime');

    render(<SettingsModal onClose={() => undefined} initialTab="tools" />);

    expect(await screen.findByText('Runtime panel')).toBeInTheDocument();
    expect(useSettingsStore.getState().requestedSettingsTab).toBeNull();
  });

  it('closes from the close button and the Escape key', () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);

    fireEvent.click(screen.getByTestId('settings-close'));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

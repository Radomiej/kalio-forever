import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
      component: () => <div>Tools panel</div>,
    },
  ],
}));

import { SettingsModal } from './SettingsModal';

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

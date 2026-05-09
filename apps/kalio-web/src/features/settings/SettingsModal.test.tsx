import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('./registry', () => ({
  SETTINGS_BLOCKS: [
    {
      id: 'llm',
      label: 'LLM Settings',
      icon: <span>llm</span>,
      component: () => <div>LLM panel</div>,
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

  it('closes from the close button and the Escape key', () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);

    fireEvent.click(screen.getByTestId('settings-close'));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

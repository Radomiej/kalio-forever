import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Update } from '@tauri-apps/plugin-updater';
import { DesktopUpdateNotice } from './DesktopUpdateNotice';
import { useDesktopUpdater } from './desktopUpdater';

vi.mock('./desktopUpdater', () => ({
  useDesktopUpdater: vi.fn(),
}));

const mockedUseDesktopUpdater = vi.mocked(useDesktopUpdater);

function createUpdate(): Update {
  return { version: '1.1.0', body: 'Bug fixes' } as unknown as Update;
}

describe('DesktopUpdateNotice', () => {
  beforeEach(() => {
    mockedUseDesktopUpdater.mockReturnValue({
      update: createUpdate(),
      status: 'available',
      progress: null,
      errorMessage: null,
      install: vi.fn(),
      dismiss: vi.fn(),
    });
  });

  it('shows the available version and starts installation after confirmation', () => {
    const install = vi.fn();
    mockedUseDesktopUpdater.mockReturnValue({
      update: createUpdate(),
      status: 'available',
      progress: null,
      errorMessage: null,
      install,
      dismiss: vi.fn(),
    });

    render(<DesktopUpdateNotice />);

    expect(screen.getByTestId('desktop-update-notice')).toHaveTextContent('Version 1.1.0');
    fireEvent.click(screen.getByRole('button', { name: 'Install and restart' }));

    expect(install).toHaveBeenCalledOnce();
  });

  it('keeps the notification accessible while installation is running', () => {
    mockedUseDesktopUpdater.mockReturnValue({
      update: createUpdate(),
      status: 'installing',
      progress: 42,
      errorMessage: null,
      install: vi.fn(),
      dismiss: vi.fn(),
    });

    render(<DesktopUpdateNotice />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Installing update — 42%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Installing…' })).toBeDisabled();
  });
});

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
      retry: vi.fn(),
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
      retry: vi.fn(),
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
      retry: vi.fn(),
    });

    render(<DesktopUpdateNotice />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Installing update — 42%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Installing…' })).toBeDisabled();
  });

  it('offers an explicit retry after an installation failure', () => {
    const install = vi.fn();
    mockedUseDesktopUpdater.mockReturnValue({
      update: createUpdate(),
      status: 'available',
      progress: null,
      errorMessage: 'The update could not be installed. Try again later.',
      install,
      dismiss: vi.fn(),
      retry: vi.fn(),
    });

    render(<DesktopUpdateNotice />);

    expect(screen.getByRole('alert')).toHaveTextContent('could not be installed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry install' }));
    expect(install).toHaveBeenCalledOnce();
  });

  it('shows a retry action when the update check fails before an update is available', () => {
    const retry = vi.fn();
    mockedUseDesktopUpdater.mockReturnValue({
      update: null,
      status: 'idle',
      progress: null,
      errorMessage: 'Updates are temporarily unavailable. Try again.',
      install: vi.fn(),
      dismiss: vi.fn(),
      retry,
    });

    render(<DesktopUpdateNotice />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry check' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

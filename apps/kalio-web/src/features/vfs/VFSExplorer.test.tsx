import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { VFSListResult } from '@kalio/types';

type SessionStoreShape = {
  activeSessionId: string | null;
};

const { activeSession, apiGet } = vi.hoisted(() => ({
  activeSession: { activeSessionId: null as string | null },
  apiGet: vi.fn(),
}));

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: (selector?: (state: SessionStoreShape) => unknown) => {
    if (selector) {
      return selector(activeSession);
    }
    return activeSession;
  },
}));

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    get: apiGet,
  },
}));

import { VFSExplorer } from './VFSExplorer';

describe('VFSExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeSession.activeSessionId = null;
  });

  it('shows a placeholder when no session is active', () => {
    render(<VFSExplorer />);

    expect(screen.getByTestId('vfs-explorer')).toHaveTextContent('No active session');
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('shows an empty state when the active session has no files', async () => {
    activeSession.activeSessionId = 'session-1';
    apiGet.mockResolvedValue({
      data: {
        sessionId: 'session-1',
        files: [],
      } satisfies VFSListResult,
    });

    render(<VFSExplorer />);

    expect(await screen.findByTestId('vfs-empty')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/api/sessions/session-1/vfs');
  });

  it('renders loaded files and logs fetch failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    activeSession.activeSessionId = 'session-1';
    apiGet
      .mockResolvedValueOnce({
        data: {
          sessionId: 'session-1',
          files: [{
            sessionId: 'session-1',
            path: 'notes/todo.md',
            sizeBytes: 2048,
            updatedAt: 1,
          }],
        } satisfies VFSListResult,
      })
      .mockRejectedValueOnce(new Error('load failed'));

    const { rerender } = render(<VFSExplorer />);

    expect(await screen.findByText('notes/todo.md')).toBeInTheDocument();
    expect(screen.getByText('2.0kb')).toBeInTheDocument();

    rerender(<VFSExplorer />);
    activeSession.activeSessionId = 'session-2';
    rerender(<VFSExplorer />);

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith('[VFSExplorer] load failed', expect.any(Error));
    });
  });
});

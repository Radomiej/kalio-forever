import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { VFSListResult, VFSReadResult } from '@kalio/types';

const { apiGet } = vi.hoisted(() => ({
  apiGet: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    get: apiGet,
    defaults: {
      baseURL: 'http://api.example.com',
    },
  },
}));

import { ConversationFilesBar } from './ConversationFilesBar';

function makeListResult(): VFSListResult {
  return {
    sessionId: 'session-1',
    files: [
      {
        sessionId: 'session-1',
        path: 'notes/todo.md',
        sizeBytes: 2048,
        mimeType: 'text/markdown',
        updatedAt: 1,
      },
      {
        sessionId: 'session-1',
        path: 'data/config.json',
        sizeBytes: 512,
        mimeType: 'application/json',
        updatedAt: 1,
      },
    ],
  };
}

describe('ConversationFilesBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('loads files, opens the modal, previews a file, and downloads file artifacts', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url.includes('/read')) {
        return Promise.resolve({
          data: {
            sessionId: 'session-1',
            filePath: 'notes/todo.md',
            content: '# Todo',
          } satisfies VFSReadResult,
        });
      }
      return Promise.resolve({ data: makeListResult() });
    });

    render(<ConversationFilesBar sessionId="session-1" />);

    expect(await screen.findByText('2')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('conversation-files-toggle'));
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);

    fireEvent.click(await screen.findByTestId('conv-file-notes-todo.md'));
    expect(await screen.findByTestId('conversation-files-preview')).toHaveTextContent('# Todo');

    fireEvent.click(screen.getByTestId('conversation-files-zip'));
    fireEvent.click(screen.getByTitle('Download file'));

    expect(window.open).toHaveBeenNthCalledWith(
      1,
      'http://api.example.com/api/sessions/session-1/vfs/zip',
      '_blank',
    );
    expect(window.open).toHaveBeenNthCalledWith(
      2,
      'http://api.example.com/api/sessions/session-1/vfs/download?path=notes%2Ftodo.md',
      '_blank',
    );
  });

  it('logs list failures and falls back to an empty file list', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    apiGet.mockRejectedValue(new Error('list failed'));

    render(<ConversationFilesBar sessionId="session-1" />);

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith('[ConversationFilesBar] load failed', expect.any(Error));
    });

    fireEvent.click(screen.getByTestId('conversation-files-toggle'));
    expect(await screen.findByText('No files yet')).toBeInTheDocument();
  });

  it('refreshes on signal changes and shows a preview fallback when file loading fails', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url.includes('/read')) {
        return Promise.reject(new Error('preview failed'));
      }
      return Promise.resolve({ data: makeListResult() });
    });

    const { rerender } = render(<ConversationFilesBar sessionId="session-1" refreshSignal={0} />);

    fireEvent.click(await screen.findByTestId('conversation-files-toggle'));
    fireEvent.click(await screen.findByTestId('conv-file-notes-todo.md'));

    expect(await screen.findByTestId('conversation-files-preview')).toHaveTextContent('Failed to load file.');

    rerender(<ConversationFilesBar sessionId="session-1" refreshSignal={1} />);

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/api/sessions/session-1/vfs');
    });
  });
});

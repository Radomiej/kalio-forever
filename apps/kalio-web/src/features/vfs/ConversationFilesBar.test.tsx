import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { VFSListResult, VFSReadResult } from '@kalio/types';

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));
const { reportBackendSuccess, reportBackendFailure } = vi.hoisted(() => ({
  reportBackendSuccess: vi.fn(),
  reportBackendFailure: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    get: apiGet,
    post: apiPost,
    defaults: {
      baseURL: 'http://api.example.com',
    },
  },
  getApiBaseUrl: () => 'http://api.example.com',
}));

vi.mock('../../services/backendHealth', () => ({
  backendHealth: {
    reportSuccess: reportBackendSuccess,
    reportFailure: reportBackendFailure,
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
    vi.spyOn(window, 'prompt').mockReturnValue('project/seed.md');
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

  it('logs list failures and shows an offline retry state instead of an empty file list', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    apiGet.mockRejectedValue(new Error('list failed'));

    render(<ConversationFilesBar sessionId="session-1" />);

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith('[ConversationFilesBar] load failed', expect.any(Error));
    });

    fireEvent.click(screen.getByTestId('conversation-files-toggle'));
    expect(await screen.findByTestId('conversation-files-list-error')).toHaveTextContent('Backend offline');
    expect(screen.queryByText('No files yet')).toBeNull();
    expect(reportBackendFailure).toHaveBeenCalled();
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

  it('uploads text files through the multipart VFS endpoint and refreshes the file list', async () => {
    const uploadedFile = {
      sessionId: 'session-1',
      path: 'project/seed.md',
      sizeBytes: 7,
      mimeType: 'text/markdown',
      updatedAt: 2,
    };
    let listCalls = 0;
    apiGet.mockImplementation((url: string, config?: { params?: { path?: string } }) => {
      if (url.includes('/read')) {
        return Promise.resolve({
          data: {
            sessionId: 'session-1',
            filePath: config?.params?.path ?? '',
            content: '# Seed uploaded',
          } satisfies VFSReadResult,
        });
      }
      listCalls += 1;
      return Promise.resolve({
        data: {
          sessionId: 'session-1',
          files: listCalls >= 3 ? [uploadedFile] : [],
        } satisfies VFSListResult,
      });
    });
    apiPost.mockResolvedValue({ data: { ok: true, path: 'project/seed.md', bytesWritten: 7 } });

    render(<ConversationFilesBar sessionId="session-1" />);

    fireEvent.click(await screen.findByTestId('conversation-files-toggle'));
    const input = screen.getByTestId('conversation-files-upload-input') as HTMLInputElement;
    const file = new File(['# Seed'], 'seed.md', { type: 'text/markdown' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/sessions/session-1/vfs/upload-text', expect.any(FormData));
    });
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/api/sessions/session-1/vfs');
    });
    expect(window.prompt).toHaveBeenCalledWith('Upload file to VFS path', 'project/seed.md');
    expect(screen.getByTestId('conv-file-project-seed.md')).toHaveTextContent('project/seed.md');
    expect(screen.getByTestId('conversation-files-preview')).toHaveTextContent('# Seed uploaded');
  });

  it('skips the upload when the target path prompt is cancelled', async () => {
    apiGet.mockResolvedValue({ data: makeListResult() });
    vi.mocked(window.prompt).mockReturnValueOnce(null);

    render(<ConversationFilesBar sessionId="session-1" />);

    fireEvent.click(await screen.findByTestId('conversation-files-toggle'));
    const input = screen.getByTestId('conversation-files-upload-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['# Seed'], 'seed.md', { type: 'text/markdown' })] } });

    expect(apiPost).not.toHaveBeenCalled();
    expect(screen.queryByTestId('conversation-files-upload-error')).toBeNull();
  });

  it('shows an actionable error when text upload is too large', async () => {
    apiGet.mockResolvedValue({ data: makeListResult() });
    apiPost.mockRejectedValue({ response: { status: 413, data: { message: 'Payload Too Large' } } });

    render(<ConversationFilesBar sessionId="session-1" />);

    fireEvent.click(await screen.findByTestId('conversation-files-toggle'));
    const input = screen.getByTestId('conversation-files-upload-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'large.md', { type: 'text/markdown' })] } });

    expect(await screen.findByTestId('conversation-files-upload-error')).toHaveTextContent('too large');
    expect(screen.getByTestId('conversation-files-upload-error')).toHaveTextContent('split the project seed');
  });
});

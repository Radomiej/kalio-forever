import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { VfsHtmlRenderer } from './VfsHtmlRenderer';

vi.mock('./HtmlIframeRenderer', () => ({
  HtmlIframeRenderer: ({ src }: { src: string }) => <div data-testid="raapp-vfs-src">{src}</div>,
}));

describe('VfsHtmlRenderer', () => {
  const fetchMock = vi.fn();

  function expectRenderedPreviewPath(vfsPath: string) {
    return screen.findByTestId('raapp-vfs-src').then((element) => {
      expect(element).toHaveTextContent(
        `/api/sessions/session-1/vfs/serve-path/${vfsPath}`,
      );
      return element;
    });
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('uses the path-based VFS serve route so relative assets resolve correctly', async () => {
    fetchMock.mockResolvedValue({ ok: true });

    render(<VfsHtmlRenderer sessionId="session-1" vfsPath="drafts/my app/index.html" />);

    await expectRenderedPreviewPath('drafts/my%20app/index.html');
  });

  it('keeps the preview preflight request credential-free for cross-origin dev serving', async () => {
    fetchMock.mockResolvedValue({ ok: true });

    render(<VfsHtmlRenderer sessionId="session-1" vfsPath="drafts/secure/index.html" />);

    await expectRenderedPreviewPath('drafts/secure/index.html');

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(typeof requestUrl).toBe('string');
    expect(new URL(String(requestUrl)).pathname).toBe('/api/sessions/session-1/vfs/serve-path/drafts/secure/index.html');
    expect(requestInit).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(requestInit).not.toHaveProperty('credentials');
  });

  it('shows a non-technical loading state before the preview is ready', async () => {
    let resolveFetch: (value: { ok: boolean }) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve as (value: { ok: boolean }) => void;
        }),
    );

    render(<VfsHtmlRenderer sessionId="session-1" vfsPath="drafts/loading/index.html" />);

    expect(screen.getByTestId('raapp-preview-loading')).toHaveTextContent('Preparing your app preview');

    await act(async () => {
      resolveFetch({ ok: true });
      await Promise.resolve();
    });

    await expectRenderedPreviewPath('drafts/loading/index.html');
  });

  it('shows a friendly fallback when the VFS preview target is unavailable', async () => {
    fetchMock.mockResolvedValue({ ok: false });

    render(<VfsHtmlRenderer sessionId="session-1" vfsPath="drafts/missing/index.html" />);

    expect(await screen.findByTestId('raapp-preview-unavailable')).toHaveTextContent(
      'not available yet',
    );
    expect(screen.queryByTestId('raapp-vfs-src')).not.toBeInTheDocument();
  });

  it('lets users retry preview checks without remounting the iframe', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });

    render(<VfsHtmlRenderer sessionId="session-1" vfsPath="drafts/ready/index.html" />);

    expect(await screen.findByTestId('raapp-preview-unavailable')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));

    await expectRenderedPreviewPath('drafts/ready/index.html');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

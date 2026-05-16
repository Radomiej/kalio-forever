import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VfsHtmlRenderer } from './VfsHtmlRenderer';

vi.mock('./HtmlIframeRenderer', () => ({
  HtmlIframeRenderer: ({ src }: { src: string }) => <div data-testid="raapp-vfs-src">{src}</div>,
}));

describe('VfsHtmlRenderer', () => {
  const fetchMock = vi.fn();

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

    expect(await screen.findByTestId('raapp-vfs-src')).toHaveTextContent(
      'http://localhost:3016/api/sessions/session-1/vfs/serve-path/drafts/my%20app/index.html',
    );
  });

  it('keeps the preview preflight request credential-free for cross-origin dev serving', async () => {
    fetchMock.mockResolvedValue({ ok: true });

    render(<VfsHtmlRenderer sessionId="session-1" vfsPath="drafts/secure/index.html" />);

    await screen.findByTestId('raapp-vfs-src');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3016/api/sessions/session-1/vfs/serve-path/drafts/secure/index.html',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('credentials');
  });

  it('shows a friendly fallback when the VFS preview target is unavailable', async () => {
    fetchMock.mockResolvedValue({ ok: false });

    render(<VfsHtmlRenderer sessionId="session-1" vfsPath="drafts/missing/index.html" />);

    expect(await screen.findByTestId('raapp-preview-unavailable')).toHaveTextContent(
      'Preview unavailable',
    );
    expect(screen.queryByTestId('raapp-vfs-src')).not.toBeInTheDocument();
  });
});
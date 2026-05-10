import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VfsHtmlRenderer } from './VfsHtmlRenderer';

vi.mock('./HtmlIframeRenderer', () => ({
  HtmlIframeRenderer: ({ src }: { src: string }) => <div data-testid="raapp-vfs-src">{src}</div>,
}));

describe('VfsHtmlRenderer', () => {
  it('uses the path-based VFS serve route so relative assets resolve correctly', () => {
    render(<VfsHtmlRenderer sessionId="session-1" vfsPath="drafts/my app/index.html" />);

    expect(screen.getByTestId('raapp-vfs-src')).toHaveTextContent(
      'http://localhost:3016/api/sessions/session-1/vfs/serve-path/drafts/my%20app/index.html',
    );
  });
});
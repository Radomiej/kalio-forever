import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { HtmlIframeRenderer } from './HtmlIframeRenderer';

// ── sessionStore mock ───────────────────────────────────────────────────────
const addMessage = vi.fn();
vi.mock('../../store/sessionStore', () => ({
  useSessionStore: Object.assign(
    () => ({
      activeSessionId: 'session-1',
      sessions: [{ id: 'session-1', title: 'Test', personaId: 'p1', createdAt: 0, updatedAt: 0 }],
      addMessage,
    }),
    {
      getState: () => ({
        activeSessionId: 'session-1',
        sessions: [{ id: 'session-1', title: 'Test', personaId: 'p1', createdAt: 0, updatedAt: 0 }],
        addMessage,
      }),
    },
  ),
}));

vi.mock('../../services/eventBus', () => ({
  eventBus: {
    sendMessage: vi.fn(),
  },
}));

describe('HtmlIframeRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders an iframe with srcDoc and data-testid', () => {
    render(<HtmlIframeRenderer html="<p>Hello</p>" />);
    const iframe = screen.getByTestId('raapp-iframe');
    expect(iframe).toBeInTheDocument();
    const srcDoc = iframe.getAttribute('srcDoc') ?? '';
    expect(srcDoc).toContain('<p>Hello</p>');
    expect(srcDoc).toContain("type:'raapp_resize'");
  });

  it('REGRESSION: injected resize bridge logs sendHeight failures instead of swallowing them', () => {
    render(<HtmlIframeRenderer html="<p>Hello</p>" />);

    const iframe = screen.getByTestId('raapp-iframe');
    const srcDoc = iframe.getAttribute('srcDoc') ?? '';

    expect(srcDoc).toContain("console.error('[RAApp:Bridge] sendHeight failed',e);");
    expect(srcDoc).not.toContain('}catch(e){}');
  });

  it('has sandbox attribute allowing scripts and modals', () => {
    render(<HtmlIframeRenderer html="<div></div>" />);
    const iframe = screen.getByTestId('raapp-iframe');
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-modals');
  });

  it('sets initial height to minHeight prop', () => {
    render(<HtmlIframeRenderer html="<div></div>" minHeight={300} />);
    const iframe = screen.getByTestId('raapp-iframe');
    expect(iframe).toHaveStyle({ minHeight: '300px' });
  });

  it('includes a download button with correct aria-label', () => {
    render(<HtmlIframeRenderer html="<p>Test</p>" title="My App" />);
    const btn = screen.getByLabelText('Download HTML');
    expect(btn).toBeInTheDocument();
  });

  it('renders src-based previews without exposing the HTML download action', () => {
    render(<HtmlIframeRenderer src="http://localhost:3016/api/sessions/session-1/vfs/serve-path/design/preview.html" />);

    const iframe = screen.getByTestId('raapp-iframe');
    expect(iframe).toHaveAttribute('src', 'http://localhost:3016/api/sessions/session-1/vfs/serve-path/design/preview.html');
    expect(iframe).not.toHaveAttribute('srcDoc');
    expect(screen.queryByLabelText('Download HTML')).not.toBeInTheDocument();
  });

  it('does not grow endlessly when resize events echo current iframe height', () => {
    render(<HtmlIframeRenderer html="<p>Loop Guard</p>" minHeight={200} />);

    const iframe = screen.getByTestId('raapp-iframe') as HTMLIFrameElement;
    const source = iframe.contentWindow;

    if (!source) {
      throw new Error('Expected iframe contentWindow to be available in test environment');
    }

    window.dispatchEvent(
      new MessageEvent('message', {
        source,
        data: { type: 'raapp_resize', height: 200 },
      }),
    );
    expect(iframe.style.height).toBe('200px');

    // A feedback loop would repost the same/near-same viewport height repeatedly.
    window.dispatchEvent(
      new MessageEvent('message', {
        source,
        data: { type: 'raapp_resize', height: 200 },
      }),
    );
    expect(iframe.style.height).toBe('200px');

    window.dispatchEvent(
      new MessageEvent('message', {
        source,
        data: { type: 'raapp_resize', height: 201 },
      }),
    );
    expect(iframe.style.height).toBe('200px');
  });

  it('REGRESSION: clamps absurdly tall inline previews instead of stretching the chat bubble indefinitely', () => {
    render(<HtmlIframeRenderer html="<p>Clamp Guard</p>" minHeight={200} />);

    const iframe = screen.getByTestId('raapp-iframe') as HTMLIFrameElement;
    const source = iframe.contentWindow;

    if (!source) {
      throw new Error('Expected iframe contentWindow to be available in test environment');
    }

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source,
          data: { type: 'raapp_resize', height: 20_000 },
        }),
      );
    });

    expect(iframe.style.height).toBe('1200px');
  });

  it('opens and closes fullscreen modal', () => {
    render(<HtmlIframeRenderer html="<p>Fullscreen</p>" title="My App" />);

    const openBtn = screen.getByLabelText('Open fullscreen');
    fireEvent.click(openBtn);

    expect(screen.getByLabelText('RA-App fullscreen modal')).toBeInTheDocument();
    expect(screen.getByTestId('raapp-iframe-fullscreen')).toBeInTheDocument();

    const closeBtn = screen.getByLabelText('Close fullscreen');
    fireEvent.click(closeBtn);

    expect(screen.queryByTestId('raapp-iframe-fullscreen')).not.toBeInTheDocument();
  });
});

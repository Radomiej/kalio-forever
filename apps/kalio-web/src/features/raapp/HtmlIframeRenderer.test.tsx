import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    expect(iframe).toHaveAttribute('srcDoc', '<p>Hello</p>');
  });

  it('has sandbox attribute allowing scripts and same-origin', () => {
    render(<HtmlIframeRenderer html="<div></div>" />);
    const iframe = screen.getByTestId('raapp-iframe');
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
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
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RAAppRenderer } from './RAAppRenderer';

vi.mock('./HtmlIframeRenderer', () => ({
  HtmlIframeRenderer: ({ html }: { html: string }) => (
    <div data-testid="raapp-html-renderer">{html}</div>
  ),
}));

vi.mock('./VfsHtmlRenderer', () => ({
  VfsHtmlRenderer: ({ sessionId, vfsPath }: { sessionId: string; vfsPath: string }) => (
    <div data-testid="raapp-vfs-renderer">{sessionId}:{vfsPath}</div>
  ),
}));

vi.mock('../../store/agentStore', () => ({
  useAgentStore: (selector: (state: { isStreaming: boolean }) => boolean) => selector({ isStreaming: false }),
}));

const addMessage = vi.fn();
const enqueueUserAction = vi.fn();

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: Object.assign(
    (selector: (state: {
      activeSessionId: string;
      sessions: Array<{ id: string; personaId: string; title: string; createdAt: number; updatedAt: number }>;
      addMessage: typeof addMessage;
      enqueueUserAction: typeof enqueueUserAction;
    }) => unknown) => selector({
      activeSessionId: 'session-1',
      sessions: [{ id: 'session-1', personaId: 'persona-1', title: 'Test', createdAt: 0, updatedAt: 0 }],
      addMessage,
      enqueueUserAction,
    }),
    {
      getState: () => ({
        activeSessionId: 'session-1',
        sessions: [{ id: 'session-1', personaId: 'persona-1', title: 'Test', createdAt: 0, updatedAt: 0 }],
        addMessage,
        enqueueUserAction,
      }),
    },
  ),
}));

vi.mock('../../services/eventBus', () => ({
  eventBus: {
    sendMessage: vi.fn(),
  },
}));

describe('RAAppRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes VFS-backed html blocks to VfsHtmlRenderer', () => {
    render(
      <RAAppRenderer
        block={{ type: 'html', mode: 'display', content: '', vfsPath: 'design/preview.html' }}
        sessionId="session-123"
      />,
    );

    expect(screen.getByTestId('raapp-vfs-renderer')).toHaveTextContent('session-123:design/preview.html');
  });

  it('renders native operation results when the RA-App block carries them', () => {
    render(
      <RAAppRenderer
        block={{
          type: 'html',
          mode: 'display',
          content: '<main>Preview</main>',
          nativeResults: [
            {
              id: 'native-1',
              system: 'vfs_write',
              status: 'executed',
              result: { path: 'drafts/result.txt' },
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Native operations')).toBeInTheDocument();
    expect(screen.getByText('vfs_write')).toBeInTheDocument();
    expect(screen.getByText(/drafts\/result\.txt/)).toBeInTheDocument();
  });
});
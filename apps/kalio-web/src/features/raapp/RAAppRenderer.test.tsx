import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RAAppRenderer } from './RAAppRenderer';

vi.mock('./HtmlIframeRenderer', () => ({
  HtmlIframeRenderer: ({ html, mode }: { html: string; mode?: string }) => (
    <div data-testid="raapp-html-renderer" data-mode={mode}>{html}</div>
  ),
}));

vi.mock('./VfsHtmlRenderer', () => ({
  VfsHtmlRenderer: ({ sessionId, vfsPath }: { sessionId: string; vfsPath: string }) => (
    <div data-testid="raapp-vfs-renderer">{sessionId}:{vfsPath}</div>
  ),
}));

vi.mock('./GuiDslRenderer', () => ({
  GuiDslRenderer: ({ onAction }: { onAction: (action: string) => void }) => (
    <button data-testid="raapp-gui-action" onClick={() => onAction('GUI_ACTION')}>Run GUI action</button>
  ),
}));

const { agentState } = vi.hoisted(() => ({
  agentState: {
    getToolActivitiesForSession: vi.fn(() => []),
    hasActiveLoopForSession: vi.fn(() => false),
    queuedDepthBySession: {} as Record<string, number>,
  },
}));

vi.mock('../../store/agentStore', () => ({
  useAgentStore: (selector: (state: typeof agentState) => unknown) => selector(agentState),
}));

const { addMessage, enqueueUserAction, getSessionActiveTurnId, sendMessage, sessions } = vi.hoisted(() => ({
  addMessage: vi.fn(),
  enqueueUserAction: vi.fn(),
  getSessionActiveTurnId: vi.fn(() => null),
  sendMessage: vi.fn(),
  sessions: [{ id: 'session-1', personaId: 'persona-1', title: 'Test', createdAt: 0, updatedAt: 0 }],
}));

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: Object.assign(
    (selector: (state: {
      activeSessionId: string;
      sessions: Array<{ id: string; personaId: string; title: string; createdAt: number; updatedAt: number }>;
      messages: Array<{ id: string; sessionId: string; role: 'user' | 'assistant'; content: string; createdAt: number }>;
      agentTurns: Array<{ id: string; sessionId: string; done: boolean; items: [] }>;
      streamingChunks: Record<string, string>;
      thinkingChunks: Record<string, string>;
      chunkSessionIds: Record<string, string>;
      getSessionActiveTurnId: typeof getSessionActiveTurnId;
      addMessage: typeof addMessage;
      enqueueUserAction: typeof enqueueUserAction;
    }) => unknown) => selector({
      activeSessionId: 'session-1',
      sessions,
      messages: [],
      agentTurns: [],
      streamingChunks: {},
      thinkingChunks: {},
      chunkSessionIds: {},
      getSessionActiveTurnId,
      addMessage,
      enqueueUserAction,
    }),
    {
      getState: () => ({
        activeSessionId: 'session-1',
        sessions,
        addMessage,
        enqueueUserAction,
      }),
    },
  ),
}));

vi.mock('../../services/eventBus', () => ({
  eventBus: {
    sendMessage,
  },
}));

describe('RAAppRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentState.getToolActivitiesForSession.mockReturnValue([]);
    agentState.hasActiveLoopForSession.mockReturnValue(false);
    agentState.queuedDepthBySession = {};
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

  it('passes html block mode to HtmlIframeRenderer', () => {
    render(
      <RAAppRenderer
        block={{
          type: 'html',
          mode: 'interactive',
          content: '<main>Interactive</main>',
        }}
      />,
    );

    expect(screen.getByTestId('raapp-html-renderer')).toHaveAttribute('data-mode', 'interactive');
  });

  it('queues GUI actions while the active session still has a live turn', () => {
    agentState.hasActiveLoopForSession.mockReturnValue(true);

    render(
      <RAAppRenderer
        block={{
          type: 'gui',
          mode: 'interactive',
          content: JSON.stringify({ nodes: [], data: {} }),
        }}
      />,
    );

    fireEvent.click(screen.getByTestId('raapp-gui-action'));

    expect(enqueueUserAction).toHaveBeenCalledWith('GUI_ACTION');
    expect(addMessage).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { RAAppRenderer } from './RAAppRenderer';
import type { GuiDslPayload } from '@kalio/types';

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

const { rendererState } = vi.hoisted(() => ({ rendererState: { realGui: false } }));
vi.mock('./GuiDslRenderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./GuiDslRenderer')>();
  return { GuiDslRenderer: ({ payload, onAction }: { payload: GuiDslPayload; onAction: (action: string) => void }) =>
    rendererState.realGui ? <actual.GuiDslRenderer payload={payload} onAction={onAction} />
      : <button data-testid="raapp-gui-action" onClick={() => onAction('GUI_ACTION')}>Run GUI action</button> };
});

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

const {
  addMessage,
  approveRaApp,
  cancelRaApp,
  enqueueUserAction,
  getSessionActiveTurnId,
  raAppNativeHandlers,
  sendMessage,
  sessions,
} = vi.hoisted(() => ({
  addMessage: vi.fn(),
  approveRaApp: vi.fn(),
  cancelRaApp: vi.fn(),
  enqueueUserAction: vi.fn(),
  getSessionActiveTurnId: vi.fn(() => null),
  raAppNativeHandlers: [] as Array<(payload: {
    sessionId: string;
    toolCallId: string;
    results: Array<{ id: string; system: string; status: 'executed' | 'cancelled' | 'error' }>;
  }) => void>,
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
    approveRaApp,
    cancelRaApp,
    onRaAppNativeResult: (handler: (payload: {
      sessionId: string;
      toolCallId: string;
      results: Array<{ id: string; system: string; status: 'executed' | 'cancelled' | 'error' }>;
    }) => void) => {
      raAppNativeHandlers.push(handler);
      return () => {
        const index = raAppNativeHandlers.indexOf(handler);
        if (index >= 0) {
          raAppNativeHandlers.splice(index, 1);
        }
      };
    },
    sendMessage,
  },
}));

describe('RAAppRenderer', () => {
  beforeEach(() => {
    rendererState.realGui = false;
    vi.clearAllMocks();
    raAppNativeHandlers.splice(0, raAppNativeHandlers.length);
    agentState.getToolActivitiesForSession.mockReturnValue([]);
    agentState.hasActiveLoopForSession.mockReturnValue(false);
    agentState.queuedDepthBySession = {};
  });

  it('rehydrates Q&A question/options and sends the clicked answer through the conversation channel', () => {
    rendererState.realGui = true;
    const payload: GuiDslPayload = { nodes: [{ kind: 'element', tag: 'window',
      props: { id: { kind: 'identifier', value: 'qa_panel' } }, children: [
        { kind: 'element', tag: 'label', props: { text: { kind: 'string', value: '[output.question]' } }, children: [] },
        ...[0, 1].map((index) => ({ kind: 'element' as const, tag: 'button', props: {
          text: { kind: 'string' as const, value: `[output.option_${index}]` },
          visible: { kind: 'string' as const, value: `[output.option_${index}]` },
          onclick: { kind: 'string' as const, value: `I choose: [output.option_${index}]` },
        }, children: [] })),
      ] }], data: { output: { question: 'Which runtime?', options: ['OpenRouter', 'Devin'], option_0: 'OpenRouter', option_1: 'Devin' } } };
    const block = { type: 'gui' as const, mode: 'interactive' as const, content: JSON.stringify(payload) };
    const first = render(<RAAppRenderer block={block} sessionId="session-1" />);
    expect(screen.getByText('Which runtime?')).toBeInTheDocument();
    first.unmount();
    render(<RAAppRenderer block={JSON.parse(JSON.stringify(block))} sessionId="session-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Devin' }));
    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1', role: 'user', content: 'I choose: Devin' }));
    expect(sendMessage).toHaveBeenCalledWith({ sessionId: 'session-1', content: 'I choose: Devin', personaId: 'persona-1' });
  });

  it('shows an actionable error for an empty Q&A restored from persisted history', () => {
    const payload: GuiDslPayload = { nodes: [{ kind: 'element', tag: 'window',
      props: { id: { kind: 'identifier', value: 'qa_panel' } }, children: [] }], data: { output: {} } };
    render(<RAAppRenderer block={{ type: 'gui', mode: 'interactive', content: JSON.stringify(payload) }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Ask the agent to generate');
    expect(screen.queryByTestId('raapp-gui-action')).not.toBeInTheDocument();
  });

  it('does not send an answer from another session preview into the active conversation', () => {
    render(<RAAppRenderer sessionId="different-session" block={{ type: 'gui', mode: 'interactive',
      content: JSON.stringify({ nodes: [], data: {} }) }} />);
    fireEvent.click(screen.getByTestId('raapp-gui-action'));
    expect(addMessage).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(enqueueUserAction).not.toHaveBeenCalled();
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

  it('hides stale pending approvals after native results are merged', () => {
    render(
      <RAAppRenderer
        block={{
          type: 'html',
          mode: 'display',
          content: '<main>Preview</main>',
          pendingApprovals: [{
            id: 'approval-1',
            system: 'vfs_write',
            displayLabel: 'write file',
            args: { path: 'architecture.md' },
          }],
        }}
        result={{
          status: 'ready',
          nativeResults: [{
            id: 'approval-1',
            system: 'vfs_write',
            status: 'executed',
            result: { path: 'architecture.md' },
          }],
          pendingApprovals: [],
        }}
      />,
    );

    expect(screen.queryByTestId('raapp-hitl-overlay')).not.toBeInTheDocument();
    expect(screen.getByText('Native operations')).toBeInTheDocument();
  });

  it('settles the HITL overlay from a typed RA-App native result event', () => {
    render(
      <RAAppRenderer
        block={{
          type: 'html',
          mode: 'display',
          content: '<main>Preview</main>',
          pendingApprovals: [{
            id: 'approval-1',
            system: 'vfs_write',
            displayLabel: 'write file',
            args: { path: 'architecture.md' },
          }],
        }}
      />,
    );

    fireEvent.click(screen.getByTestId('raapp-hitl-approve'));

    expect(approveRaApp).toHaveBeenCalledWith({
      requestIds: ['approval-1'],
      sessionId: 'session-1',
    });

    act(() => {
      raAppNativeHandlers.forEach((handler) => handler({
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
        results: [{ id: 'approval-1', system: 'vfs_write', status: 'executed' }],
      }));
    });

    expect(screen.queryByTestId('raapp-hitl-overlay')).not.toBeInTheDocument();
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

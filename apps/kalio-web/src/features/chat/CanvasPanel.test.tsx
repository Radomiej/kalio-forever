import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasPanel } from './CanvasPanel';
import type { ChatMessage, ChatSession, ToolResult } from '@kalio/types';

interface MockAgentState {
  toolActivities: Array<{
    callId: string;
    toolName: string;
    args: Record<string, unknown>;
    status: 'running' | 'success';
    startedAt: number;
    finishedAt?: number;
    result?: ToolResult;
    agentRun?: {
      agentRunId: string;
      agentType: 'subagent';
      label: string;
      vfsMode: 'isolated';
    };
  }>;
  isStreaming: boolean;
  canvasOpen: boolean;
  toggleCanvas: () => void;
  activeAgentLoops: Record<string, {
    sessionId: string;
    turnId: string;
    agentRun?: {
      agentRunId: string;
      agentType: 'subagent';
      label: string;
      vfsMode: 'isolated';
    };
  }>;
  cliAgentOutput: Record<string, string>;
}

interface MockSessionState {
  messages: ChatMessage[];
  sessionMessages: Record<string, ChatMessage[]>;
  sessions: ChatSession[];
  activeSessionId: string;
  thinkingChunks: Record<string, string>;
  streamingChunks: Record<string, string>;
  chunkSessionIds: Record<string, string>;
  setActiveSession: ReturnType<typeof vi.fn>;
  getSessionMessages: (sessionId: string | null) => ChatMessage[];
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
}

const agentState: MockAgentState = {
  toolActivities: [
    {
      callId: 'master-call',
      toolName: 'run_subagent',
      args: {},
      status: 'success',
      startedAt: 1,
      finishedAt: 2,
      result: {
        callId: 'master-call',
        status: 'success',
        data: {
          result: 'created index.html',
          taskId: 'task-1',
          childSessionId: 'sub-session-1',
          parentSessionId: 'session-1',
          vfsMode: 'isolated',
          vfsSessionId: 'sub-session-1',
          copiedFiles: [{ fromPath: 'index.html', toPath: 'sub-agents/sub-session-1/index.html', sizeBytes: 123 }],
          durationMs: 20,
        },
      },
    },
    {
      callId: 'child-call',
      toolName: 'vfs_write',
      args: { path: 'index.html' },
      status: 'success',
      startedAt: 1,
      finishedAt: 2,
      agentRun: { agentRunId: 'run-1', agentType: 'subagent', label: 'Designer sub-agent', vfsMode: 'isolated' },
    },
  ],
  isStreaming: false,
  canvasOpen: true,
  toggleCanvas: vi.fn(),
  activeAgentLoops: {
    'run-1': {
      sessionId: 'sub-session-1',
      turnId: 'turn-1',
      agentRun: { agentRunId: 'run-1', agentType: 'subagent', label: 'Designer sub-agent', vfsMode: 'isolated' },
    },
  },
  cliAgentOutput: {},
};

const sessionState: MockSessionState = {
  messages: [{ id: 'm1', sessionId: 'session-1', role: 'user', content: 'hello', createdAt: 1 }],
  sessionMessages: {
    'session-1': [{ id: 'm1', sessionId: 'session-1', role: 'user', content: 'hello', createdAt: 1 }],
  },
  sessions: [
    { id: 'session-1', personaId: 'default', title: 'Master', createdAt: 1, updatedAt: 1 },
    { id: 'sub-session-1', personaId: 'default', title: 'Sub-agent: demo', kind: 'subagent', createdAt: 2, updatedAt: 2 },
  ],
  activeSessionId: 'session-1',
  thinkingChunks: {},
  streamingChunks: {},
  chunkSessionIds: {},
  setActiveSession: vi.fn(),
  getSessionMessages: (sessionId) => {
    if (!sessionId) return [];
    const baseMessages = sessionState.sessionMessages[sessionId] ?? (sessionId === sessionState.activeSessionId ? sessionState.messages : []);
    const nextMessages = [...baseMessages];
    const indexById = new Map(nextMessages.map((message, index) => [message.id, index]));

    Object.entries(sessionState.chunkSessionIds)
      .filter(([, chunkSessionId]) => chunkSessionId === sessionId)
      .forEach(([messageId]) => {
        const content = sessionState.streamingChunks[messageId] ?? '';
        const existingIndex = indexById.get(messageId);

        if (existingIndex !== undefined) {
          const existing = nextMessages[existingIndex];
          nextMessages[existingIndex] = { ...existing, content: content || existing.content, streaming: true };
          return;
        }

        nextMessages.push({
          id: messageId,
          sessionId,
          role: 'assistant',
          content,
          streaming: true,
          createdAt: Date.now(),
        });
      });

    return nextMessages;
  },
  setMessages: (messages, sessionId) => {
    const targetSessionId = sessionId ?? sessionState.activeSessionId;
    if (!targetSessionId) return;
    sessionState.sessionMessages[targetSessionId] = messages;
    if (targetSessionId === sessionState.activeSessionId) {
      sessionState.messages = messages;
    }
  },
};

const { mockApiGet } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
}));

const { mockIdentifySession } = vi.hoisted(() => ({
  mockIdentifySession: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
  apiClient: { get: mockApiGet },
}));

vi.mock('../../services/eventBus', () => ({
  eventBus: {
    connected: true,
    identifySession: mockIdentifySession,
  },
}));

vi.mock('../../store/agentStore', () => ({
  useAgentStore: (selector?: (state: MockAgentState) => unknown) => selector ? selector(agentState) : agentState,
}));

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: (selector?: (state: MockSessionState) => unknown) => selector ? selector(sessionState) : sessionState,
}));

describe('CanvasPanel subagent grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentState.toolActivities = [
      {
        callId: 'master-call',
        toolName: 'run_subagent',
        args: {},
        status: 'success',
        startedAt: 1,
        finishedAt: 2,
        result: {
          callId: 'master-call',
          status: 'success',
          data: {
            result: 'created index.html',
            taskId: 'task-1',
            childSessionId: 'sub-session-1',
            parentSessionId: 'session-1',
            vfsMode: 'isolated',
            vfsSessionId: 'sub-session-1',
            copiedFiles: [{ fromPath: 'index.html', toPath: 'sub-agents/sub-session-1/index.html', sizeBytes: 123 }],
            durationMs: 20,
          },
        },
      },
      {
        callId: 'child-call',
        toolName: 'vfs_write',
        args: { path: 'index.html' },
        status: 'success',
        startedAt: 1,
        finishedAt: 2,
        agentRun: { agentRunId: 'run-1', agentType: 'subagent', label: 'Designer sub-agent', vfsMode: 'isolated' },
      },
    ];
    agentState.activeAgentLoops = {
      'run-1': {
        sessionId: 'sub-session-1',
        turnId: 'turn-1',
        agentRun: { agentRunId: 'run-1', agentType: 'subagent', label: 'Designer sub-agent', vfsMode: 'isolated' },
      },
    };
    sessionState.messages = [{ id: 'm1', sessionId: 'session-1', role: 'user', content: 'hello', createdAt: 1 }];
    sessionState.sessionMessages = {
      'session-1': [{ id: 'm1', sessionId: 'session-1', role: 'user', content: 'hello', createdAt: 1 }],
    };
    mockApiGet.mockResolvedValue({
      data: [
        { id: 'u1', sessionId: 'sub-session-1', role: 'user', content: 'build a page', createdAt: 1 },
        { id: 'a1', sessionId: 'sub-session-1', role: 'assistant', content: 'created index.html', createdAt: 2 },
      ],
    });
  });

  it('REGRESSION: renders image_generate results as an image preview instead of raw base64 JSON', () => {
    agentState.toolActivities = [
      {
        callId: 'image-call',
        toolName: 'image_generate',
        args: { prompt: 'otter on a surfboard' },
        status: 'success',
        startedAt: 1,
        finishedAt: 2,
        result: {
          callId: 'image-call',
          status: 'success',
          data: {
            output_type: 'image',
            image_url: 'data:image/png;base64,ZmFrZS1pbWFnZS1ieXRlcw==',
            download_url: '/api/sessions/session-1/vfs/download?path=images%2Fotter.png',
            path: 'images/otter.png',
            message: 'Image generated and saved to images/otter.png.',
          },
        },
      },
    ];
    agentState.activeAgentLoops = {};
    sessionState.messages = [{ id: 'm1', sessionId: 'session-1', role: 'user', content: 'draw an otter', createdAt: 1 }];
    sessionState.sessionMessages = {
      'session-1': [{ id: 'm1', sessionId: 'session-1', role: 'user', content: 'draw an otter', createdAt: 1 }],
    };

    render(<CanvasPanel />);

    fireEvent.click(screen.getByRole('button', { name: /image_generate/i }));

    expect(screen.getByRole('img', { name: 'Image generated and saved to images/otter.png.' })).toBeInTheDocument();
    expect(screen.queryByText(/data:image\/png;base64/i)).not.toBeInTheDocument();
  });

  it('REGRESSION: ignores oversized tool_result payloads when estimating session tokens', () => {
    const hugeBase64 = 'a'.repeat(400_000);
    agentState.toolActivities = [];
    agentState.activeAgentLoops = {};
    sessionState.messages = [
      { id: 'u1', sessionId: 'session-1', role: 'user', content: 'hello', createdAt: 1 },
      {
        id: 'tool-1',
        sessionId: 'session-1',
        role: 'tool_result',
        toolCallId: 'image-call',
        content: JSON.stringify({
          output_type: 'image',
          image_url: `data:image/png;base64,${hugeBase64}`,
          path: 'images/huge.png',
        }),
        createdAt: 2,
      },
    ];
    sessionState.sessionMessages = {
      'session-1': sessionState.messages,
    };

    render(<CanvasPanel />);

    const tokenValue = screen.getByText('~Tokens').nextElementSibling;
    expect(tokenValue).not.toHaveClass('text-warning');
    expect(tokenValue).not.toHaveClass('text-error');
  });

  it('shows subagent loops and separates subagent tools from master tools', () => {
    render(<CanvasPanel />);

    expect(screen.getByText('Sub-agents')).toBeDefined();
    expect(screen.getByText('Designer sub-agent')).toBeDefined();
    expect(screen.getByText('Sub-agent tools (1)')).toBeDefined();
    expect(screen.getByText('Tools (1)')).toBeDefined();
    expect(screen.getByText('vfs_write')).toBeDefined();
    expect(screen.getByText('run_subagent')).toBeDefined();
  });

  it('REGRESSION: orders sub-agent preview cards oldest-to-newest instead of newest-first', () => {
    agentState.toolActivities = [
      {
        callId: 'master-call-newer',
        toolName: 'run_subagent',
        args: {},
        status: 'success',
        startedAt: 3,
        finishedAt: 4,
        result: {
          callId: 'master-call-newer',
          status: 'success',
          data: {
            result: 'newer child result',
            taskId: 'task-newer',
            childSessionId: 'sub-session-2',
            parentSessionId: 'session-1',
            vfsMode: 'isolated',
            vfsSessionId: 'sub-session-2',
            copiedFiles: [],
            durationMs: 20,
          },
        },
      },
      {
        callId: 'master-call-older',
        toolName: 'run_subagent',
        args: {},
        status: 'success',
        startedAt: 1,
        finishedAt: 2,
        result: {
          callId: 'master-call-older',
          status: 'success',
          data: {
            result: 'older child result',
            taskId: 'task-older',
            childSessionId: 'sub-session-1',
            parentSessionId: 'session-1',
            vfsMode: 'isolated',
            vfsSessionId: 'sub-session-1',
            copiedFiles: [],
            durationMs: 20,
          },
        },
      },
    ];
    agentState.activeAgentLoops = {};
    sessionState.sessions = [
      { id: 'session-1', personaId: 'default', title: 'Master', createdAt: 1, updatedAt: 1 },
      { id: 'sub-session-1', personaId: 'default', title: 'Sub-agent: older', kind: 'subagent', createdAt: 2, updatedAt: 10 },
      { id: 'sub-session-2', personaId: 'default', title: 'Sub-agent: newer', kind: 'subagent', createdAt: 3, updatedAt: 20 },
    ];

    render(<CanvasPanel />);

    const olderCard = screen.getByText('Sub-agent: older');
    const newerCard = screen.getByText('Sub-agent: newer');

    expect(olderCard.compareDocumentPosition(newerCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows subagent transcript, copied VFS files, and opens the child conversation', async () => {
    render(<CanvasPanel />);

    await waitFor(() => expect(screen.getByText('build a page')).toBeDefined());
    expect(screen.getByText('created index.html')).toBeDefined();
    expect(screen.getByText('sub-agents/sub-session-1/index.html')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Open sub-agent chat' }));

    expect(sessionState.setActiveSession).toHaveBeenCalledWith('sub-session-1');
  });

  it('keeps subagent previews visible after the subagent loop completes', async () => {
    agentState.activeAgentLoops = {};

    render(<CanvasPanel />);

    await waitFor(() => expect(screen.getByText('Sub-agents')).toBeDefined());
    expect(screen.getByText('build a page')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Open sub-agent chat' })).toBeDefined();
  });

  it('reconstructs subagent previews from persisted history after reload', async () => {
    agentState.activeAgentLoops = {};
    agentState.toolActivities = [];
    sessionState.messages = [
      { id: 'm1', sessionId: 'session-1', role: 'user', content: 'make a page', createdAt: 1 },
      {
        id: 'tool-1',
        sessionId: 'session-1',
        role: 'tool_result',
        toolCallId: 'master-call',
        content: JSON.stringify({
          result: 'created index.html',
          taskId: 'task-1',
          childSessionId: 'sub-session-1',
          parentSessionId: 'session-1',
          vfsMode: 'isolated',
          vfsSessionId: 'sub-session-1',
          copiedFiles: [{ fromPath: 'index.html', toPath: 'sub-agents/sub-session-1/index.html', sizeBytes: 123 }],
          durationMs: 20,
        }),
        createdAt: 2,
      },
    ];

    render(<CanvasPanel />);

    await waitFor(() => expect(screen.getByText('Sub-agents')).toBeDefined());
    expect(screen.getByText('created index.html')).toBeDefined();
    expect(screen.getByText('sub-agents/sub-session-1/index.html')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Open sub-agent chat' })).toBeDefined();
  });

  it('subscribes to child sessions and shows live streamed child responses before REST history catches up', async () => {
    sessionState.streamingChunks = { 'live-child-msg': 'streaming child draft' };
    sessionState.chunkSessionIds = { 'live-child-msg': 'sub-session-1' };
    mockApiGet.mockResolvedValue({
      data: [{ id: 'u1', sessionId: 'sub-session-1', role: 'user', content: 'build a page', createdAt: 1 }],
    });

    render(<CanvasPanel />);

    await waitFor(() => expect(mockIdentifySession).toHaveBeenCalledWith('sub-session-1'));
    expect(screen.getByText('streaming child draft')).toBeDefined();
  });

  it('REGRESSION: does not re-identify the same child session on unrelated rerenders', async () => {
    const view = render(<CanvasPanel />);

    await waitFor(() => expect(mockIdentifySession).toHaveBeenCalledWith('sub-session-1'));

    mockIdentifySession.mockClear();
    sessionState.messages = [
      ...sessionState.messages,
      { id: 'm2', sessionId: 'session-1', role: 'assistant', content: 'parent stream update', createdAt: 3 },
    ];
    sessionState.sessionMessages['session-1'] = sessionState.messages;

    await act(async () => {
      view.rerender(<CanvasPanel />);
      await Promise.resolve();
    });

    expect(mockIdentifySession).not.toHaveBeenCalled();
  });

  it('REGRESSION: identifies only newly discovered child sessions when previews expand', async () => {
    const view = render(<CanvasPanel />);

    await waitFor(() => expect(mockIdentifySession).toHaveBeenCalledWith('sub-session-1'));

    mockIdentifySession.mockClear();
    agentState.toolActivities = [
      ...agentState.toolActivities,
      {
        callId: 'master-call-2',
        toolName: 'run_subagent',
        args: {},
        status: 'success',
        startedAt: 3,
        finishedAt: 4,
        result: {
          callId: 'master-call-2',
          status: 'success',
          data: {
            result: 'created second child',
            taskId: 'task-2',
            childSessionId: 'sub-session-2',
            parentSessionId: 'session-1',
            vfsMode: 'isolated',
            vfsSessionId: 'sub-session-2',
            copiedFiles: [],
            durationMs: 20,
          },
        },
      },
    ];
    sessionState.sessions = [
      ...sessionState.sessions,
      { id: 'sub-session-2', personaId: 'default', title: 'Sub-agent: follow-up', kind: 'subagent', createdAt: 4, updatedAt: 4 },
    ];

    await act(async () => {
      view.rerender(<CanvasPanel />);
      await Promise.resolve();
    });

    expect(mockIdentifySession).toHaveBeenCalledTimes(1);
    expect(mockIdentifySession).toHaveBeenCalledWith('sub-session-2');
  });

  it('keeps the latest child transcript from session state when REST history is stale', async () => {
    sessionState.sessionMessages['sub-session-1'] = [
      { id: 'u1', sessionId: 'sub-session-1', role: 'user', content: 'build a page', createdAt: 1 },
      { id: 'a1', sessionId: 'sub-session-1', role: 'assistant', content: 'final child transcript answer', createdAt: 2 },
    ];
    mockApiGet.mockResolvedValue({
      data: [{ id: 'u1', sessionId: 'sub-session-1', role: 'user', content: 'build a page', createdAt: 1 }],
    });

    render(<CanvasPanel />);

    await waitFor(() => expect(screen.getByText('final child transcript answer')).toBeDefined());
  });
});
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
  canvasFocus: { kind: 'architecture-branch'; sessionId: string; label?: string } | { kind: 'architecture-run'; runId: string } | null;
  setCanvasFocus: ReturnType<typeof vi.fn>;
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
  canvasFocus: null,
  setCanvasFocus: vi.fn((focus) => {
    agentState.canvasFocus = focus;
    if (focus) agentState.canvasOpen = true;
  }),
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
    agentState.canvasFocus = null;
    agentState.setCanvasFocus.mockClear();
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
    sessionState.sessionMessages['sub-session-1'] = [
      { id: 'u1', sessionId: 'sub-session-1', role: 'user', content: 'build a page', createdAt: 1 },
      { id: 'a1', sessionId: 'sub-session-1', role: 'assistant', content: 'created index.html', createdAt: 2 },
    ];

    render(<CanvasPanel />);

    expect(screen.getByTestId('canvas-subagents-section')).toBeDefined();
    expect(screen.getByTestId('canvas-subagent-card-sub-session-1')).toHaveAttribute('data-session-id', 'sub-session-1');
    expect(screen.getByTestId('canvas-open-subagent-sub-session-1')).toHaveAttribute('data-session-id', 'sub-session-1');
    expect(screen.getByText('Designer sub-agent')).toBeDefined();
    expect(screen.getByTestId('canvas-subagent-status-sub-session-1')).toHaveTextContent('running');
    expect(screen.getByText('Sub-agent tools (1)')).toBeDefined();
    expect(screen.getByText('vfs_write')).toBeDefined();
    expect(screen.queryByText('Tools (1)')).toBeNull();
    expect(screen.queryByText('run_subagent')).toBeNull();
  });

  it('shows architecture run detail with branch open controls', () => {
    agentState.canvasFocus = { kind: 'architecture-run', runId: 'run-1' };
    sessionState.messages = [
      {
        id: 'arch-final',
        sessionId: 'session-1',
        role: 'assistant',
        content: '### Finalizer',
        createdAt: 3,
        architectureRun: {
          runId: 'run-1',
          schemaId: 'strategic-decision-council',
          status: 'completed',
          trace: [
            {
              speaker: 'router',
              content: 'Router dispatched parallel council branches',
              eventId: 'event-router-dispatch',
              nodeId: 'router',
              nextNodeId: 'pragmatist',
            },
            {
              speaker: 'participant',
              content: 'Pragmatist branch result',
              eventId: 'event-pragmatist',
              nodeId: 'pragmatist',
              nextNodeId: 'router',
              stream: {
                streamGroupId: 'group-1',
                branchSessionId: 'sub-session-1',
                status: 'completed',
                chunkCount: 12,
                text: 'Pragmatist branch result',
              },
            },
            {
              speaker: 'router',
              content: 'Router selected final path',
              eventId: 'event-router',
              nodeId: 'router',
              nextNodeId: 'final-artifact',
            },
            {
              speaker: 'finalizer',
              content: 'Final answer',
              eventId: 'event-finalizer',
              nodeId: 'final-artifact',
            },
          ],
          routeHops: [],
        },
      },
    ];
    sessionState.sessionMessages = {
      'session-1': sessionState.messages,
      'sub-session-1': [
        { id: 'branch-user', sessionId: 'sub-session-1', role: 'user', content: 'Pragmatist branch prompt', createdAt: 4 },
        { id: 'branch-agent', sessionId: 'sub-session-1', role: 'assistant', content: 'Pragmatist branch transcript answer', createdAt: 5 },
      ],
    };

    render(<CanvasPanel />);

    expect(screen.getByTestId('architecture-run-canvas-section')).toHaveAttribute('data-focused', 'true');
    expect(screen.getByTestId('architecture-run-flow')).toHaveTextContent('Router dispatch');
    expect(screen.queryByTestId('architecture-run-parallel-group')).not.toBeInTheDocument();
    expect(screen.getByTestId('architecture-run-sequential-flow')).toHaveTextContent('Pragmatist branch result');
    expect(screen.getByTestId('architecture-run-branch-transcript-sub-session-1')).toHaveTextContent('Pragmatist branch prompt');
    expect(screen.getByTestId('architecture-run-branch-transcript-sub-session-1')).toHaveTextContent('Pragmatist branch transcript answer');
    expect(screen.getByTestId('architecture-run-sequential-flow')).toHaveTextContent('Router selected final path');
    expect(screen.getByTestId('architecture-run-sequential-flow')).toHaveTextContent('Finalizer');
    expect(screen.getByTestId('architecture-run-internal-transcript')).toHaveTextContent('Router dispatched parallel council branches');
    expect(screen.getByTestId('architecture-run-internal-transcript')).toHaveTextContent('Pragmatist branch transcript answer');
    expect(screen.getByTestId('architecture-run-internal-transcript')).toHaveTextContent('Final answer');
    expect(screen.getAllByTestId('architecture-run-transcript-entry')).toHaveLength(4);

    fireEvent.click(screen.getByTestId('architecture-open-branch-sub-session-1'));

    expect(agentState.setCanvasFocus).toHaveBeenCalledWith({ kind: 'architecture-branch', sessionId: 'sub-session-1' });
  });

  it('shows focused architecture branch transcript without switching the parent session', () => {
    agentState.toolActivities = [];
    agentState.activeAgentLoops = {};
    agentState.canvasFocus = { kind: 'architecture-branch', sessionId: 'sub-session-1', label: 'Pragmatist' };
    sessionState.sessionMessages = {
      'session-1': [{ id: 'm1', sessionId: 'session-1', role: 'user', content: 'parent task', createdAt: 1 }],
      'sub-session-1': [
        { id: 'u1', sessionId: 'sub-session-1', role: 'user', content: 'branch task', createdAt: 2 },
        { id: 'a1', sessionId: 'sub-session-1', role: 'assistant', content: 'branch answer', createdAt: 3 },
      ],
    };
    sessionState.messages = sessionState.sessionMessages['session-1'];

    render(<CanvasPanel />);

    expect(screen.getByTestId('canvas-focus-section')).toHaveTextContent('Pragmatist');
    expect(screen.getByTestId('canvas-focus-transcript')).toHaveTextContent('branch task');
    expect(screen.getByTestId('canvas-focus-transcript')).toHaveTextContent('branch answer');
    expect(sessionState.setActiveSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('canvas-focus-open-session-sub-session-1'));

    expect(sessionState.setActiveSession).toHaveBeenCalledWith('sub-session-1');
  });

  it('shows a waiting state for a focused architecture branch before its transcript hydrates', () => {
    agentState.toolActivities = [];
    agentState.activeAgentLoops = {};
    agentState.canvasFocus = { kind: 'architecture-branch', sessionId: 'sub-session-missing', label: 'Shadow' };
    mockApiGet.mockReturnValue(new Promise(() => undefined));
    sessionState.sessionMessages = {
      'session-1': [{ id: 'm1', sessionId: 'session-1', role: 'user', content: 'parent task', createdAt: 1 }],
    };
    sessionState.messages = sessionState.sessionMessages['session-1'];

    render(<CanvasPanel />);

    expect(screen.getByTestId('canvas-focus-section')).toHaveTextContent('Shadow');
    expect(screen.getByTestId('canvas-focus-empty')).toHaveTextContent('Waiting for branch transcript.');
    expect(sessionState.setActiveSession).not.toHaveBeenCalled();
  });

  it('shows a partial architecture run transcript without requiring finalization', () => {
    agentState.toolActivities = [];
    agentState.activeAgentLoops = {};
    agentState.canvasFocus = { kind: 'architecture-run', runId: 'run-partial' };
    sessionState.messages = [
      {
        id: 'arch-partial',
        sessionId: 'session-1',
        role: 'assistant',
        content: '### Router',
        createdAt: 3,
        architectureRun: {
          runId: 'run-partial',
          schemaId: 'strategic-decision-council',
          status: 'running',
          trace: [
            {
              speaker: 'router',
              content: 'Router dispatched first branch',
              eventId: 'event-router-dispatch',
              nodeId: 'router',
              nextNodeId: 'pragmatist',
            },
            {
              speaker: 'participant',
              content: 'Pragmatist partial result',
              eventId: 'event-pragmatist',
              nodeId: 'pragmatist',
              nextNodeId: 'router',
              stream: {
                streamGroupId: 'group-partial',
                branchSessionId: 'sub-session-partial',
                status: 'streaming',
                chunkCount: 3,
                text: 'Pragmatist partial result',
              },
            },
          ],
          routeHops: [],
        },
      },
    ];
    sessionState.sessionMessages = { 'session-1': sessionState.messages };

    render(<CanvasPanel />);

    expect(screen.getByTestId('architecture-run-canvas-section')).toHaveAttribute('data-focused', 'true');
    expect(screen.getByTestId('architecture-run-internal-transcript')).toHaveTextContent('Router dispatched first branch');
    expect(screen.getByTestId('architecture-run-internal-transcript')).toHaveTextContent('Pragmatist partial result');
    expect(screen.getByTestId('architecture-run-branch-transcript-sub-session-partial')).toHaveTextContent('Branch transcript is loading.');
    expect(screen.getAllByTestId('architecture-run-transcript-entry')).toHaveLength(2);
    expect(screen.getByTestId('architecture-run-routing')).toHaveTextContent('Router -> Pragmatist');
  });

  it('shows sequential architecture run steps in route order instead of a parallel group', () => {
    agentState.toolActivities = [];
    agentState.activeAgentLoops = {};
    agentState.canvasFocus = { kind: 'architecture-run', runId: 'run-sequential' };
    sessionState.messages = [
      {
        id: 'arch-sequential',
        sessionId: 'session-1',
        role: 'assistant',
        content: '### Finalizer',
        createdAt: 3,
        architectureRun: {
          runId: 'run-sequential',
          schemaId: 'qa-route-hops',
          status: 'completed',
          trace: [
            {
              speaker: 'router',
              content: 'Route to first reviewer',
              eventId: 'event-router-entry',
              nodeId: 'router-entry',
              nextNodeId: 'agent-one',
            },
            {
              speaker: 'participant',
              content: 'Agent one reviewed the prompt',
              eventId: 'event-agent-one',
              nodeId: 'agent-one',
              nextNodeId: 'router-check',
              stream: {
                streamGroupId: 'group-sequential',
                branchSessionId: 'sub-session-one',
                status: 'completed',
                chunkCount: 8,
                text: 'Agent one reviewed the prompt',
              },
            },
            {
              speaker: 'router',
              content: 'Route to second reviewer',
              eventId: 'event-router-check',
              nodeId: 'router-check',
              nextNodeId: 'agent-two',
            },
            {
              speaker: 'participant',
              content: 'Agent two validated the result',
              eventId: 'event-agent-two',
              nodeId: 'agent-two',
              nextNodeId: 'router-final',
              stream: {
                streamGroupId: 'group-sequential',
                branchSessionId: 'sub-session-two',
                status: 'completed',
                chunkCount: 9,
                text: 'Agent two validated the result',
              },
            },
            {
              speaker: 'router',
              content: 'Route to final answer',
              eventId: 'event-router-final',
              nodeId: 'router-final',
              nextNodeId: 'final-artifact',
            },
            {
              speaker: 'finalizer',
              content: 'Final routed answer',
              eventId: 'event-finalizer',
              nodeId: 'final-artifact',
            },
          ],
          routeHops: [],
        },
      },
    ];
    sessionState.sessionMessages = {
      'session-1': sessionState.messages,
      'sub-session-one': [
        { id: 'one-user', sessionId: 'sub-session-one', role: 'user', content: 'First branch prompt', createdAt: 4 },
        { id: 'one-agent', sessionId: 'sub-session-one', role: 'assistant', content: 'First branch answer', createdAt: 5 },
      ],
      'sub-session-two': [
        { id: 'two-user', sessionId: 'sub-session-two', role: 'user', content: 'Second branch prompt', createdAt: 6 },
        { id: 'two-agent', sessionId: 'sub-session-two', role: 'assistant', content: 'Second branch answer', createdAt: 7 },
      ],
    };

    render(<CanvasPanel />);

    expect(screen.queryByTestId('architecture-run-parallel-group')).not.toBeInTheDocument();
    const orderedSteps = screen.getAllByTestId('architecture-run-sequential-step').map((item) => item.textContent ?? '');
    expect(orderedSteps).toHaveLength(6);
    expect(orderedSteps[0]).toContain('Router Entry');
    expect(orderedSteps[1]).toContain('Agent One');
    expect(orderedSteps[2]).toContain('Router Check');
    expect(orderedSteps[3]).toContain('Agent Two');
    expect(orderedSteps[4]).toContain('Router Final');
    expect(orderedSteps[5]).toContain('Finalizer');
    expect(screen.getByTestId('architecture-run-sequential-flow')).toHaveTextContent('First branch answer');
    expect(screen.getByTestId('architecture-run-sequential-flow')).toHaveTextContent('Second branch answer');
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
    sessionState.sessionMessages['sub-session-1'] = [
      { id: 'older-user', sessionId: 'sub-session-1', role: 'user', content: 'older task', createdAt: 1 },
    ];
    sessionState.sessionMessages['sub-session-2'] = [
      { id: 'newer-user', sessionId: 'sub-session-2', role: 'user', content: 'newer task', createdAt: 1 },
    ];

    render(<CanvasPanel />);

    const olderCard = screen.getByText('Sub-agent: older');
    const newerCard = screen.getByText('Sub-agent: newer');

    expect(olderCard.compareDocumentPosition(newerCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows subagent transcript, copied VFS files, and opens the child conversation', async () => {
    render(<CanvasPanel />);

    await waitFor(() => expect(screen.getByText('created index.html')).toBeDefined());
    expect(screen.getByText('created index.html')).toBeDefined();
    expect(screen.queryByText('build a page')).toBeNull();
    expect(screen.getByText('sub-agents/sub-session-1/index.html')).toBeDefined();

    fireEvent.click(screen.getByTestId('canvas-open-subagent-sub-session-1'));

    expect(sessionState.setActiveSession).toHaveBeenCalledWith('sub-session-1');
  });

  it('keeps subagent previews visible after the subagent loop completes', async () => {
    agentState.activeAgentLoops = {};

    render(<CanvasPanel />);

    await waitFor(() => expect(screen.getByTestId('canvas-subagents-section')).toBeDefined());
    expect(screen.queryByText('build a page')).toBeNull();
    expect(screen.getByTestId('canvas-open-subagent-sub-session-1')).toBeDefined();
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

    await waitFor(() => expect(screen.getByTestId('canvas-subagents-section')).toBeDefined());
    expect(screen.getByText('created index.html')).toBeDefined();
    expect(screen.getByText('sub-agents/sub-session-1/index.html')).toBeDefined();
    expect(screen.getByTestId('canvas-open-subagent-sub-session-1')).toBeDefined();
  });

  it('shows persisted AgentFlow runs from the parent conversation and opens the linked chat and graph', async () => {
    agentState.activeAgentLoops = {};
    agentState.toolActivities = [];
    sessionState.messages = [
      { id: 'm1', sessionId: 'session-1', role: 'user', content: 'build with goal guard', createdAt: 1 },
      {
        id: 'tool-agentflow-1',
        sessionId: 'session-1',
        role: 'tool_result',
        toolCallId: 'agentflow-call-1',
        content: JSON.stringify({
          flowRunId: 'flow-run-1',
          childSessionId: 'flow-child-source',
          status: 'waiting_on_orchestrator',
          summary: 'Goal Guard returned work to the Implementer.',
          decisions: ['Missing screenshot evidence.'],
          nextActions: ['Implementer must add proof.'],
          artifacts: [],
          openChatSessionId: 'flow-linked-chat',
          openGraphRunId: 'flow-linked-graph',
        }),
        createdAt: 2,
      },
    ];
    sessionState.sessionMessages = { 'session-1': sessionState.messages };
    sessionState.sessions = [
      { id: 'session-1', personaId: 'default', title: 'Master', createdAt: 1, updatedAt: 1 },
      {
        id: 'flow-linked-chat',
        personaId: 'default',
        title: 'Goal Guard AgentFlow',
        kind: 'agent-flow',
        parentSessionId: 'session-1',
        parentToolCallId: 'agentflow-call-1',
        createdAt: 2,
        updatedAt: 3,
      },
    ];

    render(<CanvasPanel />);

    await waitFor(() => expect(screen.getByTestId('canvas-agentflows-section')).toBeDefined());
    expect(screen.getByText('Goal Guard AgentFlow')).toBeDefined();
    expect(screen.getByText('Goal Guard returned work to the Implementer.')).toBeDefined();
    expect(screen.getByTestId('canvas-agentflow-card-flow-run-1')).toHaveAttribute('data-session-id', 'flow-linked-chat');
    expect(screen.getByTestId('canvas-agentflow-card-flow-run-1')).toHaveTextContent('Goal Guard AgentFlow');
    expect(mockIdentifySession).toHaveBeenCalledWith('flow-linked-chat');

    fireEvent.click(screen.getByTestId('canvas-open-agentflow-chat-flow-run-1'));
    expect(sessionState.setActiveSession).toHaveBeenCalledWith('flow-linked-chat');

    fireEvent.click(screen.getByTestId('canvas-open-agentflow-graph-flow-run-1'));
    expect(agentState.setCanvasFocus).toHaveBeenCalledWith({ kind: 'architecture-run', runId: 'flow-linked-graph' });
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

  it('keeps the latest child transcript from session state without refetching stale REST history', async () => {
    sessionState.sessionMessages['sub-session-1'] = [
      { id: 'u1', sessionId: 'sub-session-1', role: 'user', content: 'build a page', createdAt: 1 },
      { id: 'a1', sessionId: 'sub-session-1', role: 'assistant', content: 'final child transcript answer', createdAt: 2 },
    ];
    mockApiGet.mockResolvedValue({
      data: [{ id: 'u1', sessionId: 'sub-session-1', role: 'user', content: 'build a page', createdAt: 1 }],
    });

    render(<CanvasPanel />);

    await waitFor(() => expect(screen.getByText('final child transcript answer')).toBeDefined());
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockApiGet).not.toHaveBeenCalled();
  });
});

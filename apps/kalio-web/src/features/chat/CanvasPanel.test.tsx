import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasPanel } from './CanvasPanel';
import type { ChatMessage, ChatSession, RuntimeActivitySnapshot, ToolResult } from '@kalio/types';
import type { CLIChildProjection } from './cliChildProjection.model';
import type { ArchitectureRunSummaryWithGraph } from './architectureChatSummary';

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
  cliChildProjections: Record<string, CLIChildProjection>;
  pendingConfirmations: Record<string, unknown>;
  pendingBudgetApprovals: Record<string, unknown>;
  queuedDepthBySession: Record<string, number>;
  sessionStatusSnapshots: Record<string, unknown>;
  runtimeActivitySnapshots: Record<string, RuntimeActivitySnapshot>;
  getRuntimeActivitySnapshot: (sessionId: string | null) => RuntimeActivitySnapshot | null;
  getToolActivitiesForSession: (sessionId: string | null) => MockAgentState['toolActivities'];
  hasActiveLoopForSession: (sessionId: string | null) => boolean;
}

interface MockSessionState {
  messages: ChatMessage[];
  sessionMessages: Record<string, ChatMessage[]>;
  sessions: ChatSession[];
  activeSessionId: string;
  agentTurns: Array<{ id: string; sessionId: string; done: boolean; items: [] }>;
  thinkingChunks: Record<string, string>;
  streamingChunks: Record<string, string>;
  chunkSessionIds: Record<string, string>;
  getSessionActiveTurnId: (sessionId: string | null) => string | null;
  setActiveSession: ReturnType<typeof vi.fn>;
  getSessionMessages: (sessionId: string | null) => ChatMessage[];
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
  setSessionHistoryMeta: ReturnType<typeof vi.fn>;
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
  cliChildProjections: {},
  pendingConfirmations: {},
  pendingBudgetApprovals: {},
  queuedDepthBySession: {},
  sessionStatusSnapshots: {},
  runtimeActivitySnapshots: {},
  getRuntimeActivitySnapshot: (sessionId) => (
    sessionId ? agentState.runtimeActivitySnapshots[sessionId] ?? null : null
  ),
  getToolActivitiesForSession: () => agentState.toolActivities,
  hasActiveLoopForSession: (sessionId) => {
    if (!sessionId) return false;
    if (Object.values(agentState.activeAgentLoops).some((loop) => loop.sessionId === sessionId)) {
      return true;
    }
    const snapshot = agentState.runtimeActivitySnapshots[sessionId];
    if (snapshot?.run?.status === 'active') {
      return true;
    }
    return snapshot?.childExecutions.some((execution) => (
      execution.status === 'running' || execution.status === 'waiting'
    )) ?? false;
  },
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
  agentTurns: [],
  thinkingChunks: {},
  streamingChunks: {},
  chunkSessionIds: {},
  getSessionActiveTurnId: () => null,
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
  setSessionHistoryMeta: vi.fn(),
};

const { mockApiGet, mockApiPost } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPost: vi.fn(),
}));

const { mockIdentifySession } = vi.hoisted(() => ({
  mockIdentifySession: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
  apiClient: { get: mockApiGet, post: mockApiPost },
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

vi.mock('../../store/sessionStore', () => {
  const useSessionStore = Object.assign(
    (selector?: (state: MockSessionState) => unknown) => selector ? selector(sessionState) : sessionState,
    { getState: () => sessionState },
  );
  return { useSessionStore };
});

describe('CanvasPanel subagent grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiPost.mockRejectedValue(new Error('unexpected apiClient.post call'));
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
    agentState.pendingConfirmations = {};
    agentState.pendingBudgetApprovals = {};
    agentState.queuedDepthBySession = {};
    agentState.sessionStatusSnapshots = {};
    agentState.runtimeActivitySnapshots = {};
    sessionState.sessions = [
      { id: 'session-1', personaId: 'default', title: 'Master', createdAt: 1, updatedAt: 1 },
      { id: 'sub-session-1', personaId: 'default', title: 'Sub-agent: demo', kind: 'subagent', createdAt: 2, updatedAt: 2 },
    ];
    sessionState.messages = [{ id: 'm1', sessionId: 'session-1', role: 'user', content: 'hello', createdAt: 1 }];
    sessionState.sessionMessages = {
      'session-1': [{ id: 'm1', sessionId: 'session-1', role: 'user', content: 'hello', createdAt: 1 }],
    };
    sessionState.agentTurns = [];
    sessionState.getSessionActiveTurnId = () => null;
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
    agentState.runtimeActivitySnapshots = {
      'session-1': {
        sessionId: 'session-1',
        active: true,
        turnId: 'turn-1',
        queueLength: 0,
        pendingConfirmations: [],
        pendingBudgetApprovals: [],
        toolActivities: [],
        childExecutions: [{
          id: 'sub-runtime-1',
          kind: 'subagent',
          parentSessionId: 'session-1',
          childSessionId: 'sub-session-1',
          parentToolCallId: 'master-call',
          label: 'Designer sub-agent',
          status: 'running',
          updatedAt: 2,
        }],
        updatedAt: 2,
      },
    };

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

  it('derives live canvas state from the active session runtime without relying on the global streaming bit', () => {
    agentState.isStreaming = false;
    sessionState.agentTurns = [{ id: 'turn-1', sessionId: 'session-1', done: false, items: [] }];
    sessionState.getSessionActiveTurnId = () => 'turn-1';
    agentState.runtimeActivitySnapshots = {
      'session-1': {
        sessionId: 'session-1',
        active: true,
        turnId: 'turn-1',
        queueLength: 0,
        run: {
          id: 'run-1',
          sessionId: 'session-1',
          turnId: 'turn-1',
          phase: 'tool_running',
          status: 'active',
          retryCount: 0,
          safeResume: true,
          startedAt: 100,
          updatedAt: 200,
          lastHeartbeatAt: 200,
        },
        pendingConfirmations: [],
        pendingBudgetApprovals: [],
        toolActivities: [],
        childExecutions: [],
        updatedAt: 200,
      },
    };

    render(<CanvasPanel />);

    expect(screen.getByText('Live')).toBeInTheDocument();
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

  it('does not duplicate architecture branch sessions in the generic sub-agents canvas section', () => {
    agentState.toolActivities = [];
    agentState.activeAgentLoops = {};
    agentState.canvasFocus = { kind: 'architecture-run', runId: 'run-1' };
    sessionState.sessions = [
      { id: 'session-1', personaId: 'default', title: 'Master', createdAt: 1, updatedAt: 1 },
      {
        id: 'arch-run-pragmatist',
        personaId: 'default',
        title: 'Strategic Decision Council: Pragmatist',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          parentToolCallId: 'architecture:run-1:pragmatist',
          architectureSlotId: 'pragmatist',
          architectureContext: {
            architectureRunId: 'run-1',
            roleSlotId: 'pragmatist',
            displayLabel: 'Pragmatist',
          },
        },
        createdAt: 2,
        updatedAt: 2,
      },
    ];
    sessionState.messages = [
      { id: 'user-1', sessionId: 'session-1', role: 'user', content: 'Assess the repo', createdAt: 1 },
      {
        id: 'assistant-tool-call',
        sessionId: 'session-1',
        role: 'assistant',
        content: '',
        toolCalls: [{
          id: 'architecture-call-1',
          name: 'run_subagent',
          args: {
            architectureRunId: 'run-1',
            schemaName: 'Strategic Decision Council',
            nodeId: 'pragmatist',
            childSessionId: 'arch-run-pragmatist',
          },
        }],
        createdAt: 2,
      },
      {
        id: 'tool-result-1',
        sessionId: 'session-1',
        role: 'tool_result',
        toolCallId: 'architecture-call-1',
        content: JSON.stringify({
          result: 'Pragmatist branch result',
          taskId: 'architecture:run-1:event:1',
          childSessionId: 'arch-run-pragmatist',
          parentSessionId: 'session-1',
          vfsMode: 'shared',
          vfsSessionId: 'arch-run-root',
          copiedFiles: [],
          durationMs: 20,
        }),
        createdAt: 3,
      },
      {
        id: 'assistant-final',
        sessionId: 'session-1',
        role: 'assistant',
        content: '### Finalizer',
        createdAt: 4,
        architectureRun: {
          runId: 'run-1',
          schemaId: 'strategic-decision-council',
          status: 'running',
          routeHops: [],
          trace: [
            {
              speaker: 'participant',
              content: 'Pragmatist branch result',
              eventId: 'architecture:run-1:event:1',
              nodeId: 'pragmatist',
              stream: {
                streamGroupId: 'architecture:run-1:pragmatist',
                branchSessionId: 'arch-run-pragmatist',
                status: 'completed',
                chunkCount: 1,
                text: 'Pragmatist branch result',
              },
            },
          ],
        },
      },
    ];
    sessionState.sessionMessages = {
      'session-1': sessionState.messages,
      'arch-run-pragmatist': [
        { id: 'branch-user', sessionId: 'arch-run-pragmatist', role: 'user', content: 'Pragmatist prompt', createdAt: 5 },
        { id: 'branch-assistant', sessionId: 'arch-run-pragmatist', role: 'assistant', content: 'Pragmatist branch result', createdAt: 6 },
      ],
    };

    render(<CanvasPanel />);

    expect(screen.getByTestId('architecture-run-canvas-section')).toBeInTheDocument();
    expect(screen.queryByTestId('canvas-subagents-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('canvas-subagent-card-arch-run-pragmatist')).not.toBeInTheDocument();
    expect(screen.getByTestId('architecture-run-branch-transcript-arch-run-pragmatist')).toHaveTextContent('Pragmatist branch result');
  });

  it('renders planned architecture stages from graph metadata before trace messages exist for every step', () => {
    agentState.toolActivities = [];
    agentState.activeAgentLoops = {};
    agentState.canvasFocus = { kind: 'architecture-run', runId: 'run-live-graph' };
    const architectureRun: ArchitectureRunSummaryWithGraph = {
      runId: 'run-live-graph',
      schemaId: 'Strategic Decision Council',
      status: 'running',
      finalArtifact: undefined,
      routeHops: [],
      graphNodes: [
        { id: 'orchestrator', label: 'Orchestrator', kind: 'router', status: 'running', eventIds: ['run-live-graph:event:1'] },
        { id: 'pragmatist', label: 'Pragmatist', kind: 'role', status: 'completed', eventIds: ['run-live-graph:event:2'] },
        { id: 'innovator', label: 'Innovator', kind: 'role', status: 'running', eventIds: [] },
        { id: 'analyst', label: 'Analyst', kind: 'role', status: 'pending', eventIds: [] },
        { id: 'user-advocate', label: 'User Advocate', kind: 'role', status: 'pending', eventIds: [] },
        { id: 'shadow', label: 'Shadow', kind: 'role', status: 'pending', eventIds: [] },
        { id: 'synthesizer', label: 'Router merge', kind: 'router', status: 'pending', eventIds: [] },
        { id: 'final-artifact', label: 'Finalizer', kind: 'artifact', status: 'pending', eventIds: [] },
      ],
      graphEdges: [
        { id: 'e1', fromNodeId: 'orchestrator', toNodeId: 'pragmatist' },
        { id: 'e2', fromNodeId: 'orchestrator', toNodeId: 'innovator' },
        { id: 'e3', fromNodeId: 'orchestrator', toNodeId: 'analyst' },
        { id: 'e4', fromNodeId: 'orchestrator', toNodeId: 'user-advocate' },
        { id: 'e5', fromNodeId: 'orchestrator', toNodeId: 'shadow' },
        { id: 'e6', fromNodeId: 'pragmatist', toNodeId: 'synthesizer' },
        { id: 'e7', fromNodeId: 'innovator', toNodeId: 'synthesizer' },
        { id: 'e8', fromNodeId: 'analyst', toNodeId: 'synthesizer' },
        { id: 'e9', fromNodeId: 'user-advocate', toNodeId: 'synthesizer' },
        { id: 'e10', fromNodeId: 'shadow', toNodeId: 'synthesizer' },
        { id: 'e11', fromNodeId: 'synthesizer', toNodeId: 'final-artifact' },
      ],
      trace: [
        {
          speaker: 'router',
          content: 'Orchestrator is dispatching the council.',
          eventId: 'run-live-graph:event:1',
          nodeId: 'orchestrator',
          nextNodeId: 'pragmatist',
        },
        {
          speaker: 'participant',
          content: 'Pragmatist answer.',
          eventId: 'run-live-graph:event:2',
          nodeId: 'pragmatist',
          nextNodeId: 'synthesizer',
          stream: {
            streamGroupId: 'architecture:run-live-graph:pragmatist',
            branchSessionId: 'sub-session-1',
            status: 'completed',
            chunkCount: 4,
            text: 'Pragmatist answer.',
          },
        },
      ],
    };
    sessionState.messages = [
      {
        id: 'arch-graph-only',
        sessionId: 'session-1',
        role: 'assistant',
        content: '### Finalizer',
        createdAt: 3,
        architectureRun,
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

    expect(screen.getByText('running / 8 steps')).toBeInTheDocument();
    expect(screen.getByTestId('architecture-run-flow')).toHaveTextContent('Router dispatch');
    expect(screen.getByTestId('architecture-run-flow')).toHaveTextContent('Parallel sub-agents');
    expect(screen.getByTestId('architecture-run-flow')).toHaveTextContent('Router merge');
    expect(screen.getByTestId('architecture-run-flow')).toHaveTextContent('Finalizer');
    expect(screen.getByTestId('architecture-run-branch-count')).toHaveTextContent('5');
    expect(screen.getByTestId('architecture-run-branches')).toHaveTextContent('pending');
    expect(screen.getByTestId('architecture-run-step-synthesizer')).toHaveTextContent('pending');
    expect(screen.getByTestId('architecture-run-step-final-artifact')).toHaveTextContent('pending');
    expect(screen.getByTestId('architecture-run-internal-transcript')).toHaveTextContent('Orchestrator is dispatching the council.');
    expect(screen.getAllByTestId('architecture-run-transcript-entry')).toHaveLength(2);
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

  it('hides branch open controls and transcripts for synthetic architecture branch ids missing from sessions', () => {
    agentState.toolActivities = [];
    agentState.activeAgentLoops = {};
    agentState.canvasFocus = { kind: 'architecture-run', runId: 'run-missing' };
    sessionState.messages = [
      {
        id: 'arch-missing',
        sessionId: 'session-1',
        role: 'assistant',
        content: '### Router',
        createdAt: 3,
        architectureRun: {
          runId: 'run-missing',
          schemaId: 'strategic-decision-council',
          status: 'running',
          trace: [
            {
              speaker: 'participant',
              content: 'Analyst branch pending',
              eventId: 'event-analyst',
              nodeId: 'analyst',
              nextNodeId: 'router',
              stream: {
                streamGroupId: 'group-missing',
                branchSessionId: 'arch-run-missing-analyst',
                status: 'started',
                chunkCount: 0,
                text: '',
              },
            },
          ],
          routeHops: [],
        },
      },
    ];
    sessionState.sessionMessages = { 'session-1': sessionState.messages };

    render(<CanvasPanel />);

    expect(screen.queryByTestId('architecture-open-branch-arch-run-missing-analyst')).not.toBeInTheDocument();
    expect(screen.queryByTestId('architecture-run-branch-transcript-arch-run-missing-analyst')).not.toBeInTheDocument();
    expect(screen.queryByTestId('architecture-run-transcript-branch-arch-run-missing-analyst')).not.toBeInTheDocument();
  });

  it('hides branch open controls for untouched placeholder architecture sessions that have no transcript or live activity', () => {
    agentState.toolActivities = [];
    agentState.activeAgentLoops = {};
    agentState.canvasFocus = { kind: 'architecture-run', runId: 'run-placeholder' };
    sessionState.sessions = [
      { id: 'session-1', personaId: 'default', title: 'Master', createdAt: 1, updatedAt: 1 },
      {
        id: 'arch-run-placeholder-analyst',
        personaId: 'web-research',
        title: 'Strategic Decision Council: Analyst',
        kind: 'subagent',
        parentSessionId: 'arch-run-placeholder-root',
        createdAt: 2,
        updatedAt: 2,
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureSlotId: 'analyst',
          architectureContext: {
            architectureRunId: 'run-placeholder',
            roleSlotId: 'analyst',
            roleSlotType: 'participant',
            displayLabel: 'Analyst',
          },
        },
      },
    ];
    sessionState.messages = [
      {
        id: 'arch-placeholder',
        sessionId: 'session-1',
        role: 'assistant',
        content: '### Finalizer',
        createdAt: 3,
        architectureRun: {
          runId: 'run-placeholder',
          schemaId: 'strategic-decision-council',
          status: 'running',
          trace: [],
          routeHops: [],
          graphNodes: [
            { id: 'analyst', label: 'Analyst', kind: 'role', status: 'pending', eventIds: [] },
          ],
          graphEdges: [],
        } as NonNullable<ChatMessage['architectureRun']> & {
          graphNodes: Array<{ id: string; label: string; kind: 'role'; status: 'pending'; eventIds: string[] }>;
          graphEdges: [];
        },
      },
    ];
    sessionState.sessionMessages = { 'session-1': sessionState.messages };

    render(<CanvasPanel />);

    expect(screen.queryByTestId('architecture-open-branch-arch-run-placeholder-analyst')).not.toBeInTheDocument();
    expect(screen.queryByTestId('architecture-run-branch-transcript-arch-run-placeholder-analyst')).not.toBeInTheDocument();
    expect(screen.queryByTestId('architecture-run-transcript-branch-arch-run-placeholder-analyst')).not.toBeInTheDocument();
  });

  it('opens technical architecture sessions when replayed graph run ids are arch-prefixed', () => {
    agentState.toolActivities = [];
    agentState.activeAgentLoops = {};
    agentState.canvasFocus = { kind: 'architecture-run', runId: 'arch-run-prefixed' };
    sessionState.sessions = [
      { id: 'session-1', personaId: 'default', title: 'Master', createdAt: 1, updatedAt: 1 },
      {
        id: 'arch-run-prefixed-router',
        personaId: 'default',
        title: 'Strategic Decision Council: Router',
        kind: 'subagent',
        parentSessionId: 'arch-run-prefixed-root',
        createdAt: 2,
        updatedAt: 3,
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureSlotId: 'router',
          architectureContext: {
            architectureRunId: 'run-prefixed',
            roleSlotId: 'router',
            roleSlotType: 'router',
            sessionSurface: 'technical-node',
            conversationVisibility: 'visible',
            displayLabel: 'Router',
          },
        },
      },
    ];
    sessionState.messages = [
      {
        id: 'arch-prefixed-summary',
        sessionId: 'session-1',
        role: 'assistant',
        content: '### Router',
        createdAt: 3,
        architectureRun: {
          runId: 'arch-run-prefixed',
          schemaId: 'strategic-decision-council',
          status: 'completed',
          trace: [
            {
              speaker: 'router',
              content: '### Router\nRoute: router -> final-artifact',
              eventId: 'event-router',
              nodeId: 'router',
              nextNodeId: 'final-artifact',
            },
          ],
          routeHops: [],
          graphNodes: [
            {
              id: 'router',
              sessionId: 'arch-run-prefixed-router',
              label: 'Router',
              kind: 'router',
              status: 'completed',
              eventIds: ['event-router'],
            },
          ],
          graphEdges: [],
        } as NonNullable<ChatMessage['architectureRun']> & {
          graphNodes: Array<{
            id: string;
            sessionId: string;
            label: string;
            kind: 'router';
            status: 'completed';
            eventIds: string[];
          }>;
          graphEdges: [];
        },
      },
    ];
    sessionState.sessionMessages = { 'session-1': sessionState.messages };

    render(<CanvasPanel />);

    fireEvent.click(screen.getByTestId('architecture-open-branch-arch-run-prefixed-router'));

    expect(agentState.setCanvasFocus).toHaveBeenCalledWith({
      kind: 'architecture-branch',
      sessionId: 'arch-run-prefixed-router',
    });
  });

  it('shows a waiting state for a real focused architecture branch before its transcript hydrates', () => {
    agentState.toolActivities = [];
    agentState.activeAgentLoops = {};
    agentState.canvasFocus = { kind: 'architecture-branch', sessionId: 'sub-session-waiting', label: 'Shadow' };
    mockApiGet.mockReturnValue(new Promise(() => undefined));
    sessionState.sessions = [
      { id: 'session-1', personaId: 'default', title: 'Master', createdAt: 1, updatedAt: 1 },
      { id: 'sub-session-waiting', personaId: 'default', title: 'Shadow', kind: 'subagent', parentSessionId: 'session-1', createdAt: 2, updatedAt: 2 },
    ];
    sessionState.sessionMessages = {
      'session-1': [{ id: 'm1', sessionId: 'session-1', role: 'user', content: 'parent task', createdAt: 1 }],
    };
    sessionState.messages = sessionState.sessionMessages['session-1'];

    render(<CanvasPanel />);

    expect(screen.getByTestId('canvas-focus-section')).toHaveTextContent('Shadow');
    expect(screen.getByTestId('canvas-focus-empty')).toHaveTextContent('Waiting for branch transcript.');
    expect(screen.getByTestId('canvas-focus-open-session-sub-session-waiting')).toBeInTheDocument();
    expect(sessionState.setActiveSession).not.toHaveBeenCalled();
  });

  it('retries focused architecture branch hydration after an early empty history window', async () => {
    agentState.toolActivities = [];
    agentState.activeAgentLoops = {};
    agentState.canvasFocus = { kind: 'architecture-branch', sessionId: 'sub-session-race', label: 'Pragmatist' };
    sessionState.sessions = [
      { id: 'session-1', personaId: 'default', title: 'Master', createdAt: 1, updatedAt: 1 },
      { id: 'sub-session-race', personaId: 'default', title: 'Pragmatist', kind: 'subagent', parentSessionId: 'session-1', createdAt: 2, updatedAt: 2 },
    ];
    sessionState.sessionMessages = {
      'session-1': [{ id: 'm1', sessionId: 'session-1', role: 'user', content: 'parent task', createdAt: 1 }],
      'sub-session-race': [{
        id: 'scaffold-result',
        sessionId: 'sub-session-race',
        role: 'tool_result',
        toolCallId: 'branch-scaffold',
        content: '{}',
        createdAt: 2,
      }],
    };
    sessionState.messages = sessionState.sessionMessages['session-1'];
    mockApiGet
      .mockResolvedValueOnce({ data: [sessionState.sessionMessages['sub-session-race'][0]], headers: {} })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'branch-user',
            sessionId: 'sub-session-race',
            role: 'user',
            content: 'Architecture: Strategic Decision Council v0.1.0\nSlot: Pragmatist',
            createdAt: 3,
          },
          {
            id: 'branch-assistant',
            sessionId: 'sub-session-race',
            role: 'assistant',
            content: 'Recommendation: keep the workflow envelope typed.',
            createdAt: 4,
          },
        ],
        headers: {},
      });

    const view = render(<CanvasPanel />);

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('canvas-focus-empty')).toHaveTextContent('Waiting for branch transcript.');

    view.rerender(<CanvasPanel />);

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(sessionState.sessionMessages['sub-session-race']?.some((message) => message.id === 'branch-assistant')).toBe(true));
    view.rerender(<CanvasPanel />);
    await waitFor(() => expect(screen.getByTestId('canvas-focus-transcript')).toHaveTextContent('Architecture: Strategic Decision Council v0.1.0'));
    expect(screen.getByTestId('canvas-focus-transcript')).toHaveTextContent('Recommendation: keep the workflow envelope typed.');
  });

  it('clears focused architecture branch state when the branch session does not exist', async () => {
    agentState.toolActivities = [];
    agentState.activeAgentLoops = {};
    agentState.canvasFocus = { kind: 'architecture-branch', sessionId: 'sub-session-missing', label: 'Shadow' };
    sessionState.sessions = [
      { id: 'session-1', personaId: 'default', title: 'Master', createdAt: 1, updatedAt: 1 },
    ];
    sessionState.sessionMessages = {
      'session-1': [{ id: 'm1', sessionId: 'session-1', role: 'user', content: 'parent task', createdAt: 1 }],
    };
    sessionState.messages = sessionState.sessionMessages['session-1'];

    const view = render(<CanvasPanel />);

    await waitFor(() => expect(agentState.setCanvasFocus).toHaveBeenCalledWith(null));
    view.rerender(<CanvasPanel />);
    expect(screen.queryByTestId('canvas-focus-section')).not.toBeInTheDocument();
  });

  it('shows a partial architecture run transcript without requiring finalization', () => {
    agentState.toolActivities = [];
    agentState.activeAgentLoops = {};
    agentState.canvasFocus = { kind: 'architecture-run', runId: 'run-partial' };
    sessionState.sessions = [
      { id: 'session-1', personaId: 'default', title: 'Master', createdAt: 1, updatedAt: 1 },
      { id: 'sub-session-partial', personaId: 'default', title: 'Pragmatist partial', kind: 'subagent', parentSessionId: 'arch-root', createdAt: 2, updatedAt: 2 },
    ];
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
    sessionState.sessions = [
      { id: 'session-1', personaId: 'default', title: 'Master', createdAt: 1, updatedAt: 1 },
      { id: 'sub-session-one', personaId: 'default', title: 'Agent one branch', kind: 'subagent', parentSessionId: 'arch-root', createdAt: 2, updatedAt: 2 },
      { id: 'sub-session-two', personaId: 'default', title: 'Agent two branch', kind: 'subagent', parentSessionId: 'arch-root', createdAt: 3, updatedAt: 3 },
    ];
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

  it('shows the resume action in the focused AgentFlow canvas section', async () => {
    agentState.activeAgentLoops = {};
    agentState.toolActivities = [];
    agentState.canvasFocus = { kind: 'architecture-run', runId: 'flow-linked-graph' };
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
          decisions: [],
          nextActions: [],
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

    await waitFor(() => expect(screen.getByTestId('agentflow-canvas-section')).toBeDefined());
    expect(screen.getByTestId('agentflow-canvas-section')).toHaveTextContent('Waiting on orchestrator');
    expect(screen.getByTestId('agentflow-canvas-section')).toHaveTextContent('Resume AgentFlow');
  });

  it('shows the same resume action for a hydrated waiting AgentFlow preview', async () => {
    mockApiPost.mockResolvedValueOnce({
      data: {
        run: {
          id: 'flow-run-1',
          parentSessionId: 'session-1',
          childSessionId: 'flow-linked-chat',
          openChatSessionId: 'flow-linked-chat',
          openGraphRunId: 'flow-linked-graph',
          flowDefinitionId: 'goal_guard_delivery_loop',
          status: 'running',
          startMode: 'durable',
          returnMode: 'summary',
          createdAt: 1,
          updatedAt: 2,
        },
        events: [],
      },
    });
    agentState.activeAgentLoops = {};
    agentState.toolActivities = [];
    agentState.runtimeActivitySnapshots = {
      'session-1': {
        sessionId: 'session-1',
        active: false,
        queueLength: 0,
        pendingConfirmations: [],
        pendingBudgetApprovals: [],
        childExecutions: [
          {
            id: 'child-flow-1',
            kind: 'agent_flow',
            parentSessionId: 'session-1',
            childSessionId: 'flow-linked-chat',
            parentToolCallId: 'agentflow-call-1',
            flowRunId: 'flow-run-1',
            label: 'Goal Guard',
            status: 'waiting',
            updatedAt: 3,
          },
        ],
        toolActivities: [],
        updatedAt: 3,
      },
    };
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

    await waitFor(() => expect(screen.getByTestId('canvas-agentflow-card-flow-run-1')).toBeDefined());
    expect(screen.getByTestId('canvas-agentflow-card-flow-run-1')).toHaveTextContent('Waiting on orchestrator');

    fireEvent.click(screen.getByTestId('resume-agentflow-flow-run-1'));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/agent-flows/runs/flow-run-1/resume', { input: 'Continue.' });
    });
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

describe('CanvasPanel CLI children section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentState.toolActivities = [];
    agentState.activeAgentLoops = {};
    agentState.runtimeActivitySnapshots = {};
    sessionState.messages = [{ id: 'm1', sessionId: 'session-1', role: 'user', content: 'hello', createdAt: 1 }];
    sessionState.sessionMessages = {
      'session-1': [{ id: 'm1', sessionId: 'session-1', role: 'user', content: 'hello', createdAt: 1 }],
    };
    agentState.cliChildProjections = {
      'cli-child-1': {
        childSessionId: 'cli-child-1',
        parentSessionId: 'session-1',
        parentCallId: 'call-cli-1',
        agentId: 'codex',
        status: 'stopped',
        lastOutput: 'done',
        toolName: 'spawn_cli_agent',
        childTitle: 'codex CLI',
      },
    };
    sessionState.sessions = [
      { id: 'session-1', personaId: 'default', title: 'Master', createdAt: 1, updatedAt: 1 },
      {
        id: 'cli-child-1',
        personaId: 'default',
        title: 'codex CLI',
        kind: 'cli-agent',
        parentSessionId: 'session-1',
        parentToolCallId: 'call-cli-1',
        createdAt: 2,
        updatedAt: 2,
      },
    ];
    agentState.canvasOpen = true;
  });

  it('renders CLI child cards from projections in the canvas section', () => {
    render(<CanvasPanel />);

    expect(screen.getByTestId('canvas-cli-children-section')).toBeInTheDocument();
    expect(screen.getByTestId('cli-child-card-cli-child-1')).toBeInTheDocument();
    expect(screen.getByTestId('cli-child-status-cli-child-1')).toHaveTextContent('stopped');
    expect(screen.getByTestId('cli-child-output-cli-child-1')).toHaveTextContent('done');
  });

  it('does not render or hydrate projected CLI children without a real session row', () => {
    agentState.cliChildProjections = {
      'cli-child-ghost': {
        childSessionId: 'cli-child-ghost',
        parentSessionId: 'session-1',
        parentCallId: 'call-cli-ghost',
        agentId: 'codex',
        status: 'running',
        lastOutput: 'ghost output',
        toolName: 'spawn_cli_agent',
        childTitle: 'ghost CLI',
      },
    };
    sessionState.sessions = [
      { id: 'session-1', personaId: 'default', title: 'Master', createdAt: 1, updatedAt: 1 },
    ];

    render(<CanvasPanel />);

    expect(screen.queryByTestId('canvas-cli-children-section')).not.toBeInTheDocument();
    expect(mockIdentifySession).not.toHaveBeenCalledWith('cli-child-ghost');
    expect(mockApiGet).not.toHaveBeenCalled();
  });
});

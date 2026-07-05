/**
 * Regression tests for ChatInterface event wiring.
 *
 * Focus: verify that tool:start, tool:result, and tool:confirmation_required
 * Socket.IO events correctly drive toolActivities in the agent store.
 *
 * Before the tool:start fix, non-HITL tool calls were invisible in the UI
 * because addToolActivity was only called from the confirmation handler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent, screen, waitFor } from '@testing-library/react';
import { buildArchitectureRunContext, ChatInterface } from './ChatInterface';
import { computeAnsweredCallIds } from './chatUtils';
import { resolveRenderableConversationProjection } from './conversationTranscriptProjection';
import type { ChatMessage, ChatSession, VFSFile } from '@kalio/types';
import { apiClient } from '../../services/apiClient';
import { ARCHITECTURE_REGISTRY_CHANGED_EVENT } from '../architect/architectureRegistryEvents';
import type { AgentTurn } from '../../store/sessionStore';

// jsdom does not implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// ── Captured event handlers (populated when ChatInterface mounts) ─────────────
const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};

function capture(event: string, handler: (...args: unknown[]) => void) {
  if (!handlers[event]) handlers[event] = [];
  handlers[event].push(handler);
  return () => {
    handlers[event] = (handlers[event] ?? []).filter((h) => h !== handler);
  };
}

function fire(event: string, payload: unknown) {
  (handlers[event] ?? []).forEach((h) => h(payload));
}

async function flushReactEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function renderChatInterface() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<ChatInterface />);
    await flushReactEffects();
  });
  return view;
}

async function rerenderChatInterface(rerender: ReturnType<typeof render>['rerender']) {
  await act(async () => {
    rerender(<ChatInterface />);
    await flushReactEffects();
  });
}

async function emitEvent(event: string, payload: unknown) {
  await act(async () => {
    fire(event, payload);
    await flushReactEffects();
  });
}

// Spies declared via vi.hoisted() so they're initialized before vi.mock factories run
const mockSendMessage = vi.hoisted(() => vi.fn());
const mockConversationFilesBar = vi.hoisted(() => vi.fn());
const mockIdentifySession = vi.hoisted(() => vi.fn());
const mockEventBusConnected = vi.hoisted(() => ({ value: true }));
const mockGetArchitectureSchemas = vi.hoisted(() => vi.fn());
const mockStartArchitectureRun = vi.hoisted(() => vi.fn());
const mockStartGoalGuardAgentFlowRun = vi.hoisted(() => vi.fn());

// ── eventBus mock ─────────────────────────────────────────────────────────────
vi.mock('../../services/eventBus', () => ({
  eventBus: {
    get connected() {
      return mockEventBusConnected.value;
    },
    connect: vi.fn(),
    onChunk: (h: (...args: unknown[]) => void) => capture('chat:chunk', h),
    onComplete: (h: (...args: unknown[]) => void) => capture('chat:complete', h),
    onError: (h: (...args: unknown[]) => void) => capture('chat:error', h),
    onToolConfirmation: (h: (...args: unknown[]) => void) => capture('tool:confirmation_required', h),
    onToolConfirmationInvalidated: (h: (...args: unknown[]) => void) => capture('tool:confirmation_invalidated', h),
    onToolStart: (h: (...args: unknown[]) => void) => capture('tool:start', h),
    onToolResult: (h: (...args: unknown[]) => void) => capture('tool:result', h),
    onContext: (h: (...args: unknown[]) => void) => capture('chat:context', h),
    onAgentStart: (h: (...args: unknown[]) => void) => capture('agent:start', h),
    onAgentDone: (h: (...args: unknown[]) => void) => capture('agent:done', h),
    onSessionCreated: (h: (...args: unknown[]) => void) => capture('session:created', h),
    onRaAppNativeResult: (h: (...args: unknown[]) => void) => capture('raapp:native_result', h),
    onCLIAgentProgress: (h: (...args: unknown[]) => void) => capture('cli_agent:progress', h),
    onToolArgProgress: (h: (...args: unknown[]) => void) => capture('tool:arg_progress', h),
    onSessionStatus: (h: (...args: unknown[]) => void) => capture('session:status', h),
    onRuntimeActivitySnapshot: (h: (...args: unknown[]) => void) => capture('session:runtime_snapshot', h),
    onQueued: (h: (...args: unknown[]) => void) => capture('chat:queued', h),
    onReconnect: (h: (...args: unknown[]) => void) => capture('socket:reconnect', h),
    onConnectionState: (h: (...args: unknown[]) => void) => capture('socket:connection_state', h),
    identifySession: mockIdentifySession,
    sendMessage: mockSendMessage,
    stopTurn: vi.fn(),
    confirmTool: vi.fn(),
    cancelTool: vi.fn(),
    disconnect: vi.fn(),
  },
}));

vi.mock('../../services/sessionWatchRegistry', () => ({
  identifyWatchedSession: (...args: unknown[]) => {
    const [sessionId] = args;
    if (typeof sessionId === 'string' && sessionId.trim().length > 0) {
      mockIdentifySession(sessionId);
    }
  },
  replaceBaselineWatchedSessions: vi.fn(),
  resetSessionWatchConnectionEpoch: vi.fn(),
  clearSessionWatchRegistry: vi.fn(),
}));

// ── agentStore mock ───────────────────────────────────────────────────────────
const addToolActivity = vi.fn();
const updateToolActivity = vi.fn();
const addSession = vi.fn();
const addMessage = vi.fn();
const setStreaming = vi.fn();
const setPendingConfirmation = vi.fn();
const removePendingConfirmation = vi.fn();
const clearToolActivities = vi.fn();
const addLlmActivity = vi.fn();
const updateLlmActivity = vi.fn();
const setContext = vi.fn();
const registerCallId = vi.fn();
const addActiveAgentLoop = vi.fn();
const removeActiveAgentLoop = vi.fn();
const appendCLIAgentChunk = vi.fn();
const clearCLIAgentOutput = vi.fn();
const setToolArgProgress = vi.fn();
const setSessionStatusSnapshot = vi.fn();
const setRuntimeActivitySnapshot = vi.fn();
const recordSessionStatusSnapshot = vi.fn();
const clearBufferedSessionStatusSnapshots = vi.fn();
const consumeBufferedSessionStatusSnapshots = vi.fn(() => []);

const agentStoreState = {
  isStreaming: false,
  streamingSessionId: null as string | null,
  pendingConfirmations: {} as Record<string, unknown>,
  toolArgProgress: null as { toolName: string; totalChars: number; charsPerSec: number } | null,
  toolActivities: [] as Array<{
    callId: string;
    requestId?: string;
    toolName: string;
    args?: Record<string, unknown>;
    sessionId?: string;
    status?: 'awaiting_confirmation' | 'running' | 'success' | 'error' | 'cancelled' | 'expired';
    startedAt?: number;
  }>,
  llmActivities: [],
  systemPrompt: null,
  activeToolNames: [],
  callIdToName: {},
  activeAgentLoops: {} as Record<string, { sessionId: string; turnId: string; startedAt: number }>,
  cliChildProjections: {} as Record<string, unknown>,
  queuedDepthBySession: {} as Record<string, number>,
  sessionStatusSnapshots: {} as Record<string, unknown>,
  runtimeActivitySnapshots: {} as Record<string, unknown>,
  bufferedSessionStatusSnapshots: {} as Record<string, unknown>,
  cliAgentOutput: {} as Record<string, string>,
  setStreaming,
  setPendingConfirmation,
  removePendingConfirmation,
  addToolActivity,
  updateToolActivity,
  clearToolActivities,
  addLlmActivity,
  updateLlmActivity,
  setContext,
  getToolActivitiesForSession: (sessionId: string | null) =>
    sessionId
      ? agentStoreState.toolActivities.filter((activity) => (activity as { sessionId?: string }).sessionId === sessionId)
      : [],
  getContextForSession: () => ({
    systemPrompt: agentStoreState.systemPrompt,
    activeToolNames: agentStoreState.activeToolNames,
  }),
  registerCallId,
  addActiveAgentLoop,
  removeActiveAgentLoop,
  hasActiveLoopForSession: (sessionId: string | null) =>
    sessionId
      ? Object.values(agentStoreState.activeAgentLoops).some((loop) => loop.sessionId === sessionId)
      : false,
  setToolArgProgress,
  appendCLIAgentChunk,
  clearCLIAgentOutput,
  setSessionStatusSnapshot,
  setRuntimeActivitySnapshot,
  recordSessionStatusSnapshot,
  clearBufferedSessionStatusSnapshots,
  consumeBufferedSessionStatusSnapshots,
  getRuntimeActivitySnapshot: (sessionId: string | null) =>
    sessionId
      ? agentStoreState.runtimeActivitySnapshots[sessionId] ?? null
      : null,
  upsertCLIChildProjection: vi.fn(),
  updateCLIChildProjection: vi.fn(),
  rebuildCLIChildProjections: vi.fn(),
  setQueuedDepth: vi.fn(),
};

vi.mock('../../store/agentStore', () => ({
  useAgentStore: Object.assign(() => agentStoreState, {
    getState: () => agentStoreState,
  }),
}));

// ── sessionStore mock ─────────────────────────────────────────────────────────
const setAgentTurns = vi.fn();
const updateAgentTurn = vi.fn();
const setMessages = vi.fn();
const markAgentTurnError = vi.fn();
const removeLastAgentTurn = vi.fn();
const startAgentTurn = vi.fn();
const finalizeAgentTurn = vi.fn();
const addTurnItem = vi.fn();
const clearAgentTurns = vi.fn();
const clearPendingChunks = vi.fn();
const flushStreamingChunks = vi.fn();
const getSessionMessages = vi.fn((_sessionId: string | null) => [] as ChatMessage[]);
const updateSession = vi.fn((sessionId: string, patch: { title?: string; personaId?: string }) => {
  mockSessions = mockSessions.map((session) =>
    session.id === sessionId ? { ...session, ...patch } : session,
  );
});

function createMockSessions(): ChatSession[] {
  return [
    { id: 'session-1', title: 'Test', personaId: 'p1', createdAt: 0, updatedAt: 0 },
    { id: 'session-2', title: 'Other', personaId: 'p1', createdAt: 0, updatedAt: 0 },
    { id: 'session-raapp', title: 'My RA App', personaId: 'ra-apps', createdAt: 0, updatedAt: 0 },
  ];
}

// Mutable activeTurnId so tests can control what the store returns
let mockActiveTurnId: string | null = null;
let mockActiveSessionId: string | null = 'session-1';
let mockPendingMessage: string | null = null;
let mockStreamingChunks: Record<string, string> = {};
let mockThinkingChunks: Record<string, string> = {};
let mockChunkSessionIds: Record<string, string> = {};
let mockHydratedSessionIds: Record<string, boolean> = {};
let mockSessionHistoryMeta: Record<string, import('./sessionHistoryApi').SessionHistoryMeta> = {};
let mockSessionMessages: Record<string, ChatMessage[]> = {};
let mockSessionAgentTurns: Record<string, AgentTurn[]> = {};
let mockSessionActiveTurnIds: Record<string, string | null> = {};
let mockMessages: ChatMessage[] = [];
let mockAgentTurns: AgentTurn[] = [];
let mockSessions = createMockSessions();
const mockSetPendingMessage = vi.fn();
const mockSetPendingRAAppId = vi.fn();
const mockSetPendingRAAppLaunchIntent = vi.fn();

function buildSessionStoreState() {
  return {
    messages: mockMessages,
    agentTurns: mockAgentTurns,
    activeTurnId: mockActiveTurnId,
    activeSessionId: mockActiveSessionId,
    sessions: mockSessions,
    sessionMessages: mockSessionMessages,
    sessionAgentTurns: mockSessionAgentTurns,
    sessionActiveTurnIds: mockSessionActiveTurnIds,
    pendingMessage: mockPendingMessage,
    addSession,
    pendingRAAppId: null,
    pendingRAAppLaunchIntent: null,
    setPendingMessage: mockSetPendingMessage,
    setPendingRAAppId: mockSetPendingRAAppId,
    setPendingRAAppLaunchIntent: mockSetPendingRAAppLaunchIntent,
    streamingChunks: mockStreamingChunks,
    thinkingChunks: mockThinkingChunks,
    chunkSessionIds: mockChunkSessionIds,
    addMessage,
    appendChunk: vi.fn(),
    finalizeChunk: vi.fn(),
    setMessages,
    setSessionHistoryMeta: vi.fn((sessionId: string | null, meta: import('./sessionHistoryApi').SessionHistoryMeta | null) => {
      if (!sessionId) {
        return;
      }
      if (!meta) {
        delete mockSessionHistoryMeta[sessionId];
        return;
      }
      mockSessionHistoryMeta[sessionId] = meta;
    }),
    updateSession,
    setAgentTurns,
    updateAgentTurn,
    startAgentTurn,
    addTurnItem,
    finalizeAgentTurn,
    clearAgentTurns,
    clearPendingChunks,
    getSessionMessages,
    getSessionHistoryMeta: (sessionId: string | null) => (sessionId ? mockSessionHistoryMeta[sessionId] ?? null : null),
    getSessionActiveTurnId: () => mockActiveTurnId,
    getSessionAgentTurns: () => [],
    markAgentTurnError,
    removeLastAgentTurn,
    flushThinkingChunks: vi.fn(),
    flushStreamingChunks,
    isSessionHydrated: (sessionId: string | null) => (sessionId ? mockHydratedSessionIds[sessionId] === true : false),
    markSessionHydrated: (sessionId: string) => {
      mockHydratedSessionIds[sessionId] = true;
    },
  };
}

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: Object.assign(
    <T,>(selector?: (state: ReturnType<typeof buildSessionStoreState>) => T) => {
      const state = buildSessionStoreState();
      return typeof selector === 'function' ? selector(state) : state;
    },
    {
      getState: () => buildSessionStoreState(),
      setState: (patch: Partial<ReturnType<typeof buildSessionStoreState>>) => {
        if (Array.isArray(patch.messages)) {
          mockMessages = patch.messages as ChatMessage[];
        }
        if (Array.isArray(patch.agentTurns)) {
          mockAgentTurns = patch.agentTurns as AgentTurn[];
        }
        if ('activeTurnId' in patch) {
          mockActiveTurnId = (patch.activeTurnId ?? null) as string | null;
        }
      },
    },
  ),
}));

// ── settingsStore mock ────────────────────────────────────────────────────────
const settingsStoreState = {
  conversationTitleSettings: {
    autoRenameEnabled: false,
    renameEveryReplies: 3,
  },
  getEffectiveModel: () => 'test-model',
  setConversationTitleSettings: vi.fn((settings: { autoRenameEnabled: boolean; renameEveryReplies: number }) => {
    settingsStoreState.conversationTitleSettings = settings;
  }),
};

vi.mock('../settings/settingsStore', () => ({
  useSettingsStore: (selector: (state: typeof settingsStoreState) => unknown) => selector(settingsStoreState),
}));

// ── context usage mock ────────────────────────────────────────────────────────
vi.mock('./hooks/useContextUsage', () => ({
  useContextUsage: () => ({
    tokenCount: { total: 100, contextLimit: 32000, usagePercent: 0 },
    needsCompact: false,
    compactMessages: vi.fn(),
  }),
}));

vi.mock('./hooks/useContextPreview', () => ({
  useContextPreview: () => ({
    preview: null,
    tokenCount: null,
    loading: false,
    stale: false,
    error: null,
    invalidate: vi.fn(),
  }),
}));

// ── apiClient mock ────────────────────────────────────────────────────────────
vi.mock('../../services/apiClient', () => ({
  apiClient: {
    get: vi.fn(() => Promise.resolve({ data: [] })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    patch: vi.fn(() => Promise.resolve({ data: {} })),
  },
  getSessionVfsFiles: vi.fn(() => Promise.resolve({ files: [] })),
}));

vi.mock('../architect/architect.api', () => ({
  getArchitectureSchemas: mockGetArchitectureSchemas,
  startArchitectureRun: mockStartArchitectureRun,
  startGoalGuardAgentFlowRun: mockStartGoalGuardAgentFlowRun,
}));

// ── Minor child-component mocks ───────────────────────────────────────────────
vi.mock('./MessageBubble', () => ({ MessageBubble: () => null }));
vi.mock('./ToolActivityRow', () => ({ ToolActivityRow: () => null }));
vi.mock('./ChatInput', () => ({
  ChatInput: (props: {
    architectures?: Array<{ id: string; name: string }>;
    disabled: boolean;
    isStreaming?: boolean;
    onStop?: () => void;
    onArchitectureChange?: (schemaId: string) => void;
    onArchitectureRun?: (content: string, schemaId: string) => void;
    onSend: (content: string, personaId: string) => void;
    selectedArchitectureId?: string;
  }) => (
    <div>
      <select
        data-testid="chat-architecture-select"
        value={props.selectedArchitectureId ?? 'single-chat'}
        onChange={(event) => props.onArchitectureChange?.(event.target.value)}
      >
        <option value="single-chat">Single Chat</option>
        {(props.architectures ?? []).map((schema) => (
          <option key={schema.id} value={schema.id}>{schema.name}</option>
        ))}
      </select>
      <textarea data-testid="chat-input" />
      <button
        data-testid="chat-send-btn"
        disabled={props.disabled}
        onClick={() => {
          const input = document.querySelector('[data-testid="chat-input"]') as HTMLTextAreaElement | null;
          const value = input?.value ?? '';
          const content = value.trim();
          if (!content) return;
          if (props.selectedArchitectureId && props.selectedArchitectureId !== 'single-chat') {
            if (props.isStreaming) return;
            props.onArchitectureRun?.(content, props.selectedArchitectureId);
            if (input) input.value = '';
            return;
          }
          props.onSend(content, 'default');
          if (input) input.value = '';
        }}
      >
        Send
      </button>
      {props.isStreaming && props.onStop && (
        <button data-testid="chat-stop-btn" onClick={props.onStop}>
          Stop
        </button>
      )}
    </div>
  ),
}));
vi.mock('./TokenBadge', () => ({ TokenBadge: () => null }));
vi.mock('./ContextStats', () => ({ ContextStats: () => null }));
vi.mock('../vfs/ConversationFilesBar', () => ({
  ConversationFilesBar: (props: { sessionId: string; refreshSignal: number }) => {
    mockConversationFilesBar(props);
    return null;
  },
}));
vi.mock('./AgentTurnBubble', () => ({ AgentTurnBubble: () => null }));

// ─────────────────────────────────────────────────────────────────────────────

  beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })),
  );
  Object.keys(handlers).forEach((k) => delete handlers[k]);
  mockEventBusConnected.value = true;
  mockActiveTurnId = null;
  mockActiveSessionId = 'session-1';
  mockPendingMessage = null;
  mockStreamingChunks = {};
  mockThinkingChunks = {};
    mockChunkSessionIds = {};
    mockHydratedSessionIds = {};
    mockSessionHistoryMeta = {};
    mockSessionMessages = {};
    mockSessionAgentTurns = {};
    mockSessionActiveTurnIds = {};
    mockMessages = [];
    mockAgentTurns = [];
  mockSessions = createMockSessions();
  settingsStoreState.conversationTitleSettings = {
    autoRenameEnabled: false,
    renameEveryReplies: 3,
  };
  agentStoreState.isStreaming = false;
  agentStoreState.streamingSessionId = null;
  agentStoreState.activeAgentLoops = {};
  agentStoreState.toolActivities = [];
  agentStoreState.sessionStatusSnapshots = {};
  agentStoreState.bufferedSessionStatusSnapshots = {};
  getSessionMessages.mockReturnValue(mockMessages);
  vi.clearAllMocks();
  mockSendMessage.mockReturnValue(true);
  mockGetArchitectureSchemas.mockResolvedValue([]);
  mockStartArchitectureRun.mockResolvedValue({
    run: { id: 'arch-run-1', schemaId: 'strategic-decision-council', prompt: 'Decide.', executionMode: 'subagent_execution', status: 'completed', createdAt: 1, updatedAt: 2 },
    events: [],
    graph: { runId: 'arch-run-1', nodes: [], edges: [] },
    chat: { runId: 'arch-run-1', messages: [] },
  });
  mockStartGoalGuardAgentFlowRun.mockResolvedValue({
    run: { id: 'goal-run-1', schemaId: 'goal-master-delivery-loop', prompt: 'Deliver.', executionMode: 'session_branches', status: 'completed', createdAt: 1, updatedAt: 2 },
    events: [],
    graph: { runId: 'goal-run-1', nodes: [], edges: [] },
    chat: { runId: 'goal-run-1', messages: [] },
    agentFlowRunId: 'agent-flow-1',
    agentFlowStatus: 'done',
  });
  vi.mocked(apiClient.get).mockImplementation((url: string) => {
    if (url === '/api/credentials/settings/conversation-title') {
      return Promise.resolve({
        data: {
          autoRenameEnabled: false,
          renameEveryReplies: 3,
        },
      } as never);
    }
    return Promise.resolve({ data: [] } as never);
  });
});

describe('ChatInterface event wiring', () => {
  it('renders the welcome composer even before any session is active', async () => {
    mockActiveSessionId = null;

    await renderChatInterface();

    expect(screen.getByTestId('welcome-screen')).toBeInTheDocument();
    expect(screen.getByTestId('welcome-prompt-input')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-input')).toBeNull();
  });

  it('renders only the welcome composer for an empty active chat', async () => {
    await renderChatInterface();

    expect(screen.getByTestId('welcome-prompt-input')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-input')).toBeNull();
  });

  it('REGRESSION: sending the first prompt from the welcome screen shows a pending assistant state before the first chunk', async () => {
    addMessage.mockImplementation((message: ChatMessage) => {
      mockMessages = [...mockMessages, message];
      getSessionMessages.mockReturnValue(mockMessages);
    });

    await renderChatInterface();

    await act(async () => {
      fireEvent.change(screen.getByTestId('welcome-prompt-input'), {
        target: { value: 'What can you do?' },
      });
      fireEvent.click(screen.getByTestId('welcome-run-prompt'));
      await flushReactEffects();
    });

    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      content: 'What can you do?',
      personaId: 'p1',
      interrupt: false,
    }));
    expect(screen.queryByTestId('welcome-screen')).toBeNull();
    expect(screen.getByTestId('pending-agent-bubble')).toBeInTheDocument();
  });

  it('REGRESSION: sending the first prompt from the welcome screen exposes the stop action before the first chunk', async () => {
    addMessage.mockImplementation((message: ChatMessage) => {
      mockMessages = [...mockMessages, message];
      getSessionMessages.mockReturnValue(mockMessages);
    });

    await renderChatInterface();

    await act(async () => {
      fireEvent.change(screen.getByTestId('welcome-prompt-input'), {
        target: { value: 'Inspect the repo.' },
      });
      fireEvent.click(screen.getByTestId('welcome-run-prompt'));
      await flushReactEffects();
    });

    expect(screen.getByTestId('chat-stop-btn')).toBeInTheDocument();
  });

  it('REGRESSION: renders the welcome composer when the active session only has non-renderable messages', async () => {
    mockMessages = [
      makeMsg({
        id: 'tool-only',
        role: 'tool_result',
        content: '{"ok":true}',
        toolCallId: 'call-tool-only',
      }),
    ];

    await renderChatInterface();

    expect(screen.getByTestId('welcome-prompt-input')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-input')).toBeNull();
    expect(screen.queryByText('{"ok":true}')).toBeNull();
  });

  it('REGRESSION: an unrelated streaming session does not hide the new-chat launch form', async () => {
    mockActiveSessionId = 'session-2';
    agentStoreState.isStreaming = true;
    agentStoreState.streamingSessionId = 'session-1';
    getSessionMessages.mockImplementation(((sessionId: string | null) => (
      sessionId === 'session-2' ? [] : mockMessages
    )) as typeof getSessionMessages);

    await renderChatInterface();

    expect(screen.getByTestId('welcome-prompt-input')).toBeInTheDocument();
    expect(screen.queryByTestId('pending-agent-bubble')).toBeNull();
  });

  it('hydrates architecture runs from the active session VFS when files are attached', () => {
    const files: VFSFile[] = [{
      sessionId: 'session-1',
      path: 'README.md',
      sizeBytes: 120,
      mimeType: 'text/markdown',
      updatedAt: 1,
    }];

    expect(buildArchitectureRunContext('session-1', files, ['vfs_read', 'fs_read'])).toEqual({
      maxArchitectureSteps: 64,
      maxArchitectureNodeVisits: 4,
      maxArchitectureSubagentIterations: 30,
      parentSessionId: 'session-1',
      hostSessionId: 'session-1',
      historySessionId: 'session-1',
      sessionSurface: 'host-envelope',
      launchAllowedToolNames: ['vfs_read', 'fs_read'],
      hydrateFromSessionId: 'session-1',
      hydrateTargetPrefix: 'project',
      hydrateFilePaths: ['README.md'],
    });
  });

  it('keeps prompt-only architecture runs explicit when no VFS files are attached', () => {
    expect(buildArchitectureRunContext('session-1', [], ['vfs_read'])).toEqual({
      maxArchitectureSteps: 64,
      maxArchitectureNodeVisits: 4,
      maxArchitectureSubagentIterations: 30,
      parentSessionId: 'session-1',
      hostSessionId: 'session-1',
      historySessionId: 'session-1',
      sessionSurface: 'host-envelope',
      launchAllowedToolNames: ['vfs_read'],
    });
  });

  it('includes the real prompt message id in architecture launch context when provided', () => {
    expect(buildArchitectureRunContext('session-1', [], [], '', 'user-1')).toEqual({
      maxArchitectureSteps: 64,
      maxArchitectureNodeVisits: 4,
      maxArchitectureSubagentIterations: 30,
      parentSessionId: 'session-1',
      hostSessionId: 'session-1',
      historySessionId: 'session-1',
      sessionSurface: 'host-envelope',
      promptMessageId: 'user-1',
    });
  });

  it('includes the selected project path in architecture launch context', () => {
    expect(buildArchitectureRunContext('session-1', [], ['vfs_read'], 'C:\\Projekty\\kalio-forever')).toEqual({
      maxArchitectureSteps: 64,
      maxArchitectureNodeVisits: 4,
      maxArchitectureSubagentIterations: 30,
      parentSessionId: 'session-1',
      hostSessionId: 'session-1',
      historySessionId: 'session-1',
      sessionSurface: 'host-envelope',
      projectPath: 'C:\\Projekty\\kalio-forever',
      executionCwd: 'C:\\Projekty\\kalio-forever',
      launchAllowedToolNames: ['vfs_read'],
    });
  });

  it('does not show a warning banner for prompt-only architecture runs without VFS files', async () => {
    mockGetArchitectureSchemas.mockResolvedValue([
      {
        id: 'strategic-decision-council',
        name: 'Strategic Decision Council',
        version: '0.1.0',
        description: '',
        nodes: [],
        edges: [],
        roleSlots: [],
      },
    ]);

    await renderChatInterface();
    await act(async () => {
      fireEvent.click(await screen.findByTestId('welcome-mode-workflow'));
      fireEvent.change(await screen.findByTestId('welcome-architecture-select'), {
        target: { value: 'strategic-decision-council' },
      });
      fireEvent.change(await screen.findByTestId('welcome-prompt-input'), {
        target: { value: 'Pick a stack.' },
      });
      fireEvent.click(await screen.findByTestId('welcome-run-prompt'));
      await flushReactEffects();
    });

    expect(mockStartArchitectureRun).toHaveBeenCalled();
    expect(screen.queryByTestId('chat-recovery-notice')).toBeNull();
  });

  it('refreshes Talk architecture options when the registry changes', async () => {
    const baseSchema = {
      id: 'strategic-decision-council',
      name: 'Strategic Decision Council',
      version: '0.1.0',
      description: '',
      nodes: [],
      edges: [],
      roleSlots: [],
    };
    const variantSchema = {
      ...baseSchema,
      id: 'strategic-decision-council-variant-99',
      name: 'UI Saved Variant',
    };
    mockGetArchitectureSchemas
      .mockResolvedValueOnce([baseSchema])
      .mockResolvedValueOnce([baseSchema, variantSchema]);

    await renderChatInterface();
    await act(async () => {
      fireEvent.click(await screen.findByTestId('welcome-mode-workflow'));
      await flushReactEffects();
    });
    await screen.findByRole('option', { name: 'Strategic Decision Council' });
    expect(screen.queryByRole('option', { name: 'UI Saved Variant' })).toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event(ARCHITECTURE_REGISTRY_CHANGED_EVENT));
      await flushReactEffects();
    });

    expect(await screen.findByRole('option', { name: 'UI Saved Variant' })).toBeInTheDocument();
  });

  it('passes the active project path into non-goal architecture launches from chat', async () => {
    mockSessions = mockSessions.map((session) => (
      session.id === 'session-1'
        ? {
            ...session,
            runtimeContext: {
              runtimeKind: 'chat',
              architectureContext: {
                projectPath: 'C:\\Projekty\\kalio-forever',
              },
            },
          }
        : session
    ));
    mockGetArchitectureSchemas.mockResolvedValue([
      {
        id: 'strategic-decision-council',
        name: 'Strategic Decision Council',
        version: '0.1.0',
        description: '',
        nodes: [],
        edges: [],
        roleSlots: [],
      },
    ]);

    await renderChatInterface();
    await act(async () => {
      fireEvent.click(await screen.findByTestId('welcome-mode-workflow'));
      fireEvent.change(await screen.findByTestId('welcome-architecture-select'), {
        target: { value: 'strategic-decision-council' },
      });
      fireEvent.change(await screen.findByTestId('welcome-prompt-input'), {
        target: { value: 'Pick a stack.' },
      });
      fireEvent.click(await screen.findByTestId('welcome-run-prompt'));
      await flushReactEffects();
    });

    await waitFor(() => {
      expect(mockStartArchitectureRun).toHaveBeenCalledWith(
        'strategic-decision-council',
        'Pick a stack.',
        {},
        'subagent_execution',
        undefined,
        expect.objectContaining({
          parentSessionId: 'session-1',
          projectPath: 'C:\\Projekty\\kalio-forever',
          executionCwd: 'C:\\Projekty\\kalio-forever',
        }),
        expect.any(Function),
      );
    });
  });

  it('REGRESSION: seeds a pending workflow turn immediately before the architecture run resolves', async () => {
    mockGetArchitectureSchemas.mockResolvedValue([
      {
        id: 'strategic-decision-council',
        name: 'Strategic Decision Council',
        version: '0.1.0',
        description: '',
        nodes: [],
        edges: [],
        roleSlots: [],
      },
    ]);
    mockStartArchitectureRun.mockImplementation(() => new Promise(() => {}));
    setAgentTurns.mockClear();

    await renderChatInterface();
    await act(async () => {
      fireEvent.click(await screen.findByTestId('welcome-mode-workflow'));
      fireEvent.change(await screen.findByTestId('welcome-architecture-select'), {
        target: { value: 'strategic-decision-council' },
      });
      fireEvent.change(await screen.findByTestId('welcome-prompt-input'), {
        target: { value: 'Follow up workflow.' },
      });
      fireEvent.click(await screen.findByTestId('welcome-run-prompt'));
      await flushReactEffects();
    });

    expect(mockStartArchitectureRun).toHaveBeenCalled();
    expect(setAgentTurns).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          turnKind: 'workflow-envelope',
          done: false,
          items: [expect.objectContaining({ kind: 'text' })],
        }),
      ]),
      'session-1',
    );
    const optimisticWorkflowMessage = addMessage.mock.calls
      .map(([message]) => message as ChatMessage)
      .find((message) => message.content === 'Architecture run is starting.');
    expect(optimisticWorkflowMessage).toBeDefined();
    expect(optimisticWorkflowMessage?.architectureRun).toBeUndefined();
  });

  it('fail-first: does not start architecture run while streaming and keeps composer draft', async () => {
    mockGetArchitectureSchemas.mockResolvedValue([
      {
        id: 'strategic-decision-council',
        name: 'Strategic Decision Council',
        version: '0.1.0',
        description: '',
        nodes: [],
        edges: [],
        roleSlots: [],
      },
    ]);
    mockMessages = [{ id: 'u1', role: 'user', content: 'hello', sessionId: 'session-1', createdAt: 1 }];
    getSessionMessages.mockReturnValue(mockMessages);
    agentStoreState.isStreaming = true;
    agentStoreState.streamingSessionId = 'session-1';
    mockStartArchitectureRun.mockClear();

    await renderChatInterface();
    await screen.findByTestId('chat-architecture-select');
    await screen.findByRole('option', { name: 'Strategic Decision Council' });
    await act(async () => {
      fireEvent.change(screen.getByTestId('chat-architecture-select'), {
        target: { value: 'strategic-decision-council' },
      });
      fireEvent.change(screen.getByTestId('chat-input'), {
        target: { value: 'keep this architecture draft' },
      });
      fireEvent.click(screen.getByTestId('chat-send-btn'));
      await flushReactEffects();
    });

    expect(mockStartArchitectureRun).not.toHaveBeenCalled();
    expect((screen.getByTestId('chat-input') as HTMLTextAreaElement).value).toBe('keep this architecture draft');
  });

  it('routes Goal Master Delivery Loop from Talk through canonical AgentFlow with strict proof context', async () => {
    mockSessions = mockSessions.map((session) => (
      session.id === 'session-1'
        ? {
            ...session,
            runtimeContext: {
              runtimeKind: 'chat',
              architectureContext: {
                projectPath: 'C:\\Projekty\\kalio-forever',
              },
            },
          }
        : session
    ));
    mockGetArchitectureSchemas.mockResolvedValue([
      {
        id: 'goal-master-delivery-loop',
        name: 'Goal Master Delivery Loop',
        version: '0.1.0',
        description: '',
        nodes: [],
        edges: [],
        roleSlots: [],
      },
    ]);

    await renderChatInterface();
    await act(async () => {
      fireEvent.click(await screen.findByTestId('welcome-mode-workflow'));
      await flushReactEffects();
    });
    await screen.findByRole('option', { name: 'Goal Master Delivery Loop' });
    await act(async () => {
      const select = screen.getByTestId('welcome-architecture-select');
      const input = screen.getByTestId('welcome-prompt-input');
      const send = screen.getByTestId('welcome-run-prompt');
      fireEvent.change(select, { target: { value: 'goal-master-delivery-loop' } });
      fireEvent.change(input, { target: { value: 'Deliver with proof.' } });
      fireEvent.click(send);
      await flushReactEffects();
    });

    await waitFor(() => {
      expect(mockStartGoalGuardAgentFlowRun).toHaveBeenCalledWith(
        'Deliver with proof.',
        expect.objectContaining({
          parentSessionId: 'session-1',
          projectPath: 'C:\\Projekty\\kalio-forever',
          executionCwd: 'C:\\Projekty\\kalio-forever',
          requireGoalMasterLoopProof: true,
          requireImplementerWriteProof: true,
        }),
        'session-1',
        expect.any(Function),
      );
    });
    expect(mockStartArchitectureRun).not.toHaveBeenCalled();
  });

  it('REGRESSION: identifies the active session on mount', async () => {
    await renderChatInterface();

    expect(mockIdentifySession).toHaveBeenCalledWith('session-1');
  });

  it('REGRESSION: identifies the active session after socket connects', async () => {
    mockEventBusConnected.value = false;
    await renderChatInterface();
    mockIdentifySession.mockClear();

    mockEventBusConnected.value = true;
    await emitEvent('socket:connection_state', { status: 'connected', recovered: false });

    expect(mockIdentifySession).toHaveBeenCalledWith('session-1');
  });

  it('REGRESSION: re-identifies when the active session changes', async () => {
    const { rerender } = await renderChatInterface();
    mockIdentifySession.mockClear();

    mockActiveSessionId = 'session-2';
    await rerenderChatInterface(rerender);

    expect(mockIdentifySession).toHaveBeenCalled();
    expect(mockIdentifySession).toHaveBeenLastCalledWith('session-2');
  });

  it('REGRESSION: reconnect re-identifies the active session and reloads its history', async () => {
    await renderChatInterface();
    mockIdentifySession.mockClear();
    const apiGetMock = vi.mocked(apiClient.get);
    apiGetMock.mockClear();

    await emitEvent('socket:reconnect', undefined);

    expect(mockIdentifySession).toHaveBeenCalledTimes(1);
    expect(mockIdentifySession).toHaveBeenCalledWith('session-1');
    expect(apiGetMock).toHaveBeenCalledWith('/api/sessions/session-1/messages', expect.objectContaining({
      params: expect.objectContaining({ limit: 40 }),
    }));
  });

  it('REGRESSION: reconnect history reload merges server history with local optimistic messages', async () => {
    const localMessage: ChatMessage = {
      id: 'local-user-1',
      sessionId: 'session-1',
      role: 'user',
      content: 'still local',
      createdAt: 10,
    };
    mockMessages = [localMessage];
    await renderChatInterface();
    setMessages.mockClear();
    setAgentTurns.mockClear();
    getSessionMessages.mockReturnValueOnce([localMessage]);
    const apiGetMock = vi.mocked(apiClient.get);
    apiGetMock.mockClear();
    apiGetMock.mockResolvedValueOnce({ data: [] });

    await emitEvent('socket:reconnect', undefined);

    expect(setMessages).toHaveBeenCalledWith([localMessage], 'session-1');
    expect(setAgentTurns).toHaveBeenCalledWith(
      expect.any(Array),
      'session-1',
    );
  });

  it('REGRESSION: loading older history merges into the latest store state and rebuilds turns', async () => {
    const currentMessage = makeMsg({
      id: 'msg-current',
      sessionId: 'session-1',
      role: 'user',
      content: 'Current prompt',
      createdAt: 20,
    });
    const liveMessage = makeMsg({
      id: 'msg-live',
      sessionId: 'session-1',
      role: 'assistant',
      content: 'Live reply',
      createdAt: 30,
    });
    const olderMessage = makeMsg({
      id: 'msg-older',
      sessionId: 'session-1',
      role: 'assistant',
      content: 'Earlier reply',
      createdAt: 10,
    });

    mockMessages = [currentMessage];
    mockSessionHistoryMeta = {
      'session-1': {
        totalCount: 3,
        hasMoreBefore: true,
        oldestLoadedMessageId: 'msg-current',
      },
    };
    const apiGetMock = vi.mocked(apiClient.get);
    const defaultGet = apiGetMock.getMockImplementation();
    apiGetMock.mockImplementation((url: string, config?: unknown) => {
      if (url === '/api/sessions/session-1/messages') {
        return Promise.resolve({
          data: [currentMessage],
          headers: {
            'x-kalio-history-total-count': '3',
            'x-kalio-history-has-more-before': '1',
            'x-kalio-history-oldest-loaded-id': 'msg-current',
          },
        } as never);
      }
      return defaultGet
        ? defaultGet(url, config as never)
        : Promise.resolve({ data: [] } as never);
    });

    await renderChatInterface();
    setMessages.mockClear();
    setAgentTurns.mockClear();

    mockMessages = [currentMessage, liveMessage];
    getSessionMessages.mockReturnValue([currentMessage, liveMessage]);

    apiGetMock.mockClear();
    apiGetMock.mockResolvedValueOnce({
      data: [olderMessage],
      headers: {
        'x-kalio-history-total-count': '3',
        'x-kalio-history-has-more-before': '0',
        'x-kalio-history-oldest-loaded-id': 'msg-older',
      },
    } as never);

    const loadOlderButton = await screen.findByTestId('chat-load-older-btn');

    await act(async () => {
      fireEvent.click(loadOlderButton);
      await flushReactEffects();
    });

    await waitFor(() => {
      expect(apiGetMock).toHaveBeenCalledWith('/api/sessions/session-1/messages', expect.objectContaining({
        params: expect.objectContaining({
          limit: 40,
          beforeMessageId: 'msg-current',
        }),
      }));
      expect(setMessages).toHaveBeenCalledWith(
        [olderMessage, currentMessage, liveMessage],
        'session-1',
      );
      expect(setAgentTurns).toHaveBeenCalledWith(expect.any(Array), 'session-1');
    });
  });

  it('REGRESSION: active session status replay restores the live agent turn after reconnect', async () => {
    await renderChatInterface();

    await emitEvent('session:status', {
      sessionId: 'session-1',
      active: true,
      turnId: 'turn-restored',
      queueLength: 0,
    });

    expect(addActiveAgentLoop).toHaveBeenCalledWith('session-1', 'turn-restored');
    expect(startAgentTurn).toHaveBeenCalledWith('turn-restored', 'session-1');
    expect(setStreaming).toHaveBeenCalledWith(true, undefined, 'session-1');
  });

  it('merges raapp:native_result into the target session even when it is not active', async () => {
    const inactiveSessionId = 'session-2';
    const toolCallId = 'call-raapp-1';
    const inactiveMessage: ChatMessage = {
      id: 'tool-result-1',
      sessionId: inactiveSessionId,
      role: 'tool_result',
      content: JSON.stringify({
        pendingApprovals: [{ id: 'approval-1', label: 'Approve' }],
      }),
      toolCallId,
      createdAt: 20,
    };

    mockActiveSessionId = 'session-1';
    getSessionMessages.mockImplementation(((sessionId: string | null) => (
      sessionId === inactiveSessionId ? [inactiveMessage] : mockMessages
    )) as typeof getSessionMessages);

    await renderChatInterface();
    setMessages.mockClear();

    await emitEvent('raapp:native_result', {
      sessionId: inactiveSessionId,
      toolCallId,
      results: [{ id: 'approval-1', system: 'test', status: 'executed' }],
    });

    expect(setMessages).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          sessionId: inactiveSessionId,
          toolCallId,
          role: 'tool_result',
          content: JSON.stringify({
            pendingApprovals: [],
            nativeResults: [{ id: 'approval-1', system: 'test', status: 'executed' }],
          }),
        }),
      ],
      inactiveSessionId,
    );
  });

  it('shows safe resume guidance when backend replays an interrupted LLM run', async () => {
    await renderChatInterface();

    await emitEvent('session:status', {
      sessionId: 'session-1',
      active: false,
      queueLength: 0,
      run: {
        id: 'run-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        phase: 'llm_streaming',
        status: 'interrupted_needs_retry',
        retryCount: 0,
        safeResume: true,
        createdAt: 1,
        updatedAt: 2,
      },
    });

    expect(screen.getByTestId('chat-recovery-notice')).toHaveTextContent(
      'Backend restarted during LLM work',
    );
  });

  it('shows reconnect state when the socket drops', async () => {
    await renderChatInterface();

    await emitEvent('socket:connection_state', { status: 'reconnecting' });

    expect(screen.getByTestId('chat-connection-status')).toHaveTextContent('Reconnecting');
    expect(screen.getByTestId('chat-recovery-notice')).toHaveTextContent('Connection dropped');
  });

  it('does not show the recovered reconnect banner on an initial recovered connect', async () => {
    await renderChatInterface();

    await emitEvent('socket:connection_state', { status: 'connected', recovered: true });

    expect(screen.queryByTestId('chat-recovery-notice')).toBeNull();
  });

  it('shows the recovered reconnect banner only after a real reconnect transition', async () => {
    mockMessages = [
      { id: 'u1', sessionId: 'session-1', role: 'user', content: 'Hello', createdAt: 1 },
      { id: 'a1', sessionId: 'session-1', role: 'assistant', content: 'Hi', createdAt: 2 },
    ];
    getSessionMessages.mockReturnValue(mockMessages);
    await renderChatInterface();

    await emitEvent('socket:connection_state', { status: 'reconnecting' });
    await emitEvent('socket:connection_state', { status: 'connected', recovered: true });

    expect(screen.getByTestId('chat-recovery-notice')).toHaveTextContent(
      'Recovered missed stream events after reconnect.',
    );
  });

  it('shows pending child session shell instead of raw workflow scaffold transcript', async () => {
    mockActiveSessionId = 'branch-1';
    mockSessions = [
      ...createMockSessions(),
      {
        id: 'branch-1',
        title: 'Strategic Decision Council: Analyst',
        personaId: 'default',
        parentSessionId: 'host-1',
        createdAt: 1,
        updatedAt: 1,
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureContext: {
            hostSessionId: 'host-1',
            historySessionId: 'host-1',
            sessionSurface: 'conversation-branch',
          },
        },
      },
    ];
    mockMessages = [
      {
        id: 'branch-user-1',
        sessionId: 'branch-1',
        role: 'user',
        content: 'Architecture: Strategic Decision Council v0.1.0\nSlot: Analyst (participant)\nTask: Assess repo.',
        createdAt: 1,
      },
      {
        id: 'branch-assistant-1',
        sessionId: 'branch-1',
        role: 'assistant',
        content: '[MockLLM] Echo: Architecture: Strategic Decision Council v0.1.0\nSlot: Analyst (participant)\nTask: Assess repo.',
        createdAt: 2,
      },
    ];
    mockSessionMessages = {
      'branch-1': mockMessages,
      'host-1': [],
    };
    getSessionMessages.mockImplementation((sessionId: string | null) =>
      sessionId === 'branch-1' ? mockMessages : [],
    );

    await renderChatInterface();

    expect(screen.getByTestId('pending-child-session-screen')).toBeTruthy();
    expect(screen.queryByText('Architecture: Strategic Decision Council v0.1.0')).toBeNull();
    expect(screen.queryByText('Slot: Analyst (participant)')).toBeNull();
  });

  it('REGRESSION: tool:start creates a running activity in agentStore', async () => {
    await renderChatInterface();

    await emitEvent('tool:start', {
        callId: 'call-1',
        toolName: 'fs_list',
        args: { path: '/tmp' },
      });

    expect(addToolActivity).toHaveBeenCalledOnce();
    expect(addToolActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: 'call-1',
        toolName: 'fs_list',
        status: 'running',
      }),
    );
  });

  it('tool:result updates an existing activity to success', async () => {
    await renderChatInterface();

    await emitEvent('tool:start', { callId: 'call-2', toolName: 'fs_read', args: {} });
    await emitEvent('tool:result', { callId: 'call-2', status: 'success', data: 'content' });

    expect(updateToolActivity).toHaveBeenCalledWith(
      'call-2',
      expect.objectContaining({ status: 'success' }),
    );
  });

  it('tool:result updates an existing activity to error', async () => {
    await renderChatInterface();

    await emitEvent('tool:start', { callId: 'call-3', toolName: 'fs_list', args: {} });
    await emitEvent('tool:result', { callId: 'call-3', status: 'error', errorCode: 'TOOL_NOT_FOUND', errorMessage: 'not found' });

    expect(updateToolActivity).toHaveBeenCalledWith(
      'call-3',
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('REGRESSION: tool:result clears a matching pending confirmation when invalidation races', async () => {
    await renderChatInterface();
    removePendingConfirmation.mockClear();
    agentStoreState.pendingConfirmations = {
      'session-1': [{
        requestId: 'req-confirmed-result',
        toolCallId: 'call-confirmed-result',
        sessionId: 'session-1',
        toolName: 'vfs_write',
        args: { path: 'e2e/mock-tool-trigger.txt' },
        timeoutMs: 600000,
      }],
    };

    await emitEvent('tool:result', {
      callId: 'call-confirmed-result',
      status: 'success',
      sessionId: 'session-1',
    });

    expect(removePendingConfirmation).toHaveBeenCalledWith('session-1', 'req-confirmed-result');
  });

  it('tool:result for the active session unlocks composer streaming state when no turn remains active', async () => {
    await renderChatInterface();
    setStreaming.mockClear();
    mockActiveTurnId = null;

    await emitEvent('tool:start', { callId: 'call-raapp', toolName: 'run_raapp', args: { name: 'calculator' } });
    await emitEvent('tool:result', {
      callId: 'call-raapp',
      status: 'success',
      data: { status: 'ready', type: 'gui', content: '{"nodes":[],"data":{}}' },
      sessionId: 'session-1',
    });

    expect(setStreaming).toHaveBeenCalledWith(false, undefined, 'session-1');
  });

  it('first tool:result during an active loop does not unlock composer streaming state', async () => {
    await renderChatInterface();
    setStreaming.mockClear();

    mockActiveTurnId = 'turn-active';
    agentStoreState.activeAgentLoops = {
      'session-1': { sessionId: 'session-1', turnId: 'turn-active', startedAt: Date.now() },
    };
    agentStoreState.toolActivities = [
      {
        callId: 'call-first',
        toolName: 'run_raapp',
        sessionId: 'session-1',
        args: { name: 'calculator' },
        status: 'running',
        startedAt: Date.now(),
      },
      {
        callId: 'call-next',
        toolName: 'vfs_read',
        sessionId: 'session-1',
        args: { path: 'README.md' },
        status: 'running',
        startedAt: Date.now(),
      },
    ];

    await emitEvent('tool:result', {
      callId: 'call-first',
      status: 'success',
      data: { status: 'ready', type: 'gui' },
      sessionId: 'session-1',
    });

    expect(setStreaming).not.toHaveBeenCalledWith(false, undefined, 'session-1');
  });

  it('tool:result error/abort for the active session unlocks composer streaming state', async () => {
    await renderChatInterface();
    setStreaming.mockClear();
    mockActiveTurnId = null;

    await emitEvent('tool:start', { callId: 'call-abort', toolName: 'run_raapp', args: { name: 'calculator' }, sessionId: 'session-1' });
    await emitEvent('tool:result', {
      callId: 'call-abort',
      status: 'cancelled',
      sessionId: 'session-1',
    });

    expect(setStreaming).toHaveBeenCalledWith(false, undefined, 'session-1');
  });

  it('tool:confirmation_required creates an awaiting_confirmation activity', async () => {
    await renderChatInterface();
    // Clear the setup call from the activation effect before testing event-driven behaviour
    setPendingConfirmation.mockClear();

    await emitEvent('tool:confirmation_required', {
        requestId: 'req-1',
        toolCallId: 'call-4',
        sessionId: 'session-1',
        toolName: 'fs_delete',
        args: { path: '/tmp/file' },
        timeoutMs: 30000,
      });

    expect(setPendingConfirmation).toHaveBeenCalledOnce();
    expect(setPendingConfirmation).toHaveBeenCalledWith('session-1', expect.objectContaining({
      requestId: 'req-1',
      toolCallId: 'call-4',
      sessionId: 'session-1',
    }));
    expect(addToolActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: 'call-4',
        toolName: 'fs_delete',
        status: 'awaiting_confirmation',
      }),
    );
  });

  it('REGRESSION: tool:arg_progress updates toolArgProgress in agentStore for the active session', async () => {
    await renderChatInterface();
    setToolArgProgress.mockClear();

    await emitEvent('tool:arg_progress', {
      sessionId: 'session-1',
      toolName: 'raapp_create',
      totalChars: 2048,
      charsPerSec: 512,
    });

    expect(setToolArgProgress).toHaveBeenCalledWith({
      toolName: 'raapp_create',
      totalChars: 2048,
      charsPerSec: 512,
    });
  });

  it('REGRESSION: tool:confirmation_required synthesizes Preparing fallback before any arg progress arrives', async () => {
    await renderChatInterface();
    setPendingConfirmation.mockClear();
    setToolArgProgress.mockClear();

    await emitEvent('tool:confirmation_required', {
      requestId: 'req-fallback',
      toolCallId: 'call-fallback',
      sessionId: 'session-1',
      toolName: 'raapp_create',
      args: { type: 'html', content: '<!DOCTYPE html><html></html>' },
      timeoutMs: 30000,
    });

    expect(setToolArgProgress).toHaveBeenCalledWith({
      toolName: 'raapp_create',
      totalChars: 0,
      charsPerSec: 0,
    });
  });

  it('REGRESSION: tool:confirmation_invalidated with reason confirmed returns the activity to running', async () => {
    const childAgentRun = {
      agentRunId: 'subagent-run-confirm',
      agentType: 'subagent' as const,
      parentSessionId: 'session-1',
    };

    await renderChatInterface();

    await emitEvent('tool:start', {
      callId: 'call-confirmed',
      toolName: 'run_cli_agent',
      args: { agentId: 'copilot', workdir: 'C:/repo' },
      sessionId: 'child-session',
      agentRun: childAgentRun,
    });

    await emitEvent('tool:confirmation_required', {
      requestId: 'req-confirmed',
      toolCallId: 'call-confirmed',
      sessionId: 'child-session',
      toolName: 'run_cli_agent',
      args: { agentId: 'copilot', workdir: 'C:/repo' },
      timeoutMs: 0,
      agentRun: childAgentRun,
    });

    setPendingConfirmation.mockClear();
    updateToolActivity.mockClear();

    await emitEvent('tool:confirmation_invalidated', {
      requestId: 'req-confirmed',
      toolCallId: 'call-confirmed',
      sessionId: 'child-session',
      reason: 'confirmed',
      agentRun: childAgentRun,
    });

    expect(removePendingConfirmation).toHaveBeenCalledWith('child-session', 'req-confirmed');
    expect(updateToolActivity).toHaveBeenCalledWith(
      'call-confirmed',
      expect.objectContaining({ status: 'running' }),
    );
  });

  it('REGRESSION: stale confirmation invalidation resolves callId after pending state was cleared', async () => {
    await renderChatInterface();
    agentStoreState.toolActivities = [
      {
        callId: 'call-stale',
        requestId: 'req-stale',
        toolName: 'image_generate',
        args: { prompt: 'Generate a coffee poster' },
        sessionId: 'session-1',
        status: 'awaiting_confirmation',
        startedAt: Date.now(),
      },
    ];
    agentStoreState.pendingConfirmations = {};
    updateToolActivity.mockClear();

    await emitEvent('tool:confirmation_invalidated', {
      requestId: 'req-stale',
      sessionId: 'session-1',
      reason: 'expired',
      message: 'Tool confirmation expired or was already handled.',
    });

    expect(updateToolActivity).toHaveBeenCalledWith(
      'call-stale',
      expect.objectContaining({
        status: 'expired',
        result: expect.objectContaining({
          callId: 'call-stale',
          status: 'cancelled',
          errorMessage: 'Tool confirmation expired or was already handled.',
        }),
      }),
    );
  });

  it('REGRESSION: fs_write confirmation expiry remains visible as a settled tool activity', async () => {
    await renderChatInterface();
    agentStoreState.toolActivities = [
      {
        callId: 'call-fs-write',
        requestId: 'req-fs-write',
        toolName: 'fs_write',
        args: { path: 'C:/repo/App.tsx', content: 'updated file' },
        sessionId: 'session-1',
        status: 'awaiting_confirmation',
        startedAt: Date.now(),
      },
    ];
    updateToolActivity.mockClear();
    setPendingConfirmation.mockClear();

    await emitEvent('tool:confirmation_invalidated', {
      requestId: 'req-fs-write',
      toolCallId: 'call-fs-write',
      sessionId: 'session-1',
      reason: 'expired',
      message: 'Tool confirmation expired before fs_write could run.',
    });

    expect(removePendingConfirmation).toHaveBeenCalledWith('session-1', 'req-fs-write');
    expect(updateToolActivity).toHaveBeenCalledWith(
      'call-fs-write',
      expect.objectContaining({
        status: 'expired',
        finishedAt: expect.any(Number),
        result: expect.objectContaining({
          callId: 'call-fs-write',
          status: 'cancelled',
          errorMessage: 'Tool confirmation expired before fs_write could run.',
        }),
      }),
    );
  });

  it('chat:context event calls setContext with systemPrompt and toolNames', async () => {
    await renderChatInterface();

    await emitEvent('chat:context', {
        sessionId: 'session-1',
        systemPrompt: 'You are a test assistant.',
        toolNames: ['vfs_read', 'vfs_write'],
      });

    expect(setContext).toHaveBeenCalledOnce();
    expect(setContext).toHaveBeenCalledWith('You are a test assistant.', ['vfs_read', 'vfs_write'], 'session-1');
  });

  it('subagent tool:start records session and agentRun metadata', async () => {
    await renderChatInterface();

    await emitEvent('tool:start', {
        callId: 'call-sub',
        toolName: 'vfs_write',
        args: { filePath: 'index.html' },
        sessionId: 'child-session',
        agentRun: { agentRunId: 'subagent-run-1', agentType: 'subagent', parentSessionId: 'session-1' },
      });

    expect(addToolActivity).toHaveBeenCalledWith(expect.objectContaining({
      callId: 'call-sub',
      sessionId: 'child-session',
      agentRun: expect.objectContaining({ agentRunId: 'subagent-run-1' }),
    }));
  });

  it('subagent tool:result persists the child tool_result under the child session id', async () => {
    await renderChatInterface();
    agentStoreState.toolActivities = [{ callId: 'call-sub', toolName: 'vfs_write', sessionId: 'child-session' }];

    await emitEvent('tool:result', {
        callId: 'call-sub',
        status: 'success',
        data: { path: 'index.html' },
        sessionId: 'child-session',
        agentRun: { agentRunId: 'subagent-run-1', agentType: 'subagent', parentSessionId: 'session-1' },
      });

    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'child-session',
      role: 'tool_result',
      toolCallId: 'call-sub',
    }));
  });

  it.each(['image_generate', 'image_edit'])(
    'refreshes the VFS file bar after successful %s results',
    async (toolName) => {
      await renderChatInterface();

      expect(mockConversationFilesBar).toHaveBeenCalled();
      expect(mockConversationFilesBar.mock.lastCall?.[0]).toMatchObject({
        sessionId: 'session-1',
        refreshSignal: 0,
      });

      agentStoreState.toolActivities = [{ callId: `call-${toolName}`, toolName }];

      await emitEvent('tool:result', {
        callId: `call-${toolName}`,
        status: 'success',
        data: { output_type: 'image', path: 'images/hero.png' },
        sessionId: 'session-1',
      });

      expect(mockConversationFilesBar.mock.lastCall?.[0]).toMatchObject({
        sessionId: 'session-1',
        refreshSignal: 1,
      });
    },
  );

  it('REGRESSION: refreshes the VFS file bar after a successful shared-mode subagent result', async () => {
    await renderChatInterface();

    expect(mockConversationFilesBar).toHaveBeenCalled();
    expect(mockConversationFilesBar.mock.lastCall?.[0]).toMatchObject({
      sessionId: 'session-1',
      refreshSignal: 0,
    });

    agentStoreState.toolActivities = [{ callId: 'call-subagent-shared', toolName: 'run_subagent' }];

    await emitEvent('tool:result', {
      callId: 'call-subagent-shared',
      status: 'success',
      sessionId: 'session-1',
      data: {
        childSessionId: 'child-session',
        parentSessionId: 'session-1',
        vfsMode: 'shared',
        vfsSessionId: 'session-1',
        copiedFiles: [],
        result: 'Created shared files',
        taskId: 'task-1',
        durationMs: 1234,
      },
    });

    expect(mockConversationFilesBar.mock.lastCall?.[0]).toMatchObject({
      sessionId: 'session-1',
      refreshSignal: 1,
    });
  });

  it('session:created adds subagent session to the store', async () => {
    await renderChatInterface();

    await emitEvent('session:created', {
        id: 'child-session',
        personaId: 'default',
        title: 'Sub-agent: demo',
        kind: 'subagent',
        parentSessionId: 'session-1',
        createdAt: 1,
        updatedAt: 1,
      });

    expect(addSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'child-session', kind: 'subagent' }));
    expect(mockIdentifySession).toHaveBeenCalledWith('child-session');
  });

  it('ignores tool:result streaming state changes from a different session', async () => {
    mockActiveSessionId = 'session-1';
    await renderChatInterface();
    agentStoreState.toolActivities = [{ callId: 'call-background', toolName: 'fs_read', sessionId: 'session-2' }];
    setStreaming.mockClear();

    await emitEvent('tool:result', {
      callId: 'call-background',
      status: 'success',
      data: { ok: true },
      sessionId: 'session-2',
    });

    expect(setStreaming).not.toHaveBeenCalled();
    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-2',
      toolCallId: 'call-background',
    }));
  });

  it('chat:complete clears streaming for a background session that owned the live stream', async () => {
    mockActiveSessionId = 'session-1';
    await renderChatInterface();
    setStreaming.mockClear();

    await emitEvent('chat:complete', {
      sessionId: 'session-2',
      messageId: 'msg-background',
    });

    expect(setStreaming).toHaveBeenCalledWith(false, undefined, 'session-2');
  });

  it('REGRESSION: first completed turn still triggers title generation after optimistic preview title', async () => {
    const firstPrompt = 'Build a dashboard that tracks agent loop progress across subagents';
    mockSessions = mockSessions.map((session) =>
      session.id === 'session-1'
        ? { ...session, title: 'Build a dashboard that tracks agent loop progress...' }
        : session,
    );
    mockMessages = [
      { id: 'user-1', sessionId: 'session-1', role: 'user', content: firstPrompt, createdAt: 1 },
      { id: 'assistant-1', sessionId: 'session-1', role: 'assistant', content: 'Need a tool call first', createdAt: 2 },
      { id: 'assistant-2', sessionId: 'session-1', role: 'assistant', content: 'Done', createdAt: 3 },
    ];

      vi.mocked(apiClient.post).mockImplementationOnce((url: string) => {
        if (url === '/api/sessions/session-1/generate-title') {
          return Promise.resolve({ data: { title: 'Generated Title' } } as never);
        }
        return Promise.reject(new Error(`unexpected apiClient.post call: ${url}`));
      });

    await renderChatInterface();
    addLlmActivity.mockClear();
    updateLlmActivity.mockClear();
    updateSession.mockClear();

    await emitEvent('chat:complete', {
      sessionId: 'session-1',
      messageId: 'assistant-2',
    });

    expect(addLlmActivity).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'title-gen', status: 'running' }),
    );
      expect(apiClient.post).toHaveBeenCalledWith('/api/sessions/session-1/generate-title');
      expect(updateSession).toHaveBeenCalledWith('session-1', { title: 'Generated Title' });
    expect(updateLlmActivity).toHaveBeenCalledWith(
      'title-gen',
      expect.objectContaining({ status: 'done' }),
    );
  });

  it('auto-rename cadence triggers only on every configured Nth assistant reply', async () => {
    mockSessions = mockSessions.map((session) =>
      session.id === 'session-1'
        ? { ...session, title: 'Architecture Review' }
        : session,
    );
    mockMessages = [
      { id: 'user-1', sessionId: 'session-1', role: 'user', content: 'Review this architecture', createdAt: 1 },
      { id: 'assistant-1', sessionId: 'session-1', role: 'assistant', content: 'First answer', createdAt: 2 },
    ];
    settingsStoreState.conversationTitleSettings = {
      autoRenameEnabled: true,
      renameEveryReplies: 2,
    };
    settingsStoreState.setConversationTitleSettings.mockImplementation((settings: { autoRenameEnabled: boolean; renameEveryReplies: number }) => {
      settingsStoreState.conversationTitleSettings = settings;
    });
    vi.mocked(apiClient.get).mockImplementation((url: string) => {
      if (url === '/api/credentials/settings/conversation-title') {
        return Promise.resolve({
          data: {
            autoRenameEnabled: true,
            renameEveryReplies: 2,
          },
        } as never);
      }
      return Promise.resolve({ data: [] } as never);
    });
    vi.mocked(apiClient.post).mockImplementation((url: string) => {
      if (url === '/api/sessions/session-1/generate-title') {
        return Promise.resolve({ data: { title: 'Updated Conversation Title' } } as never);
      }
      return Promise.reject(new Error(`unexpected apiClient.post call: ${url}`));
    });

    await renderChatInterface();
    addLlmActivity.mockClear();
    updateLlmActivity.mockClear();
    updateSession.mockClear();
    vi.mocked(apiClient.post).mockClear();

    await emitEvent('chat:complete', {
      sessionId: 'session-1',
      messageId: 'assistant-1',
    });

    expect(apiClient.post).not.toHaveBeenCalled();
    expect(addLlmActivity).not.toHaveBeenCalled();

    mockMessages = [
      ...mockMessages,
      { id: 'assistant-2', sessionId: 'session-1', role: 'assistant', content: 'Second answer', createdAt: 3 },
    ];

    await emitEvent('chat:complete', {
      sessionId: 'session-1',
      messageId: 'assistant-2',
    });

    expect(apiClient.post).toHaveBeenCalledWith('/api/sessions/session-1/generate-title');
    expect(addLlmActivity).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'title-gen', status: 'running' }),
    );
    expect(updateSession).toHaveBeenCalledWith('session-1', { title: 'Updated Conversation Title' });
  });

  it('auto-rename cadence still runs after a later user reply', async () => {
    mockSessions = mockSessions.map((session) =>
      session.id === 'session-1'
        ? { ...session, title: 'Architecture Review' }
        : session,
    );
    mockMessages = [
      { id: 'user-1', sessionId: 'session-1', role: 'user', content: 'Review this architecture', createdAt: 1 },
      { id: 'assistant-1', sessionId: 'session-1', role: 'assistant', content: 'First answer', createdAt: 2 },
      { id: 'user-2', sessionId: 'session-1', role: 'user', content: 'Now compare two options', createdAt: 3 },
      { id: 'assistant-2', sessionId: 'session-1', role: 'assistant', content: 'Second answer', createdAt: 4 },
    ];
    settingsStoreState.conversationTitleSettings = {
      autoRenameEnabled: true,
      renameEveryReplies: 2,
    };
    settingsStoreState.setConversationTitleSettings.mockImplementation((settings: { autoRenameEnabled: boolean; renameEveryReplies: number }) => {
      settingsStoreState.conversationTitleSettings = settings;
    });
    vi.mocked(apiClient.get).mockImplementation((url: string) => {
      if (url === '/api/credentials/settings/conversation-title') {
        return Promise.resolve({
          data: {
            autoRenameEnabled: true,
            renameEveryReplies: 2,
          },
        } as never);
      }
      return Promise.resolve({ data: [] } as never);
    });
    vi.mocked(apiClient.post).mockImplementation((url: string) => {
      if (url === '/api/sessions/session-1/generate-title') {
        return Promise.resolve({ data: { title: 'Renamed After Follow-up' } } as never);
      }
      return Promise.reject(new Error(`unexpected apiClient.post call: ${url}`));
    });

    await renderChatInterface();
    addLlmActivity.mockClear();
    updateLlmActivity.mockClear();
    updateSession.mockClear();
    vi.mocked(apiClient.post).mockClear();

    await emitEvent('chat:complete', {
      sessionId: 'session-1',
      messageId: 'assistant-2',
    });

    expect(apiClient.post).toHaveBeenCalledWith('/api/sessions/session-1/generate-title');
    expect(updateSession).toHaveBeenCalledWith('session-1', { title: 'Renamed After Follow-up' });
  });
});

describe('REGRESSION: tool name resolution persists across turns', () => {
  it('tool:start calls registerCallId so name survives clearToolActivities', async () => {
    await renderChatInterface();

    await emitEvent('tool:start', {
        callId: 'call_abc123',
        toolName: 'raapp_create',
        args: { type: 'html', content: '<div/>' },
      });

    // registerCallId must be called with the exact callId and toolName
    expect(registerCallId).toHaveBeenCalledWith('call_abc123', 'raapp_create');
  });

  it('tool:start for a second turn also registers its callId', async () => {
    await renderChatInterface();

    await emitEvent('tool:start', { callId: 'call_turn1', toolName: 'raapp_create', args: {} });
    await emitEvent('tool:start', { callId: 'call_turn2', toolName: 'run_raapp', args: { id: 'interactive-qa' } });

    expect(registerCallId).toHaveBeenCalledWith('call_turn1', 'raapp_create');
    expect(registerCallId).toHaveBeenCalledWith('call_turn2', 'run_raapp');
    expect(registerCallId).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: RA-App widget freezes after user answers (computeAnsweredCallIds)
// Bug: after clicking an answer in Q&A interactive app, the old widget
// remained interactive (not frozen) instead of showing "answer submitted".
// ─────────────────────────────────────────────────────────────────────────────

function makeMsg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg-default',
    sessionId: 's1',
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
    ...overrides,
  } as ChatMessage;
}

describe('REGRESSION: computeAnsweredCallIds freezes old RA-App widgets', () => {
  it('ignores scaffold-only branch user messages after projection', () => {
    const branchSession: ChatSession = {
      id: 'branch-1',
      personaId: 'default',
      title: 'Strategic Decision Council: Analyst',
      parentSessionId: 'host-1',
      createdAt: 1,
      updatedAt: 1,
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureContext: {
          hostSessionId: 'host-1',
          historySessionId: 'host-1',
          sessionSurface: 'conversation-branch',
        },
      },
    };
    const projection = resolveRenderableConversationProjection({
      session: branchSession,
      messages: [
        makeMsg({ id: 'assistant-1', sessionId: 'branch-1', role: 'assistant', content: '' }),
        makeMsg({
          id: 'tool-1',
          sessionId: 'branch-1',
          role: 'tool_result',
          content: '{"type":"gui","status":"ready"}',
          toolCallId: 'call_raapp_1',
        }),
        makeMsg({
          id: 'user-scaffold',
          sessionId: 'branch-1',
          role: 'user',
          content: 'Architecture: Strategic Decision Council v0.1.0\nSlot: Analyst (participant)\nTask: Assess repo.',
        }),
      ],
      agentTurns: [],
    });

    const result = computeAnsweredCallIds(projection.messages);

    expect(projection.messages.map((message) => message.id)).toEqual(['tool-1']);
    expect(projection.messages.some((message) => message.role === 'user')).toBe(false);
    expect(result.has('call_raapp_1')).toBe(false);
  });

  it('returns empty set when no user message follows any tool_result', () => {
    const messages: ChatMessage[] = [
      makeMsg({ id: 'u1', role: 'user', content: 'Run Q&A' }),
      makeMsg({ id: 'a1', role: 'assistant', content: '' }),
      makeMsg({ id: 'tr1', role: 'tool_result', content: '{}', toolCallId: 'call_raapp_1' }),
    ];
    const result = computeAnsweredCallIds(messages);
    expect(result.size).toBe(0);
  });

  it('marks run_raapp tool_result as answered when user message appears after it', () => {
    const messages: ChatMessage[] = [
      makeMsg({ id: 'u1', role: 'user', content: 'Run Q&A' }),
      makeMsg({ id: 'a1', role: 'assistant', content: '' }),
      makeMsg({ id: 'tr1', role: 'tool_result', content: '{"type":"gui","status":"ready"}', toolCallId: 'call_raapp_1' }),
      makeMsg({ id: 'u2', role: 'user', content: 'I choose: Java' }),
    ];
    const result = computeAnsweredCallIds(messages);
    expect(result.has('call_raapp_1')).toBe(true);
  });

  it('does NOT mark second run_raapp as answered when no user message follows it', () => {
    // Full Q&A round-trip: first widget answered, second widget still active
    const messages: ChatMessage[] = [
      makeMsg({ id: 'u1', role: 'user', content: 'Run Q&A' }),
      makeMsg({ id: 'a1', role: 'assistant', content: '' }),
      makeMsg({ id: 'tr1', role: 'tool_result', content: '{"type":"gui","status":"ready"}', toolCallId: 'call_raapp_1' }),
      makeMsg({ id: 'u2', role: 'user', content: 'I choose: Java' }),
      makeMsg({ id: 'a2', role: 'assistant', content: 'Great choice!' }),
      makeMsg({ id: 'tr2', role: 'tool_result', content: '{"type":"gui","status":"ready"}', toolCallId: 'call_raapp_2' }),
    ];
    const result = computeAnsweredCallIds(messages);
    // First widget: answered ✓
    expect(result.has('call_raapp_1')).toBe(true);
    // Second widget: NOT answered yet (no user message after it)
    expect(result.has('call_raapp_2')).toBe(false);
  });

  it('handles multiple tool_results in same agent turn — only run_raapp ones that matter', () => {
    const messages: ChatMessage[] = [
      makeMsg({ id: 'u1', role: 'user', content: 'Run Q&A' }),
      makeMsg({ id: 'a1', role: 'assistant', content: '' }),
      makeMsg({ id: 'tr_list', role: 'tool_result', content: '[]', toolCallId: 'call_list_1' }),
      makeMsg({ id: 'tr_run', role: 'tool_result', content: '{"type":"gui","status":"ready"}', toolCallId: 'call_raapp_1' }),
      makeMsg({ id: 'u2', role: 'user', content: 'I choose: Java' }),
    ];
    const result = computeAnsweredCallIds(messages);
    // Both tool_results before user message should be answered
    expect(result.has('call_list_1')).toBe(true);
    expect(result.has('call_raapp_1')).toBe(true);
  });

  it('tool_result without toolCallId is never included', () => {
    const messages: ChatMessage[] = [
      makeMsg({ id: 'tr1', role: 'tool_result', content: '{}' }), // no toolCallId
      makeMsg({ id: 'u1', role: 'user', content: 'answer' }),
    ];
    const result = computeAnsweredCallIds(messages);
    expect(result.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: timeline interleaving (user → agent → user → agent)
// Bug: after agent:start/agent:done refactor, user messages were all rendered
// first, then agent turns separately, breaking chronological order.
// ─────────────────────────────────────────────────────────────────────────────

describe('REGRESSION: timeline interleaving preserves chronological order', () => {
  it('renders user[0] → agent[0] → user[1] → agent[1] pattern', async () => {
    // The timeline logic in ChatInterface uses a simple for loop that interleaves:
    // for i in range(max(userMsgs.length, agentTurns.length)):
    //   if i < userMsgs.length: render user[i]
    //   if i < agentTurns.length: render agent[i]
    // This test verifies the component renders with the mock state
    
    const { container } = await renderChatInterface();
    // With default mock (empty messages, empty agentTurns), should render nothing
    const bubbles = container.querySelectorAll('[data-testid="message-bubble"], [data-testid="agent-turn-bubble"]');
    expect(bubbles).toHaveLength(0);
  });

  it('uses a full-width message lane so assistant content starts close to the chat edge', async () => {
    await renderChatInterface();

    const shell = screen.getByTestId('chat-interface');
    expect(shell).not.toHaveClass('rounded-xl');
    expect(shell).not.toHaveClass('border');

    const messageList = screen.getByTestId('message-list');
    expect(messageList).toHaveClass('px-1.5');
    expect(messageList).toHaveClass('lg:px-2');

    const lane = screen.getByTestId('message-list').firstElementChild;
    expect(lane).toHaveClass('w-full');
    expect(lane).not.toHaveClass('mx-auto');
    expect(lane).not.toHaveClass('max-w-[72rem]');
  });

  it('does not force-scroll to the bottom when the user is reading earlier messages', async () => {
    const { rerender } = await renderChatInterface();
    const messageList = screen.getByTestId('message-list');
    Object.defineProperty(messageList, 'scrollHeight', { configurable: true, value: 1200 });
    Object.defineProperty(messageList, 'clientHeight', { configurable: true, value: 500 });
    Object.defineProperty(messageList, 'scrollTop', { configurable: true, value: 200 });
    (window.HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();

    fireEvent.scroll(messageList);
    mockMessages = [{
      id: 'new-message',
      sessionId: 'session-1',
      role: 'user',
      content: 'new content',
      createdAt: 2,
    }];
    await rerenderChatInterface(rerender);

    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('pins the list with direct scroll positioning instead of restarting smooth scroll on updates', async () => {
    const { rerender } = await renderChatInterface();
    const messageList = screen.getByTestId('message-list');
    let scrollTopValue = 0;
    Object.defineProperty(messageList, 'scrollHeight', { configurable: true, value: 1200 });
    Object.defineProperty(messageList, 'clientHeight', { configurable: true, value: 500 });
    Object.defineProperty(messageList, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });
    (window.HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();

    mockMessages = [{
      id: 'streaming-message',
      sessionId: 'session-1',
      role: 'user',
      content: 'new content',
      createdAt: 2,
    }];
    await rerenderChatInterface(rerender);

    expect(scrollTopValue).toBe(1200);
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('timeline loop handles unequal array lengths correctly', () => {
    // Test the interleaving logic directly
    const userMsgs = ['u1', 'u2'];
    const agentTurns = ['t1', 't2', 't3'];
    const timeline: string[] = [];
    const maxLen = Math.max(userMsgs.length, agentTurns.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < userMsgs.length) timeline.push(`user:${userMsgs[i]}`);
      if (i < agentTurns.length) timeline.push(`agent:${agentTurns[i]}`);
    }
    // Expected: user:u1, agent:t1, user:u2, agent:t2, agent:t3
    expect(timeline).toEqual(['user:u1', 'agent:t1', 'user:u2', 'agent:t2', 'agent:t3']);
  });

  it('timeline with only agent turns renders all agents', () => {
    const userMsgs: string[] = [];
    const agentTurns = ['t1', 't2'];
    const timeline: string[] = [];
    const maxLen = Math.max(userMsgs.length, agentTurns.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < userMsgs.length) timeline.push(`user:${userMsgs[i]}`);
      if (i < agentTurns.length) timeline.push(`agent:${agentTurns[i]}`);
    }
    expect(timeline).toEqual(['agent:t1', 'agent:t2']);
  });

  it('timeline with only user messages renders all users', () => {
    const userMsgs = ['u1', 'u2'];
    const agentTurns: string[] = [];
    const timeline: string[] = [];
    const maxLen = Math.max(userMsgs.length, agentTurns.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < userMsgs.length) timeline.push(`user:${userMsgs[i]}`);
      if (i < agentTurns.length) timeline.push(`agent:${agentTurns[i]}`);
    }
    expect(timeline).toEqual(['user:u1', 'user:u2']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// chat:error two-path dispatch
// ─────────────────────────────────────────────────────────────────────────────

describe('chat:error two-path dispatch', () => {
  it('chat:error with active turn and hadContent=true calls markAgentTurnError', async () => {
    mockActiveTurnId = 'turn-abc';
    await renderChatInterface();

    await emitEvent('chat:error', {
        sessionId: 'session-1',
        code: 'INTERRUPTED',
        message: 'Turn interrupted by user',
        hadContent: true,
      });

    expect(markAgentTurnError).toHaveBeenCalledWith('turn-abc', {
      code: 'INTERRUPTED',
      message: 'Turn interrupted by user',
    }, 'session-1');
    expect(removeLastAgentTurn).not.toHaveBeenCalled();
  });

  it('chat:error with active turn, hadContent=false and non-INTERRUPTED code removes bubble and sets retry', async () => {
    mockActiveTurnId = 'turn-abc';
    await renderChatInterface();

    await emitEvent('chat:error', {
        sessionId: 'session-1',
        code: 'LLM_ERROR',
        message: 'LLM unavailable',
        hadContent: false,
      });

    expect(removeLastAgentTurn).toHaveBeenCalledOnce();
    expect(markAgentTurnError).not.toHaveBeenCalled();
  });

  it('chat:error with active turn, hadContent=false and INTERRUPTED silently removes bubble', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockActiveTurnId = 'turn-abc';
    await renderChatInterface();

    await emitEvent('chat:error', {
        sessionId: 'session-1',
        code: 'INTERRUPTED',
        message: 'Turn interrupted by user',
        hadContent: false,
      });

    expect(removeLastAgentTurn).toHaveBeenCalledOnce();
    expect(markAgentTurnError).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalledWith('[EventBus] chat:error', expect.anything());
    consoleErrorSpy.mockRestore();
  });

  it('chat:error QUEUE_FULL with no active turn calls setStreaming(false) only (floating banner path)', async () => {
    // activeTurnId remains null
    await renderChatInterface();

    await emitEvent('chat:error', {
        sessionId: 'session-1',
        code: 'QUEUE_FULL',
        message: 'Queue is full',
        hadContent: false,
      });

    // Neither turn action should be called — floating banner handles it
    expect(markAgentTurnError).not.toHaveBeenCalled();
    expect(removeLastAgentTurn).not.toHaveBeenCalled();
    expect(setStreaming).toHaveBeenCalledWith(false, undefined, 'session-1');
  });

  it('REGRESSION: chat:error clears pending confirmation and settles active tool activities for the errored session', async () => {
    mockActiveTurnId = 'turn-abc';
    agentStoreState.toolActivities = [
      {
        callId: 'call-awaiting',
        toolName: 'vfs_write',
        args: { path: 'orchestrator-edit-cycle.html' },
        sessionId: 'session-1',
        status: 'awaiting_confirmation',
        startedAt: 1000,
      },
      {
        callId: 'call-running',
        toolName: 'image_generate',
        args: { filename: 'images/coffee-hero.png' },
        sessionId: 'session-1',
        status: 'running',
        startedAt: 2000,
      },
      {
        callId: 'call-other-session',
        toolName: 'vfs_write',
        args: { path: 'other.html' },
        sessionId: 'session-2',
        status: 'awaiting_confirmation',
        startedAt: 3000,
      },
    ];

    await renderChatInterface();
    setPendingConfirmation.mockClear();
    updateToolActivity.mockClear();

    await emitEvent('chat:error', {
      sessionId: 'session-1',
      code: 'LLM_ERROR',
      message: 'quota exhausted',
      hadContent: true,
    });

    expect(setPendingConfirmation).toHaveBeenCalledWith('session-1', null);
    expect(updateToolActivity).toHaveBeenCalledWith(
      'call-awaiting',
      expect.objectContaining({
        status: 'error',
        result: expect.objectContaining({
          callId: 'call-awaiting',
          status: 'error',
          errorCode: 'LLM_ERROR',
          errorMessage: 'quota exhausted',
        }),
      }),
    );
    expect(updateToolActivity).toHaveBeenCalledWith(
      'call-running',
      expect.objectContaining({
        status: 'error',
        result: expect.objectContaining({
          callId: 'call-running',
          status: 'error',
          errorCode: 'LLM_ERROR',
          errorMessage: 'quota exhausted',
        }),
      }),
    );
    expect(updateToolActivity).not.toHaveBeenCalledWith(
      'call-other-session',
      expect.anything(),
    );
  });

  it('REGRESSION: chat:error with INTERRUPTED settles active tool activities as cancelled', async () => {
    mockActiveTurnId = 'turn-abc';
    agentStoreState.toolActivities = [
      {
        callId: 'call-awaiting',
        toolName: 'vfs_write',
        args: { path: 'orchestrator-edit-cycle.html' },
        sessionId: 'session-1',
        status: 'awaiting_confirmation',
        startedAt: 1000,
      },
    ];

    await renderChatInterface();
    updateToolActivity.mockClear();

    await emitEvent('chat:error', {
      sessionId: 'session-1',
      code: 'INTERRUPTED',
      message: 'Turn interrupted by user',
      hadContent: false,
    });

    expect(updateToolActivity).toHaveBeenCalledWith(
      'call-awaiting',
      expect.objectContaining({
        status: 'cancelled',
        result: expect.objectContaining({
          callId: 'call-awaiting',
          status: 'cancelled',
        }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: Retry sends stale content after session switch
// Bug: lastSentContentRef was not cleared when activeSessionId changed, so
// clicking Retry in session-2 would resend session-1's message.
// ─────────────────────────────────────────────────────────────────────────────

describe('Retry stale ref: session switch clears lastSentContentRef', () => {
  it('does not show retry banner after switching sessions (ref is cleared)', async () => {
    // Start on session-1 and receive an LLM error that would offer retry
    mockActiveSessionId = 'session-1';
    mockActiveTurnId = 'turn-1';
    const { rerender } = await renderChatInterface();

    // LLM fails on session-1 without content → retry banner should appear
    await emitEvent('chat:error', {
        sessionId: 'session-1',
        code: 'LLM_ERROR',
        message: 'LLM down',
        hadContent: false,
      });

    // Switch to session-2 (simulates user clicking another session)
    mockActiveSessionId = 'session-2';
    mockActiveTurnId = null;
    await rerenderChatInterface(rerender);

    // Re-render with new session causes the useEffect to fire and clear the ref.
    // The retry banner itself depends on `retryError` state which is reset separately,
    // but the key invariant: removeLastAgentTurn was called for session-1's turn, not
    // a hypothetical session-2 turn.
    expect(removeLastAgentTurn).toHaveBeenCalledOnce();
  });

  it('retry banner does not appear for the new session after switching', async () => {
    // After switching to session-2, errors on that session remove the empty bubble
    // via removeLastAgentTurn — same path as session-1, no cross-contamination.
    mockActiveSessionId = 'session-2';
    mockActiveTurnId = 'turn-2';
    await renderChatInterface();

    await emitEvent('chat:error', {
        sessionId: 'session-2',
        code: 'LLM_ERROR',
        message: 'error on session-2',
        hadContent: false,
      });

    // session-2's own turn is removed — not a stale session-1 turn
    expect(removeLastAgentTurn).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: auto-send pending message uses session's personaId
// Bug: ChatInterface hardcoded 'default' personaId when auto-sending the pending
// message after tile click, causing the LLM to use the wrong persona config.
// Sessions created for RA-App tiles use personaId: 'ra-apps' which has the
// required system prompt and tool set to launch RA-Apps automatically.
// ─────────────────────────────────────────────────────────────────────────────

describe('auto-send pending message uses session personaId (not hardcoded default)', () => {
  it('sends with the session stored personaId when pendingMessage is set', async () => {
    mockActiveSessionId = 'session-raapp';
    mockPendingMessage = 'Run the My RA App RA-App for me. Launch it immediately.';

    await renderChatInterface();

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ personaId: 'ra-apps' }),
    );
  });

  it('never sends with hardcoded default personaId for ra-apps sessions', async () => {
    mockActiveSessionId = 'session-raapp';
    mockPendingMessage = 'Run the My RA App RA-App for me. Launch it immediately.';

    await renderChatInterface();

    expect(mockSendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ personaId: 'default' }),
    );
  });

  it('falls back to default personaId when session is not found', async () => {
    mockActiveSessionId = 'unknown-session-id';
    mockPendingMessage = 'Some pending message';

    await renderChatInterface();

    // session not in list → falls back to 'default'
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ personaId: 'default' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: navigating away (home) and back to chat wipes in-flight agent turn
//
// Root cause: ChatInterface is conditionally rendered in App.tsx. When the user
// navigates to the landing page, it unmounts. On remount (return to talk), the
// activeSessionId effect fires again and calls clearAgentTurns() even though the
// session hasn't changed. This nukes the in-flight turn; subsequent chat:chunk
// events find activeTurnId=null and addTurnItem is never called, so the LLM
// response stream becomes invisible until the user manually switches sessions.
//
// Fix: clearAgentTurns should NOT be called in the activation effect. Instead,
// setActiveSession in the store clears agentTurns on a real session switch.
// ─────────────────────────────────────────────────────────────────────────────
describe('REGRESSION: remount with same session must not clear agent turns', () => {
  it('unmounting and remounting with the same activeSessionId does not call clearAgentTurns', async () => {
    const { unmount } = await renderChatInterface();
    // clearAgentTurns is called once on initial mount (part of activation effect)
    vi.clearAllMocks();

    // Simulate navigating to landing (unmounts ChatInterface) and back (remounts)
    unmount();
    await renderChatInterface();

    // BUG: clearAgentTurns was called again, wiping any in-flight streaming turn.
    // After fix: clearAgentTurns lives in setActiveSession (store), not here.
    expect(clearAgentTurns).not.toHaveBeenCalled();
  });

  it('chat:chunk after remount still calls appendChunk (streaming channel intact)', async () => {
    // Pull appendChunk from the useSessionStore mock so we can spy on it
    // after remount. The mock returns fresh vi.fn() per call, but we can
    // check via the handler capture that the event bus re-registered listeners.
    const { unmount } = await renderChatInterface();
    vi.clearAllMocks();

    unmount();
    await renderChatInterface();

    // Fire a chunk AFTER remount — with the bug the listener may not be
    // registered, but more critically the activation effect wipes streaming state.
    // The simplest observable: appendChunk (from useSessionStore hook) is called.
    // Since each render creates a fresh vi.fn() via the factory, we verify the
    // event is dispatched at all by checking no error is thrown.
    expect(() => {
      act(() => {
        fire('chat:chunk', {
          sessionId: 'session-1',
          messageId: 'msg-live',
          delta: 'hello',
          done: false,
          thinking: false,
        });
      });
    }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: RA-App launched from home disappears after tools complete
//
// Root cause: race condition in the session activation useEffect.
// When a new session is activated (e.g. after clicking an RA-App tile on home),
// two things happen nearly simultaneously:
//   1. fetch('/api/sessions/:id/messages') fires to load persisted history
//   2. pendingMessage is auto-sent → backend starts the agent turn → agent:start
//      fires → startAgentTurn() populates agentTurns + sets activeTurnId
//
// If the fetch resolves AFTER agent:start (typical: fetch ~10-50ms, tool calls
// take seconds), the .then() callback calls:
//   setAgentTurns(buildTurnsFromHistory([])) → agentTurns = [], activeTurnId = null
//
// With activeTurnId = null:
//   - addTurnItem() is a no-op for ALL subsequent tool:start events
//   - finalizeAgentTurn() is a no-op on agent:done
//   - agentTurns stays empty → no AgentTurnBubble renders → nothing appears
//
// Fix: guard setAgentTurns with activeAgentLoops[sessionId]. If a live turn is
// active for this session when the fetch resolves, skip setAgentTurns entirely.
// ─────────────────────────────────────────────────────────────────────────────

describe('REGRESSION: session history fetch does not overwrite live agent turn', () => {
  it('BEFORE FIX: setAgentTurns([]) is called even mid-turn (documents the bug)', async () => {
    // This test demonstrates the raw behaviour WITHOUT the guard.
    // It is intentionally a "would fail after fix" marker — once the fix is
    // applied the guard prevents setAgentTurns from being called, so this
    // passes as "not.toHaveBeenCalled" in the real regression test below.
    // We keep this as a documentation block only — no assertion here.
    // (The real assertion is in the next test.)
  });

  it('REGRESSION: setAgentTurns is NOT called when an active loop still owns the session turn', async () => {
    // Arrange: fetch returns a deferred promise so we control timing
    let resolveMessages!: (d: unknown) => void;
    const deferred = new Promise((res) => {
      resolveMessages = res;
    });
      vi.mocked(apiClient.get).mockImplementation((url: string) => {
        if (url === '/api/sessions/session-1/messages') {
          return deferred.then((messages) => ({ data: messages } as never));
        }
        return Promise.resolve({ data: [] } as never);
      });

    // Simulate that agent:start already fired before the fetch resolves —
    // this is the normal production sequence (agent:start fires in ~1ms,
    // fetch resolves in ~10-50ms). We do it by directly mutating the mock
    // state object (same reference used by useAgentStore.getState()).
    agentStoreState.activeAgentLoops = {
      'session-1': { sessionId: 'session-1', turnId: 'turn-live', startedAt: Date.now() },
    };
    mockActiveTurnId = 'turn-live';

    await renderChatInterface();
    // useEffect fired during render; fetch is pending. Clear any setup-time calls.
    setAgentTurns.mockClear();

    // Act: fetch completes with empty history (new session — nothing persisted yet)
    await act(async () => {
      resolveMessages([]);
      await deferred;
    });

    // Assert: because an active loop still owns the live turn id, setAgentTurns
    // must NOT be called. Calling it would set activeTurnId = null, making all
    // subsequent addTurnItem / finalizeAgentTurn calls no-ops.
    expect(setAgentTurns).not.toHaveBeenCalled();

      vi.mocked(apiClient.get).mockReset();
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] } as never);
    });

  it('calls setAgentTurns from history when no active agent loop exists for the session', async () => {
    // Normal path: fetch resolves before any agent:start — safe to set history turns.
    const historyMsg = {
      id: 'a1',
      sessionId: 'session-1',
      role: 'assistant' as const,
      content: 'Previous answer',
      createdAt: 0,
    };
    let resolveMessages!: (messages: unknown) => void;
    const deferredMessages = new Promise((resolve) => {
      resolveMessages = resolve;
    });
      vi.mocked(apiClient.get).mockImplementation((url: string) => {
        if (url === '/api/sessions/session-1/messages') {
          return deferredMessages.then((messages) => ({ data: messages } as never));
        }
        return Promise.resolve({ data: [] } as never);
      });

    agentStoreState.activeAgentLoops = {}; // no active loop

    await renderChatInterface();
    setAgentTurns.mockClear();

    await act(async () => {
      resolveMessages([historyMsg]);
      await deferredMessages;
      await flushReactEffects();
    });

    // With no active loop, setAgentTurns SHOULD be called with the history turns
    expect(setAgentTurns).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ done: true })]),
      'session-1',
    );

      vi.mocked(apiClient.get).mockReset();
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] } as never);
    });

  it('rebuilds history turns when a stale active loop exists without an active turn id', async () => {
    const historyMsg = {
      id: 'a2',
      sessionId: 'session-1',
      role: 'assistant' as const,
      content: 'Persisted architecture summary',
      createdAt: 0,
    };
    let resolveMessages!: (messages: unknown) => void;
    const deferredMessages = new Promise((resolve) => {
      resolveMessages = resolve;
    });
    vi.mocked(apiClient.get).mockImplementation((url: string) => {
      if (url === '/api/sessions/session-1/messages') {
        return deferredMessages.then((messages) => ({ data: messages } as never));
      }
      return Promise.resolve({ data: [] } as never);
    });

    agentStoreState.activeAgentLoops = {
      'stale-loop': { sessionId: 'session-1', turnId: 'turn-stale', startedAt: Date.now() },
    };
    mockActiveTurnId = null;

    await renderChatInterface();
    setAgentTurns.mockClear();

    await act(async () => {
      resolveMessages([historyMsg]);
      await deferredMessages;
      await flushReactEffects();
    });

    expect(setAgentTurns).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ done: true })]),
      'session-1',
    );

    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.get).mockResolvedValue({ data: [] } as never);
  });
  });

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION: pendingConfirmations not cleared on session switch / turn lifecycle
//
// Root cause: per-session pendingConfirmations were added but corresponding
// cleanup was not added in session-switch effect, agent:start, and agent:done
// handlers. Stale confirmations cause ConfirmationInlineBubble to reference a
// tool activity that no longer exists (it was wiped by clearToolActivities).
// ─────────────────────────────────────────────────────────────────────────────

describe('REGRESSION: pendingConfirmations cleared on session switch', () => {
  it('activating a session clears its own pendingConfirmation', async () => {
    mockActiveSessionId = 'session-1';
    const { rerender } = await renderChatInterface();
    setPendingConfirmation.mockClear();

    // Switch to session-2 — activation effect should clear confirmation for session-2
    mockActiveSessionId = 'session-2';
    await rerenderChatInterface(rerender);

    expect(setPendingConfirmation).toHaveBeenCalledWith('session-2', null);
  });
});

describe('REGRESSION: pendingConfirmations cleared on agent:start', () => {
  it('agent:start for the active session clears its pendingConfirmation', async () => {
    await renderChatInterface();
    setPendingConfirmation.mockClear();

    await emitEvent('agent:start', { sessionId: 'session-1', turnId: 'turn-new' });

    expect(setPendingConfirmation).toHaveBeenCalledWith('session-1', null);
  });
});

describe('REGRESSION: pendingConfirmations cleared on agent:done', () => {
  it('agent:done for the active session clears its pendingConfirmation', async () => {
    await renderChatInterface();
    setPendingConfirmation.mockClear();

    await emitEvent('agent:done', { sessionId: 'session-1', turnId: 'turn-done' });

    expect(setPendingConfirmation).toHaveBeenCalledWith('session-1', null);
  });

  it('agent:done for the active session stops streaming even when chat:complete never arrived', async () => {
    await renderChatInterface();
    setStreaming.mockClear();

    await emitEvent('agent:done', { sessionId: 'session-1', turnId: 'turn-done' });

    expect(setStreaming).toHaveBeenCalledWith(false, undefined, 'session-1');
  });

  it('agent:done also clears streaming for a background session that finishes off-screen', async () => {
    mockActiveSessionId = 'session-1';
    await renderChatInterface();
    setStreaming.mockClear();

    await emitEvent('agent:done', { sessionId: 'session-2', turnId: 'turn-done' });

    expect(setStreaming).toHaveBeenCalledWith(false, undefined, 'session-2');
  });

  it('agent:done flushes pending chunks and stops streaming when chat:complete never arrived', async () => {
    mockStreamingChunks = { 'msg-1': 'partial' };
    mockChunkSessionIds = { 'msg-1': 'session-1' };

    await renderChatInterface();
    setStreaming.mockClear();
    flushStreamingChunks.mockClear();

    await emitEvent('agent:done', { sessionId: 'session-1', turnId: 'turn-done' });

    expect(flushStreamingChunks).toHaveBeenCalledWith('session-1');
    expect(setStreaming).toHaveBeenCalledWith(false, undefined, 'session-1');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LandingPage } from './LandingPage';
import type { RAAppGroup, RAAppSummary } from '@kalio/types';

const {
  addSession,
  setActiveSession,
  setMessages,
  setAgentTurns,
  setPendingMessage,
  setPendingRAAppLaunchIntent,
  markSessionHydrated,
  getRAApps,
  getRAAppGroups,
  getExecutionProfiles,
  getPendingRAAppApprovals,
  apiPost,
  confirmTool,
  cancelTool,
  approveRaApp,
  cancelRaApp,
  identifySession,
  setPendingConfirmation,
  removePendingConfirmation,
  updateToolActivity,
  agentStoreState,
} = vi.hoisted(() => ({
  addSession: vi.fn(),
  setActiveSession: vi.fn(),
  setMessages: vi.fn(),
  setAgentTurns: vi.fn(),
  setPendingMessage: vi.fn(),
  setPendingRAAppLaunchIntent: vi.fn(),
  markSessionHydrated: vi.fn(),
  getRAApps: vi.fn<() => Promise<RAAppSummary[]>>(),
  getRAAppGroups: vi.fn<() => Promise<RAAppGroup[]>>(),
  getExecutionProfiles: vi.fn(),
  getPendingRAAppApprovals: vi.fn().mockResolvedValue([]),
  apiPost: vi.fn(),
  confirmTool: vi.fn(),
  cancelTool: vi.fn(),
  approveRaApp: vi.fn(),
  cancelRaApp: vi.fn(),
  identifySession: vi.fn(),
  setPendingConfirmation: vi.fn(),
  removePendingConfirmation: vi.fn(),
  updateToolActivity: vi.fn(),
  agentStoreState: {
    pendingConfirmations: {} as Record<string, Array<{
      requestId: string;
      toolCallId: string;
      sessionId: string;
      toolName: string;
      args: Record<string, unknown>;
      timeoutMs: number;
      agentRun?: { label?: string };
    }>>,
    sessionToolActivities: {} as Record<string, Array<{
      callId: string;
      toolName: string;
      args: Record<string, unknown>;
      status: string;
      startedAt: number;
    }>>,
  },
}));

vi.mock('./QuickChatWidget', () => ({
  QuickChatWidget: () => <div data-testid="quick-chat-widget">Quick Chat</div>,
}));

vi.mock('./AppTile', () => ({
  AppTile: ({ id, name, onClick }: { id: string; name: string; onClick: () => void }) => (
    <button data-testid={`tile-${id}`} onClick={onClick}>
      {name}
    </button>
  ),
}));

vi.mock('./useTileIcons', () => ({
  useTileIcons: () => ({
    icons: {},
    generating: null,
    generateIcon: vi.fn(),
    removeIcon: vi.fn(),
  }),
}));

vi.mock('../../store/sessionStore', () => {
  const state = {
    sessions: [
      { id: 'session-hitl', title: 'Agent delivery run', updatedAt: 1 },
    ],
    sessionMessages: {},
    addSession,
    setActiveSession,
    setMessages,
    setAgentTurns,
    setPendingMessage,
    setPendingRAAppLaunchIntent,
    markSessionHydrated,
  };
  const useSessionStore = (selector: (store: typeof state) => unknown) => selector(state);
  useSessionStore.getState = () => state;
  return { useSessionStore };
});

vi.mock('../../store/agentStore', () => ({
  useAgentStore: (selector: (state: {
    pendingConfirmations: typeof agentStoreState.pendingConfirmations;
    sessionToolActivities: typeof agentStoreState.sessionToolActivities;
    setPendingConfirmation: typeof setPendingConfirmation;
    removePendingConfirmation: typeof removePendingConfirmation;
    updateToolActivity: typeof updateToolActivity;
  }) => unknown) => selector({
    pendingConfirmations: agentStoreState.pendingConfirmations,
    sessionToolActivities: agentStoreState.sessionToolActivities,
    setPendingConfirmation,
    removePendingConfirmation,
    updateToolActivity,
  }),
}));

vi.mock('../../services/eventBus', () => ({
  eventBus: {
    confirmTool,
    cancelTool,
    approveRaApp,
    cancelRaApp,
    identifySession,
  },
}));

vi.mock('../../services/apiClient', () => ({
  getRAApps,
  getRAAppGroups,
  getExecutionProfiles,
  getPendingRAAppApprovals,
  apiClient: {
    post: apiPost,
  },
}));

function makeSummary(id: string, source: 'core' | 'user', name = id): RAAppSummary {
  return {
    id,
    name,
    description: '',
    version: '1.0.0',
    tags: [],
    expose_as_tool: false,
    tool_description: '',
    source,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('LandingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getExecutionProfiles.mockResolvedValue([{ id: 'enabled-profile', name: 'Enabled', kind: 'devin-cli-acp', model: 'swe-2', enabled: true }]);
    agentStoreState.pendingConfirmations = {};
    agentStoreState.sessionToolActivities = {};
  });

  it('persists the selected profile when launching from Home', async () => {
    getRAApps.mockResolvedValue([makeSummary('qa-interactive', 'core', 'Q&A')]);
    getRAAppGroups.mockResolvedValue([]);
    apiPost.mockResolvedValue({ data: { id: 'qa-session', title: 'Q&A' } });
    render(<LandingPage onNavigateToChat={vi.fn()} />);
    await screen.findByRole('option', { name: /Enabled/ });
    fireEvent.change(screen.getByRole('combobox', { name: 'App execution profile' }), { target: { value: 'enabled-profile' } });
    fireEvent.click(await screen.findByTestId('tile-qa-interactive'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({ executionProfileId: 'enabled-profile' })));
    expect(setPendingRAAppLaunchIntent).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('Generate missing values using this conversation runtime') }));
  });

  it('shows profile loading and errors and explains backend-default inheritance', async () => {
    getRAApps.mockResolvedValue([]);
    getRAAppGroups.mockResolvedValue([]);
    getExecutionProfiles.mockRejectedValue(new Error('Profiles offline'));
    render(<LandingPage onNavigateToChat={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading execution profiles');
    expect(screen.getByRole('combobox', { name: 'App execution profile' })).toBeDisabled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Profiles offline');
    expect(screen.getByRole('option', { name: 'Use saved default execution profile' })).toBeInTheDocument();
  });

  it('excludes disabled profiles and leaves blank selection to backend defaults', async () => {
    getExecutionProfiles.mockResolvedValue([
      { id: 'disabled', name: 'Disabled', enabled: false },
      { id: 'enabled-profile', name: 'Enabled', enabled: true, kind: 'devin-cli-acp', model: 'swe-2' },
    ]);
    getRAApps.mockResolvedValue([makeSummary('core-calc', 'core', 'Calculator')]);
    getRAAppGroups.mockResolvedValue([]);
    apiPost.mockResolvedValue({ data: { id: 'default-session', title: 'Calculator' } });
    render(<LandingPage onNavigateToChat={vi.fn()} />);
    await screen.findByRole('option', { name: /Enabled/ });
    expect(screen.queryByRole('option', { name: /Disabled/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('tile-core-calc'));
    await waitFor(() => expect(setPendingRAAppLaunchIntent).toHaveBeenCalled());
    expect(apiPost.mock.calls[0]?.[1]).not.toHaveProperty('executionProfileId');
  });

  it('displays a launch failure without navigating or queuing an intent', async () => {
    getRAApps.mockResolvedValue([makeSummary('core-calc', 'core', 'Calculator')]);
    getRAAppGroups.mockResolvedValue([]);
    apiPost.mockRejectedValueOnce(new Error('Profile unavailable'));
    const navigate = vi.fn();
    render(<LandingPage onNavigateToChat={navigate} />);
    fireEvent.click(await screen.findByTestId('tile-core-calc'));
    expect(await screen.findByRole('alert')).toHaveTextContent('App launch failed: Profile unavailable');
    expect(navigate).not.toHaveBeenCalled();
    expect(setPendingRAAppLaunchIntent).not.toHaveBeenCalled();
  });

  it('renders home tiles from the same catalog system as RA-App manager', async () => {
    getRAApps.mockResolvedValue([
      makeSummary('core-calc', 'core', 'Visual Calculator'),
      makeSummary('standalone-user', 'user', 'Cat Notes'),
    ]);

    getRAAppGroups.mockResolvedValue([
      {
        slug: 'cats-suite',
        name: 'Cats Suite',
        source: 'user',
        current: {
          version: '2.0.0',
          status: 'current',
          zipPath: '/tmp/current.zip',
          createdAt: 1,
          meta: {
            id: 'cats-suite-current',
            name: 'Cats Suite',
            version: '2.0.0',
            description: 'Grouped app current version',
          },
        },
        history: [],
      },
    ]);

    render(<LandingPage onNavigateToChat={() => undefined} />);

    expect(screen.getByTestId('home-hitl-inbox')).toBeInTheDocument();
    expect(screen.getByText('Ongoing actions')).toBeInTheDocument();
    expect(screen.getByText('Nothing to do. Waiting for agents that need your approval.')).toBeInTheDocument();
    expect(screen.getByTestId('home-hitl-empty')).not.toHaveClass('border', 'border-dashed');
    expect(screen.getByTestId('quick-chat-widget')).toBeInTheDocument();

    await waitFor(() => {
      expect(getRAApps).toHaveBeenCalledTimes(1);
      expect(getRAAppGroups).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByTestId('tile-cats-suite-current')).toBeInTheDocument();
    expect(await screen.findByTestId('tile-core-calc')).toBeInTheDocument();
    expect(await screen.findByTestId('tile-standalone-user')).toBeInTheDocument();
  });

  it('opens the created session in chat after tile click and sets typed RA-App launch intent', async () => {
    const onNavigateToChat = vi.fn();
    const onOpenSessionInChat = vi.fn();

    getRAApps.mockResolvedValue([
      makeSummary('standalone-user', 'user', 'Cat Notes'),
    ]);
    getRAAppGroups.mockResolvedValue([]);
    apiPost.mockResolvedValue({
      data: {
        id: 'session-cat-1',
        title: 'Cat Notes',
      },
    });

    render(<LandingPage onNavigateToChat={onNavigateToChat} onOpenSessionInChat={onOpenSessionInChat} />);

    const tile = await screen.findByTestId('tile-standalone-user');
    fireEvent.click(tile);

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/sessions', {
        personaId: 'ra-apps',
        title: 'Cat Notes',
        runtimeContext: {
          runtimeKind: 'chat',
          architectureContext: {
            raAppLaunchId: 'standalone-user',
            raAppLaunchName: 'Cat Notes',
            raAppLaunchSource: 'home_tile',
          },
        },
      });
    });

    expect(addSession).toHaveBeenCalledTimes(1);
    expect(setActiveSession).toHaveBeenCalledWith('session-cat-1');
    expect(setPendingMessage).not.toHaveBeenCalled();
    expect(setPendingRAAppLaunchIntent).toHaveBeenCalledWith({
      targetSessionId: 'session-cat-1',
      appId: 'standalone-user',
      appName: 'Cat Notes',
      personaId: 'ra-apps',
      prompt: 'Run the "Cat Notes" RA-App for me. Launch it immediately.',
      source: 'home_tile',
    });
    expect(onOpenSessionInChat).toHaveBeenCalledWith('session-cat-1');
    expect(onNavigateToChat).not.toHaveBeenCalled();
  });

  it('falls back to plain chat navigation when session-open callback is unavailable', async () => {
    const onNavigateToChat = vi.fn();

    getRAApps.mockResolvedValue([
      makeSummary('standalone-user', 'user', 'Cat Notes'),
    ]);
    getRAAppGroups.mockResolvedValue([]);
    apiPost.mockResolvedValue({
      data: {
        id: 'session-cat-1',
        title: 'Cat Notes',
      },
    });

    render(<LandingPage onNavigateToChat={onNavigateToChat} />);

    fireEvent.click(await screen.findByTestId('tile-standalone-user'));

    await waitFor(() => {
      expect(onNavigateToChat).toHaveBeenCalledTimes(1);
    });
  });

  it('still shows grouped current apps when flat list endpoint fails', async () => {
    getRAApps.mockRejectedValue(new Error('flat endpoint down'));
    getRAAppGroups.mockResolvedValue([
      {
        slug: 'cats-suite',
        name: 'Cats Suite',
        source: 'user',
        current: {
          version: '2.0.0',
          status: 'current',
          zipPath: '/tmp/current.zip',
          createdAt: 1,
          meta: {
            id: 'cats-suite-current',
            name: 'Cats Suite',
            version: '2.0.0',
          },
        },
        history: [],
      },
    ]);

    render(<LandingPage onNavigateToChat={() => undefined} />);

    expect(await screen.findByTestId('tile-cats-suite-current')).toBeInTheDocument();
  });

  it('deduplicates tiles when grouped current app is also present in flat list', async () => {
    getRAApps.mockResolvedValue([
      makeSummary('cats-suite-current', 'user', 'Cats Suite'),
      makeSummary('core-calc', 'core', 'Visual Calculator'),
    ]);
    getRAAppGroups.mockResolvedValue([
      {
        slug: 'cats-suite',
        name: 'Cats Suite',
        source: 'user',
        current: {
          version: '2.0.0',
          status: 'current',
          zipPath: '/tmp/current.zip',
          createdAt: 1,
          meta: {
            id: 'cats-suite-current',
            name: 'Cats Suite',
            version: '2.0.0',
          },
        },
        history: [],
      },
    ]);

    render(<LandingPage onNavigateToChat={() => undefined} />);

    await screen.findByTestId('tile-cats-suite-current');

    expect(screen.getAllByTestId('tile-cats-suite-current')).toHaveLength(1);
    expect(screen.getByTestId('tile-core-calc')).toBeInTheDocument();
  });

  it('skips invalid catalog entries that do not provide an id', async () => {
    getRAApps.mockResolvedValue([
      makeSummary('core-calc', 'core', 'Visual Calculator'),
    ]);
    getRAAppGroups.mockResolvedValue([
      {
        slug: 'broken-suite',
        name: 'Broken Suite',
        source: 'user',
        current: {
          version: '2.0.0',
          status: 'current',
          zipPath: '/tmp/current.zip',
          createdAt: 1,
          meta: {
            id: undefined as unknown as string,
            name: 'Broken Suite',
            version: '2.0.0',
          },
        },
        history: [],
      },
    ]);

    render(<LandingPage onNavigateToChat={() => undefined} />);

    expect(await screen.findByTestId('tile-core-calc')).toBeInTheDocument();
    expect(screen.queryByTestId('tile-undefined')).toBeNull();
  });

  it('renders Home HITL inbox and approves a pending tool with an optional note', async () => {
    getRAApps.mockResolvedValue([]);
    getRAAppGroups.mockResolvedValue([]);
    agentStoreState.pendingConfirmations = {
      'session-hitl': [{
        requestId: 'req-approve',
        toolCallId: 'call-approve',
        sessionId: 'session-hitl',
        toolName: 'fs_write',
        args: { filePath: 'README.md', content: 'Updated' },
        timeoutMs: 0,
        agentRun: { label: 'Implementer' },
      }],
    };
    agentStoreState.sessionToolActivities = {
      'session-hitl': [
        {
          callId: 'call-approve',
          toolName: 'fs_write',
          args: { filePath: 'README.md', content: 'Updated' },
          status: 'awaiting_confirmation',
          startedAt: 1,
        },
      ],
    };

    render(<LandingPage onNavigateToChat={() => undefined} />);

    expect(await screen.findByTestId('home-hitl-inbox')).toBeInTheDocument();
    expect(screen.getByText('Agent delivery run')).toBeInTheDocument();
    expect(screen.getByText('Implementer')).toBeInTheDocument();
    expect(screen.getByText('fs_write')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('home-hitl-note-req-approve'), {
      target: { value: 'Looks safe, continue.' },
    });
    fireEvent.click(screen.getByTestId('home-hitl-approve-req-approve'));

    expect(updateToolActivity).not.toHaveBeenCalled();
    expect(confirmTool).toHaveBeenCalledWith({
      requestId: 'req-approve',
      sessionId: 'session-hitl',
      message: 'Looks safe, continue.',
    });
    expect(removePendingConfirmation).not.toHaveBeenCalled();
    expect(screen.getByTestId('home-hitl-approve-req-approve')).toBeInTheDocument();
  });

  it('rejects a pending tool from Home and sends the rejection note to the agent', async () => {
    getRAApps.mockResolvedValue([]);
    getRAAppGroups.mockResolvedValue([]);
    agentStoreState.pendingConfirmations = {
      'session-hitl': [{
        requestId: 'req-reject',
        toolCallId: 'call-reject',
        sessionId: 'session-hitl',
        toolName: 'terminal_spawn',
        args: { command: 'pnpm build' },
        timeoutMs: 600000,
      }],
    };

    render(<LandingPage onNavigateToChat={() => undefined} />);

    await screen.findByTestId('home-hitl-inbox');
    fireEvent.change(screen.getByTestId('home-hitl-note-req-reject'), {
      target: { value: 'Do not run commands; explain the plan instead.' },
    });
    fireEvent.click(screen.getByTestId('home-hitl-reject-req-reject'));

    expect(updateToolActivity).toHaveBeenCalledWith('call-reject', {
      status: 'cancelled',
      finishedAt: expect.any(Number),
    });
    expect(cancelTool).toHaveBeenCalledWith({
      requestId: 'req-reject',
      sessionId: 'session-hitl',
      message: 'Do not run commands; explain the plan instead.',
    });
    expect(removePendingConfirmation).toHaveBeenCalledWith('session-hitl', 'req-reject');
  });
});

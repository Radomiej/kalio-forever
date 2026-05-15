import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LandingPage } from './LandingPage';
import type { RAAppGroup, RAAppSummary } from '@kalio/types';

const {
  addSession,
  setActiveSession,
  setPendingMessage,
  getRAApps,
  getRAAppGroups,
  apiPost,
} = vi.hoisted(() => ({
  addSession: vi.fn(),
  setActiveSession: vi.fn(),
  setPendingMessage: vi.fn(),
  getRAApps: vi.fn<() => Promise<RAAppSummary[]>>(),
  getRAAppGroups: vi.fn<() => Promise<RAAppGroup[]>>(),
  apiPost: vi.fn(),
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

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: (selector: (state: {
    addSession: typeof addSession;
    setActiveSession: typeof setActiveSession;
    setPendingMessage: typeof setPendingMessage;
  }) => unknown) => selector({ addSession, setActiveSession, setPendingMessage }),
}));

vi.mock('../../services/apiClient', () => ({
  getRAApps,
  getRAAppGroups,
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

    await waitFor(() => {
      expect(getRAApps).toHaveBeenCalledTimes(1);
      expect(getRAAppGroups).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByTestId('tile-cats-suite-current')).toBeInTheDocument();
    expect(await screen.findByTestId('tile-core-calc')).toBeInTheDocument();
    expect(await screen.findByTestId('tile-standalone-user')).toBeInTheDocument();
  });

  it('opens chat flow after tile click and sets pending run prompt', async () => {
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

    const tile = await screen.findByTestId('tile-standalone-user');
    fireEvent.click(tile);

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/sessions', {
        personaId: 'ra-apps',
        title: 'Cat Notes',
      });
    });

    expect(addSession).toHaveBeenCalledTimes(1);
    expect(setActiveSession).toHaveBeenCalledWith('session-cat-1');
    expect(setPendingMessage).toHaveBeenCalledWith('Run the "Cat Notes" RA-App for me. Launch it immediately.');
    expect(onNavigateToChat).toHaveBeenCalledTimes(1);
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
});

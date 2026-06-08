import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ChatSession, VFSListResult } from '@kalio/types';
import { useSessionStore } from '../../store/sessionStore';
import { WorkspacePanel } from './WorkspacePanel';

const { apiGet } = vi.hoisted(() => ({
  apiGet: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    get: apiGet,
  },
}));

function makeSession(id: string, title: string): ChatSession {
  return {
    id,
    title,
    personaId: 'default',
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeVfsResult(sessionId: string, files: VFSListResult['files']): VFSListResult {
  return { sessionId, files };
}

describe('WorkspacePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      sessions: [
        makeSession('session-empty', 'Empty session'),
        makeSession('session-files', 'Session with files'),
      ],
      activeSessionId: null,
      messages: [],
      sessionMessages: {},
      agentTurns: [],
      sessionAgentTurns: {},
      activeTurnId: null,
      sessionActiveTurnIds: {},
    });
  });

  it('scans session files asynchronously and only renders sessions that contain files', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/sessions/session-empty/vfs') {
        return Promise.resolve({ data: makeVfsResult('session-empty', []) });
      }
      if (url === '/api/sessions/session-files/vfs') {
        return Promise.resolve({
          data: makeVfsResult('session-files', [
            {
              sessionId: 'session-files',
              path: 'project/app.tsx',
              sizeBytes: 1280,
              mimeType: 'text/typescript',
              updatedAt: 1,
            },
          ]),
        });
      }
      throw new Error(`unexpected get call: ${url}`);
    });

    render(<WorkspacePanel />);

    expect(screen.getByText('Scanning session files...')).toBeInTheDocument();

    expect(await screen.findByText('Session with files')).toBeInTheDocument();
    expect(screen.queryByText('Empty session')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.queryByText('Scanning session files...')).not.toBeInTheDocument());
    expect(screen.getByText('Session Files (1)')).toBeInTheDocument();
  });
});

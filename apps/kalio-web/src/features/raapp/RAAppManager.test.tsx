import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RAAppManager } from './RAAppManager';
import type { RAAppGroup, VFSListResult } from '@kalio/types';
import {
  approveRAAppDraft,
  deleteRAAppGroup,
  discardRAAppDraft,
  getRAApps,
  getRAAppGroups,
  getSessionVfsFiles,
  rollbackRAApp,
  uploadRAApp,
} from '../../services/apiClient';

vi.mock('../../services/apiClient', () => ({
  getRAApps: vi.fn(),
  getRAAppGroups: vi.fn(),
  getSessionVfsFiles: vi.fn(),
  uploadRAApp: vi.fn(),
  approveRAAppDraft: vi.fn(),
  discardRAAppDraft: vi.fn(),
  rollbackRAApp: vi.fn(),
  deleteRAAppGroup: vi.fn(),
}));

const setPendingMessage = vi.fn();

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: Object.assign(
    (
      selector: (state: {
        activeSessionId: string;
        messages: Array<{ id: string; role: string; content: string }>;
      }) => unknown,
    ) => selector({
      activeSessionId: 'session-1',
      messages: [],
    }),
    {
      getState: () => ({
        activeSessionId: 'session-1',
        messages: [],
        setPendingMessage,
      }),
    },
  ),
}));

function makeGroup(): RAAppGroup {
  return {
    slug: 'my-app',
    name: 'My App',
    source: 'user',
    current: {
      version: '1.2.0',
      status: 'current',
      zipPath: '/tmp/current.zip',
      createdAt: 1,
      meta: { id: 'my-app', name: 'My App', version: '1.2.0' },
    },
    history: [],
  };
}

function makeVfsResult(): VFSListResult {
  return {
    sessionId: 'session-1',
    files: [
      { sessionId: 'session-1', path: 'drafts/draft-1/meta.yml', sizeBytes: 20, updatedAt: 1 },
      { sessionId: 'session-1', path: 'drafts/draft-1/ui.gui', sizeBytes: 40, updatedAt: 2 },
      { sessionId: 'session-1', path: 'drafts/draft-1/tests.yml', sizeBytes: 30, updatedAt: 3 },
    ],
  };
}

describe('RAAppManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRAApps).mockResolvedValue([]);
    vi.mocked(getRAAppGroups).mockResolvedValue([makeGroup()]);
    vi.mocked(getSessionVfsFiles).mockResolvedValue(makeVfsResult());
    vi.mocked(uploadRAApp).mockResolvedValue({
      id: 'uploaded-app',
      name: 'Uploaded App',
      description: '',
      version: '1.0.0',
      tags: [],
      expose_as_tool: false,
      tool_description: '',
      source: 'user',
      createdAt: 1,
      updatedAt: 1,
    });
    vi.mocked(approveRAAppDraft).mockResolvedValue(makeGroup());
    vi.mocked(discardRAAppDraft).mockResolvedValue(makeGroup());
    vi.mocked(rollbackRAApp).mockResolvedValue(makeGroup());
    vi.mocked(deleteRAAppGroup).mockResolvedValue(undefined);
  });

  it('shows raw work drafts from session VFS and lets the user open that workspace', async () => {
    const onOpenVFS = vi.fn();
    const onRunWithAgent = vi.fn();

    render(<RAAppManager onOpenVFS={onOpenVFS} onRunWithAgent={onRunWithAgent} />);

    expect(await screen.findByText('Work (1)')).toBeInTheDocument();
    expect(screen.getByTestId('raapp-work-draft-draft-1')).toBeInTheDocument();
    expect(screen.getByText('draft-1')).toBeInTheDocument();
    expect(screen.getByText('3 files')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('raapp-work-open-vfs-session-1'));

    expect(onOpenVFS).toHaveBeenCalledWith('session-1');

    fireEvent.click(screen.getByTestId('raapp-work-test-draft-1'));
    expect(setPendingMessage).toHaveBeenLastCalledWith(
      'Run raapp_test for draft_id "draft-1" now and summarize the results briefly.',
    );

    fireEvent.click(screen.getByTestId('raapp-work-run-draft-1'));
    expect(setPendingMessage).toHaveBeenLastCalledWith(
      'Run the RA-App draft "draft-1" now using raapp_execute_dsl and launch it immediately.',
    );

    fireEvent.click(screen.getByTestId('raapp-work-publish-draft-1'));
    expect(setPendingMessage).toHaveBeenLastCalledWith(
      'Publish the RA-App draft "draft-1" now using raapp_publish_draft with bump_type "minor", then report the released version.',
    );
    expect(onRunWithAgent).toHaveBeenCalledTimes(3);
  });
});
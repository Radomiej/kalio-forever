/**
 * REGRESSION tests for ToolCallBubble rendering.
 *
 * Focus:
 * 1. RA-App widget renders INSIDE the chip (not outside the agent bubble)
 * 2. HistoryToolCallBubble collapses widget when isAnswered flips to true
 * 3. LiveToolCallBubble auto-expands when RA-App result arrives after mount
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { HistoryToolCallBubble, LiveToolCallBubble } from './ToolCallBubble';
import type { ToolActivity } from '../../store/agentStore';
import { useAgentStore } from '../../store/agentStore';
import { useSessionStore } from '../../store/sessionStore';
import { apiClient } from '../../services/apiClient';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../raapp/RAAppRenderer', () => ({
  RAAppRenderer: ({ block }: { block: { type: string } }) => (
    <div data-testid="raapp-renderer" data-type={block.type}>RA-App Widget</div>
  ),
}));

vi.mock('../../services/apiClient', async () => {
  const actual = await vi.importActual<typeof import('../../services/apiClient')>('../../services/apiClient');
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      get: vi.fn(),
      post: vi.fn(),
    },
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const GUI_TOOL_RESULT = JSON.stringify({
  status: 'ready',
  type: 'gui',
  mode: 'interactive',
  content: '{"nodes":[],"data":{}}',
});

const NON_RAAPP_RESULT = JSON.stringify({ status: 'ok', items: [] });
const realSessionActions = {
  setActiveSession: useSessionStore.getState().setActiveSession,
  setPendingMessage: useSessionStore.getState().setPendingMessage,
};
const realCanvasActions = {
  setCanvasOpen: useAgentStore.getState().setCanvasOpen,
  setCanvasFocus: useAgentStore.getState().setCanvasFocus,
};

function makeActivity(overrides: Partial<ToolActivity> = {}): ToolActivity {
  return {
    callId: 'call-1',
    toolName: 'run_raapp',
    args: { id: 'qa-interactive' },
    status: 'running',
    startedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(apiClient.get).mockReset();
  vi.mocked(apiClient.get).mockRejectedValue(new Error('unexpected apiClient.get call'));
  vi.mocked(apiClient.post).mockReset();
  vi.mocked(apiClient.post).mockRejectedValue(new Error('unexpected apiClient.post call'));
  useSessionStore.setState({
    activeSessionId: null,
    sessions: [],
    setActiveSession: realSessionActions.setActiveSession,
    setPendingMessage: realSessionActions.setPendingMessage,
  });
  useAgentStore.setState({
    runtimeActivitySnapshots: {},
    cliChildProjections: {},
    cliAgentOutput: {},
    canvasOpen: false,
    canvasFocus: null,
    setCanvasOpen: realCanvasActions.setCanvasOpen,
    setCanvasFocus: realCanvasActions.setCanvasFocus,
  });
});

// ── LiveToolCallBubble tests ──────────────────────────────────────────────────
// Live chip = status indicator only. Widget NEVER renders here —
// it appears in HistoryToolCallBubble once tool:result arrives as a ChatMessage.

describe('LiveToolCallBubble — status indicator only (no widget)', () => {
  it('shows spinner when running', () => {
    const activity = makeActivity({ status: 'running' });
    render(<LiveToolCallBubble activity={activity} />);
    expect(screen.getByTestId('tool-call-bubble')).toBeInTheDocument();
    expect(screen.queryByTestId('raapp-renderer')).not.toBeInTheDocument();
  });

  it('never renders RAApp widget even when result has RA-App block', () => {
    const activity = makeActivity({
      status: 'success',
      finishedAt: Date.now(),
      result: { callId: 'call-1', status: 'success', data: JSON.parse(GUI_TOOL_RESULT) },
    });
    render(<LiveToolCallBubble activity={activity} />);
    // Widget must NOT appear in live chip — it belongs in HistoryToolCallBubble
    expect(screen.queryByTestId('raapp-renderer')).not.toBeInTheDocument();
  });

  it('shows tool name', () => {
    const activity = makeActivity({ status: 'running' });
    render(<LiveToolCallBubble activity={activity} />);
    expect(screen.getByText('run_raapp')).toBeInTheDocument();
  });

  it('shows the target path for live filesystem reads without expanding args', () => {
    const activity = makeActivity({
      toolName: 'fs_read',
      args: { path: 'C:/Projekty/kalio-forever/README.md' },
      status: 'running',
    });

    render(<LiveToolCallBubble activity={activity} />);

    expect(screen.getByTestId('tool-call-target')).toHaveTextContent('C:/Projekty/kalio-forever/README.md');
  });

  it('REGRESSION: ToolActivity accepts backend agentRun metadata for auto-approve and subagent depth', () => {
    const activity: ToolActivity = {
      callId: 'call-subagent',
      toolName: 'run_subagent',
      args: { objective: 'Design a landing page' },
      status: 'running',
      startedAt: Date.now(),
      agentRun: {
        agentRunId: 'subagent-run-1',
        agentType: 'subagent',
        parentSessionId: 'session-1',
        parentToolCallId: 'call-parent',
        autoApproveTools: ['image_generate'],
        subagentDepth: 1,
      },
    };

    render(<LiveToolCallBubble activity={activity} />);

    expect(screen.getByText('run_subagent')).toBeInTheDocument();
  });

  it('hides the spawn_cli_agent tool chip while the CLI child card is the primary view', () => {
    const activity = makeActivity({
      toolName: 'spawn_cli_agent',
      status: 'running',
      args: { prompt: 'Inspect the repository', agentId: 'codex', workdir: 'C:/repo' },
      result: {
        callId: 'call-cli-session',
        status: 'success',
        data: {
          childSessionId: 'cli-child-1',
          parentSessionId: 'session-1',
          agentId: 'codex',
          workdir: 'C:/repo',
          status: 'running',
          lastPrompt: 'Inspect the repository',
          updatedAt: Date.now(),
          lastOutput: 'Scanning files...',
        },
      },
    });

    render(<LiveToolCallBubble activity={activity} />);

    expect(screen.getByTestId('cli-child-card-cli-child-1')).toBeInTheDocument();
    expect(screen.queryByText('spawn_cli_agent')).not.toBeInTheDocument();
  });

  it('renders durable CLI session snapshots instead of raw JSON blobs', () => {
    const activity = makeActivity({
      toolName: 'spawn_cli_agent',
      status: 'success',
      finishedAt: Date.now(),
      result: {
        callId: 'call-cli-session',
        status: 'success',
        data: {
          childSessionId: 'cli-child-1',
          parentSessionId: 'session-1',
          agentId: 'codex',
          workdir: 'C:/repo',
          status: 'running',
          lastPrompt: 'Inspect the repository',
          updatedAt: Date.now(),
          activeCallId: 'cli-run-1',
          lastOutput: 'Scanning files...',
        },
      },
    });

    render(<LiveToolCallBubble activity={activity} />);

    expect(screen.getByTestId('cli-child-card-cli-child-1')).toBeInTheDocument();
    expect(screen.getByTestId('cli-child-status-cli-child-1')).toHaveTextContent('running');
    expect(screen.getByText('Scanning files...')).toBeInTheDocument();
    expect(screen.queryByText(/"childSessionId": "cli-child-1"/)).not.toBeInTheDocument();
    expect(screen.queryByText('spawn_cli_agent')).not.toBeInTheDocument();
  });

  it('uses runtime child executions as the primary live CLI card source when no stored projection exists', () => {
    useAgentStore.setState({
      runtimeActivitySnapshots: {
        'session-1': {
          sessionId: 'session-1',
          active: true,
          queueLength: 0,
          pendingConfirmations: [],
          pendingBudgetApprovals: [],
          toolActivities: [],
          childExecutions: [{
            id: 'child-exec-1',
            kind: 'cli_agent',
            parentSessionId: 'session-1',
            childSessionId: 'cli-child-runtime',
            parentToolCallId: 'call-cli-runtime',
            label: 'codex',
            status: 'running',
            lastOutput: 'runtime output',
            updatedAt: 1,
          }],
          updatedAt: 1,
        },
      },
      cliChildProjections: {},
      cliAgentOutput: {},
    });
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessions: [{
        id: 'cli-child-runtime',
        personaId: 'default',
        title: 'codex CLI',
        kind: 'cli-agent',
        parentSessionId: 'session-1',
        parentToolCallId: 'call-cli-runtime',
        createdAt: 1,
        updatedAt: 1,
      }],
    });

    render(<LiveToolCallBubble activity={makeActivity({
      callId: 'call-cli-runtime',
      toolName: 'spawn_cli_agent',
      args: { prompt: 'Inspect the repository', agentId: 'codex' },
      status: 'running',
    })} />);

    expect(screen.getByTestId('cli-child-card-cli-child-runtime')).toBeInTheDocument();
    expect(screen.getByTestId('cli-child-status-cli-child-runtime')).toHaveTextContent('running');
    expect(screen.getByTestId('cli-child-output-cli-child-runtime')).toHaveTextContent('runtime output');
    expect(screen.queryByText('spawn_cli_agent')).not.toBeInTheDocument();
  });
});

// ── HistoryToolCallBubble args display ────────────────────────────────────────

describe('HistoryToolCallBubble — tool input args display', () => {
  it('REGRESSION: run_sub_agentflow result opens child chat and graph focus from the same bubble', () => {
    useSessionStore.setState({
      activeSessionId: 'parent-session',
      sessions: [
        { id: 'parent-session', personaId: 'default', title: 'Parent', createdAt: 1, updatedAt: 1 },
        { id: 'flow-child-1', personaId: 'default', title: 'Goal Master', createdAt: 1, updatedAt: 1 },
      ],
    });
    useAgentStore.setState({ canvasOpen: false, canvasFocus: null });

    render(
      <HistoryToolCallBubble
        toolName="run_sub_agentflow"
        content={JSON.stringify({
          flowRunId: 'flow-run-1',
          parentSessionId: 'parent-session',
          parentToolCallId: 'call-flow-1',
          childSessionId: 'flow-child-1',
          openChatSessionId: 'flow-child-1',
          openGraphRunId: 'flow-run-1',
          status: 'done',
          summary: 'Goal Master accepted the result.',
          decisions: [],
          nextActions: [],
          artifacts: [],
          tracePreview: [],
        })}
      />,
    );

    fireEvent.click(screen.getByTestId('open-agentflow-chat'));

    expect(useSessionStore.getState().activeSessionId).toBe('flow-child-1');
    expect(useAgentStore.getState().canvasOpen).toBe(true);
    expect(useAgentStore.getState().canvasFocus).toEqual({ kind: 'architecture-run', runId: 'flow-run-1' });
  });

  it('shows the target path for history VFS reads in the collapsed chip', () => {
    render(
      <HistoryToolCallBubble
        toolName="vfs_read"
        content={NON_RAAPP_RESULT}
        args={{ filePath: 'project/SimulationApp.tsx' }}
      />,
    );

    expect(screen.getByTestId('tool-call-target')).toHaveTextContent('project/SimulationApp.tsx');
    expect(screen.queryByText('filePath:')).not.toBeInTheDocument();
  });

  it('shows the session VFS root for vfs_list calls without path args', () => {
    render(
      <HistoryToolCallBubble
        toolName="vfs_list"
        content={NON_RAAPP_RESULT}
        args={{}}
      />,
    );

    expect(screen.getByTestId('tool-call-target')).toHaveTextContent('session VFS root');
  });

  it('shows args key/value when args prop is provided', () => {
    render(
      <HistoryToolCallBubble
        toolName="web_search"
        content={NON_RAAPP_RESULT}
        args={{ query: 'how to fix bugs', maxResults: 5 }}
      />,
    );
    // Chip renders, but args are in the expandable section — click to open
    const toggle = screen.getByRole('button', { name: /toggle details/i });
    act(() => toggle.click());

    expect(screen.getByText('query:')).toBeInTheDocument();
    expect(screen.getByText('how to fix bugs')).toBeInTheDocument();
    expect(screen.getByText('maxResults:')).toBeInTheDocument();
  });

  it('shows "input" label above args', () => {
    render(
      <HistoryToolCallBubble
        toolName="web_search"
        content={NON_RAAPP_RESULT}
        args={{ query: 'test' }}
      />,
    );
    const toggle = screen.getByRole('button', { name: /toggle details/i });
    act(() => toggle.click());

    expect(screen.getByText('input')).toBeInTheDocument();
  });

  it('renders structured web_search v2 results instead of raw JSON', () => {
    render(
      <HistoryToolCallBubble
        toolName="web_search"
        content={JSON.stringify({
          offline: true,
          results: [
            {
              content: 'Stored web result about TypeScript 5.8',
              citationUrls: ['https://example.com/typescript'],
              blockType: 'paragraph',
              headingPath: ['Release Notes'],
              webResultId: 'web-1',
              blockIndex: 0,
              query: 'TypeScript latest',
              provider: 'perplexity',
              model: 'sonar',
            },
          ],
        })}
      />,
    );

    expect(screen.getByTestId('web-search-result-renderer')).toBeInTheDocument();
    expect(screen.getByText('Stored web result about TypeScript 5.8')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://example.com/typescript' })).toBeInTheDocument();
    expect(screen.queryByText(/"offline": true/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"results": \[/)).not.toBeInTheDocument();
  });

  it('does NOT show args section when args is undefined', () => {
    render(<HistoryToolCallBubble toolName="list_raapps" content={NON_RAAPP_RESULT} />);
    // Open the expandable section if any
    const toggle = screen.queryByRole('button', { name: /toggle details/i });
    if (toggle) act(() => toggle.click());
    expect(screen.queryByText('input')).not.toBeInTheDocument();
  });

  it('does NOT show args section when args is empty object', () => {
    render(<HistoryToolCallBubble toolName="list_raapps" content={NON_RAAPP_RESULT} args={{}} />);
    const toggle = screen.queryByRole('button', { name: /toggle details/i });
    if (toggle) act(() => toggle.click());
    expect(screen.queryByText('input')).not.toBeInTheDocument();
  });
});

describe('HistoryToolCallBubble - CLI terminal output', () => {
  it('renders run_cli_agent results through the CLI child conversation card', () => {
    useAgentStore.setState({
      cliChildProjections: {
        'cli-child-1': {
          childSessionId: 'cli-child-1',
          parentSessionId: 'session-1',
          parentCallId: 'call-cli-1',
          agentId: 'codex',
          status: 'failed',
          lastOutput: 'Focused test run complete',
          toolName: 'run_cli_agent',
        },
      },
    });

    render(
      <HistoryToolCallBubble
        toolName="run_cli_agent"
        callId="call-cli-1"
        parentSessionId="session-1"
        content={JSON.stringify({
          output: 'Focused test run complete',
          exitCode: 1,
          durationMs: 1_250,
          agentId: 'codex',
          childSessionId: 'cli-child-1',
        })}
      />,
    );

    expect(screen.getByTestId('cli-child-card-cli-child-1')).toBeInTheDocument();
    expect(screen.getByText('Focused test run complete')).toBeInTheDocument();
    expect(screen.getByTestId('cli-child-status-cli-child-1')).toHaveTextContent('failed');
  });
});

describe('HistoryToolCallBubble - persisted tool status', () => {
  it('renders failed status for persisted error results after reload', () => {
    render(
      <HistoryToolCallBubble
        toolName="raapp_create"
        content={JSON.stringify({
          status: 'error',
          errorCode: 'TOOL_EXECUTION_FAILED',
          errorMessage: 'Invalid RA-App slug "generated-iFJ7wi6u-53d01c1d".',
        })}
      />,
    );

    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getAllByText(/Invalid RA-App slug/)).toHaveLength(2);
  });
});

describe('REGRESSION: run_subagent bubble renders child RAApp', () => {
  it('exposes a stable canvas opener for sub-agent history results', () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] } as never);

    render(
      <HistoryToolCallBubble
        toolName="run_subagent"
        content={JSON.stringify({
          childSessionId: 'sub-1',
          parentSessionId: 'p-1',
          vfsMode: 'isolated',
          vfsSessionId: 'sub-1',
          copiedFiles: [],
          result: 'Completed',
          taskId: 't-1',
          durationMs: 1000,
        })}
      />,
    );

    expect(screen.getByTestId('open-subagent-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('tool-call-bubble')).toHaveAttribute('data-tool-name', 'run_subagent');
    expect(screen.queryByTestId('open-cli-agent-canvas')).not.toBeInTheDocument();
  });

  it('uses a separate canvas opener id for durable CLI history results', () => {
    render(
      <HistoryToolCallBubble
        toolName="message_cli_agent"
        content={JSON.stringify({
          childSessionId: 'cli-child-1',
          parentSessionId: 'session-1',
          agentId: 'codex',
          workdir: 'C:/repo',
          status: 'running',
          lastPrompt: 'Continue with tests',
          updatedAt: Date.now(),
          activeCallId: 'cli-run-2',
          lastOutput: 'Running focused tests...',
        })}
      />,
    );

    expect(screen.getByTestId('open-cli-agent-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('tool-call-bubble')).toHaveAttribute('data-tool-name', 'message_cli_agent');
    expect(screen.queryByTestId('open-subagent-canvas')).not.toBeInTheDocument();
  });

  it('REGRESSION: ignores malformed copiedFiles payloads instead of treating them as subagent results', () => {
    render(
      <HistoryToolCallBubble
        toolName="run_subagent"
        content={JSON.stringify({
          childSessionId: 'sub-1',
          parentSessionId: 'p-1',
          vfsMode: 'isolated',
          vfsSessionId: 'sub-1',
          copiedFiles: null,
          result: 'Completed',
          taskId: 't-1',
          durationMs: 1000,
        })}
      />,
    );

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /toggle details/i }));
    });

    expect(screen.getByText(/"copiedFiles": null/)).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('REGRESSION: aborts the child transcript request on unmount', async () => {
    const abortSpy = vi.fn();
    vi.mocked(apiClient.get).mockImplementationOnce((...args: unknown[]) => {
      const config = args[1] as { signal?: AbortSignal } | undefined;
      config?.signal?.addEventListener('abort', abortSpy);
      return new Promise(() => undefined) as Promise<{ data: never[] }>;
    });

    let unmount!: () => void;
    await act(async () => {
      ({ unmount } = render(
        <HistoryToolCallBubble
          toolName="run_subagent"
          content={JSON.stringify({
            childSessionId: 'sub-1',
            parentSessionId: 'p-1',
            vfsMode: 'isolated',
            vfsSessionId: 'sub-1',
            copiedFiles: [],
            result: 'Completed',
            taskId: 't-1',
            durationMs: 1000,
          })}
        />,
      ));
    });

    const requestConfig = vi.mocked(apiClient.get).mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined;
    expect(requestConfig?.signal).toBeDefined();

    await act(async () => {
      unmount();
    });

    expect(abortSpy).toHaveBeenCalledTimes(1);
  });

  it('loads child session messages and renders latest raapp_create result', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: [
        {
          id: 'tool-1',
          sessionId: 'sub-1',
          role: 'tool_result',
          toolCallId: 'child-call-1',
          content: JSON.stringify({
            status: 'ready',
            type: 'html',
            mode: 'display',
            content: '<!doctype html><html><body>hello</body></html>',
          }),
          createdAt: Date.now(),
        },
      ],
    } as never);

    render(
      <HistoryToolCallBubble
        toolName="run_subagent"
        content={JSON.stringify({
          childSessionId: 'sub-1',
          parentSessionId: 'p-1',
          vfsMode: 'isolated',
          vfsSessionId: 'sub-1',
          copiedFiles: [],
          result: 'Completed',
          taskId: 't-1',
          durationMs: 1000,
        })}
      />,
    );

    expect(await screen.findByTestId('raapp-renderer')).toBeInTheDocument();
  });

  it('renders generated child images from the subagent transcript', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: [
        {
          id: 'tool-image-1',
          sessionId: 'sub-1',
          role: 'tool_result',
          toolCallId: 'child-call-image-1',
          content: JSON.stringify({
            output_type: 'image',
            image_url: 'data:image/png;base64,AAAA',
            path: 'images/hero-coffee.png',
            message: 'Generated hero image',
          }),
          createdAt: Date.now(),
        },
        {
          id: 'tool-image-2',
          sessionId: 'sub-1',
          role: 'tool_result',
          toolCallId: 'child-call-image-2',
          content: JSON.stringify({
            output_type: 'image',
            image_url: 'data:image/png;base64,BBBB',
            path: 'images/menu-collage.png',
            message: 'Generated menu collage',
          }),
          createdAt: Date.now() + 1,
        },
      ],
    } as never);

    render(
      <HistoryToolCallBubble
        toolName="run_subagent"
        content={JSON.stringify({
          childSessionId: 'sub-1',
          parentSessionId: 'p-1',
          vfsMode: 'isolated',
          vfsSessionId: 'sub-1',
          copiedFiles: [],
          result: 'Completed',
          taskId: 't-1',
          durationMs: 1000,
        })}
      />,
    );

    expect(await screen.findByAltText('Generated hero image')).toBeInTheDocument();
    expect(screen.getByAltText('Generated menu collage')).toBeInTheDocument();
    expect(screen.getByText('images/hero-coffee.png')).toBeInTheDocument();
    expect(screen.getByText('images/menu-collage.png')).toBeInTheDocument();
  });

  it('REGRESSION: deduplicates child images by VFS path when the path is available', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: [
        {
          id: 'tool-image-1',
          sessionId: 'sub-1',
          role: 'tool_result',
          toolCallId: 'child-call-image-1',
          content: JSON.stringify({
            output_type: 'image',
            image_url: 'data:image/png;base64,AAAA',
            path: 'images/hero-coffee.png',
            message: 'Generated hero image',
          }),
          createdAt: Date.now(),
        },
        {
          id: 'tool-image-2',
          sessionId: 'sub-1',
          role: 'tool_result',
          toolCallId: 'child-call-image-2',
          content: JSON.stringify({
            output_type: 'image',
            image_url: 'data:image/png;base64,BBBB',
            path: 'images/hero-coffee.png',
            message: 'Generated hero image',
          }),
          createdAt: Date.now() + 1,
        },
      ],
    } as never);

    render(
      <HistoryToolCallBubble
        toolName="run_subagent"
        content={JSON.stringify({
          childSessionId: 'sub-1',
          parentSessionId: 'p-1',
          vfsMode: 'isolated',
          vfsSessionId: 'sub-1',
          copiedFiles: [],
          result: 'Completed',
          taskId: 't-1',
          durationMs: 1000,
        })}
      />,
    );

    expect((await screen.findAllByAltText('Generated hero image')).length).toBe(1);
    expect(screen.getAllByText('images/hero-coffee.png')).toHaveLength(1);
  });

  it('keeps the child preview visible while collapsing verbose result details by default', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: [
        {
          id: 'tool-1',
          sessionId: 'sub-1',
          role: 'tool_result',
          toolCallId: 'child-call-1',
          content: JSON.stringify({
            status: 'ready',
            type: 'html',
            mode: 'display',
            content: '',
            vfsPath: 'design/preview.html',
          }),
          createdAt: Date.now(),
        },
      ],
    } as never);

    render(
      <HistoryToolCallBubble
        toolName="run_subagent"
        content={JSON.stringify({
          childSessionId: 'sub-1',
          parentSessionId: 'p-1',
          vfsMode: 'isolated',
          vfsSessionId: 'sub-1',
          copiedFiles: [{ fromPath: 'design/preview.html', toPath: 'sub-agents/sub-1/design/preview.html', sizeBytes: 321 }],
          result: 'Verbose implementation summary',
          taskId: 't-1',
          durationMs: 1000,
        })}
      />,
    );

    expect(await screen.findByTestId('raapp-renderer')).toBeInTheDocument();
    expect(screen.queryByText('Verbose implementation summary')).not.toBeInTheDocument();
    expect(screen.queryByText('sub-agents/sub-1/design/preview.html')).not.toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /toggle sub-agent details/i }));
    });

    expect(screen.getByText('Verbose implementation summary')).toBeInTheDocument();
    expect(screen.getByText('sub-agents/sub-1/design/preview.html')).toBeInTheDocument();
  });

  it('hides history spawn_cli_agent chip until inspect is requested', () => {
    useAgentStore.setState({
      cliChildProjections: {
        'cli-child-1': {
          childSessionId: 'cli-child-1',
          parentSessionId: 'session-1',
          parentCallId: 'call-cli-1',
          agentId: 'codex',
          status: 'completed',
          lastOutput: 'Done',
          toolName: 'spawn_cli_agent',
          childTitle: 'codex CLI',
        },
      },
    });

    render(
      <HistoryToolCallBubble
        toolName="spawn_cli_agent"
        callId="call-cli-1"
        parentSessionId="session-1"
        content={JSON.stringify({
          childSessionId: 'cli-child-1',
          parentSessionId: 'session-1',
          agentId: 'codex',
          workdir: 'C:/repo',
          status: 'completed',
          lastPrompt: 'Inspect the repository',
          updatedAt: Date.now(),
          lastOutput: 'Done',
        })}
        args={{ prompt: 'Inspect the repository', agentId: 'codex', workdir: 'C:/repo' }}
      />,
    );

    expect(screen.getByTestId('cli-child-card-cli-child-1')).toBeInTheDocument();
    expect(screen.queryByText('spawn_cli_agent')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cli-child-inspect-cli-child-1'));
    expect(screen.getByText('spawn_cli_agent')).toBeInTheDocument();
  });

  it('renders durable CLI session status for message_cli_agent history results without requiring an exit code', () => {
    render(
      <HistoryToolCallBubble
        toolName="message_cli_agent"
        content={JSON.stringify({
          childSessionId: 'cli-child-1',
          parentSessionId: 'session-1',
          agentId: 'codex',
          workdir: 'C:/repo',
          status: 'running',
          lastPrompt: 'Continue with tests',
          updatedAt: Date.now(),
          activeCallId: 'cli-run-2',
          lastOutput: 'Running focused tests...',
        })}
        args={{ childSessionId: 'cli-child-1', prompt: 'Continue with tests' }}
      />,
    );

    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getAllByText('cli-child-1').length).toBeGreaterThan(0);
    expect(screen.getByText('Running focused tests...')).toBeInTheDocument();
    expect(screen.queryByText(/"activeCallId": "cli-run-2"/)).not.toBeInTheDocument();
  });

  it('renders run_sub_agentflow history as an AgentFlow result block instead of raw JSON', () => {
    render(
      <HistoryToolCallBubble
        toolName="run_sub_agentflow"
        content={JSON.stringify({
          flowRunId: 'flow-1',
          childSessionId: 'arch-flow-1-root',
          status: 'running',
          summary: 'AgentFlow goal_guard_delivery_loop started.',
          decisions: [],
          nextActions: ['Wait for Goal Guard evidence.'],
          artifacts: [],
          openChatSessionId: 'arch-flow-1-root',
          openGraphRunId: 'flow-1',
          tracePreview: [
            {
              id: 'event-1',
              sequence: 1,
              type: 'flow:node_start',
              message: 'Orchestrator started.',
              nodeId: 'orchestrator',
              createdAt: Date.now(),
            },
          ],
        })}
        args={{ flowId: 'goal_guard_delivery_loop', goal: 'Build project' }}
      />,
    );

    expect(screen.getByTestId('sub-agentflow-result')).toBeInTheDocument();
    expect(screen.getByText('AgentFlow goal_guard_delivery_loop started.')).toBeInTheDocument();
    expect(screen.getAllByText('flow-1').length).toBeGreaterThan(0);
    expect(screen.getByText('arch-flow-1-root')).toBeInTheDocument();
    expect(screen.queryByText(/"flowRunId"/)).not.toBeInTheDocument();
  });

  it('shows return-to-orchestrator handoff counts for waiting AgentFlow results', () => {
    render(
      <HistoryToolCallBubble
        toolName="run_sub_agentflow"
        content={JSON.stringify({
          flowRunId: 'flow-return',
          childSessionId: 'arch-flow-return-root',
          status: 'waiting_on_orchestrator',
          summary: 'Goal Guard returned control to the orchestrator for QA evidence.',
          decisions: ['route_to(orchestrator, request QA evidence)'],
          nextActions: ['Resume with Playwright QA evidence.'],
          artifacts: [],
          returnToOrchestratorCount: 2,
          openChatSessionId: 'arch-flow-return-root',
          openGraphRunId: 'flow-return',
          tracePreview: [
            {
              id: 'event-return-1',
              sequence: 1,
              type: 'flow:return_to_orchestrator',
              message: 'First supervision handoff.',
              nodeId: 'orchestrator',
              status: 'waiting_on_orchestrator',
              createdAt: Date.now(),
            },
          ],
        })}
        args={{ flowId: 'goal_guard_delivery_loop', goal: 'Build project' }}
      />,
    );

    const result = screen.getByTestId('sub-agentflow-result');
    expect(result).toHaveTextContent('waiting_on_orchestrator');
    expect(result).toHaveTextContent('handoffs');
    expect(result).toHaveTextContent('2');

    fireEvent.click(screen.getByRole('button', { name: /toggle agentflow details/i }));

    expect(result).toHaveTextContent('route_to(orchestrator, request QA evidence)');
    expect(result).toHaveTextContent('Resume with Playwright QA evidence.');
    expect(result).toHaveTextContent('flow:return_to_orchestrator');
    expect(result).toHaveTextContent('First supervision handoff.');
  });

  it('renders the generic resume action for a waiting AgentFlow result', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: {
        run: {
          id: 'flow-resume',
          parentSessionId: 'session-1',
          childSessionId: 'arch-flow-resume-root',
          openChatSessionId: 'arch-flow-resume-root',
          openGraphRunId: 'flow-resume',
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

    render(
      <HistoryToolCallBubble
        toolName="run_sub_agentflow"
        content={JSON.stringify({
          flowRunId: 'flow-resume',
          childSessionId: 'arch-flow-resume-root',
          status: 'waiting_on_orchestrator',
          summary: 'Goal Guard is waiting for orchestrator input.',
          decisions: [],
          nextActions: ['Resume AgentFlow with the next instruction.'],
          artifacts: [],
          openChatSessionId: 'arch-flow-resume-root',
          openGraphRunId: 'flow-resume',
        })}
        args={{ flowId: 'goal_guard_delivery_loop', goal: 'Build project' }}
      />,
    );

    expect(screen.getByTestId('sub-agentflow-result')).toHaveTextContent('Waiting on orchestrator');
    fireEvent.click(screen.getByTestId('resume-agentflow-flow-resume'));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/agent-flows/runs/flow-resume/resume', { input: 'Continue.' });
    });
  });

  it('refreshes a durable run_sub_agentflow history block from the AgentFlow run snapshot', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: {
        run: {
          id: 'flow-refresh',
          parentSessionId: 'session-1',
          childSessionId: 'arch-flow-refresh-root',
          openChatSessionId: 'arch-flow-refresh-root',
          openGraphRunId: 'flow-refresh',
          flowDefinitionId: 'goal_guard_delivery_loop',
          status: 'done',
          startMode: 'durable',
          returnMode: 'summary',
          createdAt: 1,
          updatedAt: 2,
          finishedAt: 2,
        },
        result: {
          flowRunId: 'flow-refresh',
          childSessionId: 'arch-flow-refresh-root',
          openChatSessionId: 'arch-flow-refresh-root',
          openGraphRunId: 'flow-refresh',
          status: 'done',
          summary: 'Goal Guard accepted durable AgentFlow evidence.',
          decisions: ['accepted after QA'],
          nextActions: [],
          artifacts: ['qa/proof.md'],
        },
        events: [],
      },
    });

    render(
      <HistoryToolCallBubble
        toolName="run_sub_agentflow"
        content={JSON.stringify({
          flowRunId: 'flow-refresh',
          childSessionId: 'arch-flow-refresh-root',
          status: 'running',
          summary: 'AgentFlow goal_guard_delivery_loop started.',
          decisions: [],
          nextActions: ['Open the child AgentFlow graph to monitor completion.'],
          artifacts: [],
          openChatSessionId: 'arch-flow-refresh-root',
          openGraphRunId: 'flow-refresh',
        })}
        args={{ flowId: 'goal_guard_delivery_loop', goal: 'Build project' }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('sub-agentflow-result')).toHaveTextContent('done');
      expect(screen.getByText('Goal Guard accepted durable AgentFlow evidence.')).toBeInTheDocument();
    });
    expect(apiClient.get).toHaveBeenCalledWith('/api/agent-flows/runs/flow-refresh');
  });

  it('keeps polling a durable run_sub_agentflow history block until the run is stable', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({
          data: {
            run: {
              id: 'flow-poll',
              parentSessionId: 'session-1',
              childSessionId: 'arch-flow-poll-root',
              openChatSessionId: 'arch-flow-poll-root',
              openGraphRunId: 'flow-poll',
              flowDefinitionId: 'goal_guard_delivery_loop',
              status: 'running',
              startMode: 'durable',
              returnMode: 'summary',
              createdAt: 1,
              updatedAt: 2,
            },
            result: {
              flowRunId: 'flow-poll',
              childSessionId: 'arch-flow-poll-root',
              openChatSessionId: 'arch-flow-poll-root',
              openGraphRunId: 'flow-poll',
              status: 'running',
              summary: 'Goal Guard is still running.',
              decisions: [],
              nextActions: ['Keep watching the durable run.'],
              artifacts: [],
            },
            events: [],
          },
        })
        .mockResolvedValueOnce({
          data: {
            run: {
              id: 'flow-poll',
              parentSessionId: 'session-1',
              childSessionId: 'arch-flow-poll-root',
              openChatSessionId: 'arch-flow-poll-root',
              openGraphRunId: 'flow-poll',
              flowDefinitionId: 'goal_guard_delivery_loop',
              status: 'done',
              startMode: 'durable',
              returnMode: 'summary',
              createdAt: 1,
              updatedAt: 5,
              finishedAt: 5,
            },
            result: {
              flowRunId: 'flow-poll',
              childSessionId: 'arch-flow-poll-root',
              openChatSessionId: 'arch-flow-poll-root',
              openGraphRunId: 'flow-poll',
              status: 'done',
              summary: 'Goal Guard accepted the final evidence.',
              decisions: ['accepted after QA'],
              nextActions: [],
              artifacts: ['qa/proof.md'],
            },
            events: [],
          },
        });

      render(
        <HistoryToolCallBubble
          toolName="run_sub_agentflow"
          content={JSON.stringify({
            flowRunId: 'flow-poll',
            childSessionId: 'arch-flow-poll-root',
            status: 'running',
            summary: 'AgentFlow goal_guard_delivery_loop started.',
            decisions: [],
            nextActions: ['Open the child AgentFlow graph to monitor completion.'],
            artifacts: [],
            openChatSessionId: 'arch-flow-poll-root',
            openGraphRunId: 'flow-poll',
          })}
          args={{ flowId: 'goal_guard_delivery_loop', goal: 'Build project' }}
        />,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByTestId('sub-agentflow-result')).toHaveTextContent('Goal Guard is still running.');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByTestId('sub-agentflow-result')).toHaveTextContent('done');
      expect(screen.getByText('Goal Guard accepted the final evidence.')).toBeInTheDocument();
      expect(apiClient.get).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * REGRESSION tests for ToolCallBubble rendering.
 *
 * Focus:
 * 1. RA-App widget renders INSIDE the chip (not outside the agent bubble)
 * 2. HistoryToolCallBubble collapses widget when isAnswered flips to true
 * 3. LiveToolCallBubble auto-expands when RA-App result arrives after mount
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { HistoryToolCallBubble, LiveToolCallBubble, extractRAAppBlock } from './ToolCallBubble';
import type { ToolActivity } from '../../store/agentStore';
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

// ── HistoryToolCallBubble tests ───────────────────────────────────────────────

describe('REGRESSION: HistoryToolCallBubble — RA-App widget inside chip', () => {
  it('preserves vfsPath when extracting html RA-App blocks', () => {
    const block = extractRAAppBlock({
      status: 'ready',
      type: 'html',
      mode: 'display',
      content: '',
      vfsPath: 'design/preview.html',
    });

    expect(block).toMatchObject({
      type: 'html',
      mode: 'display',
      content: '',
      vfsPath: 'design/preview.html',
    });
  });

  it('renders RAAppRenderer when content has RA-App block', () => {
    render(<HistoryToolCallBubble toolName="run_raapp" content={GUI_TOOL_RESULT} isAnswered={false} />);
    expect(screen.getByTestId('raapp-renderer')).toBeInTheDocument();
  });

  it('does NOT render RAAppRenderer for non-RA-App content', () => {
    render(<HistoryToolCallBubble toolName="list_raapps" content={NON_RAAPP_RESULT} />);
    expect(screen.queryByTestId('raapp-renderer')).not.toBeInTheDocument();
  });

  it('hides widget and shows freeze text when isAnswered=true', () => {
    render(<HistoryToolCallBubble toolName="run_raapp" content={GUI_TOOL_RESULT} isAnswered={true} />);
    expect(screen.queryByTestId('raapp-renderer')).not.toBeInTheDocument();
    expect(screen.getByText('Interactive app — answer submitted')).toBeInTheDocument();
  });

  it('shows "answered" badge when isAnswered=true', () => {
    render(<HistoryToolCallBubble toolName="run_raapp" content={GUI_TOOL_RESULT} isAnswered={true} />);
    expect(screen.getByText('↩ answered')).toBeInTheDocument();
  });

  it('collapses widget when isAnswered flips from false to true (live collapse)', () => {
    const { rerender } = render(
      <HistoryToolCallBubble toolName="run_raapp" content={GUI_TOOL_RESULT} isAnswered={false} />,
    );
    // Initially expanded — widget visible
    expect(screen.getByTestId('raapp-renderer')).toBeInTheDocument();

    // User answers → isAnswered becomes true
    act(() => {
      rerender(<HistoryToolCallBubble toolName="run_raapp" content={GUI_TOOL_RESULT} isAnswered={true} />);
    });

    // Widget should be gone, freeze text should appear
    expect(screen.queryByTestId('raapp-renderer')).not.toBeInTheDocument();
    expect(screen.getByText('Interactive app — answer submitted')).toBeInTheDocument();
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
});

// ── HistoryToolCallBubble args display ────────────────────────────────────────

describe('HistoryToolCallBubble — tool input args display', () => {
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

describe('REGRESSION: run_subagent bubble renders child RAApp', () => {
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
});

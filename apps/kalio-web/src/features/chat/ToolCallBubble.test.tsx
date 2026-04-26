/**
 * REGRESSION tests for ToolCallBubble rendering.
 *
 * Focus:
 * 1. RA-App widget renders INSIDE the chip (not outside the agent bubble)
 * 2. HistoryToolCallBubble collapses widget when isAnswered flips to true
 * 3. LiveToolCallBubble auto-expands when RA-App result arrives after mount
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { HistoryToolCallBubble, LiveToolCallBubble } from './ToolCallBubble';
import type { ToolActivity } from '../../store/agentStore';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../raapp/RAAppRenderer', () => ({
  RAAppRenderer: ({ block }: { block: { type: string } }) => (
    <div data-testid="raapp-renderer" data-type={block.type}>RA-App Widget</div>
  ),
}));

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
});

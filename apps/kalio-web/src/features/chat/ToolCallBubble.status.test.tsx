import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ChatMessage } from '@kalio/types';
import { HistoryToolCallBubble, LiveToolCallBubble } from './ToolCallBubble';
import { useAgentStore, type ToolActivity } from '../../store/agentStore';
import { useSessionStore } from '../../store/sessionStore';

const sessionId = 'status-session';
const callId = 'denied-fs-list';
const deniedMessage = 'ACCESS_DENIED: path is outside allowed roots';

function message(content: string): ChatMessage {
  return { id: 'result-message', sessionId, role: 'tool_result', toolCallId: callId, content, createdAt: 1 };
}

function history(result: ChatMessage) {
  return <HistoryToolCallBubble toolName="fs_list" content={result.content} callId={result.toolCallId}
    parentSessionId={result.sessionId} args={{ path: '.' }} />;
}

function activity(status: ToolActivity['status'], errorMessage?: string): ToolActivity {
  return { callId, sessionId, toolName: 'fs_list', args: { path: '.' }, status, startedAt: 1, finishedAt: 2,
    ...(status === 'error' || status === 'cancelled' ? {
      result: { callId, status, errorMessage, errorCode: status === 'error' ? 'TOOL_EXECUTION_FAILED' : undefined },
    } : {}),
  };
}

beforeEach(() => {
  useAgentStore.setState({ toolActivities: [], cliChildProjections: {}, runtimeActivitySnapshots: {} });
  useSessionStore.setState({ activeSessionId: sessionId, sessions: [] });
});

describe('tool outcome with empty result data', () => {
  it.each([
    ['error', deniedMessage, 'denied'],
    ['error', 'Tool execution failed', 'failed'],
    ['cancelled', undefined, 'cancelled'],
  ] as const)('preserves %s from live through empty history to persisted DTO (%s)', (status, errorMessage, label) => {
    const live = activity(status, errorMessage);
    useAgentStore.setState({ toolActivities: [live] });
    const view = render(<LiveToolCallBubble activity={live} />);
    expect(within(screen.getByTestId('tool-call-chip')).getByText(label)).toBeInTheDocument();
    view.rerender(history(message('')));
    expect(within(screen.getByTestId('tool-call-chip')).getByText(label)).toBeInTheDocument();
    expect(screen.queryByText('unconfirmed')).not.toBeInTheDocument();
    // F5: only the actual ChatMessage DTO remains, with metadata serialized by the backend.
    view.unmount();
    useAgentStore.setState({ toolActivities: [] });
    render(history(JSON.parse(JSON.stringify(message(JSON.stringify({
      status, errorCode: live.result?.errorCode, errorMessage,
    })))) as ChatMessage));
    expect(within(screen.getByTestId('tool-call-chip')).getByText(label)).toBeInTheDocument();
    if (errorMessage) expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  it.each(['', '   ', '""', 'null'])('keeps unknown empty content %j unavailable, without success', (content) => {
    const { container } = render(history(message(content)));
    expect(screen.getByText('result unavailable')).toBeInTheDocument();
    expect(container.querySelector('.text-success')).toBeNull();
  });

  it('does not borrow a status from another session with the same call ID', () => {
    useAgentStore.setState({ toolActivities: [{ ...activity('error', deniedMessage), sessionId: 'other' }] });
    render(history(message('')));
    expect(screen.getByText('result unavailable')).toBeInTheDocument();
    expect(screen.queryByText('denied')).not.toBeInTheDocument();
  });

  it('keeps durable error ahead of a stale live success', () => {
    useAgentStore.setState({ toolActivities: [activity('success')] });
    render(history(message(JSON.stringify({ status: 'error', errorMessage: deniedMessage, data: '' }))));
    expect(screen.getByText('denied')).toBeInTheDocument();
  });

  it('preserves explicit denied payload status with empty data', () => {
    render(history(message(JSON.stringify({ status: 'denied', data: '' }))));
    expect(screen.getByText('denied')).toBeInTheDocument();
  });

  it('does not classify successful empty directory data as unavailable', () => {
    const { container } = render(history(message(JSON.stringify({ entries: [] }))));
    expect(screen.queryByText('result unavailable')).not.toBeInTheDocument();
    expect(container.querySelector('.text-success')).not.toBeNull();
  });
});

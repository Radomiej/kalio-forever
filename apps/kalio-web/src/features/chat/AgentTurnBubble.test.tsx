import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentTurnBubble } from './AgentTurnBubble';
import type { ChatMessage } from '@kalio/types';
import type { ToolActivity } from '../../store/agentStore';
import type { AgentTurn, AgentTurnItem } from '../../store/sessionStore';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockMessages: ChatMessage[] = [];

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: () => ({
    streamingChunks: {},
    thinkingChunks: {},
    messages: mockMessages,
  }),
}));

// Provide callIdToName with a known mapping for regression tests
const KNOWN_CALL_ID = 'call_1777207759460_1';
vi.mock('../../store/agentStore', () => ({
  useAgentStore: () => ({
    callIdToName: { [KNOWN_CALL_ID]: 'raapp_create' },
  }),
}));

vi.mock('../../components/markdown/MarkdownViewer', () => ({
  MarkdownViewer: ({ content }: { content: string }) => <div data-testid="markdown-viewer">{content}</div>,
}));

// Mock child tool call bubbles so we can assert their presence
vi.mock('./ToolCallBubble', () => ({
  LiveToolCallBubble: ({ activity }: { activity: ToolActivity }) => (
    <div data-testid={`live-tool-${activity.callId}`}>{activity.toolName}</div>
  ),
  HistoryToolCallBubble: ({ toolName, callId, isAnswered }: { toolName: string; callId: string; isAnswered?: boolean }) => (
    <div
      data-testid={`history-tool-${toolName}`}
      data-call-id={callId}
      data-answered={String(isAnswered ?? false)}
    >
      {toolName}
      {isAnswered && <span>Interactive app — answer submitted</span>}
    </div>
  ),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeMsg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg-1',
    sessionId: 's1',
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
    ...overrides,
  } as ChatMessage;
}

function makeTurn(items: AgentTurnItem[], done = true): AgentTurn {
  return {
    id: 'turn-1',
    sessionId: 's1',
    items,
    done,
  };
}

describe('AgentTurnBubble', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMessages.length = 0; // Clear mock messages
  });

  it('renders agent turn bubble with data-testid', () => {
    mockMessages.push(makeMsg({ id: 'msg-1', content: 'Hello' }));
    render(<AgentTurnBubble turn={makeTurn([{ kind: 'text', messageId: 'msg-1' }])} toolActivities={[]} />);
    expect(screen.getByTestId('agent-turn-bubble')).toBeInTheDocument();
  });

  it('shows thinking block when thinkingChunks exist', () => {
    // Override session store mock for this test
    vi.doMock('../../store/sessionStore', () => ({
      useSessionStore: () => ({
        streamingChunks: {},
        thinkingChunks: { 'msg-1': 'I need to think about this...' },
        messages: mockMessages,
      }),
    }));

    mockMessages.push(makeMsg({ id: 'msg-1', role: 'assistant', content: 'Hello' }));
    render(
      <AgentTurnBubble turn={makeTurn([{ kind: 'thinking', messageId: 'msg-1' }, { kind: 'text', messageId: 'msg-1' }])} toolActivities={[]} />
    );

    expect(screen.getByTestId('agent-turn-bubble')).toBeInTheDocument();
  });

  it('renders markdown for assistant content', () => {
    mockMessages.push(makeMsg({ id: 'msg-1', content: '**bold** text' }));
    render(<AgentTurnBubble turn={makeTurn([{ kind: 'text', messageId: 'msg-1' }])} toolActivities={[]} />);
    expect(screen.getByTestId('markdown-viewer')).toHaveTextContent('**bold** text');
  });

  it('renders history tool call bubbles for tool_result messages', () => {
    mockMessages.push(
      makeMsg({ id: 'msg-a', role: 'assistant', toolCalls: [{ id: 'tc-1', name: 'fs_read', args: {} }] }),
      makeMsg({ id: 'msg-t', role: 'tool_result', content: '{"ok":true}', toolCallId: 'tc-1' })
    );
    render(<AgentTurnBubble turn={makeTurn([{ kind: 'text', messageId: 'msg-a' }, { kind: 'tool', callId: 'tc-1' }])} toolActivities={[]} />);
    expect(screen.getByTestId('history-tool-fs_read')).toBeInTheDocument();
  });

  it('renders live tool activities not yet in messages', () => {
    mockMessages.push(makeMsg({ id: 'msg-a', role: 'assistant', content: 'Hello' }));
    const activities: ToolActivity[] = [
      { callId: 'tc-live', toolName: 'fs_write', args: {}, status: 'running', startedAt: Date.now() },
    ];
    render(<AgentTurnBubble turn={makeTurn([{ kind: 'text', messageId: 'msg-a' }, { kind: 'tool', callId: 'tc-live' }])} toolActivities={activities} />);
    expect(screen.getByTestId('live-tool-tc-live')).toBeInTheDocument();
  });

  it('skips live activities already present as tool_result messages', () => {
    mockMessages.push(
      makeMsg({ id: 'msg-a', role: 'assistant', content: 'Hello' }),
      makeMsg({ id: 'msg-t', role: 'tool_result', content: '{"ok":true}', toolCallId: 'tc-1' })
    );
    const activities: ToolActivity[] = [
      { callId: 'tc-1', toolName: 'fs_write', args: {}, status: 'success', startedAt: Date.now(), finishedAt: Date.now() },
    ];
    render(<AgentTurnBubble turn={makeTurn([{ kind: 'text', messageId: 'msg-a' }, { kind: 'tool', callId: 'tc-1' }])} toolActivities={activities} />);
    expect(screen.queryByTestId('live-tool-tc-1')).not.toBeInTheDocument();
  });

  it('shows streaming indicator when message is streaming with no content', () => {
    mockMessages.push(makeMsg({ id: 'msg-1', streaming: true, content: '' }));
    render(<AgentTurnBubble turn={makeTurn([{ kind: 'text', messageId: 'msg-1' }], false)} toolActivities={[]} />);
    expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument();
  });

  it('REGRESSION: hides streaming indicator after agent:done even if msg.streaming is still true', () => {
    // Scenario: backend sent agent:start, created a placeholder message,
    // but no chat:chunk ever arrived and no chat:complete was emitted.
    // Then agent:done fires, setting turn.done=true, but msg.streaming stays true.
    mockMessages.push(makeMsg({ id: 'msg-1', streaming: true, content: '' }));
    render(<AgentTurnBubble turn={makeTurn([{ kind: 'text', messageId: 'msg-1' }], true)} toolActivities={[]} />);
    expect(screen.queryByTestId('streaming-indicator')).not.toBeInTheDocument();
  });
});

// ── REGRESSION: multi-turn quiz ordering ────────────────────────────────────

describe('REGRESSION: multi-turn quiz — tool chip ordering preserved', () => {
  function makeToolResult(id: string, callId: string): ChatMessage {
    return makeMsg({ id, role: 'tool_result', content: '{"type":"gui"}', toolCallId: callId });
  }

  it('renders 3 sequential run_raapp chips in correct order with answeredCallIds', () => {
    mockMessages.push(
      makeMsg({ id: 'a1', role: 'assistant', toolCalls: [{ id: 'tc-1', name: 'list_raapps', args: {} }] }),
      makeToolResult('t1', 'tc-1'),
      makeMsg({ id: 'a2', role: 'assistant', toolCalls: [{ id: 'tc-2', name: 'run_raapp', args: {} }] }),
      makeToolResult('t2', 'tc-2'),
      makeMsg({ id: 'a3', role: 'assistant', toolCalls: [{ id: 'tc-3', name: 'run_raapp', args: {} }] }),
      makeToolResult('t3', 'tc-3')
    );
    const answeredCallIds = new Set(['tc-2']);

    render(
      <AgentTurnBubble
        turn={makeTurn([
          { kind: 'text', messageId: 'a1' },
          { kind: 'tool', callId: 'tc-1' },
          { kind: 'text', messageId: 'a2' },
          { kind: 'tool', callId: 'tc-2' },
          { kind: 'text', messageId: 'a3' },
          { kind: 'tool', callId: 'tc-3' },
        ])}
        toolActivities={[]}
        answeredCallIds={answeredCallIds}
      />,
    );

    const chips = screen.getAllByTestId(/^history-tool-/);
    expect(chips).toHaveLength(3);
    expect(chips[0]).toHaveAttribute('data-testid', 'history-tool-list_raapps');
    expect(chips[1]).toHaveAttribute('data-testid', 'history-tool-run_raapp');
    expect(chips[2]).toHaveAttribute('data-testid', 'history-tool-run_raapp');

    // tc-2 answered, tc-3 not yet
    expect(chips[1]).toHaveAttribute('data-answered', 'true');
    expect(chips[2]).toHaveAttribute('data-answered', 'false');
  });

  it('renders 10 sequential run_raapp chips in order without duplication', () => {
    const items: AgentTurnItem[] = [];
    for (let i = 1; i <= 10; i++) {
      mockMessages.push(
        makeMsg({ id: `a${i}`, role: 'assistant', toolCalls: [{ id: `tc-${i}`, name: 'run_raapp', args: {} }] }),
        makeToolResult(`t${i}`, `tc-${i}`)
      );
      items.push({ kind: 'text', messageId: `a${i}` }, { kind: 'tool', callId: `tc-${i}` });
    }

    render(
      <AgentTurnBubble
        turn={makeTurn(items)}
        toolActivities={[]}
        answeredCallIds={new Set(['tc-1', 'tc-2', 'tc-3', 'tc-4', 'tc-5', 'tc-6', 'tc-7', 'tc-8', 'tc-9'])}
      />,
    );

    const chips = screen.getAllByTestId('history-tool-run_raapp');
    expect(chips).toHaveLength(10);

    chips.slice(0, 9).forEach((chip) => expect(chip).toHaveAttribute('data-answered', 'true'));
    expect(chips[9]).toHaveAttribute('data-answered', 'false');
  });

  it('non-last turn gets toolActivities=[] — no live chips in history turns', () => {
    mockMessages.push(
      makeMsg({ id: 'a1', role: 'assistant', toolCalls: [{ id: 'tc-1', name: 'run_raapp', args: {} }] }),
      makeToolResult('t1', 'tc-1')
    );
    const liveActivities = [
      { callId: 'tc-live', toolName: 'run_raapp', args: {}, status: 'running' as const, startedAt: Date.now() },
    ];

    render(
      <AgentTurnBubble turn={makeTurn([{ kind: 'text', messageId: 'a1' }, { kind: 'tool', callId: 'tc-1' }])} toolActivities={[]} answeredCallIds={new Set()} />
    );
    expect(screen.queryByTestId('live-tool-tc-live')).not.toBeInTheDocument();

    render(
      <AgentTurnBubble turn={makeTurn([{ kind: 'tool', callId: 'tc-live' }])} toolActivities={liveActivities} answeredCallIds={new Set()} />
    );
    expect(screen.getByTestId('live-tool-tc-live')).toBeInTheDocument();
  });

  it('live activity already resolved in messages does not render as live chip', () => {
    mockMessages.push(
      makeMsg({ id: 'a1', role: 'assistant', toolCalls: [{ id: 'tc-resolved', name: 'run_raapp', args: {} }] }),
      makeToolResult('t1', 'tc-resolved')
    );
    const activities = [
      { callId: 'tc-resolved', toolName: 'run_raapp', args: {}, status: 'success' as const, startedAt: Date.now(), finishedAt: Date.now() },
    ];

    render(
      <AgentTurnBubble turn={makeTurn([{ kind: 'text', messageId: 'a1' }, { kind: 'tool', callId: 'tc-resolved' }])} toolActivities={activities} answeredCallIds={new Set()} />
    );

    expect(screen.queryByTestId('live-tool-tc-resolved')).not.toBeInTheDocument();
    expect(screen.getByTestId('history-tool-run_raapp')).toBeInTheDocument();
  });

  it('tool_result without matching toolCalls renders inline after its assistant (streaming placeholder case)', () => {
    mockMessages.push(
      makeMsg({ id: 'assistant-1', role: 'assistant', content: 'First response' }),
      makeMsg({ id: 'tool-1', role: 'tool_result', content: '{"result":1}', toolCallId: 'call-1' }),
      makeMsg({ id: 'assistant-2', role: 'assistant', content: 'Second response' }),
      makeMsg({ id: 'tool-2', role: 'tool_result', content: '{"result":2}', toolCallId: 'call-2' })
    );

    render(
      <AgentTurnBubble turn={makeTurn([
        { kind: 'text', messageId: 'assistant-1' },
        { kind: 'tool', callId: 'call-1' },
        { kind: 'text', messageId: 'assistant-2' },
        { kind: 'tool', callId: 'call-2' },
      ])} toolActivities={[]} answeredCallIds={new Set()} />
    );

    const markdowns = screen.getAllByTestId('markdown-viewer');
    expect(markdowns).toHaveLength(2);
    expect(markdowns[0]).toHaveTextContent('First response');
    expect(markdowns[1]).toHaveTextContent('Second response');

    const chips = screen.getAllByTestId(/^history-tool-/);
    expect(chips).toHaveLength(2);
  });
});

// ── REGRESSION tests (bugs reported via screenshot) ─────────────────────────

describe('REGRESSION: tool chip shows resolved name, not raw call ID', () => {
  it('uses callIdToName from agentStore when msg.toolCalls is absent', () => {
    mockMessages.push(
      makeMsg({ id: 'msg-a', role: 'assistant', content: '' }),
      makeMsg({ id: 'msg-t', role: 'tool_result', content: '{"ok":true}', toolCallId: KNOWN_CALL_ID })
    );
    render(<AgentTurnBubble turn={makeTurn([{ kind: 'text', messageId: 'msg-a' }, { kind: 'tool', callId: KNOWN_CALL_ID }])} toolActivities={[]} />);

    expect(screen.getByTestId('history-tool-raapp_create')).toBeInTheDocument();
    expect(screen.queryByTestId(`history-tool-${KNOWN_CALL_ID}`)).not.toBeInTheDocument();
  });

  it('msg.toolCalls takes precedence over callIdToName (DB-loaded turn)', () => {
    mockMessages.push(
      makeMsg({
        id: 'msg-a',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: KNOWN_CALL_ID, name: 'run_raapp', args: {} }],
      }),
      makeMsg({ id: 'msg-t', role: 'tool_result', content: '{"ok":true}', toolCallId: KNOWN_CALL_ID })
    );
    render(<AgentTurnBubble turn={makeTurn([{ kind: 'text', messageId: 'msg-a' }, { kind: 'tool', callId: KNOWN_CALL_ID }])} toolActivities={[]} />);

    expect(screen.getByTestId('history-tool-run_raapp')).toBeInTheDocument();
  });
});

describe('REGRESSION: RA-App freezes after user answers', () => {
  const RAAPP_CALL_ID = 'call_raapp_99';

  it('passes isAnswered=false when callId not in answeredCallIds', () => {
    mockMessages.push(
      makeMsg({ id: 'msg-a', role: 'assistant', toolCalls: [{ id: RAAPP_CALL_ID, name: 'raapp_create', args: {} }] }),
      makeMsg({ id: 'msg-t', role: 'tool_result', content: '{}', toolCallId: RAAPP_CALL_ID })
    );
    render(
      <AgentTurnBubble
        turn={makeTurn([{ kind: 'text', messageId: 'msg-a' }, { kind: 'tool', callId: RAAPP_CALL_ID }])}
        toolActivities={[]}
        answeredCallIds={new Set()}
      />,
    );

    const chip = screen.getByTestId('history-tool-raapp_create');
    expect(chip.getAttribute('data-answered')).toBe('false');
    expect(screen.queryByText('Interactive app — answer submitted')).not.toBeInTheDocument();
  });

  it('passes isAnswered=true and shows freeze text when callId is in answeredCallIds', () => {
    mockMessages.push(
      makeMsg({ id: 'msg-a', role: 'assistant', toolCalls: [{ id: RAAPP_CALL_ID, name: 'raapp_create', args: {} }] }),
      makeMsg({ id: 'msg-t', role: 'tool_result', content: '{}', toolCallId: RAAPP_CALL_ID })
    );
    render(
      <AgentTurnBubble
        turn={makeTurn([{ kind: 'text', messageId: 'msg-a' }, { kind: 'tool', callId: RAAPP_CALL_ID }])}
        toolActivities={[]}
        answeredCallIds={new Set([RAAPP_CALL_ID])}
      />,
    );

    const chip = screen.getByTestId('history-tool-raapp_create');
    expect(chip.getAttribute('data-answered')).toBe('true');
    expect(screen.getByText('Interactive app — answer submitted')).toBeInTheDocument();
  });
});

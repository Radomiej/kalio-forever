import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
const mockAgentStoreState = {
  callIdToName: { [KNOWN_CALL_ID]: 'raapp_create' },
  toolArgProgress: null as { toolName: string; totalChars: number; charsPerSec: number } | null,
  setCanvasOpen: vi.fn(),
  setCanvasFocus: vi.fn(),
};

vi.mock('../../store/agentStore', () => ({
  useAgentStore: () => ({
    callIdToName: mockAgentStoreState.callIdToName,
    toolArgProgress: mockAgentStoreState.toolArgProgress,
    setCanvasOpen: mockAgentStoreState.setCanvasOpen,
    setCanvasFocus: mockAgentStoreState.setCanvasFocus,
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
  HistoryToolCallBubble: ({ toolName, callId, isAnswered, defaultOpenOverride }: { toolName: string; callId: string; isAnswered?: boolean; defaultOpenOverride?: boolean }) => (
    <div
      data-testid={`history-tool-${toolName}`}
      data-call-id={callId}
      data-answered={String(isAnswered ?? false)}
      data-default-open={defaultOpenOverride === undefined ? 'unset' : String(defaultOpenOverride)}
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
    mockAgentStoreState.toolArgProgress = null;
    mockAgentStoreState.setCanvasOpen.mockClear();
    mockAgentStoreState.setCanvasFocus.mockClear();
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

  it('REGRESSION: shows tool intent before any argument chars are streamed', () => {
    mockAgentStoreState.toolArgProgress = { toolName: 'raapp_create', totalChars: 0, charsPerSec: 0 };

    render(<AgentTurnBubble turn={makeTurn([], false)} toolActivities={[]} />);

    expect(screen.getByTestId('turn-loading-indicator')).toHaveTextContent('Preparing');
    expect(screen.getByTestId('turn-loading-indicator')).toHaveTextContent('raapp_create');
  });

  it('renders an architecture route timeline and opens the run canvas', () => {
    mockMessages.push(makeMsg({
      id: 'msg-arch',
      content: '### Finalizer',
      architectureRun: {
        runId: 'run-1',
        schemaId: 'strategic-decision-council',
        status: 'completed',
        finalArtifact: 'Final answer',
        trace: [
          {
            speaker: 'router',
            content: 'Dispatch to council branches',
            nodeId: 'router',
            nextNodeId: 'pragmatist',
          },
          {
            speaker: 'participant',
            content: 'Pragmatist branch result',
            nodeId: 'pragmatist',
            nextNodeId: 'router',
            stream: {
              streamGroupId: 'run-1',
              branchSessionId: 'branch-pragmatist',
              status: 'completed',
              chunkCount: 12,
              text: 'Pragmatist branch result',
            },
          },
          {
            speaker: 'participant',
            content: 'Shadow branch result',
            nodeId: 'shadow',
            nextNodeId: 'router',
          },
          {
            speaker: 'router',
            content: 'Merge council outputs',
            nodeId: 'router',
            nextNodeId: 'final-artifact',
            visitIndex: 2,
          },
          {
            speaker: 'finalizer',
            content: 'Final answer',
            nodeId: 'final-artifact',
          },
        ],
        routeHops: [],
      },
    }));

    render(<AgentTurnBubble turn={makeTurn([{ kind: 'text', messageId: 'msg-arch' }])} toolActivities={[]} />);

    expect(screen.getByTestId('architecture-run-timeline')).toHaveTextContent('strategic-decision-council');
    expect(screen.getByTestId('architecture-route-shell')).toHaveTextContent('Router');
    expect(screen.getByTestId('architecture-route-shell')).toHaveTextContent('Sub-agents');
    expect(screen.getByTestId('architecture-route-shell')).toHaveTextContent('Finalizer');
    expect(screen.getByTestId('architecture-route-parallel-agents')).toHaveTextContent('Pragmatist');
    expect(screen.getByTestId('architecture-route-parallel-agents')).toHaveTextContent('Shadow');
    expect(screen.getAllByTestId('architecture-route-router')).toHaveLength(2);
    expect(screen.getByTestId('architecture-route-finalizer')).toHaveTextContent('Final answer');
    expect(screen.getByTestId('architecture-final-answer')).toHaveTextContent('Final answer');

    fireEvent.click(screen.getByTestId('open-architecture-run-canvas'));

    expect(mockAgentStoreState.setCanvasFocus).toHaveBeenCalledWith({
      kind: 'architecture-run',
      runId: 'run-1',
    });

    fireEvent.click(screen.getAllByTestId('architecture-route-agent')[0]);

    expect(mockAgentStoreState.setCanvasFocus).toHaveBeenLastCalledWith({
      kind: 'architecture-branch',
      sessionId: 'branch-pragmatist',
    });
  });

  it('keeps architecture sub-agent tool calls discoverable under the route timeline', () => {
    mockMessages.push(
      makeMsg({
        id: 'msg-arch',
        content: '### Finalizer',
        toolCalls: [{ id: 'tc-subagent', name: 'run_subagent', args: { nodeId: 'pragmatist' } }],
        architectureRun: {
          runId: 'run-1',
          schemaId: 'strategic-decision-council',
          status: 'completed',
          trace: [
            {
              speaker: 'router',
              content: 'Dispatch to council branches',
              nodeId: 'router',
              nextNodeId: 'pragmatist',
            },
            {
              speaker: 'participant',
              content: 'Pragmatist branch result',
              nodeId: 'pragmatist',
              nextNodeId: 'router',
              stream: {
                streamGroupId: 'run-1',
                branchSessionId: 'branch-pragmatist',
                status: 'completed',
                chunkCount: 12,
                text: 'Pragmatist branch result',
              },
            },
          ],
          routeHops: [],
        },
      }),
      makeMsg({
        id: 'tool-subagent',
        role: 'tool_result',
        toolCallId: 'tc-subagent',
        content: JSON.stringify({
          childSessionId: 'branch-pragmatist',
          parentSessionId: 's1',
          vfsMode: 'isolated',
          vfsSessionId: 'branch-pragmatist',
          copiedFiles: [],
          result: 'Pragmatist branch result',
          taskId: 'task-1',
          durationMs: 100,
        }),
      }),
    );

    render(<AgentTurnBubble turn={makeTurn([{ kind: 'text', messageId: 'msg-arch' }, { kind: 'tool', callId: 'tc-subagent' }])} toolActivities={[]} />);

    expect(screen.getByTestId('architecture-run-timeline')).toHaveTextContent('Router -> Pragmatist');
    expect(screen.getByTestId('history-tool-run_subagent')).toHaveAttribute('data-default-open', 'unset');
  });

  it('hides duplicate router and finalizer markdown when the route timeline is present', () => {
    mockMessages.push(makeMsg({
      id: 'router-msg',
      content: '### Router\n\nVerbose router body',
      architectureRun: {
        runId: 'run-1',
        schemaId: 'strategic-decision-council',
        status: 'completed',
        finalArtifact: 'Compact final body',
        trace: [
          {
            speaker: 'router',
            content: 'Compact router body',
            nodeId: 'router',
            nextNodeId: 'final-artifact',
          },
          {
            speaker: 'finalizer',
            content: 'Compact final body',
            nodeId: 'final-artifact',
          },
        ],
        routeHops: [],
      },
    }));

    render(<AgentTurnBubble turn={makeTurn([{ kind: 'text', messageId: 'router-msg' }])} toolActivities={[]} />);

    expect(screen.getByTestId('architecture-run-timeline')).toBeInTheDocument();
    expect(screen.queryByText('Verbose router body')).not.toBeInTheDocument();
    expect(screen.getByTestId('architecture-final-answer')).toHaveTextContent('Compact final body');
  });

  it('renders the finalizer trace as final answer when finalArtifact metadata is missing', () => {
    mockMessages.push(makeMsg({
      id: 'finalizer-msg',
      content: '### Finalizer\n\nVerbose duplicated body',
      architectureRun: {
        runId: 'run-1',
        schemaId: 'strategic-decision-council',
        status: 'completed',
        trace: [
          {
            speaker: 'router',
            content: 'Router merged branches',
            nodeId: 'router',
            nextNodeId: 'final-artifact',
          },
          {
            speaker: 'finalizer',
            content: 'Trace final answer survives metadata drift',
            nodeId: 'final-artifact',
          },
        ],
        routeHops: [],
      },
    }));

    render(<AgentTurnBubble turn={makeTurn([{ kind: 'text', messageId: 'finalizer-msg' }])} toolActivities={[]} />);

    expect(screen.getByTestId('architecture-run-timeline')).toBeInTheDocument();
    expect(screen.queryByText('Verbose duplicated body')).not.toBeInTheDocument();
    expect(screen.getByTestId('architecture-final-answer')).toHaveTextContent('Trace final answer survives metadata drift');
  });

  it('renders a partial architecture route without a premature finalizer stage', () => {
    mockMessages.push(makeMsg({
      id: 'msg-partial-arch',
      content: '### Router',
      architectureRun: {
        runId: 'run-partial',
        schemaId: 'strategic-decision-council',
        status: 'running',
        trace: [
          {
            speaker: 'router',
            content: 'Dispatch started',
            nodeId: 'router',
            nextNodeId: 'pragmatist',
          },
          {
            speaker: 'participant',
            content: 'Pragmatist is streaming',
            nodeId: 'pragmatist',
            nextNodeId: 'router',
            stream: {
              streamGroupId: 'run-partial',
              branchSessionId: 'branch-pragmatist',
              status: 'streaming',
              chunkCount: 3,
              text: 'Pragmatist is streaming',
            },
          },
        ],
        routeHops: [],
      },
    }));

    render(<AgentTurnBubble turn={makeTurn([{ kind: 'text', messageId: 'msg-partial-arch' }], false)} toolActivities={[]} />);

    expect(screen.getByTestId('architecture-run-timeline')).toHaveTextContent('running / 2 graph steps');
    expect(screen.getByTestId('architecture-route-agent')).toHaveTextContent('streaming');
    expect(screen.queryByTestId('architecture-route-finalizer')).not.toBeInTheDocument();
  });

  it('renders a sequential router chain without collapsing agents into a parallel group', () => {
    mockMessages.push(makeMsg({
      id: 'msg-sequential-arch',
      content: '### Finalizer',
      architectureRun: {
        runId: 'run-sequential',
        schemaId: 'qa-route-hops',
        status: 'completed',
        trace: [
          {
            speaker: 'router',
            content: 'Route to first reviewer',
            nodeId: 'router-entry',
            nextNodeId: 'agent-one',
          },
          {
            speaker: 'participant',
            content: 'Agent one reviewed the prompt',
            nodeId: 'agent-one',
            nextNodeId: 'router-check',
            stream: {
              streamGroupId: 'run-sequential',
              branchSessionId: 'branch-agent-one',
              status: 'completed',
              chunkCount: 8,
              text: 'Agent one reviewed the prompt',
            },
          },
          {
            speaker: 'router',
            content: 'Route to second reviewer',
            nodeId: 'router-check',
            nextNodeId: 'agent-two',
          },
          {
            speaker: 'participant',
            content: 'Agent two validated the result',
            nodeId: 'agent-two',
            nextNodeId: 'router-final',
            stream: {
              streamGroupId: 'run-sequential',
              branchSessionId: 'branch-agent-two',
              status: 'completed',
              chunkCount: 9,
              text: 'Agent two validated the result',
            },
          },
          {
            speaker: 'router',
            content: 'Route to final answer',
            nodeId: 'router-final',
            nextNodeId: 'final-artifact',
          },
          {
            speaker: 'finalizer',
            content: 'Final routed answer',
            nodeId: 'final-artifact',
          },
        ],
        routeHops: [],
      },
    }));

    render(<AgentTurnBubble turn={makeTurn([{ kind: 'text', messageId: 'msg-sequential-arch' }])} toolActivities={[]} />);

    expect(screen.getByTestId('architecture-route-shell')).toHaveTextContent('Router -> Agent One -> Router -> Agent Two -> Router -> Finalizer');
    expect(screen.queryByTestId('architecture-route-parallel-agents')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('architecture-route-agent')).toHaveLength(2);
    expect(screen.getAllByTestId('architecture-route-router')).toHaveLength(3);
    expect(screen.getByTestId('architecture-route-finalizer')).toHaveTextContent('Final routed answer');
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

// ─────────────────────────────────────────────────────────────────────────────
// turn.error indicator
// ─────────────────────────────────────────────────────────────────────────────

describe('turn.error indicator', () => {
  it('renders turn-error-indicator when turn.error is set', () => {
    const turn: AgentTurn = {
      ...makeTurn([{ kind: 'text', messageId: 'msg-1' }], true),
      error: { code: 'INTERRUPTED', message: 'Turn interrupted by user' },
    };
    mockMessages.push(makeMsg({ id: 'msg-1', content: 'Partial answer' }));
    render(<AgentTurnBubble turn={turn} toolActivities={[]} />);
    expect(screen.getByTestId('turn-error-indicator')).toBeInTheDocument();
    expect(screen.getByText('Interrupted')).toBeInTheDocument();
  });

  it('renders MAX_ITERATIONS_REACHED label', () => {
    const turn: AgentTurn = {
      ...makeTurn([{ kind: 'text', messageId: 'msg-1' }], true),
      error: { code: 'MAX_ITERATIONS_REACHED', message: 'Agent loop exceeded 8 iterations' },
    };
    mockMessages.push(makeMsg({ id: 'msg-1', content: 'Some content' }));
    render(<AgentTurnBubble turn={turn} toolActivities={[]} />);
    expect(screen.getByTestId('turn-error-indicator')).toBeInTheDocument();
    expect(screen.getByText('Reached iteration limit')).toBeInTheDocument();
  });

  it('does not render turn-error-indicator when turn.error is undefined', () => {
    const turn = makeTurn([{ kind: 'text', messageId: 'msg-1' }], true);
    mockMessages.push(makeMsg({ id: 'msg-1', content: 'Full answer' }));
    render(<AgentTurnBubble turn={turn} toolActivities={[]} />);
    expect(screen.queryByTestId('turn-error-indicator')).not.toBeInTheDocument();
  });
});

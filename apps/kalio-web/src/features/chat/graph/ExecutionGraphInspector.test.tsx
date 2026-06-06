import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@kalio/types';
import { ExecutionGraphInspector } from './ExecutionGraphInspector';
import type { ExecutionGraphNode, ExecutionGraphNodePayload } from './executionGraphModel';

function makePromptNode(): ExecutionGraphNode {
  const message: ChatMessage = {
    id: 'message-1234567890',
    sessionId: 'session-1234567890',
    role: 'user',
    content: 'What can you do?',
    createdAt: 1,
  };

  return {
    id: 'node-1234567890',
    kind: 'prompt',
    title: 'What can you do?',
    subtitle: 'User task root',
    status: 'success',
    column: 0,
    row: 0,
    x: 0,
    y: 0,
    width: 220,
    height: 120,
    sessionId: 'session-1234567890',
    payload: {
      kind: 'prompt',
      message,
    },
  };
}

function makeNode(payload: ExecutionGraphNodePayload, overrides: Partial<ExecutionGraphNode> = {}): ExecutionGraphNode {
  return {
    id: 'node-1',
    kind: payload.kind,
    title: 'Node',
    subtitle: 'Node subtitle',
    status: 'success',
    column: 0,
    row: 0,
    x: 0,
    y: 0,
    width: 220,
    height: 120,
    payload,
    ...overrides,
  };
}

describe('ExecutionGraphInspector', () => {
  it('keeps session ids and raw payload hidden until explicitly expanded', () => {
    render(
      <ExecutionGraphInspector
        activeSessionId="session-1234567890"
        inspectorWidth={360}
        selectedConfirmation={null}
        selectedNode={makePromptNode()}
        setActiveSession={vi.fn()}
        setPendingConfirmation={vi.fn()}
        setPendingMessage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('graph-inspector-expand'));

    expect(screen.getByText('Node Properties')).toBeTruthy();
    expect(screen.getByText('state:')).toBeTruthy();
    expect(screen.getByText('ready')).toBeTruthy();
    expect(screen.queryByText('Session')).toBeNull();
    expect(screen.queryByText(/session-1234567890/)).toBeNull();
    expect(screen.queryByText(/"message"/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Session')).toBeTruthy();
    expect(screen.getByText('sessio...7890')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show raw' }));
    expect(screen.getByText(/"message"/)).toBeTruthy();
  });

  it('collapses node properties into a compact rail and restores it on demand', () => {
    render(
      <ExecutionGraphInspector
        activeSessionId="session-1234567890"
        inspectorWidth={360}
        selectedConfirmation={null}
        selectedNode={makePromptNode()}
        setActiveSession={vi.fn()}
        setPendingConfirmation={vi.fn()}
        setPendingMessage={vi.fn()}
      />,
    );

    expect(screen.getByTestId('graph-inspector-expand')).toBeTruthy();
    fireEvent.click(screen.getByTestId('graph-inspector-expand'));
    fireEvent.click(screen.getByTestId('graph-inspector-collapse'));
    expect(screen.queryByText('Prompt details')).toBeNull();
    expect(screen.getByTestId('graph-inspector-expand')).toBeTruthy();

    fireEvent.click(screen.getByTestId('graph-inspector-expand'));
    expect(screen.getByText('Node Properties')).toBeTruthy();
  });

  it('keeps the inspector collapsed across node selection changes until the user expands it', () => {
    const firstNode = makeNode({
      kind: 'turn',
      turn: { id: 'turn-1', sessionId: 'session-1', promptMessageId: 'prompt-1', done: true, items: [] } as never,
      textPreview: 'First node.',
      toolCount: 1,
      thinkingCount: 0,
      thinkingPreviews: [],
      actorLabel: 'Builder',
      modelLabel: 'mimo-v2.5',
    }, { id: 'turn-node-1', title: 'First node' });
    const secondNode = makeNode({
      kind: 'tool',
      toolName: 'vfs_read',
      args: {},
      activity: null,
      result: null,
      confirmationRequired: false,
    }, { id: 'tool-node-1', title: 'Second node' });

    const { rerender } = render(
      <ExecutionGraphInspector
        activeSessionId="session-1"
        inspectorWidth={360}
        selectedConfirmation={null}
        selectedNode={firstNode}
        setActiveSession={vi.fn()}
        setPendingConfirmation={vi.fn()}
        setPendingMessage={vi.fn()}
      />,
    );

    expect(screen.getByText('Turn details')).toBeTruthy();
    fireEvent.click(screen.getByTestId('graph-inspector-collapse'));
    expect(screen.queryByText('Turn details')).toBeNull();

    rerender(
      <ExecutionGraphInspector
        activeSessionId="session-1"
        inspectorWidth={360}
        selectedConfirmation={null}
        selectedNode={secondNode}
        setActiveSession={vi.fn()}
        setPendingConfirmation={vi.fn()}
        setPendingMessage={vi.fn()}
      />,
    );

    expect(screen.queryByText('Tool details')).toBeNull();
    expect(screen.getByText('Second node')).toBeTruthy();

    fireEvent.click(screen.getByTestId('graph-inspector-expand'));
    expect(screen.getByText('Tool details')).toBeTruthy();
  });

  it('shows compact architecture tool evidence without expanding raw payload', () => {
    render(
      <ExecutionGraphInspector
        activeSessionId="arch-run-root"
        inspectorWidth={360}
        selectedConfirmation={null}
        selectedNode={{
          id: 'architecture-root:materializer',
          kind: 'architecture-run',
          title: 'Materializer',
          subtitle: 'role / completed / branch session',
          status: 'success',
          column: 1,
          row: 0,
          x: 0,
          y: 0,
          width: 220,
          height: 140,
          payload: {
            kind: 'architecture-run',
            summary: {
              runId: 'run-tool-proof-123456',
              schemaId: 'architecture-run',
              status: 'completed',
              trace: [],
              routeHops: [],
            },
            route: {
              eventId: 'event-1',
              source: 'runtime_fallback',
              fromNodeId: 'materializer',
              toNodeId: 'verifier',
              toolEvidence: {
                toolCallCount: 2,
                toolResultCount: 2,
                toolNames: ['vfs_write', 'vfs_read'],
                successfulToolNames: ['vfs_write', 'vfs_read'],
              },
            },
          },
        }}
        setActiveSession={vi.fn()}
        setPendingConfirmation={vi.fn()}
        setPendingMessage={vi.fn()}
      />,
    );

    expect(screen.getByText('Tool proof')).toBeTruthy();
    expect(screen.getByText('2 result(s), success: vfs_write, vfs_read')).toBeTruthy();
    expect(screen.getByText('Flow')).toBeTruthy();
    expect(screen.getByText('materializer -> verifier')).toBeTruthy();
    expect(screen.queryByText(/"toolEvidence"/)).toBeNull();
  });

  it('keeps architecture stream and branch internals behind details', () => {
    const setActiveSession = vi.fn();

    render(
      <ExecutionGraphInspector
        activeSessionId="arch-run-root"
        inspectorWidth={360}
        selectedConfirmation={null}
        selectedNode={{
          id: 'architecture-root:router',
          kind: 'architecture-run',
          title: 'Router',
          subtitle: 'router / completed / branch session',
          status: 'success',
          column: 1,
          row: 0,
          x: 0,
          y: 0,
          width: 220,
          height: 140,
          sessionId: 'branch-session-1234567890',
          payload: {
            kind: 'architecture-run',
            summary: {
              runId: 'run-router-123456',
              schemaId: 'architecture-run',
              status: 'completed',
              trace: [],
              routeHops: [],
            },
            route: {
              eventId: 'event-1',
              source: 'runtime_fallback',
              fromNodeId: 'architecture-root:router',
              toNodeId: 'architecture-root:final-artifact',
              streamStatus: 'completed',
              chunkCount: 42,
              branchSessionId: 'branch-session-1234567890',
            },
          },
        }}
        setActiveSession={setActiveSession}
        setPendingConfirmation={vi.fn()}
        setPendingMessage={vi.fn()}
      />,
    );

    expect(screen.getByText('router -> final artifact')).toBeTruthy();
    expect(screen.queryByText('Stream')).toBeNull();
    expect(screen.queryByText('Branch')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Stream')).toBeTruthy();
    expect(screen.getByText('completed / 42 chunks')).toBeTruthy();
    expect(screen.getByText('Branch')).toBeTruthy();
    expect(screen.getAllByText('branch...7890').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Open child chat' }));
    expect(setActiveSession).toHaveBeenCalledWith('branch-session-1234567890');
  });

  it('shows incomplete architecture evidence without expanding raw payload', () => {
    render(
      <ExecutionGraphInspector
        activeSessionId="arch-run-root"
        inspectorWidth={360}
        selectedConfirmation={null}
        selectedNode={{
          id: 'architecture-root:goal-master',
          kind: 'architecture-run',
          title: 'Goal Master',
          subtitle: 'router / completed / branch session',
          status: 'success',
          column: 1,
          row: 0,
          x: 0,
          y: 0,
          width: 220,
          height: 140,
          payload: {
            kind: 'architecture-run',
            summary: {
              runId: 'run-incomplete-123456',
              schemaId: 'architecture-run',
              status: 'running',
              trace: [],
              routeHops: [],
            },
            route: {
              eventId: 'event-1',
              source: 'runtime_fallback',
              fromNodeId: 'goal-master',
              toNodeId: 'implementer',
              incompleteReason: 'Subagent exhausted its tool loop without producing a final answer.',
            },
          },
        }}
        setActiveSession={vi.fn()}
        setPendingConfirmation={vi.fn()}
        setPendingMessage={vi.fn()}
      />,
    );

    expect(screen.getByText('Incomplete')).toBeTruthy();
    expect(screen.getByText('Subagent exhausted its tool loop without producing a final answer.')).toBeTruthy();
    expect(screen.queryByText(/"incompleteReason"/)).toBeNull();
  });

  it('renders grouped tool status rows without exposing raw payload by default', () => {
    render(
      <ExecutionGraphInspector
        activeSessionId="session-1"
        inspectorWidth={360}
        selectedConfirmation={null}
        selectedNode={{
          id: 'tool-group-1',
          kind: 'tool-group',
          title: 'Grouped tools',
          subtitle: 'Execution step',
          status: 'running',
          column: 1,
          row: 0,
          x: 0,
          y: 0,
          width: 220,
          height: 140,
          payload: {
            kind: 'tool-group',
            tools: [
              {
                callId: 'call-1',
                toolName: 'vfs_read',
                args: {},
                status: 'running',
                result: null,
                confirmationRequired: false,
              },
              {
                callId: 'call-2',
                toolName: 'vfs_write',
                args: {},
                status: 'error',
                result: null,
                confirmationRequired: false,
              },
            ],
          },
        }}
        setActiveSession={vi.fn()}
        setPendingConfirmation={vi.fn()}
        setPendingMessage={vi.fn()}
      />,
    );

    expect(screen.getAllByText('Grouped tools').length).toBe(2);
    expect(screen.getByText('vfs_read')).toBeTruthy();
    expect(screen.getAllByText('running').length).toBe(2);
    expect(screen.getByText('vfs_write')).toBeTruthy();
    expect(screen.getAllByText('error').length).toBe(1);
    expect(screen.queryByText(/"tools"/)).toBeNull();
  });

  it('opens the linked child graph for an AgentFlow node', () => {
    const setActiveSession = vi.fn();

    render(
      <ExecutionGraphInspector
        activeSessionId="session-1"
        inspectorWidth={360}
        selectedConfirmation={null}
        selectedNode={{
          id: 'agent-flow:flow-1',
          kind: 'agent-flow',
          title: 'Sub AgentFlow',
          subtitle: 'flow-1 / running',
          status: 'running',
          column: 1,
          row: 0,
          x: 0,
          y: 0,
          width: 220,
          height: 140,
          sessionId: 'flow-child-1',
          callId: 'call-flow-1',
          payload: {
            kind: 'agent-flow',
            childExecutionKind: 'sub_agentflow',
            result: {
              flowRunId: 'flow-1',
              childSessionId: 'flow-child-1',
              openChatSessionId: 'flow-child-1',
              openGraphRunId: 'flow-1',
              status: 'running',
              summary: 'Goal Guard flow is running.',
              decisions: [],
              nextActions: [],
              artifacts: [],
            },
            childSessionId: 'flow-child-1',
            graphRunId: 'flow-1',
            inputPrompt: 'Verify delivery',
          },
        }}
        onOpenSessionInConversation={undefined}
        setActiveSession={setActiveSession}
        setPendingConfirmation={vi.fn()}
        setPendingMessage={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'AgentFlow run' })).toBeTruthy();
    expect(screen.getByText('running')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open child graph' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open child graph' }));

    expect(setActiveSession).toHaveBeenCalledWith('flow-child-1');
  });

  it('shows an awaiting reply state for a final response node without a message yet', () => {
    render(
      <ExecutionGraphInspector
        activeSessionId="session-1"
        inspectorWidth={360}
        selectedConfirmation={null}
        selectedNode={{
          id: 'final:turn-1',
          kind: 'final-answer',
          title: 'Final response',
          subtitle: 'Last chat reply',
          status: 'running',
          column: 2,
          row: 0,
          x: 0,
          y: 0,
          width: 220,
          height: 120,
          payload: {
            kind: 'final-answer',
            message: null,
            turn: { id: 'turn-1', sessionId: 'session-1', promptMessageId: 'prompt-1', done: false, items: [] } as never,
          },
        }}
        setActiveSession={vi.fn()}
        setPendingConfirmation={vi.fn()}
        setPendingMessage={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Final response' })).toBeTruthy();
    expect(screen.getByText('Awaiting reply')).toBeTruthy();
  });

  it('keeps long node preview text collapsed until the user asks for details', () => {
    const longPreview = [
      'Router synthesis: choose Next.js with Postgres and search.',
      'Evidence: five persona branches completed, each with a separate recommendation and risk note.',
      'Decision details should stay available without turning the inspector into a long reading pane.',
      'Follow-up: expose the full raw developer payload only when someone explicitly needs it.',
    ].join(' ');

    render(
      <ExecutionGraphInspector
        activeSessionId="session-1"
        inspectorWidth={360}
        selectedConfirmation={null}
        selectedNode={makeNode({
          kind: 'turn',
          turn: { id: 'turn-1', sessionId: 'session-1', promptMessageId: 'prompt-1', done: true, items: [] } as never,
          textPreview: longPreview,
          toolCount: 2,
          thinkingCount: 0,
          thinkingPreviews: [],
          actorLabel: 'Strategist',
          modelLabel: 'mimo-v2.5',
        })}
        setActiveSession={vi.fn()}
        setPendingConfirmation={vi.fn()}
        setPendingMessage={vi.fn()}
      />,
    );

    expect(screen.getByText(longPreview)).toHaveClass('line-clamp-4');
    fireEvent.click(screen.getByRole('button', { name: 'Expand Preview' }));
    expect(screen.getByText(longPreview)).not.toHaveClass('line-clamp-4');
    expect(screen.getByRole('button', { name: 'Collapse Preview' })).toBeInTheDocument();
  });

  it('keeps long transcript tail entries collapsed inside the inspector', () => {
    const longTranscript = [
      'The branch reviewed the graph state, identified the route decision, listed the selected tools,',
      'and then produced a verbose explanation that should not dominate the node properties panel until expanded.',
      'The full text remains available because detailed audit work still needs source material.',
    ].join(' ');

    render(
      <ExecutionGraphInspector
        activeSessionId="session-1"
        inspectorWidth={360}
        selectedConfirmation={null}
        selectedNode={makeNode({
          kind: 'subagent',
          childExecutionKind: 'sub_agent',
          result: { childSessionId: 'child-session-1', result: 'Done', taskId: 'task-1' } as never,
          transcript: [{ id: 'message-1', sessionId: 'session-1', role: 'assistant', content: longTranscript, createdAt: 1 }],
          copiedFiles: [],
          actorLabel: 'UX Designer',
          modelLabel: 'mimo-v2.5',
          inputPrompt: 'Review the graph layout',
        })}
        setActiveSession={vi.fn()}
        setPendingConfirmation={vi.fn()}
        setPendingMessage={vi.fn()}
      />,
    );

    expect(screen.getByText(longTranscript)).toHaveClass('line-clamp-4');
    fireEvent.click(screen.getByRole('button', { name: 'Expand Agent' }));
    expect(screen.getByText(longTranscript)).not.toHaveClass('line-clamp-4');
  });

  it.each([
    [
      'turn',
      'Turn details',
      makeNode({
        kind: 'turn',
        turn: { id: 'turn-1', sessionId: 'session-1', promptMessageId: 'prompt-1', done: true, items: [] } as never,
        textPreview: 'Turn finished cleanly.',
        toolCount: 2,
        thinkingCount: 1,
        thinkingPreviews: [],
        actorLabel: 'RaBuilder',
        modelLabel: 'gpt-4.1',
      }),
    ],
    [
      'tool',
      'Tool details',
      makeNode({
        kind: 'tool',
        toolName: 'vfs_read',
        args: { path: 'draft.txt' },
        activity: null,
        result: null,
        confirmationRequired: true,
      }),
    ],
    [
      'subagent',
      'Sub-agent details',
      makeNode({
        kind: 'subagent',
        childExecutionKind: 'sub_agent',
        result: { childSessionId: 'child-session-1', result: 'Done', taskId: 'task-1' } as never,
        transcript: [],
        copiedFiles: [],
        actorLabel: 'UX Designer',
        modelLabel: 'gpt-4.1',
        inputPrompt: 'Review the graph layout',
      }),
    ],
    [
      'cli-agent',
      'CLI child details',
      makeNode({
        kind: 'cli-agent',
        childExecutionKind: 'cli_agent',
        snapshot: {
          childSessionId: 'cli-child-1',
          parentSessionId: 'session-1',
          agentId: 'codex',
          workdir: 'C:/Projekty/kalio-forever',
          status: 'running',
          lastPrompt: 'Inspect repo',
          updatedAt: 1,
        } as never,
        transcript: [],
        inputPrompt: 'Inspect repo',
      }),
    ],
    [
      'agent-flow',
      'AgentFlow run',
      makeNode({
        kind: 'agent-flow',
        childExecutionKind: 'sub_agentflow',
        result: {
          flowRunId: 'flow-1',
          childSessionId: 'flow-child-1',
          openChatSessionId: 'flow-child-1',
          openGraphRunId: 'flow-1',
          status: 'running',
          summary: 'Goal Guard flow is running.',
          decisions: [],
          nextActions: [],
          artifacts: [],
        } as never,
        childSessionId: 'flow-child-1',
        graphRunId: 'flow-1',
        inputPrompt: 'Verify delivery',
      }),
    ],
    [
      'tool-result',
      'Tool result fallback',
      makeNode({
        kind: 'tool-result',
        toolName: 'run_subagent',
        result: { childSessionId: 'child-session-1', status: 'done' },
        reason: 'Unrecognized child-agent result shape',
      }),
    ],
    [
      'artifact',
      'Artifact details',
      makeNode({
        kind: 'artifact',
        artifact: {
          id: 'artifact:wireframe.svg',
          kind: 'file',
          label: 'wireframe.svg',
          subtitle: 'sub-agents/child-session-1/wireframe.svg',
          path: 'sub-agents/child-session-1/wireframe.svg',
          preview: '128 bytes copied',
          payload: {},
        },
      }),
    ],
    [
      'final-answer',
      'Final response',
      makeNode({
        kind: 'final-answer',
        message: { id: 'message-1', sessionId: 'session-1', role: 'assistant', content: 'Done.', createdAt: 1 } as ChatMessage,
        turn: { id: 'turn-1', sessionId: 'session-1', promptMessageId: 'prompt-1', done: true, items: [] } as never,
      }),
    ],
  ] as const)('shows the %s payload title', (_kind, expectedTitle, selectedNode) => {
    render(
      <ExecutionGraphInspector
        activeSessionId="session-1"
        inspectorWidth={360}
        selectedConfirmation={null}
        selectedNode={selectedNode}
        setActiveSession={vi.fn()}
        setPendingConfirmation={vi.fn()}
        setPendingMessage={vi.fn()}
      />,
    );

    expect(screen.getByText(expectedTitle)).toBeInTheDocument();
  });
});

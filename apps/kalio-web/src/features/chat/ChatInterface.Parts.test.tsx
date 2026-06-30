import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ChatMessage, ChatSession, Persona } from '@kalio/types';
import type { ArchitectSchema } from '../architect/architect.types';
import { useAgentStore } from '../../store/agentStore';
import { useSessionStore } from '../../store/sessionStore';
import { buildCopiedChatText, ChatSessionHeader, ChatWelcomeScreen } from './ChatInterface.Parts';
import { DEFAULT_TEST_PERSONA_AVATAR } from '../../test/personaFixtures';

vi.mock('../vfs/ConversationFilesBar', () => ({
  ConversationFilesBar: () => <div data-testid="conversation-files-bar" />,
}));

vi.mock('./TokenBadge', () => ({
  TokenBadge: () => <div data-testid="token-badge" />,
}));

vi.mock('./ContextStats', () => ({
  ContextStats: () => <div data-testid="context-stats" />,
}));

function msg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'id-default',
    sessionId: 'sess-1',
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
    ...overrides,
  } as ChatMessage;
}

describe('buildCopiedChatText', () => {
  it('includes user and assistant content', () => {
    const messages = [
      msg({ id: 'm1', role: 'user', content: 'Hello' }),
      msg({ id: 'm2', role: 'assistant', content: 'Hi there' }),
    ];
    const text = buildCopiedChatText(messages);
    expect(text).toContain('You:');
    expect(text).toContain('Hello');
    expect(text).toContain('Kalio:');
    expect(text).toContain('Hi there');
  });

  it('includes thinking block when present', () => {
    const messages = [
      msg({ id: 'm1', role: 'user', content: 'Why is the sky blue?' }),
      msg({ id: 'm2', role: 'assistant', content: 'Rayleigh scattering', thinking: 'Let me reason about this...' }),
    ];
    const text = buildCopiedChatText(messages);
    expect(text).toContain('[Thinking]');
    expect(text).toContain('Let me reason about this...');
    expect(text).toContain('[/Thinking]');
    expect(text).toContain('Rayleigh scattering');
  });

  it('includes tool calls inlined under assistant message', () => {
    const messages = [
      msg({ id: 'm1', role: 'user', content: 'Search for cats' }),
      msg({
        id: 'm2',
        role: 'assistant',
        content: 'Let me search for you.',
        toolCalls: [{ id: 'tc-1', name: 'web_search', args: { query: 'cats' } }],
      }),
      msg({ id: 'm3', role: 'tool_result', content: 'Found 42 results about cats', toolCallId: 'tc-1' }),
    ];
    const text = buildCopiedChatText(messages);
    expect(text).toContain('[Tool: web_search');
    expect(text).toContain('Found 42 results about cats');
    // tool_result should NOT appear as its own separate Kalio: entry
    const kalioCount = (text.match(/^Kalio:/gm) ?? []).length;
    expect(kalioCount).toBe(1);
  });

  it('omits system messages', () => {
    const messages = [
      msg({ id: 'm0', role: 'system', content: 'You are a helpful assistant.' }),
      msg({ id: 'm1', role: 'user', content: 'Hi' }),
    ];
    const text = buildCopiedChatText(messages);
    expect(text).not.toContain('You are a helpful assistant.');
  });

  it('omits standalone tool_result messages from top-level entries', () => {
    const messages = [
      msg({ id: 'm1', role: 'assistant', content: '', toolCalls: [{ id: 'tc-1', name: 'read_file', args: { path: '/tmp/x' } }] }),
      msg({ id: 'm2', role: 'tool_result', content: 'file content here', toolCallId: 'tc-1' }),
    ];
    const text = buildCopiedChatText(messages);
    // result should be inlined, not appear as a separate "Kalio:" line
    const entries = text.split('\n').filter((l) => /^(You|Kalio):/.test(l));
    expect(entries).toHaveLength(1);
  });

  it('handles assistant message with no thinking and no tool calls gracefully', () => {
    const messages = [
      msg({ id: 'm1', role: 'assistant', content: 'Plain response' }),
    ];
    const text = buildCopiedChatText(messages);
    expect(text).toBe('Kalio:\nPlain response');
  });
});

describe('ChatWelcomeScreen', () => {
  it('shows a waiting placeholder for empty child sessions instead of the launch screen', () => {
    useAgentStore.setState((state) => ({
      ...state,
      sessionStatusSnapshots: {},
      runtimeActivitySnapshots: {},
    }));
    useSessionStore.setState((state) => ({
      ...state,
      sessionMessages: {},
    }));
    render(
      <ChatWelcomeScreen
        activeSession={{
          ...session(),
          id: 'branch-1',
          title: 'Strategic Decision Council: Analyst',
          kind: 'subagent',
          parentSessionId: 'arch-root',
          runtimeContext: {
            runtimeKind: 'agent-flow-branch',
            architectureContext: {
              displayLabel: 'Analyst',
            },
          },
        }}
        activeSessionId="branch-1"
        architectures={[schema()]}
        isStreaming={false}
        onArchitectureChange={vi.fn()}
        onArchitectureRun={vi.fn()}
        onDraftChange={vi.fn()}
        onPersonaChange={vi.fn()}
        onProjectPathChange={vi.fn()}
        onSend={vi.fn()}
        personas={[persona()]}
        projectPath=""
        selectedPersonaId="default"
        selectedArchitectureId="single-chat"
      />,
    );

    expect(screen.getByTestId('pending-child-session-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-run-prompt')).not.toBeInTheDocument();
    expect(screen.getByText('Pending before the first persisted message')).toBeInTheDocument();
  });

  it('shows live child-session activity from the host workflow trace', () => {
    useAgentStore.setState((state) => ({
      ...state,
      sessionStatusSnapshots: {
        'branch-1': {
          sessionId: 'branch-1',
          active: true,
          turnId: 'turn-1',
          queueLength: 0,
          run: {
            id: 'run-1',
            sessionId: 'branch-1',
            turnId: 'turn-1',
            phase: 'tool_running',
            status: 'active',
            retryCount: 0,
            safeResume: true,
            startedAt: 1,
            updatedAt: 2,
            lastHeartbeatAt: 2,
          },
        },
      },
      runtimeActivitySnapshots: {},
    }));
    useSessionStore.setState((state) => ({
      ...state,
      sessionMessages: {
        'host-1': [
          msg({
            id: 'host-msg-1',
            sessionId: 'host-1',
            role: 'assistant',
            content: '',
            architectureRun: {
              runId: 'run-1',
              schemaId: 'Architecture Debate',
              status: 'running',
              hostProjectionKind: 'workflow-envelope',
              trace: [{
                speaker: 'participant',
                sessionId: 'branch-1',
                nodeId: 'analyst',
                content: 'Researcher is inspecting project evidence.',
                actionSummary: 'Researcher is inspecting project evidence.',
                detail: 'fs_read -> src/App.tsx',
              }],
              routeHops: [],
            },
          }),
        ],
      },
    }));

    render(
      <ChatWelcomeScreen
        activeSession={{
          ...session(),
          id: 'branch-1',
          title: 'Strategic Decision Council: Analyst',
          kind: 'subagent',
          parentSessionId: 'arch-root',
          runtimeContext: {
            runtimeKind: 'agent-flow-branch',
            architectureContext: {
              displayLabel: 'Analyst',
              hostSessionId: 'host-1',
              architectureRunId: 'run-1',
              roleSlotId: 'analyst',
            },
            architectureSlotId: 'analyst',
          },
        }}
        activeSessionId="branch-1"
        architectures={[schema()]}
        isStreaming={false}
        onArchitectureChange={vi.fn()}
        onArchitectureRun={vi.fn()}
        onDraftChange={vi.fn()}
        onPersonaChange={vi.fn()}
        onProjectPathChange={vi.fn()}
        onSend={vi.fn()}
        personas={[persona()]}
        projectPath=""
        selectedPersonaId="default"
        selectedArchitectureId="single-chat"
      />,
    );

    expect(screen.getByText('Running before the first persisted message')).toBeInTheDocument();
    expect(screen.getByText('Current activity')).toBeInTheDocument();
    expect(screen.getByText('Researcher is inspecting project evidence.')).toBeInTheDocument();
    expect(screen.getByText('fs_read -> src/App.tsx')).toBeInTheDocument();
  });

  it('runs the prompt through the selected architecture instead of direct chat', () => {
    const onArchitectureRun = vi.fn();
    const onSend = vi.fn();
    const onArchitectureChange = vi.fn();
    render(
      <ChatWelcomeScreen
        activeSession={session()}
        activeSessionId="sess-1"
        architectures={[schema()]}
        isStreaming={false}
        onArchitectureChange={onArchitectureChange}
        onArchitectureRun={onArchitectureRun}
        onDraftChange={vi.fn()}
        onPersonaChange={vi.fn()}
        onProjectPathChange={vi.fn()}
        onSend={onSend}
        personas={[persona()]}
        projectPath=""
        selectedPersonaId="default"
        selectedArchitectureId="strategic-decision-council"
      />,
    );

    expect(onArchitectureChange).toHaveBeenCalledWith('single-chat');
    expect(screen.getByTestId('welcome-persona-select')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-architecture-select')).not.toBeInTheDocument();
    expect(screen.getByTestId('welcome-routing-summary')).toHaveTextContent('Chat runtime: Default');

    fireEvent.click(screen.getByTestId('welcome-mode-workflow'));
    expect(screen.queryByTestId('welcome-persona-select')).not.toBeInTheDocument();
    expect(screen.getByTestId('welcome-architecture-select')).toBeInTheDocument();
    expect(screen.getByTestId('welcome-routing-summary')).toHaveTextContent('Workflow runtime: Strategic Decision Council');

    fireEvent.change(screen.getByTestId('welcome-prompt-input'), {
      target: { value: 'Decide with the council.' },
    });
    fireEvent.click(screen.getByTestId('welcome-run-prompt'));

    expect(onArchitectureRun).toHaveBeenCalledWith('Decide with the council.', 'strategic-decision-council');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps direct chat available when Single Chat is selected', () => {
    const onArchitectureRun = vi.fn();
    const onSend = vi.fn();
    render(
      <ChatWelcomeScreen
        activeSession={session()}
        activeSessionId="sess-1"
        architectures={[schema()]}
        isStreaming={false}
        onArchitectureChange={vi.fn()}
        onArchitectureRun={onArchitectureRun}
        onDraftChange={vi.fn()}
        onPersonaChange={vi.fn()}
        onProjectPathChange={vi.fn()}
        onSend={onSend}
        personas={[persona()]}
        projectPath=""
        selectedPersonaId="default"
        selectedArchitectureId="single-chat"
      />,
    );

    expect(screen.getByTestId('welcome-persona-select')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-architecture-select')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('welcome-prompt-input'), {
      target: { value: 'Answer normally.' },
    });
    fireEvent.click(screen.getByTestId('welcome-run-prompt'));

    expect(onSend).toHaveBeenCalledWith('Answer normally.', 'default');
    expect(onArchitectureRun).not.toHaveBeenCalled();
    expect(screen.getByTestId('welcome-routing-summary')).toHaveTextContent('Chat runtime: Default');
  });

  it('swaps persona and workflow controls when the launch mode changes', () => {
    const onArchitectureChange = vi.fn();
    const onPersonaChange = vi.fn();

    render(
      <ChatWelcomeScreen
        activeSession={session()}
        activeSessionId="sess-1"
        architectures={[schema()]}
        isStreaming={false}
        onArchitectureChange={onArchitectureChange}
        onArchitectureRun={vi.fn()}
        onDraftChange={vi.fn()}
        onPersonaChange={onPersonaChange}
        onProjectPathChange={vi.fn()}
        onSend={vi.fn()}
        personas={[persona(), persona({ id: 'qa', name: 'QA' })]}
        projectPath=""
        selectedPersonaId="default"
        selectedArchitectureId="single-chat"
      />,
    );

    fireEvent.change(screen.getByTestId('welcome-persona-select'), {
      target: { value: 'qa' },
    });
    expect(onPersonaChange).toHaveBeenCalledWith('qa');

    fireEvent.click(screen.getByTestId('welcome-mode-workflow'));
    expect(screen.queryByTestId('welcome-persona-select')).not.toBeInTheDocument();
    expect(screen.getByTestId('welcome-architecture-select')).toHaveValue('strategic-decision-council');
    expect(onArchitectureChange).toHaveBeenCalledWith('strategic-decision-council');

    fireEvent.click(screen.getByTestId('welcome-mode-chat'));
    expect(screen.getByTestId('welcome-persona-select')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-architecture-select')).not.toBeInTheDocument();
  });

  it('keeps the project path editable for launch scope', () => {
    const onProjectPathChange = vi.fn();

    render(
      <ChatWelcomeScreen
        activeSession={session()}
        activeSessionId="sess-1"
        architectures={[schema()]}
        isStreaming={false}
        onArchitectureChange={vi.fn()}
        onArchitectureRun={vi.fn()}
        onDraftChange={vi.fn()}
        onPersonaChange={vi.fn()}
        onProjectPathChange={onProjectPathChange}
        onSend={vi.fn()}
        personas={[persona()]}
        projectPath="C:\\Projekty\\kalio-forever"
        selectedPersonaId="default"
        selectedArchitectureId="single-chat"
      />,
    );

    fireEvent.change(screen.getByTestId('welcome-project-path-input'), {
      target: { value: 'C:\\Projekty\\family-quest' },
    });

    expect(onProjectPathChange).toHaveBeenCalledWith('C:\\Projekty\\family-quest');
  });

  it('disables launch controls while the active host session is still pending creation', () => {
    render(
      <ChatWelcomeScreen
        activeSession={{
          ...session(),
          id: 'pending-host-session:temp-1',
          title: 'New Chat',
          runtimeContext: { runtimeKind: 'chat', pendingHostSession: true },
        }}
        activeSessionId="pending-host-session:temp-1"
        architectures={[schema()]}
        isStreaming={false}
        onArchitectureChange={vi.fn()}
        onArchitectureRun={vi.fn()}
        onDraftChange={vi.fn()}
        onPersonaChange={vi.fn()}
        onProjectPathChange={vi.fn()}
        onSend={vi.fn()}
        personas={[persona()]}
        projectPath=""
        selectedPersonaId="default"
        selectedArchitectureId="single-chat"
      />,
    );

    expect(screen.getByTestId('welcome-prompt-input')).toBeDisabled();
    expect(screen.getByTestId('welcome-run-prompt')).toBeDisabled();
  });

});

describe('ChatSessionHeader', () => {
  it('does not mount the files bar while the active host session is still pending creation', () => {
    render(
      <ChatSessionHeader
        activeContext={{ systemPrompt: null, activeToolNames: [] }}
        activeModel="mimo-v2.5"
        activeSession={{
          ...session(),
          id: 'pending-host-session:temp-1',
          runtimeContext: { runtimeKind: 'chat', pendingHostSession: true },
        }}
        activeSessionId="pending-host-session:temp-1"
        copied={false}
        messages={[]}
        needsCompact={false}
        onCloseContextStats={vi.fn()}
        onCompactNow={vi.fn()}
        onCopyChat={vi.fn()}
        onToggleContextStats={vi.fn()}
        showContextStats={false}
        tokenCount={{
          total: 0,
          breakdown: { systemPrompt: 0, skills: 0, tools: 0, history: 0, images: 0 },
          cacheable: 0,
          contextLimit: 32000,
          usagePercent: 0,
        }}
        contextPreview={null}
        contextPreviewStatus={{ loading: false, stale: false, error: null }}
        vfsRefreshSignal={0}
      />,
    );

    expect(screen.queryByTestId('conversation-files-bar')).not.toBeInTheDocument();
  });

  it('shows architecture label from runtimeContext when the active session is an architecture session', () => {
    render(
      <ChatSessionHeader
        activeContext={{ systemPrompt: null, activeToolNames: [] }}
        activeModel="mimo-v2.5"
        activeSession={{
          ...session(),
          runtimeContext: {
            runtimeKind: 'agent-flow-branch',
            architectureContext: {
              displayLabel: 'Strategic Decision Council',
            },
          },
        }}
        activeSessionId="sess-1"
        copied={false}
        messages={[]}
        needsCompact={false}
        onCloseContextStats={vi.fn()}
        onCompactNow={vi.fn()}
        onCopyChat={vi.fn()}
        onToggleContextStats={vi.fn()}
        showContextStats={false}
        tokenCount={{
          total: 0,
          breakdown: { systemPrompt: 0, skills: 0, tools: 0, history: 0, images: 0 },
          cacheable: 0,
          contextLimit: 32000,
          usagePercent: 0,
        }}
        contextPreview={null}
        contextPreviewStatus={{ loading: false, stale: false, error: null }}
        vfsRefreshSignal={0}
      />,
    );

    expect(screen.getByTestId('chat-session-architecture-label')).toHaveTextContent('Strategic Decision Council');
  });

  it('shows architecture label for a parent chat from architecture run messages', () => {
    const messages = [
      msg({ id: 'user-1', role: 'user', content: 'Review this architecture' }),
      msg({
        id: 'assistant-tools',
        role: 'assistant',
        content: '',
        toolCalls: [{
          id: 'architecture:run-1:event-1',
          name: 'run_subagent',
          args: {
            architectureRunId: 'run-1',
            schemaName: 'Strategic Decision Council',
            nodeId: 'pragmatist',
          },
        }],
      }),
      msg({
        id: 'assistant-final',
        role: 'assistant',
        content: '### Finalizer\n\nDecision made',
        architectureRun: {
          runId: 'run-1',
          schemaId: 'strategic-decision-council',
          status: 'completed',
          trace: [],
          routeHops: [],
        },
      }),
    ];

    render(
      <ChatSessionHeader
        activeContext={{ systemPrompt: null, activeToolNames: [] }}
        activeModel="mimo-v2.5"
        activeSession={session()}
        activeSessionId="sess-1"
        copied={false}
        messages={messages}
        needsCompact={false}
        onCloseContextStats={vi.fn()}
        onCompactNow={vi.fn()}
        onCopyChat={vi.fn()}
        onToggleContextStats={vi.fn()}
        showContextStats={false}
        tokenCount={{
          total: 0,
          breakdown: { systemPrompt: 0, skills: 0, tools: 0, history: 0, images: 0 },
          cacheable: 0,
          contextLimit: 32000,
          usagePercent: 0,
        }}
        contextPreview={null}
        contextPreviewStatus={{ loading: false, stale: false, error: null }}
        vfsRefreshSignal={0}
      />,
    );

    expect(screen.getByTestId('chat-session-architecture-label')).toHaveTextContent('Strategic Decision Council');
  });
});

function session(): ChatSession {
  return {
    id: 'sess-1',
    personaId: 'default',
    title: 'New Chat',
    kind: 'chat',
    createdAt: 1,
    updatedAt: 1,
  };
}

function schema(): ArchitectSchema {
  return {
    id: 'strategic-decision-council',
    version: '0.1.0',
    name: 'Strategic Decision Council',
    description: 'Parallel role deliberation',
    nodes: [],
    edges: [],
    roleSlots: [],
    contextPolicy: {
      includeUserTask: true,
      includeProjectMemory: false,
      includeBrowserSession: false,
      includePriorDecisions: false,
    },
    routerPolicy: {
      mode: 'rank_then_merge',
      mustAddressCriticFindings: true,
      canReturnNeedsMoreResearch: true,
    },
    memoryPolicy: {
      persistFinalArtifact: true,
      persistRouterDecision: true,
    },
    outputArtifactSchema: 'decision',
  };
}

function persona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: 'default',
    name: 'Default',
    systemPrompt: 'You are helpful.',
    model: 'mimo-v2.5',
    allowedTools: [],
    skillIds: [],
    mcpPolicy: 'deny_all',
    ...DEFAULT_TEST_PERSONA_AVATAR,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

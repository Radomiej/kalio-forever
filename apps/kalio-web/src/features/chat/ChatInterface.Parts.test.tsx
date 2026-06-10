import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ChatMessage, ChatSession, Persona } from '@kalio/types';
import type { ArchitectSchema } from '../architect/architect.types';
import { buildCopiedChatText, ChatWelcomeScreen } from './ChatInterface.Parts';

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
  it('runs the prompt through the selected architecture instead of direct chat', () => {
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
        onSend={onSend}
        personas={[persona()]}
        selectedArchitectureId="strategic-decision-council"
      />,
    );

    fireEvent.change(screen.getByTestId('welcome-prompt-input'), {
      target: { value: 'Decide with the council.' },
    });
    fireEvent.click(screen.getByTestId('welcome-run-prompt'));

    expect(onArchitectureRun).toHaveBeenCalledWith('Decide with the council.', 'strategic-decision-council');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByTestId('welcome-routing-summary')).toHaveTextContent('Graph runtime: Strategic Decision Council');
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
        onSend={onSend}
        personas={[persona()]}
        selectedArchitectureId="single-chat"
      />,
    );

    fireEvent.change(screen.getByTestId('welcome-prompt-input'), {
      target: { value: 'Answer normally.' },
    });
    fireEvent.click(screen.getByTestId('welcome-run-prompt'));

    expect(onSend).toHaveBeenCalledWith('Answer normally.', 'default');
    expect(onArchitectureRun).not.toHaveBeenCalled();
    expect(screen.getByTestId('welcome-routing-summary')).toHaveTextContent('Direct chat runtime');
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

function persona(): Persona {
  return {
    id: 'default',
    name: 'Default',
    systemPrompt: '',
    model: 'mock',
    allowedTools: [],
    skillIds: [],
    mcpPolicy: 'allow_all',
    avatarSeed: 'default',
    avatarVariant: 'marble',
    avatarPaletteKey: 'ocean',
    avatarIndex: 0,
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

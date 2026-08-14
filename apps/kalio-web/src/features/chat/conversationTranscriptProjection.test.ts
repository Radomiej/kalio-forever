import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSession } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';
import { resolveRenderableConversationProjection } from './conversationTranscriptProjection';

const branchSession: ChatSession = {
  id: 'branch-1',
  personaId: 'default',
  title: 'Strategic Decision Council: Analyst',
  parentSessionId: 'host-1',
  createdAt: 1,
  updatedAt: 1,
  runtimeContext: {
    runtimeKind: 'agent-flow-branch',
    architectureContext: {
      hostSessionId: 'host-1',
      historySessionId: 'host-1',
      sessionSurface: 'conversation-branch',
    },
  },
};

describe('resolveRenderableConversationProjection', () => {
  it('drops an optimistic workflow envelope when a typed projection owns the same prompt', () => {
    const hostSession: ChatSession = {
      id: 'host-1', personaId: 'default', title: 'Host', createdAt: 1, updatedAt: 1,
    };
    const messages: ChatMessage[] = [
      { id: 'pending-1', sessionId: 'host-1', role: 'assistant', content: 'Display text can change.', createdAt: 2 },
      {
        id: 'projection-1', sessionId: 'host-1', role: 'assistant', content: '', createdAt: 3,
        architectureRun: {
          runId: 'run-1', schemaId: 'strategic-decision-council', status: 'running', trace: [], routeHops: [],
        },
      },
    ];
    const turns: AgentTurn[] = [
      {
        id: 'optimistic-turn', sessionId: 'host-1', promptMessageId: 'prompt-1',
        turnKind: 'workflow-envelope', items: [{ kind: 'text', messageId: 'pending-1' }], done: false,
      },
      {
        id: 'typed-turn', sessionId: 'host-1', promptMessageId: 'prompt-1',
        turnKind: 'workflow-envelope', items: [{ kind: 'text', messageId: 'projection-1' }], done: false,
      },
    ];

    const projection = resolveRenderableConversationProjection({ session: hostSession, messages, agentTurns: turns });

    expect(projection.agentTurns).toEqual([turns[1]]);
    expect(projection.messages.map((message) => message.id)).toEqual(['projection-1']);
  });

  it('drops raw branch scaffold-only transcript and prunes empty turns', () => {
    const scaffoldMessages: ChatMessage[] = [
      {
        id: 'user-1',
        sessionId: 'branch-1',
        role: 'user',
        content: 'Architecture: Strategic Decision Council v0.1.0\nSlot: Analyst (participant)\nTask: Assess repo.',
        createdAt: 1,
      },
      {
        id: 'assistant-1',
        sessionId: 'branch-1',
        role: 'assistant',
        content: '[MockLLM] Echo: Architecture: Strategic Decision Council v0.1.0\nSlot: Analyst (participant)\nTask: Assess repo.',
        createdAt: 2,
      },
    ];
    const turns: AgentTurn[] = [{
      id: 'turn-1',
      sessionId: 'branch-1',
      promptMessageId: 'user-1',
      items: [{ kind: 'text', messageId: 'assistant-1' }],
      done: true,
    }];

    const projection = resolveRenderableConversationProjection({
      session: branchSession,
      messages: scaffoldMessages,
      agentTurns: turns,
    });

    expect(projection.messages).toEqual([]);
    expect(projection.agentTurns).toEqual([]);
  });

  it('keeps meaningful branch assistant output while stripping scaffold prefix', () => {
    const branchMessages: ChatMessage[] = [
      {
        id: 'assistant-1',
        sessionId: 'branch-1',
        role: 'assistant',
        content: '[MockLLM] Echo: Architecture: Strategic Decision Council v0.1.0\nSlot: Analyst (participant)\nTask: Assess repo.\n\nRecommendation: Keep the existing API boundary.',
        createdAt: 2,
      },
    ];
    const turns: AgentTurn[] = [{
      id: 'turn-1',
      sessionId: 'branch-1',
      items: [{ kind: 'text', messageId: 'assistant-1' }],
      done: true,
    }];

    const projection = resolveRenderableConversationProjection({
      session: branchSession,
      messages: branchMessages,
      agentTurns: turns,
    });

    expect(projection.messages).toHaveLength(1);
    expect(projection.messages[0]?.content).toBe('Recommendation: Keep the existing API boundary.');
    expect(projection.agentTurns).toHaveLength(1);
  });
});

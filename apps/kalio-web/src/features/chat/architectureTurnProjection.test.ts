import { describe, expect, it } from 'vitest';
import type { AgentTurn } from '../../store/sessionStore';
import { replaceArchitectureRunTurn } from './architectureTurnProjection';

function makeTurn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    id: overrides.id ?? 'turn-1',
    sessionId: overrides.sessionId ?? 'session-1',
    promptMessageId: overrides.promptMessageId,
    items: overrides.items ?? [],
    done: overrides.done ?? true,
    agentRun: overrides.agentRun,
    error: overrides.error,
  };
}

describe('replaceArchitectureRunTurn', () => {
  it('replaces a rebuilt history turn for the same architecture run even when prompt ids differ', () => {
    const currentTurns: AgentTurn[] = [
      makeTurn({
        id: 'history-turn-0',
        promptMessageId: 'persisted-user',
        items: [
          { kind: 'tool', callId: 'architecture:run-1:event-1' },
          { kind: 'text', messageId: 'architecture:run-1:text:event-2' },
        ],
      }),
      makeTurn({
        id: 'other-turn',
        promptMessageId: 'other-user',
        items: [{ kind: 'text', messageId: 'assistant-other' }],
      }),
    ];

    const nextTurn = makeTurn({
      id: 'architecture-turn-run-1',
      promptMessageId: 'local-user',
      items: [
        { kind: 'tool', callId: 'architecture:run-1:event-1' },
        { kind: 'text', messageId: 'architecture:run-1:text:event-2' },
      ],
    });

    const turns = replaceArchitectureRunTurn({
      currentTurns,
      promptMessageId: 'local-user',
      runId: 'run-1',
      nextTurn,
    });

    expect(turns).toEqual([currentTurns[1], nextTurn]);
  });

  it('replaces an older turn for the same local prompt before appending the next one', () => {
    const staleTurn = makeTurn({
      id: 'architecture-turn-stale',
      promptMessageId: 'local-user',
      items: [{ kind: 'text', messageId: 'assistant-stale' }],
    });
    const nextTurn = makeTurn({
      id: 'architecture-turn-run-2',
      promptMessageId: 'local-user',
      items: [{ kind: 'text', messageId: 'architecture:run-2:text:event-1' }],
    });

    const turns = replaceArchitectureRunTurn({
      currentTurns: [staleTurn],
      promptMessageId: 'local-user',
      runId: 'run-2',
      nextTurn,
    });

    expect(turns).toEqual([nextTurn]);
  });

  it('keeps unrelated turns from other prompts and other architecture runs', () => {
    const keepTurn = makeTurn({
      id: 'architecture-turn-run-keep',
      promptMessageId: 'user-keep',
      items: [{ kind: 'text', messageId: 'architecture:run-keep:text:event-1' }],
    });
    const nextTurn = makeTurn({
      id: 'architecture-turn-run-3',
      promptMessageId: 'user-3',
      items: [{ kind: 'text', messageId: 'architecture:run-3:text:event-1' }],
    });

    const turns = replaceArchitectureRunTurn({
      currentTurns: [keepTurn],
      promptMessageId: 'user-3',
      runId: 'run-3',
      nextTurn,
    });

    expect(turns).toEqual([keepTurn, nextTurn]);
  });
});

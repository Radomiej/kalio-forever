import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@kalio/types';
import type { AgentTurn } from '../../store/sessionStore';
import type { ArchitectRunResult } from '../architect/architect.types';
import {
  replaceArchitectureRunTurn,
  resolveArchitectureRunTurnUpdate,
} from './architectureTurnProjection';

function makeTurn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    id: overrides.id ?? 'turn-1',
    sessionId: overrides.sessionId ?? 'session-1',
    promptMessageId: overrides.promptMessageId,
    items: overrides.items ?? [],
    done: overrides.done ?? true,
    turnKind: overrides.turnKind,
    agentRun: overrides.agentRun,
    error: overrides.error,
  };
}

describe('replaceArchitectureRunTurn', () => {
  it('replaces a rebuilt history turn for the same architecture run even when prompt ids differ', () => {
    const currentMessages: ChatMessage[] = [
      {
        id: 'architecture:run-1:text:event-2',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'Previous workflow result',
        architectureRun: {
          runId: 'run-1',
          schemaId: 'strategic-decision-council',
          status: 'running',
          trace: [],
          routeHops: [],
        },
        createdAt: 1,
      },
      {
        id: 'tool-host',
        sessionId: 'session-1',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'architecture:run-1:event-1', name: 'run_subagent', args: { architectureRunId: 'run-1' } }],
        createdAt: 2,
      },
    ];
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
      currentMessages,
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
      currentMessages: [],
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
    const currentMessages: ChatMessage[] = [{
      id: 'architecture:run-keep:text:event-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: 'Keep this run.',
      architectureRun: {
        runId: 'run-keep',
        schemaId: 'strategic-decision-council',
        status: 'completed',
        trace: [],
        routeHops: [],
      },
      createdAt: 1,
    }];
    const nextTurn = makeTurn({
      id: 'architecture-turn-run-3',
      promptMessageId: 'user-3',
      items: [{ kind: 'text', messageId: 'architecture:run-3:text:event-1' }],
    });

    const turns = replaceArchitectureRunTurn({
      currentMessages,
      currentTurns: [keepTurn],
      promptMessageId: 'user-3',
      runId: 'run-3',
      nextTurn,
    });

    expect(turns).toEqual([keepTurn, nextTurn]);
  });
});

function makeResult(runId: string, status: ArchitectRunResult['run']['status'] = 'running'): ArchitectRunResult {
  return {
    run: {
      id: runId,
      schemaId: 'strategic-decision-council',
      prompt: 'Assess repo',
      executionMode: 'subagent_execution',
      status,
      createdAt: 1,
      updatedAt: 2,
      rootSessionId: 'host',
    },
    agentFlowStatus: status === 'running' ? 'running' : 'done',
    events: [],
    graph: { runId, nodes: [], edges: [], routeHops: [] },
    chat: { runId, messages: [] },
  };
}

describe('resolveArchitectureRunTurnUpdate', () => {
  it('replaces only the current workflow run projection and keeps prior run bubbles intact', () => {
    const currentMessages: ChatMessage[] = [
      {
        id: 'architecture:run-old:text:event-1',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'Previous workflow result',
        architectureRun: {
          runId: 'run-old',
          schemaId: 'strategic-decision-council',
          status: 'completed',
          trace: [],
          routeHops: [],
        },
        createdAt: 1,
      },
      {
        id: 'architecture:user-2:pending',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'Architecture run is starting.',
        createdAt: 2,
      },
      {
        id: 'architecture:run-new:text:event-stale',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'Stale current run projection',
        architectureRun: {
          runId: 'run-new',
          schemaId: 'strategic-decision-council',
          status: 'running',
          trace: [],
          routeHops: [],
        },
        createdAt: 3,
      },
    ];
    const currentTurns: AgentTurn[] = [
      makeTurn({
        id: 'architecture-turn-run-old',
        promptMessageId: 'user-1',
        items: [{ kind: 'text', messageId: 'architecture:run-old:text:event-1' }],
      }),
      makeTurn({
        id: 'architecture-turn-run-new-stale',
        promptMessageId: 'user-2',
        items: [{ kind: 'text', messageId: 'architecture:run-new:text:event-stale' }],
        done: false,
      }),
    ];

    const resolved = resolveArchitectureRunTurnUpdate({
      currentMessages,
      currentTurns,
      pendingAssistantMessageId: 'architecture:user-2:pending',
      promptMessageId: 'user-2',
      projection: {
        turnKind: 'workflow-envelope',
        turnItems: [{ kind: 'text', messageId: 'architecture:run-new:text:event-1' }],
        messages: [
          {
            id: 'architecture:run-new:text:event-1',
            sessionId: 'session-1',
            role: 'assistant',
            content: 'Current workflow result',
            architectureRun: {
              runId: 'run-new',
              schemaId: 'strategic-decision-council',
              status: 'running',
              trace: [],
              routeHops: [],
            },
            createdAt: 4,
          },
        ],
      },
      result: makeResult('run-new'),
      sessionId: 'session-1',
    });

    expect(resolved.messages.map((message) => message.id)).toEqual([
      'architecture:run-old:text:event-1',
      'architecture:run-new:text:event-1',
    ]);
    expect(resolved.turns.map((turn) => turn.id)).toEqual([
      'architecture-turn-run-old',
      'architecture-turn-run-new',
    ]);
    expect(resolved.nextTurn.promptMessageId).toBe('user-2');
    expect(resolved.nextTurn.done).toBe(false);
  });

  it('marks the synthetic workflow turn done for terminal runs', () => {
    const resolved = resolveArchitectureRunTurnUpdate({
      currentMessages: [],
      currentTurns: [],
      pendingAssistantMessageId: 'architecture:user-2:pending',
      promptMessageId: 'user-2',
      projection: {
        turnKind: 'workflow-envelope',
        turnItems: [{ kind: 'text', messageId: 'architecture:run-done:text:event-1' }],
        messages: [
          {
            id: 'architecture:run-done:text:event-1',
            sessionId: 'session-1',
            role: 'assistant',
            content: 'Workflow completed',
            createdAt: 4,
          },
        ],
      },
      result: makeResult('run-done', 'completed'),
      sessionId: 'session-1',
    });

    expect(resolved.nextTurn.done).toBe(true);
    expect(resolved.turns).toEqual([resolved.nextTurn]);
  });

  it('stamps typed workflow projection messages with durable turn linkage for reload ordering', () => {
    const resolved = resolveArchitectureRunTurnUpdate({
      currentMessages: [],
      currentTurns: [],
      pendingAssistantMessageId: 'architecture:user-2:pending',
      promptMessageId: 'user-2',
      projection: {
        turnKind: 'workflow-envelope',
        turnItems: [
          { kind: 'tool', callId: 'architecture:run-linked:event-1' },
          { kind: 'text', messageId: 'architecture:run-linked:text:event-2' },
        ],
        messages: [
          {
            id: 'architecture:run-linked:tool-calls',
            sessionId: 'session-1',
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'architecture:run-linked:event-1', name: 'run_subagent', args: { architectureRunId: 'run-linked' } }],
            createdAt: 3,
          },
          {
            id: 'architecture:run-linked:text:event-2',
            sessionId: 'session-1',
            role: 'assistant',
            content: 'Workflow completed',
            architectureRun: {
              runId: 'run-linked',
              schemaId: 'strategic-decision-council',
              status: 'completed',
              trace: [],
              routeHops: [],
            },
            createdAt: 4,
          },
        ],
      },
      result: makeResult('run-linked', 'completed'),
      sessionId: 'session-1',
    });

    expect(resolved.messages).toEqual([
      expect.objectContaining({
        id: 'architecture:run-linked:tool-calls',
        turnId: 'architecture-turn-run-linked',
        promptMessageId: 'user-2',
      }),
      expect.objectContaining({
        id: 'architecture:run-linked:text:event-2',
        turnId: 'architecture-turn-run-linked',
        promptMessageId: 'user-2',
      }),
    ]);
  });

  it('removes stale workflow-start placeholders for the same prompt when typed projection arrives', () => {
    const currentMessages: ChatMessage[] = [
      {
        id: 'architecture:user-2:pending-original',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'Architecture run is starting.',
        createdAt: 2,
      },
      {
        id: 'architecture:user-2:pending-duplicate',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'Architecture run is starting.',
        createdAt: 3,
      },
    ];
    const currentTurns: AgentTurn[] = [
      makeTurn({
        id: 'architecture-turn-pending',
        promptMessageId: 'user-2',
        turnKind: 'workflow-envelope',
        items: [
          { kind: 'text', messageId: 'architecture:user-2:pending-original' },
          { kind: 'text', messageId: 'architecture:user-2:pending-duplicate' },
        ],
        done: false,
      }),
    ];

    const resolved = resolveArchitectureRunTurnUpdate({
      currentMessages,
      currentTurns,
      pendingAssistantMessageId: 'architecture:user-2:pending-original',
      promptMessageId: 'user-2',
      projection: {
        turnKind: 'workflow-envelope',
        turnItems: [{ kind: 'text', messageId: 'architecture:run-done:text:event-1' }],
        messages: [
          {
            id: 'architecture:run-done:text:event-1',
            sessionId: 'session-1',
            role: 'assistant',
            content: 'Workflow completed',
            architectureRun: {
              runId: 'run-done',
              schemaId: 'strategic-decision-council',
              status: 'completed',
              trace: [],
              routeHops: [],
            },
            createdAt: 4,
          },
        ],
      },
      result: makeResult('run-done', 'completed'),
      sessionId: 'session-1',
    });

    expect(resolved.messages.map((message) => message.content)).toEqual(['Workflow completed']);
    expect(resolved.nextTurn.items).toEqual([{ kind: 'text', messageId: 'architecture:run-done:text:event-1' }]);
    expect(resolved.turns).toEqual([resolved.nextTurn]);
  });

  it('removes a stale workflow-start turn by pending assistant id when local prompt linkage drifted', () => {
    const currentMessages: ChatMessage[] = [
      {
        id: 'architecture:user-2:pending-original',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'Architecture run is starting.',
        createdAt: 2,
      },
    ];
    const currentTurns: AgentTurn[] = [
      makeTurn({
        id: 'architecture-turn-pending',
        promptMessageId: 'user-stale',
        turnKind: 'workflow-envelope',
        items: [{ kind: 'text', messageId: 'architecture:user-2:pending-original' }],
        done: false,
      }),
    ];

    const resolved = resolveArchitectureRunTurnUpdate({
      currentMessages,
      currentTurns,
      pendingAssistantMessageId: 'architecture:user-2:pending-original',
      promptMessageId: 'user-2',
      projection: {
        turnKind: 'workflow-envelope',
        turnItems: [{ kind: 'text', messageId: 'architecture:run-done:text:event-1' }],
        messages: [
          {
            id: 'architecture:run-done:text:event-1',
            sessionId: 'session-1',
            role: 'assistant',
            content: 'Workflow completed',
            architectureRun: {
              runId: 'run-done',
              schemaId: 'strategic-decision-council',
              status: 'completed',
              trace: [],
              routeHops: [],
            },
            createdAt: 4,
          },
        ],
      },
      result: makeResult('run-done', 'completed'),
      sessionId: 'session-1',
    });

    expect(resolved.messages.map((message) => message.id)).toEqual(['architecture:run-done:text:event-1']);
    expect(resolved.turns).toEqual([resolved.nextTurn]);
  });

  it('marks the local workflow turn done when waiting_on_orchestrator takes over', () => {
    const waitingResult = makeResult('run-waiting', 'running');
    waitingResult.agentFlowStatus = 'waiting_on_orchestrator';

    const resolved = resolveArchitectureRunTurnUpdate({
      currentMessages: [],
      currentTurns: [],
      pendingAssistantMessageId: 'architecture:user-3:pending',
      promptMessageId: 'user-3',
      projection: {
        turnKind: 'workflow-envelope',
        turnItems: [{ kind: 'text', messageId: 'architecture:run-waiting:text:event-1' }],
        messages: [
          {
            id: 'architecture:run-waiting:text:event-1',
            sessionId: 'session-1',
            role: 'assistant',
            content: 'Workflow waiting on orchestrator',
            createdAt: 5,
          },
        ],
      },
      result: waitingResult,
      sessionId: 'session-1',
    });

    expect(resolved.nextTurn.done).toBe(true);
  });
});

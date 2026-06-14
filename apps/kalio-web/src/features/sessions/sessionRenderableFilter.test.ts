import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSession } from '@kalio/types';
import { filterRenderableSessions } from './sessionRenderableFilter';

function makeSession(overrides: Partial<ChatSession>): ChatSession {
  return {
    id: 'session-1',
    personaId: 'default',
    title: 'Session',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeArchitectureSummaryMessage(trace: NonNullable<ChatMessage['architectureRun']>['trace']): ChatMessage {
  return {
    id: 'arch-summary',
    sessionId: 'host',
    role: 'assistant',
    content: '',
    createdAt: 20,
    architectureRun: {
      runId: 'run-live',
      schemaId: 'Strategic Decision Council',
      status: 'running',
      routeHops: [],
      trace,
      graphNodes: [
        { id: 'analyst', label: 'Analyst', kind: 'role', status: 'running', eventIds: ['event-analyst'] },
        { id: 'router', label: 'Router', kind: 'router', status: 'completed', eventIds: ['event-router'] },
      ],
      graphEdges: [],
    } as ChatMessage['architectureRun'],
  };
}

describe('filterRenderableSessions', () => {
  it('keeps graph-only architecture nodes out of the conversation tree', () => {
    const sessions: ChatSession[] = [
      makeSession({ id: 'host', title: 'Workflow host', updatedAt: 10 }),
      makeSession({
        id: 'arch-root',
        title: 'Architecture: Workflow host',
        kind: 'agent-flow',
        parentSessionId: 'host',
        createdAt: 11,
        updatedAt: 11,
        runtimeContext: {
          runtimeKind: 'chat',
          architectureContext: {
            architectureRunId: 'run-live',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
          },
        },
      }),
      makeSession({
        id: 'arch-analyst',
        title: 'Strategic Decision Council: Analyst',
        kind: 'subagent',
        parentSessionId: 'arch-root',
        createdAt: 12,
        updatedAt: 12,
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureSlotId: 'analyst',
          architectureContext: { roleSlotId: 'analyst', displayLabel: 'Analyst' },
        },
      }),
      makeSession({
        id: 'arch-router',
        title: 'Strategic Decision Council: Router',
        kind: 'subagent',
        parentSessionId: 'arch-root',
        createdAt: 12,
        updatedAt: 12,
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureSlotId: 'router',
        },
      }),
    ];

    const sessionMessages: Record<string, ChatMessage[]> = {
      host: [makeArchitectureSummaryMessage([])],
      'arch-router': [
        { id: 'router-user', sessionId: 'arch-router', role: 'user', content: 'route', createdAt: 13 },
        { id: 'router-assistant', sessionId: 'arch-router', role: 'assistant', content: 'ok', createdAt: 14 },
      ],
    };

    const { renderableSessions } = filterRenderableSessions(sessions, sessionMessages);

    expect(renderableSessions.map((session) => session.id)).toEqual(['host', 'arch-root']);
  });

  it('shows a branch only after host trace or tool-result evidence points at that branch session', () => {
    const sessions: ChatSession[] = [
      makeSession({ id: 'host', title: 'Workflow host', updatedAt: 10 }),
      makeSession({
        id: 'arch-root',
        title: 'Architecture: Workflow host',
        kind: 'agent-flow',
        parentSessionId: 'host',
        createdAt: 11,
        updatedAt: 11,
        runtimeContext: {
          runtimeKind: 'chat',
          architectureContext: {
            architectureRunId: 'run-live',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
          },
        },
      }),
      makeSession({
        id: 'arch-analyst',
        title: 'Strategic Decision Council: Analyst',
        kind: 'subagent',
        parentSessionId: 'arch-root',
        createdAt: 12,
        updatedAt: 12,
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureSlotId: 'analyst',
          architectureContext: { roleSlotId: 'analyst', displayLabel: 'Analyst' },
        },
      }),
    ];

    const sessionMessages: Record<string, ChatMessage[]> = {
      host: [
        makeArchitectureSummaryMessage([
          {
            speaker: 'participant',
            content: 'Analyst branch started',
            eventId: 'event-analyst',
            nodeId: 'analyst',
            stream: {
              streamGroupId: 'run-live',
              branchSessionId: 'arch-analyst',
              status: 'started',
              chunkCount: 0,
              text: '',
            },
          },
        ]),
      ],
    };

    const { renderableSessions } = filterRenderableSessions(sessions, sessionMessages);

    expect(renderableSessions.map((session) => session.id)).toEqual(['host', 'arch-root', 'arch-analyst']);
  });
});

import { describe, expect, it } from 'vitest';
import type { ArchitectureGraphProjection, ChatMessage, ChatSession } from '@kalio/types';
import { filterRenderableSessions } from './sessionRenderableFilter';

type ArchitectureRunWithGraphNodes = NonNullable<ChatMessage['architectureRun']> & {
  graphNodes: ArchitectureGraphProjection['nodes'];
};

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
            sessionSurface: 'technical-node',
          },
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
    const hostArchitectureRun = sessionMessages.host[0]?.architectureRun as ArchitectureRunWithGraphNodes;
    hostArchitectureRun.graphNodes = [
      { id: 'analyst', label: 'Analyst', kind: 'role', status: 'pending', eventIds: [] },
      { id: 'router', label: 'Router', kind: 'router', status: 'completed', eventIds: ['event-router'] },
    ];

    const { renderableSessions } = filterRenderableSessions(sessions, sessionMessages);

    expect(renderableSessions.map((session) => session.id)).toEqual(['host']);
  });

  it('shows a real branch session immediately even before transcript or host trace evidence exists', () => {
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
            sessionSurface: 'technical-node',
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
          parentToolCallId: 'architecture:run-live:analyst',
          architectureSlotId: 'analyst',
          architectureContext: {
            architectureRunId: 'run-live',
            roleSlotId: 'analyst',
            displayLabel: 'Analyst',
            sessionSurface: 'conversation-branch',
          },
        },
      }),
    ];

    const sessionMessages: Record<string, ChatMessage[]> = {
      host: [makeArchitectureSummaryMessage([])],
      'arch-analyst': [],
    };
    const hostArchitectureRun = sessionMessages.host[0]?.architectureRun as ArchitectureRunWithGraphNodes;
    hostArchitectureRun.graphNodes = [
      { id: 'analyst', label: 'Analyst', kind: 'role', status: 'pending', eventIds: [] },
      { id: 'router', label: 'Router', kind: 'router', status: 'completed', eventIds: ['event-router'] },
    ];

    const { renderableSessions } = filterRenderableSessions(sessions, sessionMessages);

    expect(renderableSessions.map((session) => session.id)).toEqual(['host', 'arch-analyst']);
  });

  it('keeps a branch session visible once live activity exists for it', () => {
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
            sessionSurface: 'technical-node',
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
          parentToolCallId: 'architecture:run-live:analyst',
          architectureSlotId: 'analyst',
          architectureContext: {
            architectureRunId: 'run-live',
            roleSlotId: 'analyst',
            displayLabel: 'Analyst',
            sessionSurface: 'conversation-branch',
          },
        },
      }),
    ];

    const sessionMessages: Record<string, ChatMessage[]> = {
      host: [makeArchitectureSummaryMessage([])],
      'arch-analyst': [],
    };

    const { renderableSessions } = filterRenderableSessions(sessions, sessionMessages, {
      activeLoopSessionIds: new Set(['arch-analyst']),
    });

    expect(renderableSessions.map((session) => session.id)).toEqual(['host', 'arch-analyst']);
  });

  it('prefers explicit sessionSurface over legacy architecture heuristics', () => {
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
          runtimeKind: 'agent-flow-root',
          architectureContext: {
            architectureRunId: 'run-live',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
            sessionSurface: 'technical-node',
          },
        },
      }),
      makeSession({
        id: 'arch-finalizer',
        title: 'Strategic Decision Council: Finalizer',
        kind: 'subagent',
        parentSessionId: 'arch-root',
        createdAt: 12,
        updatedAt: 12,
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureSlotId: 'finalizer',
          architectureContext: {
            architectureRunId: 'run-live',
            roleSlotId: 'finalizer',
            displayLabel: 'Finalizer',
            sessionSurface: 'technical-node',
          },
        },
      }),
      makeSession({
        id: 'arch-shadow',
        title: 'Strategic Decision Council: Shadow',
        kind: 'subagent',
        parentSessionId: 'arch-root',
        createdAt: 13,
        updatedAt: 13,
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureSlotId: 'shadow',
          architectureContext: {
            architectureRunId: 'run-live',
            roleSlotId: 'shadow',
            displayLabel: 'Shadow',
            sessionSurface: 'conversation-branch',
          },
        },
      }),
    ];

    const { renderableSessions } = filterRenderableSessions(sessions, {
      host: [makeArchitectureSummaryMessage([])],
    });

    expect(renderableSessions.map((session) => session.id)).toEqual(['host', 'arch-shadow']);
  });
});

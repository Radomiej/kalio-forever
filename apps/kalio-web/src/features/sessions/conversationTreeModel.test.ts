import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSession } from '@kalio/types';
import { buildConversationTreeModel } from './conversationTreeModel';

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

function makeWorkflowEnvelopeMessage(sessionId: string): ChatMessage {
  return {
    id: 'workflow-envelope',
    sessionId,
    role: 'assistant',
    content: 'Workflow is running.',
    createdAt: 10,
    architectureRun: {
      runId: 'run-1',
      schemaId: 'strategic-decision-council',
      status: 'running',
      hostProjectionKind: 'workflow-envelope',
      trace: [],
      routeHops: [],
    },
  };
}

describe('buildConversationTreeModel', () => {
  it('keeps a selected workflow branch nested under the visible host even when the technical parent is hidden', () => {
    const host = makeSession({
      id: 'host',
      title: 'Workflow host',
      updatedAt: 20,
    });
    const technicalRoot = makeSession({
      id: 'arch-root',
      title: 'Architecture runtime root',
      kind: 'agent-flow',
      parentSessionId: 'host',
      createdAt: 21,
      updatedAt: 21,
      runtimeContext: {
        runtimeKind: 'agent-flow-root',
        architectureContext: {
          architectureRunId: 'run-1',
          sessionSurface: 'technical-node',
        },
      },
    });
    const branch = makeSession({
      id: 'branch-analyst',
      title: 'Strategic Decision Council: Analyst',
      kind: 'subagent',
      parentSessionId: 'arch-root',
      createdAt: 22,
      updatedAt: 22,
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureSlotId: 'analyst',
        architectureContext: {
          architectureRunId: 'run-1',
          sessionSurface: 'conversation-branch',
          roleSlotId: 'analyst',
          displayLabel: 'Analyst',
        },
      },
    });

    const model = buildConversationTreeModel({
      activeSessionId: branch.id,
      originFilter: 'all',
      pendingBudgetApprovals: {},
      pendingConfirmations: {},
      queuedDepthBySession: {},
      sessionAgentTurns: {},
      sessionMessages: {
        [host.id]: [makeWorkflowEnvelopeMessage(host.id)],
        [technicalRoot.id]: [],
        [branch.id]: [],
      },
      sessionStatusSnapshots: {},
      sidebarSessions: [host, technicalRoot, branch],
      activeAgentLoops: {
        loop1: { sessionId: branch.id },
      },
    });

    expect(model.activeHostSessionId).toBe(host.id);
    expect(model.activeRenderableDescendantCount).toBe(1);
    expect(model.activeWorkflowRuntimeState).toBe('running');
    expect(model.visibleSessions.map((session) => session.id)).toEqual([host.id, branch.id]);
    expect(model.sessionListEntries).toEqual([
      {
        type: 'session',
        session: host,
        depth: 0,
      },
    ]);
  });

  it('treats runtime-only reconnect snapshots as live conversation activity', () => {
    const host = makeSession({
      id: 'host',
      title: 'Workflow host',
      updatedAt: 20,
    });
    const branch = makeSession({
      id: 'branch-analyst',
      title: 'Strategic Decision Council: Analyst',
      kind: 'subagent',
      parentSessionId: 'host',
      createdAt: 22,
      updatedAt: 22,
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureSlotId: 'analyst',
        architectureContext: {
          architectureRunId: 'run-live',
          sessionSurface: 'conversation-branch',
          roleSlotId: 'analyst',
          displayLabel: 'Analyst',
        },
      },
    });

    const model = buildConversationTreeModel({
      activeSessionId: host.id,
      originFilter: 'all',
      pendingBudgetApprovals: {},
      pendingConfirmations: {},
      queuedDepthBySession: {},
      sessionAgentTurns: {},
      sessionMessages: {
        [host.id]: [],
        [branch.id]: [],
      },
      sessionStatusSnapshots: {},
      runtimeActivitySnapshots: {
        [branch.id]: {
          sessionId: branch.id,
          active: true,
          turnId: 'turn-1',
          queueLength: 0,
          pendingConfirmations: [],
          pendingBudgetApprovals: [],
          toolActivities: [],
          childExecutions: [],
          updatedAt: 22,
          run: {
            id: 'run-1',
            sessionId: branch.id,
            turnId: 'turn-1',
            phase: 'tool_running',
            status: 'active',
            retryCount: 0,
            safeResume: true,
            startedAt: 21,
            updatedAt: 22,
            lastHeartbeatAt: 22,
          },
        },
      },
      sidebarSessions: [host, branch],
      activeAgentLoops: {},
    });

    expect(model.renderableSessions.map((session) => session.id)).toEqual([host.id, branch.id]);
    expect(model.activeLoopSessionIds.has(branch.id)).toBe(true);
  });
});

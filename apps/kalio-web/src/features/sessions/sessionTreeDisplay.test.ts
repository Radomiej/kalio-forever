import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSession } from '@kalio/types';
import {
  architectureRunIdForSession,
  buildArchitectureSessionRuntimeStates,
  displayTitleForSession,
  isPendingArchitecturePlaceholderSession,
  normalizeConversationSessionId,
  sessionStatusSnapshotToRuntimeState,
  visibleConversationParentId,
} from './sessionTreeDisplay';

function createSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'session-abcdef',
    personaId: 'default',
    title: 'New Chat',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('displayTitleForSession', () => {
  it('falls back to the session id when title is blank whitespace', () => {
    const session = createSession({ title: '   ' });

    expect(displayTitleForSession(session, new Map())).toBe('Session sessio');
  });

  it('trims surrounding whitespace from the displayed title', () => {
    const session = createSession({ title: '  New Chat  ' });

    expect(displayTitleForSession(session, new Map())).toBe('New Chat');
  });

  it('keeps the parent New Chat title instead of inheriting an architecture child title', () => {
    const session = createSession({ id: 'host-123456', title: 'New Chat' });
    const childSessionsByParent = new Map<string, ChatSession[]>([
      [
        session.id,
        [createSession({ id: 'child-123456', title: 'Architecture: Runtime MVP proof', kind: 'agent-flow', parentSessionId: session.id })],
      ],
    ]);

    expect(displayTitleForSession(session, childSessionsByParent)).toBe('New Chat');
  });

  it('uses the workflow display label for architecture envelope sessions', () => {
    const session = createSession({
      id: 'arch-run-root',
      title: 'Architecture: What can you do?',
      parentSessionId: 'missing-host',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureContext: {
          architectureRunId: 'run-live',
          schemaName: 'Strategic Decision Council',
          displayLabel: 'Strategic Decision Council',
        },
      },
    });

    expect(displayTitleForSession(session, new Map())).toBe('Strategic Decision Council');
  });

  it('normalizes architecture envelope selections back to the host session', () => {
    const host = createSession({ id: 'host', title: 'Workflow host' });
    const envelope = createSession({
      id: 'arch-run-root',
      title: 'Architecture: What can you do?',
      parentSessionId: host.id,
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureContext: {
          architectureRunId: 'run-live',
          schemaName: 'Strategic Decision Council',
        },
      },
    });
    const branch = createSession({
      id: 'arch-run-analyst',
      title: 'Strategic Decision Council: Analyst',
      parentSessionId: envelope.id,
      kind: 'subagent',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureSlotId: 'analyst',
      },
    });

    expect(normalizeConversationSessionId(envelope.id, [host, envelope, branch])).toBe(host.id);
    expect(normalizeConversationSessionId(branch.id, [host, envelope, branch])).toBe(branch.id);
  });

  it('skips workflow containers and technical nodes when resolving a visible parent', () => {
    const host = createSession({ id: 'host', title: 'Workflow host' });
    const container = createSession({
      id: 'arch-root',
      title: 'Architecture: Strategic Decision Council',
      parentSessionId: host.id,
      runtimeContext: {
        runtimeKind: 'chat',
        architectureContext: {
          architectureRunId: 'run-live',
          schemaName: 'Strategic Decision Council',
          displayLabel: 'Strategic Decision Council',
          sessionSurface: 'technical-node',
        },
      },
    });
    const router = createSession({
      id: 'arch-router',
      title: 'Strategic Decision Council: Router',
      parentSessionId: container.id,
      kind: 'subagent',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureSlotId: 'router',
        architectureContext: {
          architectureRunId: 'run-live',
          roleSlotId: 'router',
          roleSlotType: 'router',
          displayLabel: 'Router',
          sessionSurface: 'technical-node',
        },
      },
    });
    const branch = createSession({
      id: 'arch-analyst',
      title: 'Strategic Decision Council: Analyst',
      parentSessionId: router.id,
      kind: 'subagent',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureSlotId: 'analyst',
        architectureContext: {
          architectureRunId: 'run-live',
          roleSlotId: 'analyst',
          displayLabel: 'Analyst',
          sessionSurface: 'conversation-branch',
        },
      },
    });

    expect(visibleConversationParentId(branch, new Map([
      [host.id, host],
      [container.id, container],
      [router.id, router],
      [branch.id, branch],
    ]))).toBe(host.id);
  });

  it('keeps visible technical node sessions in the conversation tree hierarchy', () => {
    const host = createSession({ id: 'host', title: 'Workflow host' });
    const container = createSession({
      id: 'arch-root',
      title: 'Architecture: Strategic Decision Council',
      parentSessionId: host.id,
      runtimeContext: {
        runtimeKind: 'chat',
        architectureContext: {
          architectureRunId: 'run-live',
          schemaName: 'Strategic Decision Council',
          displayLabel: 'Strategic Decision Council',
          sessionSurface: 'technical-node',
          conversationVisibility: 'hidden',
        },
      },
    });
    const router = createSession({
      id: 'arch-router',
      title: 'Strategic Decision Council: Router',
      parentSessionId: container.id,
      kind: 'subagent',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureSlotId: 'router',
        architectureContext: {
          architectureRunId: 'run-live',
          roleSlotId: 'router',
          roleSlotType: 'router',
          displayLabel: 'Router',
          sessionSurface: 'technical-node',
          conversationVisibility: 'visible',
        },
      },
    });
    const branch = createSession({
      id: 'arch-analyst',
      title: 'Strategic Decision Council: Analyst',
      parentSessionId: router.id,
      kind: 'subagent',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureSlotId: 'analyst',
        architectureContext: {
          architectureRunId: 'run-live',
          roleSlotId: 'analyst',
          displayLabel: 'Analyst',
          sessionSurface: 'conversation-branch',
        },
      },
    });

    expect(visibleConversationParentId(branch, new Map([
      [host.id, host],
      [container.id, container],
      [router.id, router],
      [branch.id, branch],
    ]))).toBe(router.id);
  });

  it('treats untouched pending architecture branches as sidebar placeholders', () => {
    const branch = createSession({
      id: 'arch-run-innovator',
      title: 'Strategic Decision Council: Innovator',
      kind: 'subagent',
      parentSessionId: 'arch-run-root',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        parentToolCallId: 'architecture:run-live:innovator',
        architectureSlotId: 'innovator',
        architectureContext: {
          architectureRunId: 'run-live',
          roleSlotId: 'innovator',
        },
      },
      createdAt: 10,
      updatedAt: 10,
    });

    expect(isPendingArchitecturePlaceholderSession(branch, new Map([[branch.id, 'pending']]), {})).toBe(true);
  });

  it('keeps started architecture branches visible once they have activity or a non-pending state', () => {
    const branch = createSession({
      id: 'arch-run-pragmatist',
      title: 'Strategic Decision Council: Pragmatist',
      kind: 'subagent',
      parentSessionId: 'arch-run-root',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        parentToolCallId: 'architecture:run-live:pragmatist',
        architectureSlotId: 'pragmatist',
        architectureContext: {
          architectureRunId: 'run-live',
          roleSlotId: 'pragmatist',
        },
      },
      createdAt: 10,
      updatedAt: 10,
    });

    expect(isPendingArchitecturePlaceholderSession(branch, new Map([[branch.id, 'running']]), {})).toBe(false);
    expect(isPendingArchitecturePlaceholderSession(branch, new Map([[branch.id, 'pending']]), {
      [branch.id]: [{ id: 'm1', sessionId: branch.id, role: 'assistant', content: 'Started', createdAt: 11 }],
    })).toBe(false);
  });
});

describe('buildArchitectureSessionRuntimeStates', () => {
  it('does not let display-only incompleteReason override typed branch stream status', () => {
    const messages: Record<string, ChatMessage[]> = {
      host: [{
        id: 'message-1',
        sessionId: 'host',
        role: 'assistant',
        content: 'Architecture summary',
        architectureRun: {
          runId: 'run-live',
          schemaId: 'goal-master-delivery-loop',
          status: 'completed',
          trace: [{
            speaker: 'participant',
            content: 'Branch produced a completed response.',
            incompleteReason: 'Display-only note mentioning missing proof.',
            stream: {
              streamGroupId: 'stream-1',
              branchSessionId: 'branch-session',
              status: 'completed',
              chunkCount: 1,
              text: 'Branch produced a completed response.',
            },
          }],
          routeHops: [],
        },
        createdAt: 10,
      }],
    };

    expect(buildArchitectureSessionRuntimeStates([], messages).get('branch-session')).toBe('done');
  });

  it('uses typed trace status for branch runtime state when graph nodes are unavailable', () => {
    const messages: Record<string, ChatMessage[]> = {
      host: [{
        id: 'message-1',
        sessionId: 'host',
        role: 'assistant',
        content: 'Architecture summary',
        architectureRun: {
          runId: 'run-live',
          schemaId: 'goal-master-delivery-loop',
          status: 'running',
          trace: [{
            speaker: 'participant',
            content: 'Branch returned to the orchestrator.',
            status: 'waiting_on_orchestrator',
            reasonCode: 'return_to_orchestrator',
            stream: {
              streamGroupId: 'stream-1',
              branchSessionId: 'branch-session',
              status: 'completed',
              chunkCount: 1,
              text: 'Branch returned to the orchestrator.',
            },
          }],
          routeHops: [],
        },
        createdAt: 10,
      }],
    };

    expect(buildArchitectureSessionRuntimeStates([], messages).get('branch-session')).toBe('waiting');
  });

  it('maps typed cancelled graph nodes to stopped child sessions', () => {
    const finalizer = createSession({
      id: 'arch-run-live-finalizer',
      title: 'Strategic Decision Council: Finalizer',
      kind: 'subagent',
      parentSessionId: 'host',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureContext: {
          architectureRunId: 'run-live',
          roleSlotId: 'finalizer',
          roleSlotType: 'finalizer',
        },
      },
    });
    const messages: Record<string, ChatMessage[]> = {
      host: [{
        id: 'message-1',
        sessionId: 'host',
        role: 'assistant',
        content: 'Architecture summary',
        architectureRun: {
          runId: 'run-live',
          schemaId: 'strategic-decision-council',
          status: 'failed',
          trace: [],
          routeHops: [],
          graphNodes: [{
            id: 'final-artifact',
            sessionId: finalizer.id,
            roleSlotId: 'finalizer',
            label: 'Final Artifact',
            kind: 'artifact',
            status: 'cancelled',
            action: 'node_failed',
            detail: 'Skipped because an upstream workflow node failed before this node started.',
            visitCount: 0,
            eventIds: ['event-3'],
          }],
          graphEdges: [],
          graphChildAgents: [],
        },
        createdAt: 10,
      }],
    };

    expect(buildArchitectureSessionRuntimeStates([finalizer], messages).get(finalizer.id)).toBe('stopped');
  });

  it('does not project stale pending graph nodes as live after run failure', () => {
    const finalizer = createSession({
      id: 'arch-run-live-finalizer',
      title: 'Strategic Decision Council: Finalizer',
      kind: 'subagent',
      parentSessionId: 'host',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureContext: {
          architectureRunId: 'run-live',
          roleSlotId: 'finalizer',
          roleSlotType: 'finalizer',
        },
      },
    });
    const messages: Record<string, ChatMessage[]> = {
      host: [{
        id: 'message-1',
        sessionId: 'host',
        role: 'assistant',
        content: 'Architecture summary',
        architectureRun: {
          runId: 'run-live',
          schemaId: 'strategic-decision-council',
          status: 'failed',
          trace: [],
          routeHops: [],
          graphNodes: [{
            id: 'final-artifact',
            sessionId: finalizer.id,
            roleSlotId: 'finalizer',
            label: 'Final Artifact',
            kind: 'artifact',
            status: 'pending',
            visitCount: 0,
            eventIds: [],
          }],
          graphEdges: [],
          graphChildAgents: [],
        },
        createdAt: 10,
      }],
    };

    expect(buildArchitectureSessionRuntimeStates([finalizer], messages).get(finalizer.id)).toBe('stopped');
  });
});

describe('architectureRunIdForSession', () => {
  it('uses typed architecture runtime context instead of encoded parent tool call ids', () => {
    expect(architectureRunIdForSession(createSession({
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureContext: {
          architectureRunId: 'typed-run',
        },
        parentToolCallId: 'architecture:encoded-run:router',
      },
    }))).toBe('typed-run');

    expect(architectureRunIdForSession(createSession({
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        parentToolCallId: 'architecture:encoded-run:router',
      },
    }))).toBeUndefined();
  });
});

describe('sessionStatusSnapshotToRuntimeState', () => {
  it('prefers pending tool confirmation over active tool-running phase', () => {
    expect(sessionStatusSnapshotToRuntimeState({
      sessionId: 'session-hitl',
      active: true,
      queueLength: 0,
      run: {
        id: 'run-hitl',
        sessionId: 'session-hitl',
        turnId: 'turn-hitl',
        phase: 'tool_running',
        status: 'active',
        retryCount: 0,
        safeResume: true,
        startedAt: 1,
        updatedAt: 2,
        lastHeartbeatAt: 2,
      },
      toolActivities: [{
        callId: 'call-delete-1',
        requestId: 'request-delete-1',
        sessionId: 'session-hitl',
        toolName: 'vfs_delete',
        args: { path: 'draft.txt' },
        status: 'pending_confirmation',
        startedAt: 2,
      }],
    })).toBe('waiting');
  });

  it('prefers terminal completion over stale queued work', () => {
    expect(sessionStatusSnapshotToRuntimeState({
      sessionId: 'session-done',
      active: false,
      queueLength: 2,
      run: {
        id: 'run-1',
        sessionId: 'session-done',
        turnId: 'turn-1',
        phase: 'completed',
        status: 'completed',
        retryCount: 0,
        safeResume: true,
        startedAt: 1,
        updatedAt: 2,
        lastHeartbeatAt: 2,
      },
    })).toBe('done');
  });

  it('prefers terminal failure over stale queued work', () => {
    expect(sessionStatusSnapshotToRuntimeState({
      sessionId: 'session-failed',
      active: false,
      queueLength: 1,
      run: {
        id: 'run-2',
        sessionId: 'session-failed',
        turnId: 'turn-2',
        phase: 'failed',
        status: 'failed',
        retryCount: 0,
        safeResume: false,
        startedAt: 1,
        updatedAt: 2,
        lastHeartbeatAt: 2,
      },
    })).toBe('error');
  });

  it('prefers interrupted-needs-retry over stale queued work', () => {
    expect(sessionStatusSnapshotToRuntimeState({
      sessionId: 'session-retry',
      active: true,
      queueLength: 3,
      run: {
        id: 'run-3',
        sessionId: 'session-retry',
        turnId: 'turn-3',
        phase: 'tool_pending',
        status: 'interrupted_needs_retry',
        retryCount: 1,
        safeResume: true,
        startedAt: 1,
        updatedAt: 2,
        lastHeartbeatAt: 2,
      },
    })).toBe('stopped');
  });
});

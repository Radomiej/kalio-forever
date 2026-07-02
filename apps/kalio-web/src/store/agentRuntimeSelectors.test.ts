import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSession, RuntimeActivitySnapshot } from '@kalio/types';
import { sessionStatusSnapshotToRuntimeState } from '../features/sessions/sessionTreeDisplay';
import {
  mergeRuntimeQueuedDepthBySession,
  mergeRuntimeSessionStatusSnapshots,
  selectPendingApprovalCount,
  selectPendingBudgetApprovalsForSession,
  selectPendingConfirmationByToolCallId,
  selectPendingConfirmationsForSession,
  selectQueuedDepth,
  selectLiveSessionIds,
  selectRuntimeContinuationActions,
  selectRuntimeAttentionItems,
  selectRunningLoops,
} from './agentRuntimeSelectors';

function makeSession(id: string, title: string): ChatSession {
  return {
    id,
    personaId: 'default',
    title,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeRuntimeSnapshot(
  sessionId: string,
  overrides: Partial<RuntimeActivitySnapshot> = {},
): RuntimeActivitySnapshot {
  return {
    sessionId,
    active: true,
    turnId: 'turn-1',
    queueLength: 0,
    pendingConfirmations: [],
    pendingBudgetApprovals: [],
    toolActivities: [],
    childExecutions: [],
    updatedAt: 2,
    run: {
      id: 'run-1',
      sessionId,
      turnId: 'turn-1',
      phase: 'tool_running',
      status: 'active',
      retryCount: 0,
      safeResume: true,
      startedAt: 1,
      updatedAt: 2,
      lastHeartbeatAt: 2,
    },
    ...overrides,
  };
}

function makeWaitingRuntimeSnapshot(sessionId: string): RuntimeActivitySnapshot {
  return {
    ...makeRuntimeSnapshot(sessionId, { active: false }),
    run: {
      id: 'run-1',
      sessionId,
      turnId: 'turn-1',
      phase: 'tool_running',
      status: 'waiting_on_orchestrator',
      retryCount: 0,
      safeResume: true,
      startedAt: 1,
      updatedAt: 2,
      lastHeartbeatAt: 2,
    } as unknown as RuntimeActivitySnapshot['run'],
  };
}

function makeAssistantMessage(sessionId: string, content: string): ChatMessage {
  return {
    id: `${sessionId}-assistant-1`,
    sessionId,
    role: 'assistant',
    content,
    createdAt: 10,
  };
}

function makeToolResultMessage(sessionId: string, content: Record<string, unknown>): ChatMessage {
  return {
    id: `${sessionId}-tool-result-1`,
    sessionId,
    role: 'tool_result',
    toolCallId: `${sessionId}-tool-call-1`,
    content: JSON.stringify(content),
    createdAt: 10,
  };
}

describe('agentRuntimeSelectors', () => {
  it('prefers runtime snapshots over stale legacy session status snapshots', () => {
    const merged = mergeRuntimeSessionStatusSnapshots(
      {
        'session-1': {
          sessionId: 'session-1',
          active: false,
          queueLength: 0,
        },
      },
      {
        'session-1': {
          sessionId: 'session-1',
          active: true,
          turnId: 'turn-1',
          queueLength: 0,
          pendingConfirmations: [],
          pendingBudgetApprovals: [],
          toolActivities: [],
          childExecutions: [],
          updatedAt: 2,
          run: {
            id: 'run-1',
            sessionId: 'session-1',
            turnId: 'turn-1',
            phase: 'tool_pending',
            status: 'active',
            retryCount: 0,
            safeResume: true,
            startedAt: 1,
            updatedAt: 2,
            lastHeartbeatAt: 2,
          },
        },
      },
    );

    expect(sessionStatusSnapshotToRuntimeState(merged['session-1'])).toBe('waiting');
  });

  it('treats runtime-only active sessions as live after reconnect', () => {
    const liveSessionIds = selectLiveSessionIds({
      activeAgentLoops: {},
      sessionStatusSnapshots: {},
      runtimeActivitySnapshots: {
        'session-1': {
          sessionId: 'session-1',
          active: true,
          turnId: 'turn-1',
          queueLength: 0,
          pendingConfirmations: [],
          pendingBudgetApprovals: [],
          toolActivities: [],
          childExecutions: [],
          updatedAt: 2,
          run: {
            id: 'run-1',
            sessionId: 'session-1',
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
    });

    expect(liveSessionIds.has('session-1')).toBe(true);
  });

  it('does not treat interrupted retry snapshots with stale queued work as live sessions', () => {
    const liveSessionIds = selectLiveSessionIds({
      activeAgentLoops: {},
      sessionStatusSnapshots: {
        'session-1': {
          sessionId: 'session-1',
          active: true,
          queueLength: 3,
          run: {
            id: 'run-1',
            sessionId: 'session-1',
            turnId: 'turn-1',
            phase: 'tool_pending',
            status: 'interrupted_needs_retry',
            retryCount: 1,
            safeResume: true,
            startedAt: 1,
            updatedAt: 2,
            lastHeartbeatAt: 2,
          },
        },
      },
      runtimeActivitySnapshots: {},
    });

    expect(liveSessionIds.has('session-1')).toBe(false);
  });

  it('surfaces recovered interrupted runs as typed runtime attention', () => {
    const runtimeActivitySnapshots = {
      'session-1': makeRuntimeSnapshot('session-1', {
        active: false,
        run: {
          id: 'run-1',
          sessionId: 'session-1',
          turnId: 'turn-1',
          phase: 'llm_streaming',
          status: 'interrupted_needs_retry',
          retryCount: 0,
          safeResume: true,
          errorCode: 'BACKEND_RESTART',
          startedAt: 1,
          updatedAt: 2,
          lastHeartbeatAt: 2,
        },
      }),
    };

    expect(selectRuntimeAttentionItems({
      runtimeActivitySnapshots,
      sessions: [makeSession('session-1', 'Architecture Debate: Orchestrator')],
      sessionMessages: { 'session-1': [] },
    })).toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        kind: 'runtime_error',
        label: 'Architecture Debate: Orchestrator',
        detail: 'Backend restarted during LLM work. Retry is safe from the current transcript.',
        actionable: false,
      }),
    ]);
  });

  it('builds running loop summaries from runtime snapshots when legacy loops are missing', () => {
    const runningLoops = selectRunningLoops({
      activeAgentLoops: {},
      runtimeActivitySnapshots: {
        'session-1': {
          sessionId: 'session-1',
          active: true,
          turnId: 'turn-1',
          queueLength: 0,
          pendingConfirmations: [],
          pendingBudgetApprovals: [],
          toolActivities: [],
          childExecutions: [],
          updatedAt: 2,
          run: {
            id: 'run-1',
            sessionId: 'session-1',
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
    });

    expect(runningLoops).toEqual([
      {
        sessionId: 'session-1',
        turnId: 'turn-1',
        startedAt: 1,
      },
    ]);
  });

  it('treats waiting_on_orchestrator runtime snapshots as waiting state and attention', () => {
    const runtimeActivitySnapshots = {
      'session-1': makeWaitingRuntimeSnapshot('session-1'),
    };

    expect(sessionStatusSnapshotToRuntimeState(
      mergeRuntimeSessionStatusSnapshots({}, runtimeActivitySnapshots)['session-1'],
    )).toBe('waiting');

    expect(selectRuntimeAttentionItems({
      runtimeActivitySnapshots,
      sessions: [makeSession('session-1', 'Architecture Debate: Orchestrator')],
      sessionMessages: {
        'session-1': [],
      },
    })).toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        kind: 'runtime_waiting',
        label: 'Architecture Debate: Orchestrator',
        detail: 'Waiting on orchestrator',
        actionable: false,
      }),
    ]);
  });

  it('falls back to runtime waiting when assistant timeout prose lacks typed failure state', () => {
    const runtimeActivitySnapshots = {
      'session-1': makeWaitingRuntimeSnapshot('session-1'),
    };

    expect(selectRuntimeAttentionItems({
      runtimeActivitySnapshots,
      sessions: [makeSession('session-1', 'Architecture Debate: Orchestrator')],
      sessionMessages: {
        'session-1': [makeAssistantMessage(
          'session-1',
          'Sub-agent failed: Sub-agent timed out after 300000ms.',
        )],
      },
    })).toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        kind: 'runtime_waiting',
        label: 'Architecture Debate: Orchestrator',
        detail: 'Waiting on orchestrator',
        actionable: false,
      }),
    ]);
  });

  it('falls back to runtime waiting when assistant prose mentions errors or blockers without runtime evidence', () => {
    const runtimeActivitySnapshots = {
      'session-1': makeWaitingRuntimeSnapshot('session-1'),
    };

    expect(selectRuntimeAttentionItems({
      runtimeActivitySnapshots,
      sessions: [makeSession('session-1', 'AI capabilities inquiry')],
      sessionMessages: {
        'session-1': [makeAssistantMessage(
          'session-1',
          'Escalate critical events to you immediately (e.g., errors, blockers, decisions needed).',
        )],
      },
    })).toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        kind: 'runtime_waiting',
        label: 'AI capabilities inquiry',
        detail: 'Waiting on orchestrator',
        actionable: false,
      }),
    ]);
  });

  it('does not classify assistant timeout prose as runtime timeout without typed runtime state', () => {
    const runtimeActivitySnapshots = {
      'session-1': makeWaitingRuntimeSnapshot('session-1'),
    };

    expect(selectRuntimeAttentionItems({
      runtimeActivitySnapshots,
      sessions: [makeSession('session-1', 'Architecture Debate: Orchestrator')],
      sessionMessages: {
        'session-1': [makeAssistantMessage(
          'session-1',
          'Sub-agent failed: Sub-agent timed out after 300000ms.',
        )],
      },
    })).toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        kind: 'runtime_waiting',
        label: 'Architecture Debate: Orchestrator',
        detail: 'Waiting on orchestrator',
        actionable: false,
      }),
    ]);
  });

  it('does not classify child last output text as runtime error when child status is running', () => {
    const runtimeActivitySnapshots = {
      'session-1': makeRuntimeSnapshot('session-1', {
        childExecutions: [{
          id: 'child-1',
          kind: 'cli_agent',
          parentSessionId: 'session-1',
          childSessionId: 'child-session-1',
          label: 'CLI child',
          status: 'running',
          lastOutput: 'This log says failed, blocked, and timed out but the typed status is still running.',
          updatedAt: 10,
        }],
      }),
    };

    expect(selectRuntimeAttentionItems({
      runtimeActivitySnapshots,
      sessions: [makeSession('session-1', 'Parent chat')],
      sessionMessages: {
        'session-1': [],
      },
    })).toEqual([]);
  });

  it('classifies typed failed child execution status without parsing child output text', () => {
    const runtimeActivitySnapshots = {
      'session-1': makeRuntimeSnapshot('session-1', {
        childExecutions: [{
          id: 'child-1',
          kind: 'agent_flow',
          parentSessionId: 'session-1',
          childSessionId: 'child-session-1',
          label: 'Goal Guard',
          status: 'failed',
          lastOutput: 'All visible text is display-only.',
          updatedAt: 10,
        }],
      }),
    };

    expect(selectRuntimeAttentionItems({
      runtimeActivitySnapshots,
      sessions: [
        makeSession('session-1', 'Parent chat'),
        makeSession('child-session-1', 'Goal Guard'),
      ],
      sessionMessages: {
        'session-1': [],
      },
    })).toEqual([
      expect.objectContaining({
        sessionId: 'child-session-1',
        kind: 'runtime_error',
        label: 'Goal Guard',
        detail: 'Child execution failed',
      }),
    ]);
  });

  it('does not keep child-session timeout assistant text after reload without typed runtime state', () => {
    expect(selectRuntimeAttentionItems({
      sessions: [{
        ...makeSession('session-1', 'Architecture Debate: Orchestrator'),
        kind: 'subagent',
        parentSessionId: 'root-session',
        updatedAt: Date.now() - 1_000,
      }],
      sessionMessages: {
        'session-1': [makeAssistantMessage(
          'session-1',
          'Sub-agent failed: Sub-agent timed out after 300000ms.',
        )],
      },
    })).toEqual([]);
  });

  it('does not surface persisted runtime attention from generic assistant prose after reload', () => {
    expect(selectRuntimeAttentionItems({
      sessions: [{
        ...makeSession('session-1', 'AI capabilities inquiry'),
        updatedAt: Date.now() - 1_000,
        runtimeContext: {
          runtimeKind: 'agent-flow-root',
        },
      }],
      sessionMessages: {
        'session-1': [makeAssistantMessage(
          'session-1',
          'Escalate critical events to you immediately (e.g., errors, blockers, decisions needed).',
        )],
      },
    })).toEqual([]);
  });

  it('does not keep agent-flow root timeout assistant text after reload when only runtime context is durable', () => {
    expect(selectRuntimeAttentionItems({
      sessions: [{
        ...makeSession('session-1', 'Goal Guard Root'),
        updatedAt: Date.now() - 1_000,
        runtimeContext: {
          runtimeKind: 'agent-flow-root',
        },
      }],
      sessionMessages: {
        'session-1': [makeAssistantMessage(
          'session-1',
          'Sub-agent failed: Sub-agent timed out after 300000ms.',
        )],
      },
    })).toEqual([]);
  });

  it('does not surface stale root-session timeout text without runtime context after reload', () => {
    expect(selectRuntimeAttentionItems({
      sessions: [{
        ...makeSession('session-1', 'Plain chat'),
        updatedAt: Date.now() - 1_000,
      }],
      sessionMessages: {
        'session-1': [makeAssistantMessage(
          'session-1',
          'Sub-agent failed: Sub-agent timed out after 300000ms.',
        )],
      },
    })).toEqual([]);
  });

  it('does not keep old agent-flow root timeout evidence past the persisted runtime attention window', () => {
    expect(selectRuntimeAttentionItems({
      sessions: [{
        ...makeSession('session-1', 'Goal Guard Root'),
        updatedAt: Date.now() - 25 * 60 * 60 * 1000,
        runtimeContext: {
          runtimeKind: 'agent-flow-root',
        },
      }],
      sessionMessages: {
        'session-1': [makeAssistantMessage(
          'session-1',
          'Sub-agent failed: Sub-agent timed out after 300000ms.',
        )],
      },
    })).toEqual([]);
  });

  it('does not map assistant tool budget prose to runtime error without typed evidence', () => {
    expect(selectRuntimeAttentionItems({
      runtimeActivitySnapshots: {
        'session-1': makeWaitingRuntimeSnapshot('session-1'),
      },
      sessions: [makeSession('session-1', 'Release Guard: QA')],
      sessionMessages: {
        'session-1': [makeAssistantMessage(
          'session-1',
          'Risk: the slot did not produce a full narrative before the tool budget ended.',
        )],
      },
    })).toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        kind: 'runtime_waiting',
        label: 'Release Guard: QA',
        detail: 'Waiting on orchestrator',
        actionable: false,
      }),
    ]);
  });

  it('does not classify tool result error message text without a typed error code', () => {
    expect(selectRuntimeAttentionItems({
      runtimeActivitySnapshots: {
        'session-1': makeWaitingRuntimeSnapshot('session-1'),
      },
      sessions: [makeSession('session-1', 'Architecture Debate: Orchestrator')],
      sessionMessages: {
        'session-1': [makeToolResultMessage('session-1', {
          errorMessage: 'Sub-agent timed out after 300000ms.',
        })],
      },
    })).toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        kind: 'runtime_waiting',
        detail: 'Waiting on orchestrator',
      }),
    ]);
  });

  it('ignores malformed tool result content while selecting runtime attention', () => {
    const malformedToolResult = {
      id: 'session-1-tool-result-malformed',
      sessionId: 'session-1',
      role: 'tool_result',
      toolCallId: 'session-1-tool-call-1',
      content: undefined as unknown as string,
      createdAt: 10,
    } as ChatMessage;

    expect(selectRuntimeAttentionItems({
      runtimeActivitySnapshots: {
        'session-1': makeWaitingRuntimeSnapshot('session-1'),
      },
      sessions: [makeSession('session-1', 'Architecture Debate: Orchestrator')],
      sessionMessages: {
        'session-1': [malformedToolResult],
      },
    })).toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        kind: 'runtime_waiting',
        detail: 'Waiting on orchestrator',
      }),
    ]);
  });

  it('classifies typed tool result timeout code without parsing error message text', () => {
    expect(selectRuntimeAttentionItems({
      runtimeActivitySnapshots: {
        'session-1': makeWaitingRuntimeSnapshot('session-1'),
      },
      sessions: [makeSession('session-1', 'Architecture Debate: Orchestrator')],
      sessionMessages: {
        'session-1': [makeToolResultMessage('session-1', {
          errorCode: 'TIMEOUT',
          errorMessage: 'Provider stopped before returning a complete response.',
        })],
      },
    })).toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        kind: 'runtime_timeout',
        detail: 'Provider stopped before returning a complete response.',
      }),
    ]);
  });

  it('selects one runtime continuation action for a waiting AgentFlow child with a stable flow run id', () => {
    expect(selectRuntimeContinuationActions({
      runtimeActivitySnapshots: {
        'parent-session': makeRuntimeSnapshot('parent-session', {
          active: false,
          childExecutions: [{
            id: 'flow-run-1',
            kind: 'agent_flow',
            parentSessionId: 'parent-session',
            childSessionId: 'arch-flow-run-1-root',
            flowRunId: 'flow-run-1',
            label: 'Goal Guard waiting for orchestrator',
            status: 'waiting',
            updatedAt: 10,
          }],
        }),
      },
      sessions: [
        makeSession('parent-session', 'Parent chat'),
        makeSession('arch-flow-run-1-root', 'Goal Guard'),
      ],
      sessionMessages: {},
    })).toEqual([{
      id: 'agent_flow_resume:flow-run-1',
      sessionId: 'arch-flow-run-1-root',
      parentSessionId: 'parent-session',
      flowRunId: 'flow-run-1',
      label: 'Goal Guard',
      detail: 'Waiting on orchestrator',
      input: 'Continue.',
      actionable: true,
      priority: 25,
    }]);
  });

  it('does not create continuation actions for timeout/error runtime attention without a waiting AgentFlow checkpoint', () => {
    expect(selectRuntimeContinuationActions({
      runtimeActivitySnapshots: {
        'session-1': makeWaitingRuntimeSnapshot('session-1'),
      },
      sessions: [makeSession('session-1', 'Architecture Debate: Orchestrator')],
      sessionMessages: {
        'session-1': [makeAssistantMessage(
          'session-1',
          'Sub-agent failed: Sub-agent timed out after 300000ms.',
        )],
      },
    })).toEqual([]);
  });

  it('keeps budget approval attention ahead of max-tools evidence for the same session', () => {
    expect(selectRuntimeAttentionItems({
      pendingBudgetApprovals: {
        'session-1': [{
          requestId: 'budget-1',
          sessionId: 'session-1',
          scope: 'chat',
          usedIterations: 8,
          currentLimit: 8,
        }],
      },
      runtimeActivitySnapshots: {
        'session-1': makeWaitingRuntimeSnapshot('session-1'),
      },
      sessions: [makeSession('session-1', 'Release Guard: QA')],
      sessionMessages: {
        'session-1': [makeAssistantMessage(
          'session-1',
          'The slot stopped because max tools were reached.',
        )],
      },
    })).toEqual([expect.objectContaining({
      sessionId: 'session-1',
      kind: 'budget',
      actionable: true,
      detail: 'Budget approval required',
    })]);
  });

  it('prefers runtime queue depth over stale legacy queued depth', () => {
    const merged = mergeRuntimeQueuedDepthBySession(
      {
        'session-1': 4,
      },
      {
        'session-1': {
          sessionId: 'session-1',
          active: false,
          queueLength: 1,
          pendingConfirmations: [],
          pendingBudgetApprovals: [],
          toolActivities: [],
          childExecutions: [],
          updatedAt: 2,
        },
      },
    );

    expect(merged['session-1']).toBe(1);
  });

  it('selects runtime-backed queue depth for the active session', () => {
    expect(selectQueuedDepth({
      sessionId: 'session-1',
      queuedDepthBySession: { 'session-1': 3 },
      runtimeActivitySnapshots: {
        'session-1': {
          sessionId: 'session-1',
          active: true,
          queueLength: 0,
          turnId: 'turn-1',
          pendingConfirmations: [],
          pendingBudgetApprovals: [],
          toolActivities: [],
          childExecutions: [],
          updatedAt: 2,
        },
      },
    })).toBe(0);
  });

  it('counts confirmations and budget approvals across all sessions', () => {
    expect(selectPendingApprovalCount({
      pendingConfirmations: {
        'session-1': [{
          requestId: 'req-1',
          toolCallId: 'call-1',
          sessionId: 'session-1',
          toolName: 'vfs_write',
          args: {},
          timeoutMs: 30_000,
        }],
      },
      pendingBudgetApprovals: {
        'session-2': [{
          requestId: 'budget-1',
          sessionId: 'session-2',
          scope: 'chat' as const,
          usedIterations: 4,
          currentLimit: 4,
        }],
      },
    })).toBe(2);
  });

  it('counts RA-App pending approvals from structured tool results', () => {
    expect(selectPendingApprovalCount({
      sessionMessages: {
        'session-raapp': [
          makeToolResultMessage('session-raapp', {
            status: 'ready',
            type: 'html',
            mode: 'interactive',
            content: '<p>Approve write</p>',
            pendingApprovals: [{
              id: 'raapp-approval-1',
              system: 'vfs_write',
              displayLabel: 'write architecture.md',
              args: { path: 'architecture.md' },
            }],
          }),
        ],
      },
    })).toBe(1);
  });

  it('projects RA-App pending approvals ahead of passive runtime attention', () => {
    expect(selectRuntimeAttentionItems({
      runtimeActivitySnapshots: {
        'session-raapp': makeWaitingRuntimeSnapshot('session-raapp'),
      },
      sessions: [makeSession('session-raapp', 'RA-App delivery')],
      sessionMessages: {
        'session-raapp': [
          makeToolResultMessage('session-raapp', {
            status: 'ready',
            type: 'html',
            mode: 'interactive',
            content: '<p>Approve write</p>',
            pendingApprovals: [{
              id: 'raapp-approval-1',
              system: 'vfs_write',
              displayLabel: 'write architecture.md',
              args: { path: 'architecture.md' },
            }],
          }),
        ],
      },
    })).toEqual([
      expect.objectContaining({
        id: 'raapp:session-raapp:raapp-approval-1',
        sessionId: 'session-raapp',
        kind: 'hitl',
        label: 'RA-App approval',
        detail: 'write architecture.md',
        actionable: true,
      }),
    ]);
  });

  it('keeps actionable approvals ahead of passive runtime waiting and avoids duplicate attention rows for the same session', () => {
    const pendingConfirmations = {
      'session-1': [{
        requestId: 'req-1',
        toolCallId: 'call-1',
        sessionId: 'session-1',
        toolName: 'vfs_write',
        args: {},
        timeoutMs: 30_000,
      }],
    };

    expect(selectRuntimeAttentionItems({
      pendingConfirmations,
      runtimeActivitySnapshots: {
        'session-1': makeWaitingRuntimeSnapshot('session-1'),
      },
      sessions: [makeSession('session-1', 'Agent delivery run')],
      sessionMessages: {
        'session-1': [],
      },
    })).toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        kind: 'hitl',
        actionable: true,
      }),
    ]);
  });

  it('finds a pending confirmation by toolCallId without dropping other session entries', () => {
    const pendingConfirmations = {
      'session-1': [{
        requestId: 'req-1',
        toolCallId: 'call-1',
        sessionId: 'session-1',
        toolName: 'vfs_write',
        args: {},
        timeoutMs: 30_000,
      }],
      'session-2': [{
        requestId: 'req-2',
        toolCallId: 'call-2',
        sessionId: 'session-2',
        toolName: 'vfs_delete',
        args: {},
        timeoutMs: 30_000,
      }],
    };

    expect(selectPendingConfirmationByToolCallId({
      toolCallId: 'call-2',
      pendingConfirmations,
    })).toEqual(pendingConfirmations['session-2'][0]);
    expect(selectPendingConfirmationsForSession({
      sessionId: 'session-1',
      pendingConfirmations,
    })).toEqual(pendingConfirmations['session-1']);
  });

  it('returns per-session budget approvals as a stable collection', () => {
    const pendingBudgetApprovals = {
      'session-1': [{
        requestId: 'budget-1',
        sessionId: 'session-1',
        scope: 'chat' as const,
        usedIterations: 4,
        currentLimit: 4,
      }],
    };

    expect(selectPendingBudgetApprovalsForSession({
      sessionId: 'session-1',
      pendingBudgetApprovals,
    })).toEqual(pendingBudgetApprovals['session-1']);
    expect(selectPendingBudgetApprovalsForSession({
      sessionId: 'missing',
      pendingBudgetApprovals,
    })).toEqual([]);
  });
});

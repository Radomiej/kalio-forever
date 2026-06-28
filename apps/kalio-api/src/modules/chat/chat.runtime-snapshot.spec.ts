import { describe, expect, it, vi } from 'vitest';
import type { AgentBudgetApprovalRequest, AgentFlowRunSnapshot, AgentFlowRunStatus, CLIAgentSessionStatus, RuntimeChildExecutionStatus, SocketEvents } from '@kalio/types';
import {
  buildRuntimeActivitySnapshot,
  buildRuntimeActivitySnapshotBatch,
  collectRuntimeSnapshotSessionTree,
  type RuntimeSnapshotSessionTree,
} from './chat.runtime-snapshot';

function makeStatus(sessionId: string): SocketEvents['session:status'] {
  return {
    sessionId,
    active: false,
    queueLength: 0,
  };
}

function makeAgentFlowSnapshot(parentSessionId: string): AgentFlowRunSnapshot {
  return {
    run: {
      id: 'flow-run-1',
      parentSessionId,
      childSessionId: 'flow-child-1',
      parentToolCallId: 'call-flow-1',
      openChatSessionId: 'flow-chat-1',
      openGraphRunId: 'graph-run-1',
      flowDefinitionId: 'goal-master',
      summary: 'Goal Master',
      status: 'running',
      startMode: 'durable',
      returnMode: 'full_trace',
      createdAt: 100,
      updatedAt: 123,
    },
    events: [],
  };
}

type ChildStatusPatch = Omit<Partial<SocketEvents['session:status']>, 'run'> & {
  run?: Partial<NonNullable<SocketEvents['session:status']['run']>>;
};

describe('buildRuntimeActivitySnapshot', () => {
  it('uses parent-scoped agent flow lookup instead of loading all runs', async () => {
    const findByParentSessionId = vi.fn().mockResolvedValue([makeAgentFlowSnapshot('session-1')]);
    const findAll = vi.fn().mockResolvedValue([makeAgentFlowSnapshot('other-session')]);

    const snapshot = await buildRuntimeActivitySnapshot({
      sessionId: 'session-1',
      status: makeStatus('session-1'),
      pipeline: {
        getSessionStatusWithRun: vi.fn().mockResolvedValue(makeStatus('session-1')),
      },
      toolDispatch: {
        getPendingConfirmations: vi.fn().mockReturnValue([]),
      },
      agentBudgetApprovals: {
        getPendingApprovals: vi.fn().mockReturnValue([]),
      },
      sessionsService: {
        listChildren: vi.fn().mockResolvedValue([]),
        get: vi.fn(),
        getMessages: vi.fn(),
      },
      agentFlowRuntime: {
        run: vi.fn(),
        findByParentSessionId,
        findAll,
      },
    });

    expect(findByParentSessionId).toHaveBeenCalledWith('session-1');
    expect(findAll).not.toHaveBeenCalled();
    expect(snapshot.childExecutions).toEqual([
      expect.objectContaining({
        id: 'flow-run-1',
        kind: 'agent_flow',
        parentSessionId: 'session-1',
        childSessionId: 'flow-chat-1',
        flowRunId: 'graph-run-1',
        status: 'running',
      }),
    ]);
  });

  it.each([
    ['done', 'completed'],
    ['failed', 'failed'],
    ['blocked', 'blocked'],
    ['cancelled', 'cancelled'],
    ['waiting_on_orchestrator', 'waiting'],
  ] satisfies Array<[AgentFlowRunStatus, RuntimeChildExecutionStatus]>)(
    'maps agent-flow status %s to child execution status %s',
    async (flowStatus, childStatus) => {
      const snapshot = makeAgentFlowSnapshot('session-1');
      snapshot.run.status = flowStatus;
      const findByParentSessionId = vi.fn().mockResolvedValue([snapshot]);

      const result = await buildRuntimeActivitySnapshot({
        sessionId: 'session-1',
        status: makeStatus('session-1'),
        pipeline: {
          getSessionStatusWithRun: vi.fn().mockResolvedValue(makeStatus('session-1')),
        },
        toolDispatch: {
          getPendingConfirmations: vi.fn().mockReturnValue([]),
        },
        agentBudgetApprovals: {
          getPendingApprovals: vi.fn().mockReturnValue([]),
        },
        sessionsService: {
          listChildren: vi.fn().mockResolvedValue([]),
          get: vi.fn(),
          getMessages: vi.fn(),
        },
        agentFlowRuntime: {
          run: vi.fn(),
          findByParentSessionId,
        },
      });

      expect(result.childExecutions).toEqual([
        expect.objectContaining({
          kind: 'agent_flow',
          status: childStatus,
        }),
      ]);
    },
  );

  it('projects a reconstructed waiting AgentFlow child with stable ids and child-session label', async () => {
    const flowSnapshot = makeAgentFlowSnapshot('session-1');
    flowSnapshot.run.status = 'waiting_on_orchestrator';
    flowSnapshot.run.summary = undefined;
    flowSnapshot.run.checkpoint = {
      goal: 'Build and verify.',
      continuation: {
        reason: 'return_to_orchestrator',
        pendingNodeIds: ['goal-master'],
        visitCounts: { implementer: 1 },
        waitingNodeId: 'goal-master',
        message: 'Waiting on orchestrator.',
      },
    };

    const sessionTree = {
      rootSessionId: 'session-1',
      sessionIds: ['session-1', 'flow-chat-1'],
      directChildIdsBySessionId: { 'session-1': ['flow-chat-1'], 'flow-chat-1': [] },
      descendantIdsBySessionId: { 'session-1': ['flow-chat-1'], 'flow-chat-1': [] },
      childSessionsById: {
        'flow-chat-1': {
          id: 'flow-chat-1',
          parentSessionId: 'session-1',
          parentToolCallId: 'call-flow-1',
          kind: 'agent-flow',
          title: 'Goal Guard',
          personaId: 'default',
          createdAt: 1,
          updatedAt: 2,
        },
      },
    } satisfies RuntimeSnapshotSessionTree;

    const batch = await buildRuntimeActivitySnapshotBatch({
      rootSessionId: 'session-1',
      sessionTree,
      statusesBySessionId: {
        'session-1': makeStatus('session-1'),
        'flow-chat-1': makeStatus('flow-chat-1'),
      },
      pipeline: {
        getSessionStatusWithRun: vi.fn().mockResolvedValue(makeStatus('session-1')),
      },
      toolDispatch: {
        getPendingConfirmations: vi.fn().mockReturnValue([]),
      },
      agentBudgetApprovals: {
        getPendingApprovals: vi.fn().mockReturnValue([]),
      },
      sessionsService: {
        listChildren: vi.fn(),
        get: vi.fn().mockImplementation(async (sessionId: string) => (
          sessionId === 'flow-chat-1'
            ? sessionTree.childSessionsById['flow-chat-1']
            : { id: 'session-1', personaId: 'default', kind: 'chat' }
        )),
        getMessages: vi.fn(),
      },
      agentFlowRuntime: {
        run: vi.fn(),
        findByParentSessionId: vi.fn().mockResolvedValue([flowSnapshot]),
      },
    });

    expect(batch.snapshotsBySessionId['session-1'].childExecutions).toEqual([
      expect.objectContaining({
        id: 'flow-run-1',
        kind: 'agent_flow',
        parentSessionId: 'session-1',
        childSessionId: 'flow-chat-1',
        flowRunId: 'graph-run-1',
        label: 'Goal Guard',
        status: 'waiting',
      }),
    ]);
  });

  it('preserves pending budget approval when the session also has max-tools failure state', async () => {
    const status = {
      ...makeStatus('session-1'),
      active: false,
      run: {
        id: 'run-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        phase: 'failed',
        status: 'failed',
        retryCount: 0,
        safeResume: false,
        startedAt: 111,
        updatedAt: 112,
        lastHeartbeatAt: 112,
      },
    } satisfies SocketEvents['session:status'];
    const pendingBudgetApproval: AgentBudgetApprovalRequest = {
      requestId: 'budget-1',
      sessionId: 'session-1',
      scope: 'chat',
      usedIterations: 60,
      currentLimit: 60,
      suggestedNextLimit: 70,
      requestedBy: 'agent',
    };

    const snapshot = await buildRuntimeActivitySnapshot({
      sessionId: 'session-1',
      status,
      pipeline: {
        getSessionStatusWithRun: vi.fn().mockResolvedValue(status),
      },
      toolDispatch: {
        getPendingConfirmations: vi.fn().mockReturnValue([]),
      },
      agentBudgetApprovals: {
        getPendingApprovals: vi.fn().mockReturnValue([pendingBudgetApproval]),
      },
      sessionsService: {
        listChildren: vi.fn().mockResolvedValue([]),
        get: vi.fn(),
        getMessages: vi.fn(),
      },
      agentFlowRuntime: {
        run: vi.fn(),
        findByParentSessionId: vi.fn().mockResolvedValue([]),
      },
    });

    expect(snapshot.pendingBudgetApprovals).toEqual([pendingBudgetApproval]);
    expect(snapshot.pendingConfirmations).toEqual([]);
    expect(snapshot.run?.status).toBe('failed');
  });

  it.each([
    ['completed', 'completed'],
    ['failed', 'failed'],
    ['stopped', 'stopped'],
    ['running', 'running'],
    ['idle', 'idle'],
  ] satisfies Array<[CLIAgentSessionStatus, RuntimeChildExecutionStatus]>)(
    'maps CLI child status %s to child execution status %s',
    async (cliStatus, childStatus) => {
      const listChildren = vi.fn().mockImplementation(async (sessionId: string) => {
        if (sessionId === 'session-1') {
          return [{
            id: 'cli-child-1',
            parentSessionId: 'session-1',
            parentToolCallId: 'call-cli-1',
            kind: 'cli-agent',
            updatedAt: 2,
          }];
        }
        return [];
      });

      const result = await buildRuntimeActivitySnapshot({
        sessionId: 'session-1',
        status: makeStatus('session-1'),
        pipeline: {
          getSessionStatusWithRun: vi.fn().mockResolvedValue(makeStatus('session-1')),
        },
        toolDispatch: {
          getPendingConfirmations: vi.fn().mockReturnValue([]),
        },
        agentBudgetApprovals: {
          getPendingApprovals: vi.fn().mockReturnValue([]),
        },
        sessionsService: {
          listChildren,
          get: vi.fn().mockResolvedValue({
            id: 'session-1',
            personaId: 'default',
            kind: 'chat',
          }),
          getMessages: vi.fn().mockResolvedValue([]),
        },
        cliAgentSessionRuntime: {
          getStatus: vi.fn().mockResolvedValue({
            parentSessionId: 'session-1',
            childSessionId: 'cli-child-1',
            agentId: 'codex',
            status: cliStatus,
            lastOutput: 'latest output',
            updatedAt: 3,
          }),
          stopSession: vi.fn(),
        },
      });

      expect(result.childExecutions).toEqual([
        expect.objectContaining({
          kind: 'cli_agent',
          childSessionId: 'cli-child-1',
          status: childStatus,
        }),
      ]);
    },
  );

  it('silently skips legacy CLI children with missing session metadata', async () => {
    const logger = { warn: vi.fn() };
    const listChildren = vi.fn().mockImplementation(async (sessionId: string) => {
      if (sessionId === 'session-1') {
        return [
          {
            id: 'cli-child-1',
            parentSessionId: 'session-1',
            parentToolCallId: 'call-cli-1',
            kind: 'cli-agent',
          },
        ];
      }
      return [
        {
          id: 'cli-child-1',
          parentSessionId: 'session-1',
          parentToolCallId: 'call-cli-1',
          kind: 'cli-agent',
        },
      ];
    });

    const snapshot = await buildRuntimeActivitySnapshot({
      sessionId: 'session-1',
      status: makeStatus('session-1'),
      pipeline: {
        getSessionStatusWithRun: vi.fn().mockResolvedValue(makeStatus('session-1')),
      },
      toolDispatch: {
        getPendingConfirmations: vi.fn().mockReturnValue([]),
      },
      agentBudgetApprovals: {
        getPendingApprovals: vi.fn().mockReturnValue([]),
      },
      sessionsService: {
        listChildren,
        get: vi.fn().mockResolvedValue({
          id: 'cli-child-1',
          parentSessionId: 'session-1',
          parentToolCallId: 'call-cli-1',
          kind: 'cli-agent',
        }),
        getMessages: vi.fn().mockResolvedValue([]),
      },
      cliAgentSessionRuntime: {
        getStatus: vi.fn().mockRejectedValue(Object.assign(
          new Error('CLI metadata missing for child session.'),
          { code: 'CLI_AGENT_SESSION_METADATA_MISSING' },
        )),
        stopSession: vi.fn(),
      },
      logger,
    });

    expect(snapshot.childExecutions).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(listChildren).toHaveBeenCalledTimes(2);
  });

  it('reuses one session-tree preload for root and descendant snapshots', async () => {
    const listChildren = vi.fn().mockImplementation(async (sessionId: string) => {
      if (sessionId === 'session-1') {
        return [{ id: 'child-1', parentSessionId: 'session-1', kind: 'subagent', parentToolCallId: 'call-1', title: 'Child 1', updatedAt: 2 }];
      }
      return [];
    });
    const getSessionStatusWithRun = vi.fn().mockImplementation(async (sessionId: string) => ({
      ...makeStatus(sessionId),
      active: sessionId === 'child-1',
    }));

    const batch = await buildRuntimeActivitySnapshotBatch({
      rootSessionId: 'session-1',
      pipeline: {
        getSessionStatusWithRun,
      },
      toolDispatch: {
        getPendingConfirmations: vi.fn().mockReturnValue([]),
      },
      agentBudgetApprovals: {
        getPendingApprovals: vi.fn().mockReturnValue([]),
      },
      sessionsService: {
        listChildren,
        get: vi.fn(),
        getMessages: vi.fn().mockResolvedValue([]),
      },
    });

    expect(listChildren).toHaveBeenCalledTimes(2);
    expect(getSessionStatusWithRun).toHaveBeenCalledTimes(2);
    expect(batch.sessionIds).toEqual(['session-1', 'child-1']);
    expect(batch.snapshotsBySessionId['session-1'].childExecutions).toEqual([
      expect.objectContaining({
        childSessionId: 'child-1',
        kind: 'subagent',
      }),
    ]);
    expect(batch.snapshotsBySessionId['child-1'].childExecutions).toEqual([]);
  });

  it('treats a child subagent with terminal run status as completed even if queueLength is stale', async () => {
    const listChildren = vi.fn().mockImplementation(async (sessionId: string) => {
      if (sessionId === 'session-1') {
        return [{ id: 'child-1', parentSessionId: 'session-1', kind: 'subagent', parentToolCallId: 'call-1', title: 'Child 1', updatedAt: 2 }];
      }
      return [];
    });
    const getSessionStatusWithRun = vi.fn().mockImplementation(async (sessionId: string) => (
      sessionId === 'child-1'
        ? {
            ...makeStatus(sessionId),
            queueLength: 1,
            run: {
              id: 'run-child-1',
              sessionId,
              turnId: 'turn-1',
              phase: 'completed',
              status: 'completed',
              retryCount: 0,
              safeResume: true,
              startedAt: 1,
              updatedAt: 3,
              lastHeartbeatAt: 3,
            },
          }
        : makeStatus(sessionId)
    ));

    const batch = await buildRuntimeActivitySnapshotBatch({
      rootSessionId: 'session-1',
      pipeline: {
        getSessionStatusWithRun,
      },
      toolDispatch: {
        getPendingConfirmations: vi.fn().mockReturnValue([]),
      },
      agentBudgetApprovals: {
        getPendingApprovals: vi.fn().mockReturnValue([]),
      },
      sessionsService: {
        listChildren,
        get: vi.fn(),
        getMessages: vi.fn().mockResolvedValue([]),
      },
    });

    expect(batch.snapshotsBySessionId['session-1'].childExecutions).toEqual([
      expect.objectContaining({
        childSessionId: 'child-1',
        kind: 'subagent',
        status: 'completed',
      }),
    ]);
  });

  it('treats a child subagent with failed run status as failed even if queueLength is stale', async () => {
    const listChildren = vi.fn().mockImplementation(async (sessionId: string) => {
      if (sessionId === 'session-1') {
        return [{ id: 'child-1', parentSessionId: 'session-1', kind: 'subagent', parentToolCallId: 'call-1', title: 'Child 1', updatedAt: 2 }];
      }
      return [];
    });
    const getSessionStatusWithRun = vi.fn().mockImplementation(async (sessionId: string) => (
      sessionId === 'child-1'
        ? {
            ...makeStatus(sessionId),
            queueLength: 1,
            run: {
              id: 'run-child-1',
              sessionId,
              turnId: 'turn-1',
              phase: 'failed',
              status: 'failed',
              retryCount: 0,
              safeResume: false,
              startedAt: 1,
              updatedAt: 3,
              lastHeartbeatAt: 3,
            },
          }
        : makeStatus(sessionId)
    ));

    const batch = await buildRuntimeActivitySnapshotBatch({
      rootSessionId: 'session-1',
      pipeline: {
        getSessionStatusWithRun,
      },
      toolDispatch: {
        getPendingConfirmations: vi.fn().mockReturnValue([]),
      },
      agentBudgetApprovals: {
        getPendingApprovals: vi.fn().mockReturnValue([]),
      },
      sessionsService: {
        listChildren,
        get: vi.fn(),
        getMessages: vi.fn().mockResolvedValue([]),
      },
    });

    expect(batch.snapshotsBySessionId['session-1'].childExecutions).toEqual([
      expect.objectContaining({
        childSessionId: 'child-1',
        kind: 'subagent',
        status: 'failed',
      }),
    ]);
  });

  const subagentStatusCases: Array<[ChildStatusPatch, RuntimeChildExecutionStatus]> = [
    [{ queueLength: 1 }, 'waiting'],
    [{ active: true }, 'running'],
    [{ run: { phase: 'interrupted', status: 'interrupted' } }, 'stopped'],
    [{ run: { phase: 'interrupted', status: 'interrupted_needs_retry' } }, 'stopped'],
  ];

  it.each(subagentStatusCases)(
    'maps subagent runtime status %o to child execution status %s',
    async (childStatusPatch, expectedStatus) => {
      const listChildren = vi.fn().mockImplementation(async (sessionId: string) => {
        if (sessionId === 'session-1') {
          return [{ id: 'child-1', parentSessionId: 'session-1', kind: 'subagent', parentToolCallId: 'call-1', title: 'Child 1', updatedAt: 2 }];
        }
        return [];
      });
      const getSessionStatusWithRun = vi.fn().mockImplementation(async (sessionId: string) => (
        sessionId === 'child-1'
          ? {
              ...makeStatus(sessionId),
              ...childStatusPatch,
              run: childStatusPatch.run
                ? {
                    id: 'run-child-1',
                    sessionId,
                    turnId: 'turn-1',
                    retryCount: 0,
                    safeResume: false,
                    startedAt: 1,
                    updatedAt: 3,
                    lastHeartbeatAt: 3,
                    ...childStatusPatch.run,
                  }
                : undefined,
            }
          : makeStatus(sessionId)
      ));

      const batch = await buildRuntimeActivitySnapshotBatch({
        rootSessionId: 'session-1',
        pipeline: {
          getSessionStatusWithRun,
        },
        toolDispatch: {
          getPendingConfirmations: vi.fn().mockReturnValue([]),
        },
        agentBudgetApprovals: {
          getPendingApprovals: vi.fn().mockReturnValue([]),
        },
        sessionsService: {
          listChildren,
          get: vi.fn(),
          getMessages: vi.fn().mockResolvedValue([]),
        },
      });

      expect(batch.snapshotsBySessionId['session-1'].childExecutions).toEqual([
        expect.objectContaining({
          childSessionId: 'child-1',
          kind: 'subagent' as const,
          status: expectedStatus,
        }),
      ]);
    },
  );

  it('materializes an unresolved tool call as running tool activity', async () => {
    const status = {
      ...makeStatus('session-1'),
      active: true,
      run: {
        id: 'run-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        phase: 'tool_running',
        status: 'active',
        retryCount: 0,
        safeResume: true,
        startedAt: 111,
        updatedAt: 112,
        lastHeartbeatAt: 112,
      },
    } satisfies SocketEvents['session:status'];

    const snapshot = await buildRuntimeActivitySnapshot({
      sessionId: 'session-1',
      status,
      pipeline: {
        getSessionStatusWithRun: vi.fn().mockResolvedValue(status),
      },
      toolDispatch: {
        getPendingConfirmations: vi.fn().mockReturnValue([]),
      },
      agentBudgetApprovals: {
        getPendingApprovals: vi.fn().mockReturnValue([]),
      },
      sessionsService: {
        listChildren: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue({
          id: 'session-1',
          personaId: 'default',
          kind: 'chat',
        }),
        getMessages: vi.fn().mockResolvedValue([
          {
            id: 'assistant-1',
            sessionId: 'session-1',
            role: 'assistant',
            content: '',
            createdAt: 1,
            toolCalls: [
              { id: 'tool-call-1', name: 'run_subagent', args: { objective: 'check' } },
            ],
          },
        ]),
      },
    });

    expect(snapshot.toolActivities).toEqual([
      expect.objectContaining({
        callId: 'tool-call-1',
        toolName: 'run_subagent',
        args: { objective: 'check' },
        status: 'running',
        startedAt: 111,
      }),
    ]);
  });

  it('falls back to findAll when parent-scoped agent-flow lookup is unavailable', async () => {
    const findAll = vi.fn().mockResolvedValue([
      makeAgentFlowSnapshot('session-1'),
      makeAgentFlowSnapshot('other-session'),
    ]);

    const snapshot = await buildRuntimeActivitySnapshot({
      sessionId: 'session-1',
      status: makeStatus('session-1'),
      pipeline: {
        getSessionStatusWithRun: vi.fn().mockResolvedValue(makeStatus('session-1')),
      },
      toolDispatch: {
        getPendingConfirmations: vi.fn().mockReturnValue([]),
      },
      agentBudgetApprovals: {
        getPendingApprovals: vi.fn().mockReturnValue([]),
      },
      sessionsService: {
        listChildren: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue({
          id: 'session-1',
          personaId: 'default',
          kind: 'chat',
        }),
        getMessages: vi.fn(),
      },
      agentFlowRuntime: {
        run: vi.fn(),
        findAll,
      },
    });

    expect(findAll).toHaveBeenCalledTimes(1);
    expect(snapshot.childExecutions).toEqual([
      expect.objectContaining({
        kind: 'agent_flow',
        parentSessionId: 'session-1',
      }),
    ]);
  });

  it('logs non-metadata CLI status failures and keeps the parent snapshot usable', async () => {
    const logger = { warn: vi.fn() };
    const listChildren = vi.fn().mockImplementation(async (sessionId: string) => (
      sessionId === 'session-1'
        ? [{ id: 'cli-child-1', parentSessionId: 'session-1', parentToolCallId: 'call-cli-1', kind: 'cli-agent' }]
        : []
    ));

    const snapshot = await buildRuntimeActivitySnapshot({
      sessionId: 'session-1',
      status: makeStatus('session-1'),
      pipeline: {
        getSessionStatusWithRun: vi.fn().mockResolvedValue(makeStatus('session-1')),
      },
      toolDispatch: {
        getPendingConfirmations: vi.fn().mockReturnValue([]),
      },
      agentBudgetApprovals: {
        getPendingApprovals: vi.fn().mockReturnValue([]),
      },
      sessionsService: {
        listChildren,
        get: vi.fn().mockResolvedValue({
          id: 'session-1',
          personaId: 'default',
          kind: 'chat',
        }),
        getMessages: vi.fn().mockResolvedValue([]),
      },
      cliAgentSessionRuntime: {
        getStatus: vi.fn().mockRejectedValue(new Error('transport down')),
        stopSession: vi.fn(),
      },
      logger,
    });

    expect(snapshot.childExecutions).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('transport down'));
  });

  it('uses an empty child status when subagent status recovery fails', async () => {
    const logger = { warn: vi.fn() };
    const sessionTree = {
      rootSessionId: 'session-1',
      sessionIds: ['session-1'],
      directChildIdsBySessionId: { 'session-1': ['child-1'] },
      descendantIdsBySessionId: { 'session-1': ['child-1'] },
      childSessionsById: {
        'child-1': {
          id: 'child-1',
          parentSessionId: 'session-1',
          parentToolCallId: 'call-1',
          kind: 'subagent',
          title: 'Child 1',
          personaId: 'default',
          createdAt: 1,
          updatedAt: 2,
        },
      },
    } satisfies RuntimeSnapshotSessionTree;

    const batch = await buildRuntimeActivitySnapshotBatch({
      rootSessionId: 'session-1',
      sessionTree,
      statusesBySessionId: {
        'session-1': makeStatus('session-1'),
      },
      pipeline: {
        getSessionStatusWithRun: vi.fn().mockRejectedValue(new Error('status unavailable')),
      },
      toolDispatch: {
        getPendingConfirmations: vi.fn().mockReturnValue([]),
      },
      agentBudgetApprovals: {
        getPendingApprovals: vi.fn().mockReturnValue([]),
      },
      sessionsService: {
        listChildren: vi.fn(),
        get: vi.fn().mockResolvedValue({
          id: 'session-1',
          personaId: 'default',
          kind: 'chat',
        }),
        getMessages: vi.fn().mockResolvedValue([]),
      },
      logger,
    });

    expect(batch.snapshotsBySessionId['session-1'].childExecutions).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('status unavailable'));
  });

  it('falls back to completed for an inactive child subagent that still has run metadata', async () => {
    const listChildren = vi.fn().mockImplementation(async (sessionId: string) => {
      if (sessionId === 'session-1') {
        return [{ id: 'child-1', parentSessionId: 'session-1', kind: 'subagent', parentToolCallId: 'call-1', title: 'Child 1', updatedAt: 2 }];
      }
      return [];
    });
    const getSessionStatusWithRun = vi.fn().mockImplementation(async (sessionId: string) => (
      sessionId === 'child-1'
        ? {
            ...makeStatus(sessionId),
            run: {
              id: 'run-child-1',
              sessionId,
              turnId: 'turn-1',
              phase: 'started',
              status: 'active',
              retryCount: 0,
              safeResume: true,
              startedAt: 1,
              updatedAt: 3,
              lastHeartbeatAt: 3,
            },
          }
        : makeStatus(sessionId)
    ));

    const batch = await buildRuntimeActivitySnapshotBatch({
      rootSessionId: 'session-1',
      pipeline: {
        getSessionStatusWithRun,
      },
      toolDispatch: {
        getPendingConfirmations: vi.fn().mockReturnValue([]),
      },
      agentBudgetApprovals: {
        getPendingApprovals: vi.fn().mockReturnValue([]),
      },
      sessionsService: {
        listChildren,
        get: vi.fn(),
        getMessages: vi.fn().mockResolvedValue([]),
      },
    });

    expect(batch.snapshotsBySessionId['session-1'].childExecutions).toEqual([
      expect.objectContaining({
        childSessionId: 'child-1',
        status: 'completed',
      }),
    ]);
  });

  it('does not duplicate pending confirmations when the same tool call is unresolved', async () => {
    const status = {
      ...makeStatus('session-1'),
      active: true,
      run: {
        id: 'run-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        phase: 'tool_running',
        status: 'active',
        retryCount: 0,
        safeResume: true,
        startedAt: 111,
        updatedAt: 112,
        lastHeartbeatAt: 112,
      },
    } satisfies SocketEvents['session:status'];

    const snapshot = await buildRuntimeActivitySnapshot({
      sessionId: 'session-1',
      status,
      pipeline: {
        getSessionStatusWithRun: vi.fn().mockResolvedValue(status),
      },
      toolDispatch: {
        getPendingConfirmations: vi.fn().mockReturnValue([
          {
            requestId: 'confirm-1',
            sessionId: 'session-1',
            toolCallId: 'tool-call-1',
            toolName: 'run_subagent',
            args: { objective: 'check' },
            createdAt: 1,
          },
        ]),
      },
      agentBudgetApprovals: {
        getPendingApprovals: vi.fn().mockReturnValue([]),
      },
      sessionsService: {
        listChildren: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue({
          id: 'session-1',
          personaId: 'default',
          kind: 'chat',
        }),
        getMessages: vi.fn().mockResolvedValue([
          {
            id: 'assistant-1',
            sessionId: 'session-1',
            role: 'assistant',
            content: '',
            createdAt: 1,
            toolCalls: [
              { id: 'tool-call-1', name: 'run_subagent', args: { objective: 'check' } },
            ],
          },
        ]),
      },
    });

    expect(snapshot.toolActivities).toHaveLength(1);
    expect(snapshot.toolActivities[0]).toEqual(expect.objectContaining({
      callId: 'tool-call-1',
      status: 'pending_confirmation',
    }));
  });

  it('keeps a tool-running snapshot usable when message recovery fails', async () => {
    const logger = { warn: vi.fn() };
    const status = {
      ...makeStatus('session-1'),
      active: true,
      run: {
        id: 'run-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        phase: 'tool_running',
        status: 'active',
        retryCount: 0,
        safeResume: true,
        startedAt: 111,
        updatedAt: 112,
        lastHeartbeatAt: 112,
      },
    } satisfies SocketEvents['session:status'];

    const snapshot = await buildRuntimeActivitySnapshot({
      sessionId: 'session-1',
      status,
      pipeline: {
        getSessionStatusWithRun: vi.fn().mockResolvedValue(status),
      },
      toolDispatch: {
        getPendingConfirmations: vi.fn().mockReturnValue([]),
      },
      agentBudgetApprovals: {
        getPendingApprovals: vi.fn().mockReturnValue([]),
      },
      sessionsService: {
        listChildren: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue({
          id: 'session-1',
          personaId: 'default',
          kind: 'chat',
        }),
        getMessages: vi.fn().mockRejectedValue('message store offline'),
      },
      logger,
    });

    expect(snapshot.toolActivities).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('message store offline'));
  });

  it('returns no agent-flow children when runtime has no lookup API', async () => {
    const snapshot = await buildRuntimeActivitySnapshot({
      sessionId: 'session-1',
      status: makeStatus('session-1'),
      pipeline: {
        getSessionStatusWithRun: vi.fn().mockResolvedValue(makeStatus('session-1')),
      },
      toolDispatch: {
        getPendingConfirmations: vi.fn().mockReturnValue([]),
      },
      agentBudgetApprovals: {
        getPendingApprovals: vi.fn().mockReturnValue([]),
      },
      sessionsService: {
        listChildren: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue({
          id: 'session-1',
          personaId: 'default',
          kind: 'chat',
        }),
        getMessages: vi.fn(),
      },
      agentFlowRuntime: {
        run: vi.fn(),
      },
    });

    expect(snapshot.childExecutions).toEqual([]);
  });

  it('uses agent-flow child session and current timestamp when open ids are unavailable', async () => {
    const flowSnapshot = makeAgentFlowSnapshot('session-1');
    flowSnapshot.run.openChatSessionId = undefined;
    flowSnapshot.run.openGraphRunId = undefined;
    delete (flowSnapshot.run as Partial<typeof flowSnapshot.run>).updatedAt;

    const snapshot = await buildRuntimeActivitySnapshot({
      sessionId: 'session-1',
      status: makeStatus('session-1'),
      pipeline: {
        getSessionStatusWithRun: vi.fn().mockResolvedValue(makeStatus('session-1')),
      },
      toolDispatch: {
        getPendingConfirmations: vi.fn().mockReturnValue([]),
      },
      agentBudgetApprovals: {
        getPendingApprovals: vi.fn().mockReturnValue([]),
      },
      sessionsService: {
        listChildren: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue({
          id: 'session-1',
          personaId: 'default',
          kind: 'chat',
        }),
        getMessages: vi.fn(),
      },
      agentFlowRuntime: {
        run: vi.fn(),
        findByParentSessionId: vi.fn().mockResolvedValue([flowSnapshot]),
      },
    });

    expect(snapshot.childExecutions).toEqual([
      expect.objectContaining({
        childSessionId: 'flow-child-1',
        flowRunId: 'flow-run-1',
        updatedAt: expect.any(Number),
      }),
    ]);
  });

  it('deduplicates repeated child sessions while collecting a reconnect session tree', async () => {
    const listChildren = vi.fn().mockImplementation(async (sessionId: string) => {
      if (sessionId === 'session-1') {
        return [
          { id: 'child-1', parentSessionId: 'session-1', kind: 'subagent' },
          { id: 'child-1', parentSessionId: 'session-1', kind: 'subagent' },
        ];
      }
      if (sessionId === 'child-1') {
        return [
          { id: 'session-1', parentSessionId: 'child-1', kind: 'subagent' },
          { id: 'grandchild-1', parentSessionId: 'child-1', kind: 'subagent' },
        ];
      }
      return [];
    });

    const tree = await collectRuntimeSnapshotSessionTree('session-1', { listChildren });

    expect(tree.sessionIds).toEqual(['session-1', 'child-1', 'grandchild-1']);
    expect(tree.directChildIdsBySessionId['session-1']).toEqual(['child-1']);
    expect(tree.descendantIdsBySessionId['session-1']).toEqual(['child-1', 'grandchild-1']);
  });
});

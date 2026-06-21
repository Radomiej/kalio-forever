import { describe, expect, it, vi } from 'vitest';
import type { AgentFlowRunSnapshot, SocketEvents } from '@kalio/types';
import { buildRuntimeActivitySnapshot, buildRuntimeActivitySnapshotBatch } from './chat.runtime-snapshot';

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
        getStatus: vi.fn().mockRejectedValue(new Error('CLI_AGENT_SESSION_METADATA_MISSING: cli-child-1')),
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
});

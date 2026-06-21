import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentFlowRunSnapshot, ChatSession } from '@kalio/types';
import { SessionRuntimeWatchlistService } from './session-runtime-watchlist.service';

describe('SessionRuntimeWatchlistService', () => {
  const sessions: ChatSession[] = [
    { id: 'root-active', personaId: 'default', title: 'Root active', createdAt: 1, updatedAt: 10 },
    { id: 'root-pending', personaId: 'default', title: 'Root pending', createdAt: 2, updatedAt: 20 },
    { id: 'child-pending', personaId: 'default', title: 'Child pending', parentSessionId: 'root-pending', createdAt: 3, updatedAt: 30 },
    { id: 'root-budget', personaId: 'default', title: 'Root budget', createdAt: 4, updatedAt: 40 },
    { id: 'root-flow', personaId: 'default', title: 'Root flow', createdAt: 5, updatedAt: 50 },
    { id: 'flow-child', personaId: 'default', title: 'Flow child', parentSessionId: 'root-flow', createdAt: 6, updatedAt: 60 },
    { id: 'root-idle', personaId: 'default', title: 'Root idle', createdAt: 7, updatedAt: 70 },
  ];

  let service: SessionRuntimeWatchlistService;
  let sessionsService: { list: ReturnType<typeof vi.fn> };
  let pipeline: { getActiveSessionIds: ReturnType<typeof vi.fn> };
  let toolDispatch: { getPendingConfirmations: ReturnType<typeof vi.fn> };
  let approvals: { getPendingApprovals: ReturnType<typeof vi.fn> };
  let agentFlowRuntime: { findAll: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    sessionsService = {
      list: vi.fn().mockResolvedValue(sessions),
    };
    pipeline = {
      getActiveSessionIds: vi.fn().mockReturnValue(new Set(['root-active'])),
    };
    toolDispatch = {
      getPendingConfirmations: vi.fn().mockImplementation((sessionId: string) => (
        sessionId === 'child-pending' ? [{ requestId: 'confirm-1' }] : []
      )),
    };
    approvals = {
      getPendingApprovals: vi.fn().mockImplementation((sessionId: string) => (
        sessionId === 'root-budget' ? [{ requestId: 'budget-1' }] : []
      )),
    };
    const flowSnapshots: AgentFlowRunSnapshot[] = [
      {
        run: {
          runId: 'flow-1',
          parentSessionId: 'root-flow',
          childSessionId: 'flow-child',
          status: 'running',
        },
        events: [],
      } as unknown as AgentFlowRunSnapshot,
      {
        run: {
          runId: 'flow-2',
          parentSessionId: 'root-idle',
          status: 'completed',
        },
        events: [],
      } as unknown as AgentFlowRunSnapshot,
    ];
    agentFlowRuntime = {
      findAll: vi.fn().mockResolvedValue(flowSnapshots),
    };

    service = new SessionRuntimeWatchlistService(
      sessionsService as never,
      pipeline as never,
      toolDispatch as never,
      approvals as never,
      agentFlowRuntime as never,
    );
  });

  it('returns only roots that still need runtime replay', async () => {
    await expect(service.list()).resolves.toEqual([
      { sessionId: 'root-active', reasons: ['active'] },
      { sessionId: 'root-budget', reasons: ['pending_budget'] },
      { sessionId: 'root-flow', reasons: ['agent_flow_live'] },
      { sessionId: 'root-pending', reasons: ['pending_confirmation'] },
    ]);
  });

  it('keeps multiple reasons for the same root without duplicating the root id', async () => {
    pipeline.getActiveSessionIds.mockReturnValue(new Set(['root-pending']));

    await expect(service.list()).resolves.toContainEqual({
      sessionId: 'root-pending',
      reasons: ['active', 'pending_confirmation'],
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { AgentFlowRunSnapshot } from '@kalio/types';
import { AgentFlowRuntimeService } from './agent-flow-runtime.service';
import type { ArchitectureAgentFlowAdapter } from './architecture-agent-flow.adapter';
import type { AgentFlowRunRepository, RecoverableAgentFlowRun } from './agent-flow-run.repository';
import type { RunJournalService } from '../chat/run-journal.service';

function waitingSnapshot(): AgentFlowRunSnapshot {
  return {
    run: {
      id: 'run-recovery', parentSessionId: 'parent', childSessionId: 'root',
      flowDefinitionId: 'goal_guard_delivery_loop', status: 'waiting_on_orchestrator',
      startMode: 'durable', returnMode: 'summary', createdAt: 1, updatedAt: 2,
      checkpoint: {
        goal: 'Resume safely',
        continuation: {
          reason: 'runtime_pause', waitingNodeId: 'implementer', pendingNodeIds: ['implementer'],
          visitCounts: { orchestrator: 1 },
          waitIdentity: {
            requestId: 'request-1', childSessionId: 'child-1', childTurnId: 'turn-1',
            promptMessageId: 'prompt-1',
          },
        },
      },
    },
    events: [],
  };
}

describe('AgentFlowRuntimeService recovery', () => {
  it('claims and resumes a completed child wait exactly once across competing bootstraps', async () => {
    const snapshot = waitingSnapshot();
    const candidate: RecoverableAgentFlowRun = { snapshot, revision: 7 };
    let claimed = false;
    const makeRepository = () => ({
      findRecoverableRuns: vi.fn().mockReturnValue([candidate]),
      claimRecovery: vi.fn(() => {
        if (claimed) return false;
        claimed = true;
        return true;
      }),
    }) as unknown as AgentFlowRunRepository;
    const runJournal = {
      getCompletedTurn: vi.fn().mockResolvedValue({
        status: 'completed', outcome: { finalText: 'child completed', structuredOutput: { decision: 'continue' } },
      }),
    } as unknown as RunJournalService;
    const first = new AgentFlowRuntimeService({} as ArchitectureAgentFlowAdapter, makeRepository(), undefined, undefined, undefined, runJournal);
    const second = new AgentFlowRuntimeService({} as ArchitectureAgentFlowAdapter, makeRepository(), undefined, undefined, undefined, runJournal);
    const firstResume = vi.spyOn(first, 'resume').mockResolvedValue(snapshot);
    const secondResume = vi.spyOn(second, 'resume').mockResolvedValue(snapshot);

    const recovered = await Promise.all([first.recoverOrphanedRuns(100), second.recoverOrphanedRuns(100)]);

    expect(recovered.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(firstResume.mock.calls.length + secondResume.mock.calls.length).toBe(1);
    const resumeCall = firstResume.mock.calls[0] ?? secondResume.mock.calls[0];
    expect(resumeCall).toEqual([
      'run-recovery',
      { context: { runtimeRecovery: { requestId: 'request-1', childSessionId: 'child-1', childTurnId: 'turn-1' } } },
    ]);
  });

  it('reacts to a completed child outcome without polling or a fixed delay', async () => {
    let listener: ((run: { outcome?: { finalText: string } }) => void | Promise<void>) | undefined;
    const unsubscribe = vi.fn();
    const runJournal = {
      subscribeCompleted: vi.fn((next: typeof listener) => {
        listener = next;
        return unsubscribe;
      }),
    } as unknown as RunJournalService;
    const repository = { findRecoverableRuns: vi.fn().mockReturnValue([]) } as unknown as AgentFlowRunRepository;
    const runtime = new AgentFlowRuntimeService(
      {} as ArchitectureAgentFlowAdapter, repository, undefined, undefined, undefined, runJournal,
    );
    const recover = vi.spyOn(runtime, 'recoverOrphanedRuns').mockResolvedValue(0);

    runtime.onApplicationBootstrap();
    recover.mockClear();
    await listener?.({ outcome: { finalText: 'child completed after approval' } });

    expect(recover).toHaveBeenCalledTimes(1);
    runtime.onModuleDestroy();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

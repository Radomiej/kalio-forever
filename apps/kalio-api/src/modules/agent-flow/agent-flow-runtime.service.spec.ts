import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import type { AgentFlowRunSnapshot, ResumeAgentFlowRunDto } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import * as schema from '../../database/schema';
import { AgentFlowRuntimeService } from './agent-flow-runtime.service';
import { AgentFlowRunRepository } from './agent-flow-run.repository';
import { ArchitectureAgentFlowAdapter } from './architecture-agent-flow.adapter';

function adapter() {
  return {
    run: vi.fn(),
    start: vi.fn(),
    getSnapshot: vi.fn(),
    stop: vi.fn(),
  };
}

describe('AgentFlowRuntimeService', () => {
  it('starts durable runs with an async adapter snapshot', async () => {
    vi.useFakeTimers();
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    const durableSnapshot: AgentFlowRunSnapshot = {
      run: {
        id: 'run-1',
        parentSessionId: 'parent-1',
        childSessionId: 'child-1',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    };
    architectureAdapter.start.mockResolvedValue(durableSnapshot);

    const started = await service.start({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Deliver feature',
      parentSessionId: 'parent-1',
      context: { repo: 'TurboProject2' },
      vfsMode: 'shared',
      copyBack: true,
      maxSteps: 8,
    });

    expect(started.run.id).toBe('run-1');
    expect(started.run.status).toBe('running');
    expect(architectureAdapter.start).toHaveBeenCalledWith(expect.objectContaining({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Deliver feature',
      parentSessionId: 'parent-1',
    }));
    expect(repository.getSnapshot('run-1')?.run.status).toBe('running');
    expect(repository.getSnapshot('run-1')?.run.checkpoint).toEqual({
      goal: 'Deliver feature',
      context: { repo: 'TurboProject2' },
      vfsMode: 'shared',
      copyBack: true,
      maxSteps: 8,
    });
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('rewrites adapter parent lineage in durable snapshots and persisted tool results', async () => {
    vi.useFakeTimers();
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    architectureAdapter.start.mockResolvedValue({
      run: {
        id: 'run-lineage-rewrite',
        parentSessionId: 'adapter-parent',
        parentToolCallId: 'adapter-tool-call',
        childSessionId: 'adapter-child',
        flowDefinitionId: 'wrong-flow',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
      result: {
        flowRunId: 'run-lineage-rewrite',
        parentSessionId: 'adapter-parent',
        parentToolCallId: 'adapter-tool-call',
        childSessionId: 'adapter-child',
        status: 'running',
        summary: 'Adapter snapshot started.',
        decisions: [],
        nextActions: [],
        artifacts: [],
      },
    } satisfies AgentFlowRunSnapshot);

    const started = await service.start({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Preserve the run_sub_agentflow caller lineage',
      parentSessionId: 'real-parent',
      parentToolCallId: 'real-tool-call',
      startMode: 'durable',
    });

    expect(started.run.parentSessionId).toBe('real-parent');
    expect(started.run.parentToolCallId).toBe('real-tool-call');
    expect(started.run.flowDefinitionId).toBe('goal_guard_delivery_loop');
    expect(started.result?.parentSessionId).toBe('real-parent');
    expect(started.result?.parentToolCallId).toBe('real-tool-call');
    expect(repository.getSnapshot('run-lineage-rewrite')?.run.parentSessionId).toBe('real-parent');
    expect(repository.getSnapshot('run-lineage-rewrite')?.run.parentToolCallId).toBe('real-tool-call');
    expect(repository.getSnapshot('run-lineage-rewrite')?.result?.parentSessionId).toBe('real-parent');
    expect(repository.getSnapshot('run-lineage-rewrite')?.result?.parentToolCallId).toBe('real-tool-call');
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('copies isolated completed AgentFlow artifacts back into the parent VFS when requested', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const vfs = {
      copySessionFiles: vi.fn(() => [
        { fromPath: 'dist/index.html', toPath: 'agent-flows/run-copy/dist/index.html', sizeBytes: 12 },
      ]),
    };
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
      vfs as never,
    );
    architectureAdapter.run.mockResolvedValue({
      flowRunId: 'run-copy',
      childSessionId: 'child-copy',
      status: 'done',
      summary: 'Done.',
      decisions: [],
      nextActions: [],
      artifacts: [],
      tracePreview: [],
      openChatSessionId: 'child-copy',
      openGraphRunId: 'run-copy',
    });

    const result = await service.run({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Build artifacts',
      parentSessionId: 'parent-copy',
      startMode: 'blocking',
      vfsMode: 'isolated',
      copyBack: true,
      returnMode: 'summary',
    });

    expect(vfs.copySessionFiles).toHaveBeenCalledWith({
      fromSessionId: 'child-copy',
      toSessionId: 'parent-copy',
      targetPrefix: 'agent-flows/run-copy',
    });
    expect(result.artifacts).toEqual(['agent-flows/run-copy/dist/index.html']);
    expect(repository.getSnapshot('run-copy')?.events).toContainEqual(expect.objectContaining({
      type: 'flow:copy_back',
      data: expect.objectContaining({
        fromSessionId: 'child-copy',
        toSessionId: 'parent-copy',
      }),
    }));
  });

  it('does not fabricate a copy-back event when the VFS copy request returns no files', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const vfs = {
      copySessionFiles: vi.fn(() => []),
    };
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
      vfs as never,
    );
    architectureAdapter.run.mockResolvedValue({
      flowRunId: 'run-empty-copy',
      childSessionId: 'child-empty-copy',
      status: 'done',
      summary: 'Done.',
      decisions: [],
      nextActions: [],
      artifacts: [],
      tracePreview: [],
    });

    const result = await service.run({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Build artifacts without a parent copy',
      parentSessionId: 'parent-empty-copy',
      startMode: 'blocking',
      vfsMode: 'isolated',
      copyBack: true,
    });

    expect(vfs.copySessionFiles).toHaveBeenCalledWith({
      fromSessionId: 'child-empty-copy',
      toSessionId: 'parent-empty-copy',
      targetPrefix: 'agent-flows/run-empty-copy',
    });
    expect(result.artifacts).toEqual([]);
    expect(repository.getSnapshot('run-empty-copy')?.events).toEqual([]);
  });

  it('does not copy artifacts when copyBack is disabled or the flow uses shared VFS', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const vfs = { copySessionFiles: vi.fn(() => []) };
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
      vfs as never,
    );
    architectureAdapter.run.mockResolvedValue({
      flowRunId: 'run-no-copy',
      childSessionId: 'child-no-copy',
      status: 'done',
      summary: 'Done.',
      decisions: [],
      nextActions: [],
      artifacts: [],
      tracePreview: [],
    });

    await service.run({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Shared flow',
      parentSessionId: 'parent-no-copy',
      startMode: 'blocking',
      vfsMode: 'shared',
      copyBack: true,
    });
    await service.run({
      flowId: 'goal_guard_delivery_loop',
      goal: 'No copy flow',
      parentSessionId: 'parent-no-copy',
      startMode: 'blocking',
      vfsMode: 'isolated',
      copyBack: false,
    });

    expect(vfs.copySessionFiles).not.toHaveBeenCalled();
  });

  it('does not duplicate copy-back evidence when a completed run is reread', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const vfs = {
      copySessionFiles: vi.fn(() => [
        { fromPath: 'dist/index.html', toPath: 'agent-flows/run-copy-once/dist/index.html', sizeBytes: 12 },
      ]),
    };
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
      vfs as never,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-copy-once',
        parentSessionId: 'parent-copy-once',
        childSessionId: 'child-copy-once',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Build artifacts once',
          vfsMode: 'isolated',
          copyBack: true,
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    });
    architectureAdapter.getSnapshot.mockResolvedValue({
      run: {
        id: 'run-copy-once',
        parentSessionId: 'parent-copy-once',
        childSessionId: 'child-copy-once',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'done',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Build artifacts once',
          vfsMode: 'isolated',
          copyBack: true,
        },
        createdAt: 1,
        updatedAt: 20,
        finishedAt: 20,
      },
      events: [
        {
          id: 'event-final',
          sequence: 1,
          type: 'final_artifact',
          message: 'Artifacts built.',
          createdAt: 20,
        },
      ],
      result: {
        flowRunId: 'run-copy-once',
        childSessionId: 'child-copy-once',
        status: 'done',
        summary: 'Artifacts built.',
        decisions: [],
        nextActions: [],
        artifacts: [],
      },
    } satisfies AgentFlowRunSnapshot);

    await service.getSnapshot('run-copy-once');
    await service.getSnapshot('run-copy-once');

    expect(vfs.copySessionFiles).toHaveBeenCalledTimes(1);
    expect(repository.getSnapshot('run-copy-once')?.events.filter((event) => event.type === 'flow:copy_back')).toHaveLength(1);
  });

  it('does not repeat copy-back work when the adapter snapshot already carries copy-back evidence', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const vfs = {
      copySessionFiles: vi.fn(() => [
        { fromPath: 'dist/index.html', toPath: 'agent-flows/run-copy-evidence/dist/index.html', sizeBytes: 12 },
      ]),
    };
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
      vfs as never,
    );
    architectureAdapter.run.mockResolvedValue({
      flowRunId: 'run-copy-evidence',
      childSessionId: 'child-copy-evidence',
      status: 'done',
      summary: 'Artifacts already copied.',
      decisions: [],
      nextActions: [],
      artifacts: ['agent-flows/run-copy-evidence/dist/index.html'],
      tracePreview: [
        {
          id: 'event-copy-back',
          sequence: 1,
          type: 'flow:copy_back',
          message: 'Copied 1 AgentFlow artifact back to the parent session.',
          status: 'done',
          createdAt: 20,
        },
      ],
      openChatSessionId: 'child-copy-evidence',
      openGraphRunId: 'run-copy-evidence',
    });

    const result = await service.run({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Build artifacts with existing copy-back evidence',
      parentSessionId: 'parent-copy-evidence',
      startMode: 'blocking',
      vfsMode: 'isolated',
      copyBack: true,
      returnMode: 'summary',
    });

    expect(vfs.copySessionFiles).not.toHaveBeenCalled();
    expect(result.artifacts).toEqual(['agent-flows/run-copy-evidence/dist/index.html']);
    expect(repository.getSnapshot('run-copy-evidence')?.events.filter((event) => event.type === 'flow:copy_back')).toHaveLength(1);
  });

  it('reconciles durable async runs after the architecture runtime finishes', async () => {
    vi.useFakeTimers();
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    architectureAdapter.start.mockResolvedValue({
      run: {
        id: 'run-async-final',
        parentSessionId: 'parent-async',
        childSessionId: 'child-async',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    } satisfies AgentFlowRunSnapshot);
    architectureAdapter.getSnapshot.mockResolvedValue({
      run: {
        id: 'run-async-final',
        parentSessionId: 'parent-async',
        childSessionId: 'child-async',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'failed',
        startMode: 'durable',
        returnMode: 'summary',
        createdAt: 1,
        updatedAt: 30,
      },
      events: [
        {
          id: 'arch-event-failed',
          sequence: 1,
          type: 'architecture:router_decision',
          message: 'Architecture run failed.',
          status: 'failed',
          createdAt: 30,
        },
      ],
      result: {
        flowRunId: 'run-async-final',
        childSessionId: 'child-async',
        status: 'failed',
        summary: 'failed',
        decisions: [],
        nextActions: ['Fix missing evidence.'],
        artifacts: [],
      },
    } satisfies AgentFlowRunSnapshot);

    await service.start({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Deliver feature',
      parentSessionId: 'parent-async',
    });
    await vi.advanceTimersByTimeAsync(1000);

    expect(architectureAdapter.getSnapshot).toHaveBeenCalledWith(
      'run-async-final',
      expect.objectContaining({
        flowId: 'goal_guard_delivery_loop',
        parentSessionId: 'parent-async',
      }),
    );
    expect(repository.getSnapshot('run-async-final')?.run.status).toBe('failed');
    expect(repository.getSnapshot('run-async-final')?.result?.status).toBe('failed');
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('preserves parent-visible open targets when a durable run reconciles to completion', async () => {
    vi.useFakeTimers();
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    architectureAdapter.start.mockResolvedValue({
      run: {
        id: 'run-durable-complete',
        parentSessionId: 'parent-complete',
        childSessionId: 'child-complete',
        openChatSessionId: 'arch-run-complete-root',
        openGraphRunId: 'run-durable-complete',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [
        {
          id: 'event-start',
          sequence: 1,
          type: 'architecture:node_started',
          message: 'Started child AgentFlow.',
          createdAt: 2,
        },
      ],
    } satisfies AgentFlowRunSnapshot);
    architectureAdapter.getSnapshot.mockResolvedValue({
      run: {
        id: 'run-durable-complete',
        parentSessionId: 'parent-complete',
        childSessionId: 'child-complete',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'done',
        startMode: 'durable',
        returnMode: 'summary',
        createdAt: 1,
        updatedAt: 10,
        finishedAt: 10,
      },
      events: [
        {
          id: 'event-final',
          sequence: 2,
          type: 'architecture:final_artifact',
          message: 'Completed.',
          status: 'done',
          createdAt: 10,
        },
      ],
      result: {
        flowRunId: 'run-durable-complete',
        childSessionId: 'child-complete',
        status: 'done',
        summary: 'Completed.',
        decisions: [],
        nextActions: [],
        artifacts: [],
        openChatSessionId: 'arch-run-complete-root',
        openGraphRunId: 'run-durable-complete',
      },
    } satisfies AgentFlowRunSnapshot);

    await service.start({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Deliver feature',
      parentSessionId: 'parent-complete',
    });
    await vi.advanceTimersByTimeAsync(1000);

    const snapshot = repository.getSnapshot('run-durable-complete');
    expect(snapshot?.run.status).toBe('done');
    expect(snapshot?.run.openChatSessionId).toBe('arch-run-complete-root');
    expect(snapshot?.run.openGraphRunId).toBe('run-durable-complete');
    expect(snapshot?.events.map((event) => event.type)).toEqual([
      'architecture:node_started',
      'architecture:final_artifact',
    ]);
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('keeps durable waiting runs waiting during scheduled reconciliation instead of blocking them as stale', async () => {
    vi.useFakeTimers();
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    architectureAdapter.start.mockResolvedValue({
      run: {
        id: 'run-durable-waiting',
        parentSessionId: 'parent-waiting',
        childSessionId: 'child-waiting',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        waitingForNodeId: 'goal-master',
        checkpoint: {
          goal: 'Hold at the orchestrator gate until the parent resumes the run.',
          continuation: {
            reason: 'return_to_orchestrator',
            waitingNodeId: 'goal-master',
            pendingNodeIds: ['goal-master'],
            visitCounts: { implementer: 1, 'goal-master': 1 },
          },
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    } satisfies AgentFlowRunSnapshot);

    const started = await service.start({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Hold at the gate',
      parentSessionId: 'parent-waiting',
    });
    await vi.advanceTimersByTimeAsync(1000);

    expect(started.run.status).toBe('waiting_on_orchestrator');
    expect(architectureAdapter.getSnapshot).not.toHaveBeenCalled();
    expect(repository.getSnapshot('run-durable-waiting')?.run.status).toBe('waiting_on_orchestrator');
    expect(repository.getSnapshot('run-durable-waiting')?.events).toEqual([]);
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('stores blocking adapter results as durable snapshots', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    architectureAdapter.run.mockResolvedValue({
      flowRunId: 'run-blocking',
      childSessionId: 'child-blocking',
      status: 'done',
      summary: 'done',
      decisions: [],
      nextActions: [],
      artifacts: [],
      tracePreview: [],
    });

    const result = await service.run({
      flowId: 'architecture_debate',
      goal: 'Review',
      parentSessionId: 'parent-2',
      startMode: 'blocking',
    });

    expect(result.status).toBe('done');
    expect(architectureAdapter.run).toHaveBeenCalledTimes(1);
    const snapshot = repository.getSnapshot('run-blocking');
    expect(snapshot?.run.status).toBe('done');
    expect(snapshot?.run.startMode).toBe('blocking');
  });

  it('preserves child flow open targets when storing a blocking run result', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    architectureAdapter.run.mockResolvedValue({
      flowRunId: 'run-open-targets',
      childSessionId: 'arch-run-open-targets-root',
      status: 'done',
      summary: 'done',
      decisions: [],
      nextActions: [],
      artifacts: [],
      tracePreview: [],
      openChatSessionId: 'arch-run-open-targets-root',
      openGraphRunId: 'run-open-targets',
    });

    const result = await service.run({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Keep child flow links',
      parentSessionId: 'parent-open-targets',
      startMode: 'blocking',
    });

    expect(result.openChatSessionId).toBe('arch-run-open-targets-root');
    expect(result.openGraphRunId).toBe('run-open-targets');
    expect(repository.getSnapshot('run-open-targets')?.run.openChatSessionId).toBe('arch-run-open-targets-root');
    expect(repository.getSnapshot('run-open-targets')?.run.openGraphRunId).toBe('run-open-targets');
  });

  it('records a resume event and moves waiting runs back to running', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-wait',
        parentSessionId: 'parent-3',
        childSessionId: 'child-wait',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Original task',
          context: { phase: 1 },
          vfsMode: 'isolated',
          copyBack: false,
          maxSteps: 4,
        },
        waitingForNodeId: 'orchestrator',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    });
    const dto: ResumeAgentFlowRunDto = {
      input: 'Continue with current context.',
      context: { step: 2 },
      maxSteps: 40,
    };
    const resumed = await service.resume('run-wait', dto);

    expect(resumed.run.status).toBe('running');
    expect(resumed.events).toHaveLength(1);
    expect(resumed.events[0]?.message).toBe('Continue with current context.');
    expect(repository.getSnapshot('run-wait')?.run.status).toBe('running');
    expect(repository.getSnapshot('run-wait')?.run.checkpoint).toEqual({
      goal: 'Original task',
      context: { phase: 1 },
      vfsMode: 'isolated',
      copyBack: false,
      maxSteps: 40,
      lastResumeInput: 'Continue with current context.',
      resumeContext: { step: 2 },
    });
  });

  it('allows resume when a stored running snapshot has a continuation cursor', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-stored-running-continuation',
        parentSessionId: 'parent-continuation',
        childSessionId: 'child-continuation',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Continue after restart',
          continuation: {
            reason: 'return_to_orchestrator',
            waitingNodeId: 'implementer',
            pendingNodeIds: ['implementer'],
            visitCounts: { implementer: 2 },
          },
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    });
    architectureAdapter.getSnapshot.mockResolvedValue({
      run: {
        id: 'run-stored-running-continuation',
        parentSessionId: 'parent-continuation',
        childSessionId: 'child-continuation',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'done',
        startMode: 'durable',
        returnMode: 'summary',
        createdAt: 1,
        updatedAt: 10,
      },
      events: [],
      result: {
        flowRunId: 'run-stored-running-continuation',
        childSessionId: 'child-continuation',
        status: 'done',
        summary: 'done',
        decisions: [],
        nextActions: [],
        artifacts: [],
      },
    } satisfies AgentFlowRunSnapshot);

    const resumed = await service.resume('run-stored-running-continuation', {
      input: 'Continue from cursor.',
    });

    expect(resumed.run.status).toBe('done');
    expect(architectureAdapter.getSnapshot).toHaveBeenCalled();
    expect(repository.getSnapshot('run-stored-running-continuation')?.events.map((event) => event.type)).toEqual([
      'flow:return_to_orchestrator',
      'flow:resume_input',
    ]);
  });

  it('preserves the stored AgentFlow identity and links when resume refresh returns mismatched ids', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    const resume = vi.fn();
    (architectureAdapter as unknown as { resume: typeof resume }).resume = resume;
    repository.saveSnapshot({
      run: {
        id: 'run-identity',
        parentSessionId: 'parent-stored',
        parentToolCallId: 'call-stored',
        childSessionId: 'child-stored',
        openChatSessionId: 'child-stored',
        openGraphRunId: 'run-identity',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Original goal',
          context: { from: 'stored' },
          vfsMode: 'isolated',
          copyBack: false,
          maxSteps: 4,
          continuation: {
            reason: 'max_steps',
            waitingNodeId: 'implementer',
            pendingNodeIds: ['implementer'],
            visitCounts: { implementer: 1 },
          },
        },
        waitingForNodeId: 'implementer',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [
        {
          id: 'event-waiting',
          sequence: 1,
          type: 'flow:waiting_on_orchestrator',
          message: 'Paused.',
          status: 'waiting_on_orchestrator',
          createdAt: 2,
        },
      ],
    });
    resume.mockResolvedValue({
      run: {
        id: 'run-identity',
        parentSessionId: 'parent-rewritten',
        parentToolCallId: 'call-rewritten',
        childSessionId: 'child-rewritten',
        openChatSessionId: 'child-rewritten',
        openGraphRunId: 'run-rewritten',
        flowDefinitionId: 'different-flow',
        status: 'done',
        startMode: 'durable',
        returnMode: 'artifacts_only',
        createdAt: 1,
        updatedAt: 10,
      },
      events: [
        {
          id: 'event-final',
          sequence: 2,
          type: 'architecture:final_artifact',
          message: 'Resume completed.',
          status: 'done',
          createdAt: 10,
        },
      ],
      result: {
        flowRunId: 'run-identity',
        childSessionId: 'child-rewritten',
        status: 'done',
        summary: 'Resume completed.',
        decisions: [],
        nextActions: [],
        artifacts: [],
        openChatSessionId: 'child-rewritten',
        openGraphRunId: 'run-rewritten',
      },
    } satisfies AgentFlowRunSnapshot);

    const resumed = await service.resume('run-identity', {
      input: 'Continue with the stored flow.',
    });

    expect(resume.mock.calls[0]?.[0]).toBe('run-identity');
    expect(resume.mock.calls[0]?.[1]).toMatchObject({
      input: 'Continue with the stored flow.',
    });
    expect(resumed.run).toMatchObject({
      id: 'run-identity',
      parentSessionId: 'parent-stored',
      parentToolCallId: 'call-stored',
      childSessionId: 'child-stored',
      openChatSessionId: 'child-stored',
      openGraphRunId: 'run-identity',
      flowDefinitionId: 'goal_guard_delivery_loop',
      status: 'done',
      returnMode: 'summary',
    });
    expect(resumed.result).toMatchObject({
      childSessionId: 'child-stored',
      openChatSessionId: 'child-stored',
      openGraphRunId: 'run-identity',
    });
    expect(repository.getSnapshot('run-identity')?.run).toMatchObject({
      parentSessionId: 'parent-stored',
      parentToolCallId: 'call-stored',
      childSessionId: 'child-stored',
      openChatSessionId: 'child-stored',
      openGraphRunId: 'run-identity',
      flowDefinitionId: 'goal_guard_delivery_loop',
    });
  });

  it('keeps AgentFlow event sequence strictly increasing after resume refresh merges architecture events', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    const resume = vi.fn();
    (architectureAdapter as unknown as { resume: typeof resume }).resume = resume;
    repository.saveSnapshot({
      run: {
        id: 'run-resume-sequence',
        parentSessionId: 'parent-sequence',
        childSessionId: 'child-sequence',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Resume with host evidence.',
          continuation: {
            reason: 'return_to_orchestrator',
            waitingNodeId: 'implementer',
            pendingNodeIds: ['implementer'],
            visitCounts: { orchestrator: 1, implementer: 1, 'goal-master': 1 },
            lastCompletedNodeId: 'orchestrator',
          },
        },
        createdAt: 1,
        updatedAt: 4,
      },
      events: [
        {
          id: 'flow-1',
          sequence: 1,
          type: 'flow:run_created',
          message: 'Created.',
          createdAt: 1,
        },
        {
          id: 'flow-2',
          sequence: 2,
          type: 'flow:node_result',
          message: 'Orchestrator completed.',
          nodeId: 'orchestrator',
          roleSlotId: 'orchestrator',
          createdAt: 2,
        },
        {
          id: 'flow-3',
          sequence: 3,
          type: 'flow:missing_final_artifact',
          message: 'Missing final artifact.',
          status: 'blocked',
          createdAt: 3,
        },
      ],
    });
    resume.mockResolvedValue({
      run: {
        id: 'run-resume-sequence',
        parentSessionId: 'parent-sequence',
        childSessionId: 'child-sequence',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'done',
        startMode: 'durable',
        returnMode: 'summary',
        createdAt: 1,
        updatedAt: 7,
      },
      events: [
        {
          id: 'arch-resume-created',
          sequence: 3,
          type: 'flow:run_created',
          message: 'Architecture resumed.',
          createdAt: 5,
        },
        {
          id: 'arch-goal-master-start',
          sequence: 4,
          type: 'flow:node_start',
          message: 'Goal Master started.',
          nodeId: 'goal-master',
          roleSlotId: 'goal_master',
          createdAt: 6,
        },
        {
          id: 'arch-final-artifact',
          sequence: 5,
          type: 'flow:final_artifact',
          message: 'Final artifact.',
          nodeId: 'final-artifact',
          roleSlotId: 'finalizer',
          status: 'done',
          createdAt: 7,
        },
      ],
      result: {
        flowRunId: 'run-resume-sequence',
        childSessionId: 'child-sequence',
        status: 'done',
        summary: 'Final artifact.',
        decisions: [],
        nextActions: [],
        artifacts: [],
      },
    } satisfies AgentFlowRunSnapshot);

    const resumed = await service.resume('run-resume-sequence', {
      input: 'Host evidence passed.',
    });

    expect(resumed.run.status).toBe('done');
    expect(resumed.events.map((event) => event.type)).toEqual([
      'flow:run_created',
      'flow:node_result',
      'flow:missing_final_artifact',
      'flow:return_to_orchestrator',
      'flow:resume_input',
      'flow:run_created',
      'flow:node_start',
      'flow:final_artifact',
    ]);
    expect(resumed.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('marks a resumed run blocked when the adapter throws during resume', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    const resume = vi.fn();
    (architectureAdapter as unknown as { resume: typeof resume }).resume = resume;
    repository.saveSnapshot({
      run: {
        id: 'run-resume-failed',
        parentSessionId: 'parent-failed',
        childSessionId: 'child-failed',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Keep the bounded flow resumable.',
          continuation: {
            reason: 'return_to_orchestrator',
            waitingNodeId: 'goal-master',
            pendingNodeIds: ['goal-master'],
            visitCounts: { implementer: 1, 'goal-master': 1 },
          },
        },
        waitingForNodeId: 'goal-master',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    });
    resume.mockRejectedValue(new Error('resume exploded'));

    await expect(service.resume('run-resume-failed', {
      input: 'Resume the flow.',
    })).rejects.toThrow('resume exploded');

    expect(repository.getSnapshot('run-resume-failed')?.run).toMatchObject({
      status: 'blocked',
      summary: 'Blocked because AgentFlow resume failed.',
      finishedAt: expect.any(Number),
    });
    expect(repository.getSnapshot('run-resume-failed')?.events.map((event) => event.type)).toEqual([
      'flow:return_to_orchestrator',
      'flow:resume_input',
      'flow:resume_failed',
    ]);
    expect(repository.getSnapshot('run-resume-failed')?.events.at(-1)).toMatchObject({
      type: 'flow:resume_failed',
      status: 'blocked',
      message: 'resume exploded',
    });
  });

  it('recovers resume errors when the durable runtime made progress after the resume input', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    const resume = vi.fn();
    (architectureAdapter as unknown as { resume: typeof resume }).resume = resume;
    repository.saveSnapshot({
      run: {
        id: 'run-resume-error-with-progress',
        parentSessionId: 'parent-progress',
        childSessionId: 'child-progress',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Continue after external QA.',
          continuation: {
            reason: 'return_to_orchestrator',
            waitingNodeId: 'implementer',
            pendingNodeIds: ['implementer'],
            visitCounts: { implementer: 1, 'goal-master': 1 },
          },
        },
        waitingForNodeId: 'implementer',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    });
    resume.mockRejectedValue(new Error('implementer completed without required tool evidence'));
    architectureAdapter.getSnapshot.mockResolvedValue({
      run: {
        id: 'run-resume-error-with-progress',
        parentSessionId: 'parent-progress',
        childSessionId: 'child-progress',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Continue after external QA.',
          continuation: {
            reason: 'return_to_orchestrator',
            waitingNodeId: 'implementer',
            pendingNodeIds: ['implementer'],
            visitCounts: { implementer: 2, 'goal-master': 2 },
          },
        },
        createdAt: 1,
        updatedAt: 10,
      },
      events: [
        {
          id: 'arch-progress-after-resume',
          sequence: 2,
          type: 'flow:node_start',
          message: 'Implementer started after resume.',
          nodeId: 'implementer',
          status: 'running',
          createdAt: 10,
        },
      ],
    } satisfies AgentFlowRunSnapshot);

    const resumed = await service.resume('run-resume-error-with-progress', {
      input: 'Resume with external build evidence.',
    });

    expect(resumed.run.status).toBe('waiting_on_orchestrator');
    expect(resumed.run.finishedAt).toBeUndefined();
    expect(resumed.events.map((event) => event.type)).toEqual([
      'flow:return_to_orchestrator',
      'flow:resume_input',
      'flow:node_start',
      'flow:return_to_orchestrator',
    ]);
    expect(resumed.events.some((event) => event.type === 'flow:resume_failed')).toBe(false);
    expect(repository.getSnapshot('run-resume-error-with-progress')?.run.status).toBe('waiting_on_orchestrator');
  });

  it('projects return-to-orchestrator continuations as explicit supervision handoffs', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-return-to-orchestrator',
        parentSessionId: 'parent-return',
        childSessionId: 'child-return',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Return to supervisor before the next implementation pass',
          continuation: {
            reason: 'return_to_orchestrator',
            waitingNodeId: 'orchestrator',
            pendingNodeIds: ['orchestrator'],
            visitCounts: { implementer: 1, 'goal-master': 1 },
            lastCompletedNodeId: 'goal-master',
            message: 'Goal Guard returned control to the orchestrator for QA evidence.',
          },
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    });
    architectureAdapter.getSnapshot.mockResolvedValue(null);

    const snapshot = await service.getSnapshot('run-return-to-orchestrator');

    expect(snapshot?.run).toMatchObject({
      status: 'waiting_on_orchestrator',
      waitingForNodeId: 'orchestrator',
      activeNodeIds: ['orchestrator'],
      nodeVisitCounts: { implementer: 1, 'goal-master': 1 },
      returnToOrchestratorCount: 1,
    });
    expect(snapshot?.events).toEqual([
      expect.objectContaining({
        type: 'flow:return_to_orchestrator',
        nodeId: 'orchestrator',
        status: 'waiting_on_orchestrator',
        message: 'Goal Guard returned control to the orchestrator for QA evidence.',
      }),
    ]);
  });

  it('increments return-to-orchestrator count across repeated waiting cycles', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-return-count',
        parentSessionId: 'parent-return-count',
        childSessionId: 'child-return-count',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        returnToOrchestratorCount: 1,
        checkpoint: {
          goal: 'Loop until Goal Guard accepts evidence.',
          continuation: {
            reason: 'return_to_orchestrator',
            waitingNodeId: 'implementer',
            pendingNodeIds: ['implementer'],
            visitCounts: { implementer: 1, 'goal-master': 1 },
          },
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [
        {
          id: 'return-1',
          sequence: 1,
          type: 'flow:return_to_orchestrator',
          message: 'First handoff.',
          nodeId: 'implementer',
          status: 'waiting_on_orchestrator',
          createdAt: 2,
        },
        {
          id: 'resume-1',
          sequence: 2,
          type: 'flow:resume_input',
          message: 'Continue.',
          status: 'running',
          createdAt: 3,
        },
      ],
    });
    architectureAdapter.getSnapshot.mockResolvedValue({
      run: {
        id: 'run-return-count',
        parentSessionId: 'parent-return-count',
        childSessionId: 'child-return-count',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Loop until Goal Guard accepts evidence.',
          continuation: {
            reason: 'return_to_orchestrator',
            waitingNodeId: 'goal-master',
            pendingNodeIds: ['goal-master'],
            visitCounts: { implementer: 2, 'goal-master': 2 },
          },
        },
        createdAt: 1,
        updatedAt: 4,
      },
      events: [],
    } satisfies AgentFlowRunSnapshot);

    const snapshot = await service.getSnapshot('run-return-count');

    expect(snapshot?.run.status).toBe('waiting_on_orchestrator');
    expect(snapshot?.run.returnToOrchestratorCount).toBe(2);
    expect(snapshot?.events.filter((event) => event.type === 'flow:return_to_orchestrator')).toHaveLength(2);
  });

  it('blocks flows that exceed the return-to-orchestrator cap', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-return-cap',
        parentSessionId: 'parent-return-cap',
        childSessionId: 'child-return-cap',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        maxIterations: 1,
        returnToOrchestratorCount: 1,
        checkpoint: {
          goal: 'Stop unbounded supervision loops.',
          continuation: {
            reason: 'return_to_orchestrator',
            waitingNodeId: 'implementer',
            pendingNodeIds: ['implementer'],
            visitCounts: { implementer: 1, 'goal-master': 1 },
          },
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [
        {
          id: 'return-cap-1',
          sequence: 1,
          type: 'flow:return_to_orchestrator',
          message: 'First handoff.',
          nodeId: 'implementer',
          status: 'waiting_on_orchestrator',
          createdAt: 2,
        },
        {
          id: 'resume-cap-1',
          sequence: 2,
          type: 'flow:resume_input',
          message: 'Continue.',
          status: 'running',
          createdAt: 3,
        },
      ],
    });
    architectureAdapter.getSnapshot.mockResolvedValue({
      run: {
        id: 'run-return-cap',
        parentSessionId: 'parent-return-cap',
        childSessionId: 'child-return-cap',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Stop unbounded supervision loops.',
          continuation: {
            reason: 'return_to_orchestrator',
            waitingNodeId: 'goal-master',
            pendingNodeIds: ['goal-master'],
            visitCounts: { implementer: 2, 'goal-master': 2 },
          },
        },
        createdAt: 1,
        updatedAt: 4,
      },
      events: [],
    } satisfies AgentFlowRunSnapshot);

    const snapshot = await service.getSnapshot('run-return-cap');

    expect(snapshot?.run.status).toBe('blocked');
    expect(snapshot?.run.returnToOrchestratorCount).toBe(2);
    expect(snapshot?.events.map((event) => event.type)).toContain('flow:return_to_orchestrator_cap_exceeded');
  });

  it('refreshes waiting runs from the underlying architecture snapshot after resume using stored checkpoint args', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-refresh',
        parentSessionId: 'parent-5',
        childSessionId: 'child-refresh',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Stored goal',
          context: { previous: true },
          vfsMode: 'shared',
          copyBack: true,
          maxSteps: 9,
        },
        waitingForNodeId: 'orchestrator',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    });
    architectureAdapter.getSnapshot.mockResolvedValue({
      run: {
        id: 'run-refresh',
        parentSessionId: 'parent-5',
        childSessionId: 'child-refresh',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'done',
        startMode: 'durable',
        returnMode: 'summary',
        createdAt: 1,
        updatedAt: 10,
        finishedAt: 10,
      },
      events: [
        {
          id: 'arch-event-final',
          sequence: 2,
          type: 'architecture:final_artifact',
          message: 'done',
          status: 'done',
          createdAt: 10,
        },
      ],
      result: {
        flowRunId: 'run-refresh',
        childSessionId: 'child-refresh',
        status: 'done',
        summary: 'done',
        decisions: [],
        nextActions: [],
        artifacts: [],
      },
    } satisfies AgentFlowRunSnapshot);

    const resumed = await service.resume('run-refresh', { input: 'Continue.' });

    expect(architectureAdapter.getSnapshot).toHaveBeenCalledWith('run-refresh', expect.objectContaining({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Stored goal',
      context: { previous: true },
      parentSessionId: 'parent-5',
      vfsMode: 'shared',
      copyBack: true,
      maxSteps: 9,
    }));
    expect(resumed.run.status).toBe('done');
    expect(resumed.result?.status).toBe('done');
    expect(resumed.events.map((event) => event.type)).toEqual([
      'flow:resume_input',
      'architecture:final_artifact',
    ]);
  });

  it('clears stale return-to-orchestrator continuation when resume makes runtime progress', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-clear-stale-return',
        parentSessionId: 'parent-clear-stale-return',
        childSessionId: 'child-clear-stale-return',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        returnToOrchestratorCount: 6,
        checkpoint: {
          goal: 'Finalize after external build evidence.',
          context: { projectPath: 'C:\\Projekty\\TurboProject2' },
          continuation: {
            reason: 'return_to_orchestrator',
            waitingNodeId: 'implementer',
            pendingNodeIds: ['implementer'],
            visitCounts: { implementer: 1, 'goal-master': 1 },
          },
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [
        {
          id: 'return-stale-1',
          sequence: 1,
          type: 'flow:return_to_orchestrator',
          message: 'Goal Master returned control to the orchestrator.',
          nodeId: 'implementer',
          status: 'waiting_on_orchestrator',
          createdAt: 2,
        },
      ],
    });
    architectureAdapter.getSnapshot.mockResolvedValue({
      run: {
        id: 'run-clear-stale-return',
        parentSessionId: 'parent-clear-stale-return',
        childSessionId: 'child-clear-stale-return',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Finalize after external build evidence.',
          context: { projectPath: 'C:\\Projekty\\TurboProject2' },
        },
        createdAt: 1,
        updatedAt: 10,
      },
      events: [
        {
          id: 'arch-progress-1',
          sequence: 2,
          type: 'flow:node_start',
          message: 'Implementer started.',
          nodeId: 'implementer',
          status: 'running',
          createdAt: 10,
        },
      ],
    } satisfies AgentFlowRunSnapshot);

    const resumed = await service.resume('run-clear-stale-return', {
      input: 'Continue with external build evidence.',
      context: { externalQualityGate: { status: 'passed', source: 'manual-build' } },
    });

    expect(resumed.run.status).toBe('running');
    expect(resumed.run.checkpoint?.continuation).toBeUndefined();
    expect(resumed.run.returnToOrchestratorCount).toBe(6);
    expect(resumed.events.map((event) => event.type)).not.toContain('flow:return_to_orchestrator_cap_exceeded');
  });

  it('clears stale blocked result when a refreshed runtime snapshot is active again', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-clear-stale-result',
        parentSessionId: 'parent-clear-stale-result',
        childSessionId: 'child-clear-stale-result',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'blocked',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Continue after an early stale block.',
        },
        createdAt: 1,
        updatedAt: 2,
      },
      result: {
        flowRunId: 'run-clear-stale-result',
        childSessionId: 'child-clear-stale-result',
        status: 'blocked',
        summary: 'Blocked by stale CLI evidence.',
        decisions: [],
        nextActions: [],
        artifacts: [],
      },
      events: [
        {
          id: 'stale-blocked',
          sequence: 1,
          type: 'flow:unresolved_cli_children',
          message: 'Stale block.',
          status: 'blocked',
          createdAt: 2,
        },
      ],
    });
    architectureAdapter.getSnapshot.mockResolvedValue({
      run: {
        id: 'run-clear-stale-result',
        parentSessionId: 'parent-clear-stale-result',
        childSessionId: 'child-clear-stale-result',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Continue after an early stale block.',
          continuation: {
            reason: 'return_to_orchestrator',
            waitingNodeId: 'goal-master',
            pendingNodeIds: ['goal-master'],
            visitCounts: { 'goal-master': 1 },
          },
        },
        createdAt: 1,
        updatedAt: 10,
      },
      events: [],
    } satisfies AgentFlowRunSnapshot);

    const snapshot = await service.getSnapshot('run-clear-stale-result');

    expect(snapshot?.run.status).toBe('waiting_on_orchestrator');
    expect(snapshot?.result).toBeUndefined();
  });

  it('keeps a continuation cursor projected as waiting when a refreshed architecture run still says running', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-continuation-refresh',
        parentSessionId: 'parent-continuation',
        childSessionId: 'child-continuation',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        waitingForNodeId: 'implementer',
        checkpoint: {
          goal: 'Stored goal',
          maxSteps: 6,
          continuation: {
            reason: 'max_steps',
            waitingNodeId: 'implementer',
            pendingNodeIds: ['implementer'],
            visitCounts: { implementer: 2, 'goal-master': 2 },
            lastCompletedNodeId: 'goal-master',
          },
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    });
    architectureAdapter.getSnapshot.mockResolvedValue({
      run: {
        id: 'run-continuation-refresh',
        parentSessionId: 'parent-continuation',
        childSessionId: 'child-continuation',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        createdAt: 1,
        updatedAt: 3,
      },
      events: [],
    } satisfies AgentFlowRunSnapshot);

    const refreshed = await service.getSnapshot('run-continuation-refresh');

    expect(refreshed?.run).toMatchObject({
      status: 'waiting_on_orchestrator',
      waitingForNodeId: 'implementer',
      activeNodeIds: ['implementer'],
      nodeVisitCounts: { implementer: 2, 'goal-master': 2 },
    });
    expect(repository.getSnapshot('run-continuation-refresh')?.run.status).toBe('waiting_on_orchestrator');
  });

  it('projects stored running continuation snapshots to waiting without falling through to runtime_missing', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-stored-continuation',
        parentSessionId: 'parent-stored-continuation',
        childSessionId: 'child-stored-continuation',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Keep the durable continuation cursor alive',
          continuation: {
            reason: 'max_steps',
            waitingNodeId: 'implementer',
            pendingNodeIds: ['implementer'],
            visitCounts: { implementer: 2, 'goal-master': 2 },
            lastCompletedNodeId: 'goal-master',
          },
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    });
    architectureAdapter.getSnapshot.mockResolvedValue(null);

    const firstRead = await service.getSnapshot('run-stored-continuation');
    const secondRead = await service.getSnapshot('run-stored-continuation');

    expect(firstRead?.run.status).toBe('waiting_on_orchestrator');
    expect(firstRead?.run.waitingForNodeId).toBe('implementer');
    expect(firstRead?.events).toHaveLength(1);
    expect(firstRead?.events[0]).toMatchObject({
      type: 'flow:waiting_on_orchestrator',
      nodeId: 'implementer',
      status: 'waiting_on_orchestrator',
    });
    expect(secondRead?.events).toHaveLength(1);
    expect(secondRead?.events[0]?.type).toBe('flow:waiting_on_orchestrator');
    expect(repository.getSnapshot('run-stored-continuation')?.run.status).toBe('waiting_on_orchestrator');
    expect(repository.getSnapshot('run-stored-continuation')?.events).toHaveLength(1);
  });

  it('keeps resume checkpoint updates when refreshed architecture snapshot is still waiting', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-still-waiting',
        parentSessionId: 'parent-6',
        childSessionId: 'child-waiting',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        waitingForNodeId: 'goal-master',
        checkpoint: {
          goal: 'Stored goal',
          context: { previous: true },
          maxSteps: 3,
          continuation: {
            reason: 'max_steps',
            waitingNodeId: 'goal-master',
            pendingNodeIds: ['goal-master'],
            visitCounts: { implementer: 1, 'goal-master': 1 },
            lastCompletedNodeId: 'implementer',
          },
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [
        {
          id: 'architecture-stop',
          sequence: 1,
          type: 'architecture:router_decision',
          message: 'Runtime stopped after 3 graph steps.',
          status: 'waiting_on_orchestrator',
          createdAt: 2,
        },
      ],
    });
    architectureAdapter.getSnapshot.mockResolvedValue({
      run: {
        id: 'run-still-waiting',
        parentSessionId: 'parent-6',
        childSessionId: 'child-waiting',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        waitingForNodeId: 'goal-master',
        checkpoint: {
          goal: 'Stored goal',
          context: { previous: true },
          maxSteps: 3,
          continuation: {
            reason: 'max_steps',
            waitingNodeId: 'goal-master',
            pendingNodeIds: ['goal-master'],
            visitCounts: { implementer: 1, 'goal-master': 1 },
            lastCompletedNodeId: 'implementer',
          },
        },
        createdAt: 1,
        updatedAt: 5,
      },
      events: [
        {
          id: 'architecture-stop',
          sequence: 1,
          type: 'architecture:router_decision',
          message: 'Runtime stopped after 3 graph steps.',
          status: 'waiting_on_orchestrator',
          createdAt: 2,
        },
      ],
    } satisfies AgentFlowRunSnapshot);

    const resumed = await service.resume('run-still-waiting', {
      input: 'Continue after adding evidence.',
      context: { retry: 2 },
      maxSteps: 6,
    });

    expect(resumed.run.status).toBe('waiting_on_orchestrator');
    expect(resumed.run.checkpoint).toMatchObject({
      goal: 'Stored goal',
      context: { previous: true },
      maxSteps: 6,
      lastResumeInput: 'Continue after adding evidence.',
      resumeContext: { retry: 2 },
      continuation: {
        reason: 'max_steps',
        waitingNodeId: 'goal-master',
        pendingNodeIds: ['goal-master'],
      },
    });
    expect(resumed.events.map((event) => event.type)).toEqual([
      'architecture:router_decision',
      'flow:waiting_on_orchestrator',
      'flow:resume_input',
    ]);
  });

  it('merges a refreshed waiting snapshot without losing the resume checkpoint payload', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-resume-merge',
        parentSessionId: 'parent-7',
        childSessionId: 'child-resume-merge',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        waitingForNodeId: 'goal-master',
        checkpoint: {
          goal: 'Stored goal',
          context: { previous: true },
          vfsMode: 'shared',
          copyBack: true,
          maxSteps: 3,
          continuation: {
            reason: 'max_steps',
            waitingNodeId: 'goal-master',
            pendingNodeIds: ['goal-master'],
            visitCounts: { implementer: 1, 'goal-master': 1 },
            lastCompletedNodeId: 'implementer',
          },
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [
        {
          id: 'architecture-stop-resume-merge',
          sequence: 1,
          type: 'architecture:router_decision',
          message: 'Runtime stopped after 3 graph steps.',
          status: 'waiting_on_orchestrator',
          createdAt: 2,
        },
      ],
    });
    architectureAdapter.getSnapshot.mockResolvedValue({
      run: {
        id: 'run-resume-merge',
        parentSessionId: 'parent-7',
        childSessionId: 'child-resume-merge',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        waitingForNodeId: 'goal-master',
        createdAt: 1,
        updatedAt: 5,
      },
      events: [
        {
          id: 'architecture-wait-resume-merge',
          sequence: 2,
          type: 'architecture:router_decision',
          message: 'Still waiting on orchestrator.',
          status: 'waiting_on_orchestrator',
          createdAt: 5,
        },
      ],
    } satisfies AgentFlowRunSnapshot);

    const resumed = await service.resume('run-resume-merge', {
      input: 'Continue after resume.',
      context: { retry: 2 },
      maxSteps: 6,
    });

    expect(architectureAdapter.getSnapshot).toHaveBeenCalledWith(
      'run-resume-merge',
      expect.objectContaining({
        context: {
          previous: true,
          retry: 2,
        },
        continuation: expect.objectContaining({
          reason: 'max_steps',
          waitingNodeId: 'goal-master',
        }),
      }),
    );
    expect(resumed.run.status).toBe('waiting_on_orchestrator');
    expect(resumed.run.checkpoint).toMatchObject({
      goal: 'Stored goal',
      context: { previous: true },
      vfsMode: 'shared',
      copyBack: true,
      maxSteps: 6,
      lastResumeInput: 'Continue after resume.',
      resumeContext: { retry: 2 },
      continuation: {
        reason: 'max_steps',
        waitingNodeId: 'goal-master',
        pendingNodeIds: ['goal-master'],
        visitCounts: { implementer: 1, 'goal-master': 1 },
        lastCompletedNodeId: 'implementer',
      },
    });
    expect(resumed.events.map((event) => event.type)).toEqual([
      'architecture:router_decision',
      'flow:waiting_on_orchestrator',
      'flow:resume_input',
      'architecture:router_decision',
    ]);
    expect(repository.getSnapshot('run-resume-merge')?.run.checkpoint).toMatchObject({
      goal: 'Stored goal',
      context: { previous: true },
      vfsMode: 'shared',
      copyBack: true,
      maxSteps: 6,
      lastResumeInput: 'Continue after resume.',
      resumeContext: { retry: 2 },
      continuation: {
        reason: 'max_steps',
        waitingNodeId: 'goal-master',
        pendingNodeIds: ['goal-master'],
        visitCounts: { implementer: 1, 'goal-master': 1 },
        lastCompletedNodeId: 'implementer',
      },
    });
  });

  it('resumes through getSnapshot when the adapter does not expose a resume method', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-resume-fallback',
        parentSessionId: 'parent-resume-fallback',
        childSessionId: 'child-resume-fallback',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        waitingForNodeId: 'implementer',
        checkpoint: {
          goal: 'Resume through the durable projection',
          context: { phase: 1 },
          vfsMode: 'isolated',
          copyBack: false,
          maxSteps: 5,
          continuation: {
            reason: 'max_steps',
            waitingNodeId: 'implementer',
            pendingNodeIds: ['implementer'],
            visitCounts: { implementer: 2, 'goal-master': 2 },
          },
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [
        {
          id: 'flow-waiting-1',
          sequence: 1,
          type: 'flow:waiting_on_orchestrator',
          message: 'Waiting for orchestrator input.',
          nodeId: 'implementer',
          status: 'waiting_on_orchestrator',
          createdAt: 2,
        },
      ],
    });
    architectureAdapter.getSnapshot.mockResolvedValue({
      run: {
        id: 'run-resume-fallback',
        parentSessionId: 'parent-resume-fallback',
        childSessionId: 'child-resume-fallback',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'done',
        startMode: 'durable',
        returnMode: 'summary',
        createdAt: 1,
        updatedAt: 10,
        finishedAt: 10,
      },
      events: [
        {
          id: 'arch-event-final',
          sequence: 2,
          type: 'architecture:final_artifact',
          message: 'done',
          status: 'done',
          createdAt: 10,
        },
      ],
      result: {
        flowRunId: 'run-resume-fallback',
        childSessionId: 'child-resume-fallback',
        status: 'done',
        summary: 'done',
        decisions: [],
        nextActions: [],
        artifacts: [],
      },
    } satisfies AgentFlowRunSnapshot);

    const resumed = await service.resume('run-resume-fallback', {
      input: 'Continue after restart.',
      maxSteps: 8,
    });

    expect(architectureAdapter.getSnapshot).toHaveBeenCalledWith('run-resume-fallback', expect.objectContaining({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Resume through the durable projection',
      context: { phase: 1 },
      parentSessionId: 'parent-resume-fallback',
      startMode: 'durable',
      returnMode: 'summary',
      vfsMode: 'isolated',
      copyBack: false,
      maxSteps: 8,
      continuation: expect.objectContaining({
        reason: 'max_steps',
        waitingNodeId: 'implementer',
        pendingNodeIds: ['implementer'],
      }),
    }));
    expect(resumed.run.status).toBe('done');
    expect(resumed.events.map((event) => event.type)).toEqual([
      'flow:waiting_on_orchestrator',
      'flow:resume_input',
      'architecture:final_artifact',
    ]);
    expect(repository.getSnapshot('run-resume-fallback')?.run.status).toBe('done');
    expect(repository.getSnapshot('run-resume-fallback')?.result?.status).toBe('done');
  });

  it('returns the locally updated snapshot when resume falls back to an unavailable live projection', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-resume-null-refresh',
        parentSessionId: 'parent-resume-null-refresh',
        childSessionId: 'child-resume-null-refresh',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Resume even if the live runtime projection is gone',
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    });
    architectureAdapter.getSnapshot.mockResolvedValue(null);

    const resumed = await service.resume('run-resume-null-refresh', {
      input: 'Continue from durable state.',
    });

    expect(architectureAdapter.getSnapshot).toHaveBeenCalledWith(
      'run-resume-null-refresh',
      expect.objectContaining({
        flowId: 'goal_guard_delivery_loop',
        goal: 'Resume even if the live runtime projection is gone',
      }),
    );
    expect(resumed.run.status).toBe('running');
    expect(resumed.events.map((event) => event.type)).toEqual([
      'flow:resume_input',
    ]);
    expect(repository.getSnapshot('run-resume-null-refresh')?.run.status).toBe('running');
    expect(repository.getSnapshot('run-resume-null-refresh')?.events.at(-1)?.type).toBe('flow:resume_input');
  });

  it('preserves waiting continuation and resume fields after service reconstruction and adapter refresh', async () => {
    const sqlite = new Database(':memory:');
    try {
      const drizzleService = new DrizzleService(null as never);
      (drizzleService as unknown as { sqlite: Database.Database }).sqlite = sqlite;
      (drizzleService as unknown as { ensureAgentFlowTables: () => void }).ensureAgentFlowTables();
      const db = drizzle(sqlite, { schema });

      const repository = new AgentFlowRunRepository({ db } as unknown as DrizzleService);
      repository.saveSnapshot({
        run: {
          id: 'run-restart-waiting',
          parentSessionId: 'parent-restart',
          childSessionId: 'child-restart',
          flowDefinitionId: 'goal_guard_delivery_loop',
          status: 'waiting_on_orchestrator',
          startMode: 'durable',
          returnMode: 'summary',
          waitingForNodeId: 'goal-master',
          checkpoint: {
            goal: 'Persist waiting state across restart',
            context: { phase: 'resume' },
            vfsMode: 'shared',
            copyBack: true,
            maxSteps: 6,
            lastResumeInput: 'Continue after restart.',
            resumeContext: { retry: 1 },
            continuation: {
              reason: 'max_steps',
              waitingNodeId: 'goal-master',
              pendingNodeIds: ['goal-master'],
              visitCounts: { implementer: 2, 'goal-master': 2 },
              lastCompletedNodeId: 'implementer',
            },
          },
          createdAt: 1,
          updatedAt: 2,
        },
        events: [],
      });

      const refreshedRepository = new AgentFlowRunRepository({ db } as unknown as DrizzleService);
      const architectureAdapter = adapter();
      architectureAdapter.getSnapshot.mockResolvedValue({
        run: {
          id: 'run-restart-waiting',
          parentSessionId: 'parent-restart',
          childSessionId: 'child-restart',
          flowDefinitionId: 'goal_guard_delivery_loop',
          status: 'running',
          startMode: 'durable',
          returnMode: 'summary',
          createdAt: 1,
          updatedAt: 9,
        },
        events: [],
      } satisfies AgentFlowRunSnapshot);

      const service = new AgentFlowRuntimeService(
        architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
        refreshedRepository,
      );
      const snapshot = await service.getSnapshot('run-restart-waiting');

      expect(snapshot?.run.status).toBe('waiting_on_orchestrator');
      expect(snapshot?.run.waitingForNodeId).toBe('goal-master');
      expect(snapshot?.run.checkpoint).toMatchObject({
        goal: 'Persist waiting state across restart',
        context: { phase: 'resume' },
        vfsMode: 'shared',
        copyBack: true,
        maxSteps: 6,
        lastResumeInput: 'Continue after restart.',
        resumeContext: { retry: 1 },
        continuation: {
          reason: 'max_steps',
          waitingNodeId: 'goal-master',
          pendingNodeIds: ['goal-master'],
          visitCounts: { implementer: 2, 'goal-master': 2 },
          lastCompletedNodeId: 'implementer',
        },
      });
      expect(refreshedRepository.getSnapshot('run-restart-waiting')?.run.status).toBe('waiting_on_orchestrator');
      expect(refreshedRepository.getSnapshot('run-restart-waiting')?.run.checkpoint).toMatchObject({
        lastResumeInput: 'Continue after restart.',
        resumeContext: { retry: 1 },
        continuation: {
          waitingNodeId: 'goal-master',
        },
      });
    } finally {
      sqlite.close();
    }
  });

  it('delegates resume to a continuation-capable adapter instead of only refreshing stale snapshots', async () => {
    const architectureAdapter = {
      ...adapter(),
      resume: vi.fn(),
    };
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-continuable',
        parentSessionId: 'parent-8',
        childSessionId: 'child-continuable',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        waitingForNodeId: 'goal-master',
        checkpoint: {
          goal: 'Stored goal',
          maxSteps: 2,
          continuation: {
            reason: 'max_steps',
            waitingNodeId: 'goal-master',
            pendingNodeIds: ['goal-master'],
            visitCounts: { implementer: 1 },
          },
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    });
    architectureAdapter.resume.mockResolvedValue({
      run: {
        id: 'run-continuable',
        parentSessionId: 'parent-8',
        childSessionId: 'child-continuable',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'done',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Stored goal',
          maxSteps: 5,
        },
        createdAt: 1,
        updatedAt: 10,
        finishedAt: 10,
      },
      events: [
        {
          id: 'architecture-final',
          sequence: 2,
          type: 'architecture:final_artifact',
          message: 'continued and accepted',
          status: 'done',
          createdAt: 10,
        },
      ],
      result: {
        flowRunId: 'run-continuable',
        childSessionId: 'child-continuable',
        status: 'done',
        summary: 'continued and accepted',
        decisions: [],
        nextActions: [],
        artifacts: [],
      },
    } satisfies AgentFlowRunSnapshot);

    const resumed = await service.resume('run-continuable', {
      input: 'Continue from cursor.',
      maxSteps: 5,
    });

    expect(architectureAdapter.resume).toHaveBeenCalledWith('run-continuable', {
      input: 'Continue from cursor.',
      maxSteps: 5,
    }, expect.objectContaining({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Stored goal',
      continuation: expect.objectContaining({
        reason: 'max_steps',
        waitingNodeId: 'goal-master',
      }),
    }));
    expect(resumed.run.status).toBe('done');
    expect(resumed.result?.summary).toBe('continued and accepted');
  });

  it('preserves child and root session ids when a resumed waiting run is reconciled', async () => {
    const architectureAdapter = {
      ...adapter(),
      resume: vi.fn(),
    };
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-session-preserve',
        parentSessionId: 'parent-session-preserve',
        childSessionId: 'child-original',
        openChatSessionId: 'arch-run-session-preserve-root',
        openGraphRunId: 'run-session-preserve',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        waitingForNodeId: 'goal-master',
        checkpoint: {
          goal: 'Stored goal',
          continuation: {
            reason: 'max_steps',
            waitingNodeId: 'goal-master',
            pendingNodeIds: ['goal-master'],
            visitCounts: { implementer: 1 },
          },
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    });
    architectureAdapter.resume.mockResolvedValue({
      run: {
        id: 'run-session-preserve',
        parentSessionId: 'parent-session-preserve',
        childSessionId: 'child-reconstructed',
        openChatSessionId: 'arch-run-session-preserve-root-reconstructed',
        openGraphRunId: 'run-session-preserve-reconstructed',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'done',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Stored goal',
        },
        createdAt: 1,
        updatedAt: 10,
        finishedAt: 10,
      },
      events: [
        {
          id: 'architecture-final',
          sequence: 2,
          type: 'architecture:final_artifact',
          message: 'continued and accepted',
          status: 'done',
          createdAt: 10,
        },
      ],
      result: {
        flowRunId: 'run-session-preserve',
        childSessionId: 'child-reconstructed',
        status: 'done',
        summary: 'continued and accepted',
        decisions: [],
        nextActions: [],
        artifacts: [],
        openChatSessionId: 'arch-run-session-preserve-root-reconstructed',
        openGraphRunId: 'run-session-preserve-reconstructed',
      },
    } satisfies AgentFlowRunSnapshot);

    const resumed = await service.resume('run-session-preserve', {
      input: 'Continue from cursor.',
    });

    expect(resumed.run.childSessionId).toBe('child-original');
    expect(resumed.run.openChatSessionId).toBe('arch-run-session-preserve-root');
    expect(resumed.run.openGraphRunId).toBe('run-session-preserve');
    expect(resumed.result?.childSessionId).toBe('child-original');
    expect(resumed.result?.openChatSessionId).toBe('arch-run-session-preserve-root');
    expect(resumed.result?.openGraphRunId).toBe('run-session-preserve');
    expect(repository.getSnapshot('run-session-preserve')?.run.childSessionId).toBe('child-original');
    expect(repository.getSnapshot('run-session-preserve')?.run.openChatSessionId).toBe('arch-run-session-preserve-root');
    expect(repository.getSnapshot('run-session-preserve')?.run.openGraphRunId).toBe('run-session-preserve');
  });

  it('marks the stored run blocked when adapter resume fails', async () => {
    const architectureAdapter = {
      ...adapter(),
      resume: vi.fn(),
    };
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-resume-fails',
        parentSessionId: 'parent-resume-fails',
        childSessionId: 'child-resume-fails',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Stored goal',
          continuation: {
            reason: 'max_steps',
            waitingNodeId: 'goal-master',
            pendingNodeIds: ['goal-master'],
            visitCounts: { implementer: 1 },
          },
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    });
    architectureAdapter.resume.mockRejectedValue(new Error('resume worker crashed'));

    await expect(service.resume('run-resume-fails', {
      input: 'Continue from cursor.',
    })).rejects.toThrow('resume worker crashed');

    const stored = repository.getSnapshot('run-resume-fails');
    expect(stored?.run.status).toBe('blocked');
    expect(stored?.run.finishedAt).toBeTypeOf('number');
    expect(stored?.events.map((event) => event.type)).toEqual([
      'flow:waiting_on_orchestrator',
      'flow:resume_input',
      'flow:resume_failed',
    ]);
  });

  it('refreshes stored snapshots when reading a live durable run', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-read',
        parentSessionId: 'parent-6',
        childSessionId: 'child-read',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    });
    architectureAdapter.getSnapshot.mockResolvedValue({
      run: {
        id: 'run-read',
        parentSessionId: 'parent-6',
        childSessionId: 'child-read',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'done',
        startMode: 'durable',
        returnMode: 'summary',
        createdAt: 1,
        updatedAt: 20,
      },
      events: [],
      result: {
        flowRunId: 'run-read',
        childSessionId: 'child-read',
        status: 'done',
        summary: 'done',
        decisions: [],
        nextActions: [],
        artifacts: [],
      },
    } satisfies AgentFlowRunSnapshot);

    const snapshot = await service.getSnapshot('run-read');

    expect(snapshot?.run.status).toBe('done');
    expect(repository.getSnapshot('run-read')?.run.status).toBe('done');
  });

  it('RED: marks stored running snapshots blocked when the runtime adapter has lost the run', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-stale-runtime',
        parentSessionId: 'parent-stale',
        childSessionId: 'child-stale',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Recover stale durable run',
          context: { repo: 'TurboProject2' },
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    });
    architectureAdapter.getSnapshot.mockResolvedValue(null);

    const snapshot = await service.getSnapshot('run-stale-runtime');

    expect(snapshot?.run.status).toBe('blocked');
    expect(snapshot?.run.finishedAt).toBeTypeOf('number');
    expect(snapshot?.events.at(-1)).toMatchObject({
      type: 'flow:runtime_missing',
      status: 'blocked',
    });
    expect(repository.getSnapshot('run-stale-runtime')?.run.status).toBe('blocked');
  });

  it('RED: reconciles stale running snapshots when listing runs by parent session', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-stale-list',
        parentSessionId: 'parent-stale-list',
        childSessionId: 'child-stale-list',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Expose stale durable run through FE list',
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
      result: {
        flowRunId: 'run-stale-list',
        childSessionId: 'child-stale-list',
        status: 'running',
        summary: 'Still running before restart',
        decisions: [],
        nextActions: [],
        artifacts: [],
      },
    });
    architectureAdapter.getSnapshot.mockResolvedValue(null);

    const snapshots = await service.findByParentSessionId('parent-stale-list');

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.run.status).toBe('blocked');
    expect(snapshots[0]?.result?.status).toBe('blocked');
    expect(snapshots[0]?.result?.nextActions).toContain(
      'Restart or resume the AgentFlow run from the durable checkpoint instead of trusting the stale running projection.',
    );
    expect(snapshots[0]?.events.at(-1)?.type).toBe('flow:runtime_missing');
    expect(repository.getSnapshot('run-stale-list')?.run.status).toBe('blocked');
    expect(repository.getSnapshot('run-stale-list')?.result?.status).toBe('blocked');
  });

  it('reconciles stale running snapshots when listing all runs for readiness checks', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-stale-global-list',
        parentSessionId: 'parent-stale-global-list',
        childSessionId: 'child-stale-global-list',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Expose stale durable run through global readiness list',
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    });
    architectureAdapter.getSnapshot.mockResolvedValue(null);

    const snapshots = await service.findAll();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.run.status).toBe('blocked');
    expect(snapshots[0]?.events.at(-1)).toMatchObject({
      type: 'flow:runtime_missing',
      status: 'blocked',
    });
    expect(repository.getSnapshot('run-stale-global-list')?.run.status).toBe('blocked');
  });

  it('cascades stop to the runtime adapter before storing a cancelled snapshot', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-stop-cascade',
        parentSessionId: 'parent-stop-cascade',
        parentToolCallId: 'tool-stop-cascade',
        childSessionId: 'arch-run-stop-cascade-root',
        openGraphRunId: 'run-stop-cascade',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Stop the underlying architecture worker',
          context: { workdir: 'C:\\Projekty\\TurboProject2' },
          vfsMode: 'isolated',
          copyBack: false,
          maxSteps: 8,
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    });

    const stopped = await service.stop('run-stop-cascade');

    expect(architectureAdapter.stop).toHaveBeenCalledWith('run-stop-cascade', expect.objectContaining({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Stop the underlying architecture worker',
      parentSessionId: 'parent-stop-cascade',
      parentToolCallId: 'tool-stop-cascade',
      context: { workdir: 'C:\\Projekty\\TurboProject2' },
      vfsMode: 'isolated',
      copyBack: false,
      maxSteps: 8,
    }));
    expect(stopped.run.status).toBe('cancelled');
    expect(stopped.events.at(-1)).toMatchObject({
      type: 'flow:stopped',
      status: 'cancelled',
    });
    expect(repository.getSnapshot('run-stop-cascade')?.run.status).toBe('cancelled');
  });

  it('RED: preserves checkpoint fields when refreshed durable snapshots omit them', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-checkpoint-refresh',
        parentSessionId: 'parent-checkpoint',
        childSessionId: 'child-checkpoint',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'full_trace',
        checkpoint: {
          goal: 'Deliver with preserved execution constraints',
          context: { repo: 'TurboProject2', branch: 'demo1' },
          vfsMode: 'shared',
          copyBack: true,
          maxSteps: 7,
        },
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    });
    architectureAdapter.getSnapshot.mockResolvedValue({
      run: {
        id: 'run-checkpoint-refresh',
        parentSessionId: 'parent-checkpoint',
        childSessionId: 'child-checkpoint',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'full_trace',
        createdAt: 1,
        updatedAt: 20,
      },
      events: [
        {
          id: 'event-after-refresh',
          sequence: 1,
          type: 'architecture:node_completed',
          message: 'Implementer completed.',
          createdAt: 20,
        },
      ],
    } satisfies AgentFlowRunSnapshot);

    const snapshot = await service.getSnapshot('run-checkpoint-refresh');

    expect(snapshot?.run.checkpoint).toEqual({
      goal: 'Deliver with preserved execution constraints',
      context: { repo: 'TurboProject2', branch: 'demo1' },
      vfsMode: 'shared',
      copyBack: true,
      maxSteps: 7,
    });
    expect(repository.getSnapshot('run-checkpoint-refresh')?.run.checkpoint).toEqual(snapshot?.run.checkpoint);
  });

  it('rejects resume when run status is not waiting_for_orchestrator', async () => {
    const architectureAdapter = adapter();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-done',
        parentSessionId: 'parent-4',
        childSessionId: 'child-done',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'done',
        startMode: 'durable',
        returnMode: 'summary',
        createdAt: 1,
        updatedAt: 2,
      },
      events: [],
    });

    await expect(service.resume('run-done', {} as ResumeAgentFlowRunDto))
      .rejects
      .toThrow('AGENT_FLOW_RUN_NOT_WAITING: run-done');
  });

  it('allows resuming a blocked final artifact blocker with external QA evidence', async () => {
    const architectureAdapter = adapter() as ReturnType<typeof adapter> & {
      resume: ReturnType<typeof vi.fn>;
    };
    architectureAdapter.resume = vi.fn();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-final-artifact-blocker',
        parentSessionId: 'parent-final-artifact-blocker',
        childSessionId: 'child-final-artifact-blocker',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'blocked',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Deliver runtime proof',
          context: { projectPath: 'C:\\Projekty\\TurboProject2-demo63' },
        },
        createdAt: 1,
        updatedAt: 2,
      },
      result: {
        flowRunId: 'run-final-artifact-blocker',
        childSessionId: 'child-final-artifact-blocker',
        status: 'blocked',
        summary: 'Build proof is missing.',
        decisions: [],
        nextActions: ['Resolve the blocker described in the final artifact before accepting the AgentFlow result.'],
        artifacts: [],
      },
      events: [{
        id: 'event-final-artifact-blocker',
        sequence: 1,
        type: 'flow:final_artifact_blocker',
        message: 'AgentFlow blocked because the final artifact declares unresolved acceptance blockers.',
        status: 'blocked',
        createdAt: 2,
      }],
    });
    architectureAdapter.resume.mockResolvedValue({
      run: {
        id: 'run-final-artifact-blocker',
        parentSessionId: 'parent-final-artifact-blocker',
        childSessionId: 'child-final-artifact-blocker',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'done',
        startMode: 'durable',
        returnMode: 'summary',
        createdAt: 1,
        updatedAt: 4,
      },
      result: {
        flowRunId: 'run-final-artifact-blocker',
        childSessionId: 'child-final-artifact-blocker',
        status: 'done',
        summary: 'External QA accepted.',
        decisions: [],
        nextActions: [],
        artifacts: [],
      },
      events: [{
        id: 'event-final-artifact-accepted',
        sequence: 2,
        type: 'flow:final_artifact',
        message: 'External QA accepted.',
        status: 'done',
        createdAt: 4,
      }],
    });

    const resumed = await service.resume('run-final-artifact-blocker', {
      input: 'External build passed.',
      context: {
        externalQualityGate: {
          source: 'manual-build',
          status: 'passed',
          highFindings: 0,
        },
      },
    });

    expect(resumed.run.status).toBe('done');
    expect(architectureAdapter.resume).toHaveBeenCalledWith(
      'run-final-artifact-blocker',
      expect.objectContaining({ input: 'External build passed.' }),
      expect.objectContaining({
        goal: 'Deliver runtime proof',
        context: expect.objectContaining({
          projectPath: 'C:\\Projekty\\TurboProject2-demo63',
        }),
      }),
    );
  });

  it('allows resuming a blocked missing final artifact run with external QA evidence', async () => {
    const architectureAdapter = adapter() as ReturnType<typeof adapter> & {
      resume: ReturnType<typeof vi.fn>;
    };
    architectureAdapter.resume = vi.fn();
    const repository = new AgentFlowRunRepository();
    const service = new AgentFlowRuntimeService(
      architectureAdapter as unknown as ArchitectureAgentFlowAdapter,
      repository,
    );
    repository.saveSnapshot({
      run: {
        id: 'run-missing-final-artifact',
        parentSessionId: 'parent-missing-final-artifact',
        childSessionId: 'child-missing-final-artifact',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'blocked',
        startMode: 'durable',
        returnMode: 'summary',
        checkpoint: {
          goal: 'Deliver runtime proof',
          context: { projectPath: 'C:\\Projekty\\TurboProject2' },
        },
        createdAt: 1,
        updatedAt: 2,
        summary: 'Blocked because the latest architecture attempt completed without a final artifact.',
      },
      result: {
        flowRunId: 'run-missing-final-artifact',
        childSessionId: 'child-missing-final-artifact',
        status: 'blocked',
        summary: 'Blocked because the latest architecture attempt completed without a final artifact.',
        decisions: [],
        nextActions: [],
        artifacts: [],
      },
      events: [{
        id: 'event-missing-final-artifact',
        sequence: 1,
        type: 'flow:missing_final_artifact',
        message: 'AgentFlow blocked because the latest architecture attempt completed without producing a final artifact.',
        status: 'blocked',
        createdAt: 2,
      }],
    });
    architectureAdapter.resume.mockResolvedValue({
      run: {
        id: 'run-missing-final-artifact',
        parentSessionId: 'parent-missing-final-artifact',
        childSessionId: 'child-missing-final-artifact',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'done',
        startMode: 'durable',
        returnMode: 'summary',
        createdAt: 1,
        updatedAt: 4,
      },
      result: {
        flowRunId: 'run-missing-final-artifact',
        childSessionId: 'child-missing-final-artifact',
        status: 'done',
        summary: 'External QA accepted missing final artifact recovery.',
        decisions: [],
        nextActions: [],
        artifacts: [],
      },
      events: [{
        id: 'event-final-artifact-accepted',
        sequence: 2,
        type: 'flow:final_artifact',
        message: 'External QA accepted missing final artifact recovery.',
        status: 'done',
        createdAt: 4,
      }],
    });

    const resumed = await service.resume('run-missing-final-artifact', {
      input: 'External build passed and visual QA passed.',
      context: {
        externalQualityGate: {
          source: 'manual-build-and-playwright',
          status: 'passed',
          highFindings: 0,
        },
      },
    });

    expect(resumed.run.status).toBe('done');
    expect(architectureAdapter.resume).toHaveBeenCalledWith(
      'run-missing-final-artifact',
      expect.objectContaining({ input: 'External build passed and visual QA passed.' }),
      expect.objectContaining({
        goal: 'Deliver runtime proof',
        context: expect.objectContaining({
          projectPath: 'C:\\Projekty\\TurboProject2',
        }),
      }),
    );
  });
});

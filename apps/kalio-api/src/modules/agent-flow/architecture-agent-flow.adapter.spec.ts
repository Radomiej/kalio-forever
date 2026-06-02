import { describe, expect, it, vi } from 'vitest';
import type { ArchitectureExecutionEvent, ArchitectureRun } from '@kalio/types';
import { ArchitectureAgentFlowAdapter } from './architecture-agent-flow.adapter';
import type { ArchitectureRuntimeService } from '../architecture/architecture-runtime.service';

describe('ArchitectureAgentFlowAdapter', () => {
  it('maps goal_guard_delivery_loop to the current goal-master schema', async () => {
    const run: ArchitectureRun = {
      id: 'run-1',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement and verify',
      executionMode: 'session_branches',
      rootSessionId: 'arch-run-1-root',
      status: 'completed',
      createdAt: 1,
      updatedAt: 2,
      completedAt: 2,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-1',
        runId: run.id,
        sequence: 1,
        type: 'final_artifact',
        message: 'Goal Guard accepted the implementation.',
        nodeId: 'final-artifact',
        roleSlotId: 'finalizer',
        route: {
          source: 'agent',
          fromNodeId: 'goal-master',
          selectedNodeIds: ['final-artifact'],
          rejectedNodeIds: ['implementer'],
          nextNodeId: 'final-artifact',
        },
        data: {
          toolEvidence: {
            successfulToolNames: ['vfs_write'],
          },
        },
        createdAt: 2,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn().mockResolvedValue(run),
      getEvents: vi.fn().mockReturnValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const result = await adapter.run({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement and verify',
      parentSessionId: 'parent-1',
      returnMode: 'summary',
    });

    expect(architectureRuntime.createRunAsync).toHaveBeenCalledWith(expect.objectContaining({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement and verify',
      executionMode: 'subagent_execution',
      context: expect.objectContaining({
        parentSessionId: 'parent-1',
        subAgentFlow: expect.objectContaining({
          flowId: 'goal_guard_delivery_loop',
          returnMode: 'summary',
          vfsMode: 'isolated',
          copyBack: false,
        }),
      }),
    }));
    expect(result).toMatchObject({
      flowRunId: 'run-1',
      childSessionId: 'arch-run-1-root',
      status: 'done',
      summary: 'Goal Guard accepted the implementation.',
      tracePreview: [
        expect.objectContaining({
          type: 'flow:final_artifact',
          nodeId: 'final-artifact',
          roleSlotId: 'finalizer',
          route: expect.objectContaining({
            nextNodeId: 'final-artifact',
          }),
          data: expect.objectContaining({
            sourceEventType: 'final_artifact',
            toolEvidence: expect.objectContaining({
              successfulToolNames: ['vfs_write'],
            }),
          }),
        }),
      ],
    });
  });

  it('falls back to the raw flow id when no schema alias exists', async () => {
    const run: ArchitectureRun = {
      id: 'run-unknown-schema',
      schemaId: 'custom-schema-flow',
      prompt: 'Investigate',
      executionMode: 'session_branches',
      rootSessionId: 'arch-run-unknown-schema-root',
      status: 'running',
      createdAt: 1,
      updatedAt: 2,
    };
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn().mockResolvedValue(run),
      getEvents: vi.fn().mockReturnValue([]),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const result = await adapter.run({
      flowId: 'custom-schema-flow',
      goal: 'Investigate',
      parentSessionId: 'parent-unknown-schema',
    });

    expect(architectureRuntime.createRunAsync).toHaveBeenCalledWith(expect.objectContaining({
      schemaId: 'custom-schema-flow',
      prompt: 'Investigate',
      executionMode: 'subagent_execution',
    }));
    expect(result).toMatchObject({
      status: 'running',
      childSessionId: 'arch-run-unknown-schema-root',
      openChatSessionId: 'arch-run-unknown-schema-root',
      openGraphRunId: 'run-unknown-schema',
    });
  });

  it('does not report queued or running architecture runs as done', async () => {
    const run: ArchitectureRun = {
      id: 'run-2',
      schemaId: 'architecture_debate',
      prompt: 'Review',
      executionMode: 'session_branches',
      rootSessionId: 'arch-run-2-root',
      status: 'running',
      createdAt: 1,
      updatedAt: 1,
    };
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn().mockResolvedValue(run),
      getEvents: vi.fn().mockReturnValue([]),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const result = await adapter.run({
      flowId: 'architecture_debate',
      goal: 'Review',
      parentSessionId: 'parent-1',
    });

    expect(result.status).toBe('running');
    expect(result.nextActions).toEqual(['Inspect the child AgentFlow trace before retrying.']);
  });

  it('uses async durable architecture runs by default and returns open targets', async () => {
    const run: ArchitectureRun = {
      id: 'run-3',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement',
      executionMode: 'session_branches',
      rootSessionId: 'arch-run-3-root',
      status: 'running',
      createdAt: 1,
      updatedAt: 1,
    };
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn().mockResolvedValue(run),
      getEvents: vi.fn().mockReturnValue([]),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const result = await adapter.run({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement',
      parentSessionId: 'parent-1',
    });

    expect(architectureRuntime.createRunAsync).toHaveBeenCalledOnce();
    expect(architectureRuntime.createRunAsync).toHaveBeenCalledWith(expect.objectContaining({
      executionMode: 'subagent_execution',
    }));
    expect(architectureRuntime.createRun).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'running',
      childSessionId: 'arch-run-3-root',
      openChatSessionId: 'arch-run-3-root',
      openGraphRunId: 'run-3',
    });
  });

  it('returns the complete trace only when full_trace return mode is requested', async () => {
    const run: ArchitectureRun = {
      id: 'run-full-trace',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Inspect full trace',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-full-trace-root',
      status: 'completed',
      createdAt: 1,
      updatedAt: 30,
      completedAt: 30,
    };
    const events: ArchitectureExecutionEvent[] = Array.from({ length: 25 }, (_, index) => ({
      id: `event-${index + 1}`,
      runId: run.id,
      sequence: index + 1,
      type: index === 24 ? 'final_artifact' : 'participant_output',
      message: index === 24 ? 'Full trace completed.' : `Trace event ${index + 1}`,
      nodeId: index === 24 ? 'final-artifact' : 'implementer',
      createdAt: index + 1,
    }));
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn().mockResolvedValue(run),
      getEvents: vi.fn().mockReturnValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const summary = await adapter.run({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Inspect summary trace',
      parentSessionId: 'parent-1',
      returnMode: 'summary',
    });
    const fullTrace = await adapter.run({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Inspect full trace',
      parentSessionId: 'parent-1',
      returnMode: 'full_trace',
    });

    expect(summary.tracePreview).toHaveLength(20);
    expect(summary.tracePreview?.[0]?.id).toBe('event-6');
    expect(fullTrace.tracePreview).toHaveLength(25);
    expect(fullTrace.tracePreview?.[0]?.id).toBe('event-1');
    expect(fullTrace.tracePreview?.at(-1)).toMatchObject({
      type: 'flow:final_artifact',
      message: 'Full trace completed.',
    });
  });

  it('suppresses decisions and trace projection for artifacts_only return mode', async () => {
    const run: ArchitectureRun = {
      id: 'run-artifacts-only',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Return artifacts only',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-artifacts-only-root',
      status: 'completed',
      createdAt: 1,
      updatedAt: 3,
      completedAt: 3,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-router',
        runId: run.id,
        sequence: 1,
        type: 'router_decision',
        message: 'Goal Master accepted the implementation.',
        nodeId: 'goal-master',
        route: {
          source: 'agent',
          fromNodeId: 'goal-master',
          selectedNodeIds: ['final-artifact'],
          rejectedNodeIds: ['implementer'],
          nextNodeId: 'final-artifact',
        },
        createdAt: 2,
      },
      {
        id: 'event-final',
        runId: run.id,
        sequence: 2,
        type: 'final_artifact',
        message: 'Verified artifact is ready.',
        nodeId: 'final-artifact',
        createdAt: 3,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn().mockResolvedValue(run),
      getEvents: vi.fn().mockReturnValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const result = await adapter.run({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Return artifacts only',
      parentSessionId: 'parent-1',
      returnMode: 'artifacts_only',
    });

    expect(result).toMatchObject({
      status: 'done',
      summary: 'Verified artifact is ready.',
      decisions: [],
      nextActions: [],
      artifacts: [],
      openChatSessionId: 'arch-run-artifacts-only-root',
      openGraphRunId: 'run-artifacts-only',
    });
    expect(result.tracePreview).toBeUndefined();
  });

  it('refreshes snapshots from durable architecture runtime state', async () => {
    const run: ArchitectureRun = {
      id: 'run-refresh',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement',
      executionMode: 'session_branches',
      rootSessionId: 'arch-run-refresh-root',
      status: 'completed',
      createdAt: 1,
      updatedAt: 5,
      completedAt: 5,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-final',
        runId: run.id,
        sequence: 1,
        type: 'final_artifact',
        message: 'Verified complete.',
        createdAt: 5,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRun: vi.fn().mockReturnValue(run),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-refresh', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('done');
    expect(snapshot?.result).toMatchObject({
      status: 'done',
      summary: 'Verified complete.',
      openChatSessionId: 'arch-run-refresh-root',
      openGraphRunId: 'run-refresh',
    });
  });

  it('uses verified Goal Master acceptance when the finalizer produced only generic empty output', async () => {
    const run: ArchitectureRun = {
      id: 'run-summary-proof',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with proof',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-summary-proof-root',
      status: 'completed',
      createdAt: 1,
      updatedAt: 8,
      completedAt: 8,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-implementer',
        runId: run.id,
        sequence: 1,
        type: 'participant_output',
        message: 'Implementer wrote e2e/goal-guard-proof.json with vfs_write evidence.',
        nodeId: 'implementer',
        roleSlotId: 'implementer',
        data: {
          toolEvidence: {
            successfulToolNames: ['vfs_write'],
          },
        },
        createdAt: 2,
      },
      {
        id: 'event-goal-master',
        runId: run.id,
        sequence: 2,
        type: 'router_decision',
        message: 'Goal Master confirmed e2e/goal-guard-proof.json and accepted verified evidence.',
        nodeId: 'goal-master',
        roleSlotId: 'goal_master',
        route: {
          source: 'agent',
          fromNodeId: 'goal-master',
          selectedNodeIds: ['final-artifact'],
          rejectedNodeIds: ['implementer'],
          nextNodeId: 'final-artifact',
        },
        createdAt: 6,
      },
      {
        id: 'event-final',
        runId: run.id,
        sequence: 3,
        type: 'final_artifact',
        message: 'Sub-agent completed with no output.',
        nodeId: 'final-artifact',
        roleSlotId: 'finalizer',
        createdAt: 8,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRun: vi.fn().mockReturnValue(run),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-summary-proof', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with proof',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('done');
    expect(snapshot?.result?.summary).toBe('Goal Master confirmed e2e/goal-guard-proof.json and accepted verified evidence.');
    expect(snapshot?.result?.summary).not.toBe('Sub-agent completed with no output.');
  });

  it('reconciles a stale failed architecture status when final artifact evidence exists', async () => {
    const run: ArchitectureRun = {
      id: 'run-final-after-failed',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with external QA',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-final-after-failed-root',
      status: 'failed',
      createdAt: 1,
      updatedAt: 12,
      completedAt: 12,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-accept',
        runId: run.id,
        sequence: 1,
        type: 'router_decision',
        message: 'Goal Master accepted verified build evidence.',
        nodeId: 'goal-master',
        roleSlotId: 'goal_master',
        route: {
          source: 'agent',
          fromNodeId: 'goal-master',
          selectedNodeIds: ['final-artifact'],
          rejectedNodeIds: ['implementer'],
          nextNodeId: 'final-artifact',
        },
        createdAt: 10,
      },
      {
        id: 'event-final',
        runId: run.id,
        sequence: 2,
        type: 'final_artifact',
        message: 'Delivery accepted with npm run build evidence.',
        nodeId: 'final-artifact',
        roleSlotId: 'finalizer',
        createdAt: 12,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRun: vi.fn().mockReturnValue(run),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-final-after-failed', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with external QA',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('done');
    expect(snapshot?.run.summary).toBe('Delivery accepted with npm run build evidence.');
    expect(snapshot?.result).toMatchObject({
      status: 'done',
      summary: 'Delivery accepted with npm run build evidence.',
    });
  });

  it('does not accept a stale running reconstruction just because a final artifact exists', async () => {
    const run: ArchitectureRun = {
      id: 'run-stale-final-artifact',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with stale runtime evidence',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-stale-final-artifact-root',
      status: 'running',
      createdAt: 1,
      updatedAt: 12,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-final',
        runId: run.id,
        sequence: 1,
        type: 'final_artifact',
        message: 'Delivery accepted before the runtime disappeared.',
        nodeId: 'final-artifact',
        roleSlotId: 'finalizer',
        createdAt: 12,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRun: vi.fn().mockReturnValue(null),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-stale-final-artifact', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with stale runtime evidence',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('blocked');
    expect(snapshot?.result?.status).toBe('blocked');
    expect(snapshot?.events.at(-1)).toMatchObject({
      type: 'flow:runtime_missing',
      status: 'blocked',
    });
    expect(snapshot?.result?.summary).toBe('AgentFlow goal_guard_delivery_loop is blocked because its architecture runtime is no longer live.');
  });

  it('does not finalize reconstructed runs while linked CLI child evidence is unresolved', async () => {
    const run: ArchitectureRun = {
      id: 'run-final-with-running-cli',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with CLI child',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-final-with-running-cli-root',
      status: 'failed',
      createdAt: 1,
      updatedAt: 12,
      completedAt: 12,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-cli',
        runId: run.id,
        sequence: 1,
        type: 'participant_output',
        message: 'Materializer spawned a CLI child that has not completed yet.',
        nodeId: 'materializer',
        roleSlotId: 'materializer',
        data: {
          toolEvidence: {
            successfulToolNames: ['spawn_cli_agent'],
            childCliSessions: [
              {
                childSessionId: 'cli-child-running',
                agentId: 'codex',
                status: 'running',
                workdir: 'C:\\Projekty\\TurboProject2',
              },
              {
                childSessionId: 'cli-child-failed',
                agentId: 'gemini',
                status: 'failed',
                workdir: 'C:\\Projekty\\TurboProject2',
              },
              {
                childSessionId: 'cli-child-unknown',
                agentId: 'copilot',
                status: 'unknown',
                workdir: 'C:\\Projekty\\TurboProject2',
              },
              {
                childSessionId: 'cli-child-missing-status',
                agentId: 'codex',
                workdir: 'C:\\Projekty\\TurboProject2',
              },
            ],
          },
        },
        createdAt: 8,
      },
      {
        id: 'event-final',
        runId: run.id,
        sequence: 2,
        type: 'final_artifact',
        message: 'Delivery accepted before the CLI child finished.',
        nodeId: 'final-artifact',
        roleSlotId: 'finalizer',
        createdAt: 12,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRun: vi.fn().mockReturnValue(run),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-final-with-running-cli', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with CLI child',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).not.toBe('done');
    expect(snapshot?.result?.status).not.toBe('done');
    expect(snapshot?.events.at(-1)).toMatchObject({
      type: 'flow:unresolved_cli_children',
      status: 'blocked',
      data: {
        childSessionIds: [
          'cli-child-running',
          'cli-child-failed',
          'cli-child-unknown',
          'cli-child-missing-status',
        ],
      },
    });
    expect(snapshot?.result?.nextActions).toContain('Wait for linked CLI child agents to complete before accepting the AgentFlow result.');
  });

  it('does not finalize when the final artifact contract declares unresolved blockers', async () => {
    const run: ArchitectureRun = {
      id: 'run-final-artifact-blocked',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with build proof',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-final-artifact-blocked-root',
      status: 'completed',
      createdAt: 1,
      updatedAt: 12,
      completedAt: 12,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-final',
        runId: run.id,
        sequence: 1,
        type: 'final_artifact',
        message: 'Build verification is incomplete.',
        nodeId: 'final-artifact',
        roleSlotId: 'finalizer',
        data: {
          finalArtifactStatus: 'blocked',
          acceptanceStatus: 'blocked',
          blockingReason: 'Missing post-change build log.',
        },
        createdAt: 12,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRun: vi.fn().mockReturnValue(run),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-final-artifact-blocked', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with build proof',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('blocked');
    expect(snapshot?.result?.status).toBe('blocked');
    expect(snapshot?.events.at(-1)).toMatchObject({
      type: 'flow:final_artifact_blocker',
      status: 'blocked',
    });
    expect(snapshot?.result?.nextActions).toEqual([
      'Resolve the blocker described in the final artifact before accepting the AgentFlow result.',
    ]);
  });

  it('does not reuse a stale final artifact from an earlier resumed attempt as current completion', async () => {
    const run: ArchitectureRun = {
      id: 'run-resume-after-blocked-final',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Resume after external QA',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-resume-after-blocked-final-root',
      status: 'running',
      createdAt: 1,
      updatedAt: 20,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-initial-run',
        runId: run.id,
        sequence: 1,
        type: 'run_created',
        message: 'Initial run.',
        createdAt: 1,
      },
      {
        id: 'event-stale-final',
        runId: run.id,
        sequence: 2,
        type: 'final_artifact',
        message: 'Previous attempt incomplete.',
        data: {
          finalArtifactStatus: 'incomplete',
          blockingReason: 'Missing build proof.',
        },
        createdAt: 10,
      },
      {
        id: 'event-resume-run',
        runId: run.id,
        sequence: 3,
        type: 'run_created',
        message: 'Resume after external QA.',
        createdAt: 20,
      },
      {
        id: 'event-resume-orchestrator',
        runId: run.id,
        sequence: 4,
        type: 'router_decision',
        message: 'Orchestrator resumed and routed to implementer.',
        nodeId: 'orchestrator',
        roleSlotId: 'orchestrator',
        route: {
          source: 'agent',
          fromNodeId: 'orchestrator',
          selectedNodeIds: ['implementer'],
          rejectedNodeIds: [],
          nextNodeId: 'implementer',
        },
        createdAt: 21,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRun: vi.fn().mockReturnValue(run),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-resume-after-blocked-final', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Resume after external QA',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('running');
    expect(snapshot?.result).toBeUndefined();
    expect(snapshot?.events.some((event) => event.type === 'flow:final_artifact_blocker')).toBe(false);
  });

  it('blocks a completed resumed attempt when it produced no current final artifact', async () => {
    const run: ArchitectureRun = {
      id: 'run-resume-completed-without-final',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Resume after external QA without current final artifact',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-resume-completed-without-final-root',
      status: 'completed',
      createdAt: 1,
      updatedAt: 30,
      completedAt: 30,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-initial-run',
        runId: run.id,
        sequence: 1,
        type: 'run_created',
        message: 'Initial run.',
        createdAt: 1,
      },
      {
        id: 'event-stale-final',
        runId: run.id,
        sequence: 2,
        type: 'final_artifact',
        message: 'Previous attempt incomplete.',
        data: {
          finalArtifactStatus: 'incomplete',
          blockingReason: 'Missing build proof.',
        },
        createdAt: 10,
      },
      {
        id: 'event-resume-run',
        runId: run.id,
        sequence: 3,
        type: 'run_created',
        message: 'Resume after external QA.',
        createdAt: 20,
      },
      {
        id: 'event-resume-orchestrator',
        runId: run.id,
        sequence: 4,
        type: 'router_decision',
        message: 'Orchestrator resumed and routed to implementer.',
        nodeId: 'orchestrator',
        roleSlotId: 'orchestrator',
        route: {
          source: 'agent',
          fromNodeId: 'orchestrator',
          selectedNodeIds: ['implementer'],
          rejectedNodeIds: [],
          nextNodeId: 'implementer',
        },
        createdAt: 21,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRun: vi.fn().mockReturnValue(run),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-resume-completed-without-final', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Resume after external QA without current final artifact',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('blocked');
    expect(snapshot?.result?.status).toBe('blocked');
    expect(snapshot?.run.summary).toBe('Blocked because the latest architecture attempt completed without a final artifact.');
    expect(snapshot?.events.at(-1)).toMatchObject({
      type: 'flow:missing_final_artifact',
      status: 'blocked',
    });
    expect(snapshot?.events.some((event) => event.type === 'flow:final_artifact_blocker')).toBe(false);
  });

  it('does not mark an active architecture run blocked only because an earlier CLI child is still unresolved', async () => {
    const run: ArchitectureRun = {
      id: 'run-active-with-running-cli',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with active graph progress',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-active-with-running-cli-root',
      status: 'running',
      createdAt: 1,
      updatedAt: 20,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-orchestrator-cli',
        runId: run.id,
        sequence: 1,
        type: 'router_decision',
        message: 'Orchestrator delegated to a CLI child, then routed to implementer.',
        nodeId: 'orchestrator',
        roleSlotId: 'orchestrator',
        data: {
          toolEvidence: {
            successfulToolNames: ['spawn_cli_agent', 'wait_for'],
            childCliSessions: [{
              childSessionId: 'cli-child-running',
              agentId: 'copilot',
              status: 'running',
              workdir: 'C:\\Projekty\\TurboProject2',
            }],
          },
        },
        route: {
          source: 'runtime_fallback',
          fromNodeId: 'orchestrator',
          selectedNodeIds: ['implementer'],
          rejectedNodeIds: [],
          nextNodeId: 'implementer',
        },
        createdAt: 8,
      },
      {
        id: 'event-implementer-started',
        runId: run.id,
        sequence: 2,
        type: 'node_started',
        message: 'Implementer started.',
        nodeId: 'implementer',
        roleSlotId: 'implementer',
        createdAt: 10,
      },
      {
        id: 'event-implementer-read',
        runId: run.id,
        sequence: 3,
        type: 'tool_call',
        message: 'Implementer fs_read success.',
        nodeId: 'implementer',
        roleSlotId: 'implementer',
        data: {
          toolName: 'fs_read',
          status: 'success',
          toolPath: 'C:\\Projekty\\TurboProject2\\src\\App.tsx',
        },
        createdAt: 12,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRun: vi.fn().mockReturnValue(run),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-active-with-running-cli', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with active graph progress',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('running');
    expect(snapshot?.result).toBeUndefined();
    expect(snapshot?.events.some((event) => event.type === 'flow:unresolved_cli_children')).toBe(false);
  });

  it('allows finalization when later host verification supersedes stale unresolved CLI child evidence', async () => {
    const run: ArchitectureRun = {
      id: 'run-final-with-stale-cli-and-host-proof',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with CLI child and host verification',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-final-with-stale-cli-and-host-proof-root',
      status: 'completed',
      createdAt: 1,
      updatedAt: 16,
      completedAt: 16,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-cli-running',
        runId: run.id,
        sequence: 1,
        type: 'participant_output',
        message: 'Materializer spawned a CLI child and moved on after partial evidence.',
        nodeId: 'materializer',
        roleSlotId: 'materializer',
        data: {
          toolEvidence: {
            successfulToolNames: ['spawn_cli_agent', 'wait_for', 'get_cli_agent_status'],
            targetPaths: ['C:\\Projekty\\TurboProject2'],
            childCliSessions: [
              {
                childSessionId: 'cli-child-later-missing',
                agentId: 'codex',
                status: 'running',
                workdir: 'C:\\Projekty\\TurboProject2',
              },
            ],
          },
        },
        createdAt: 8,
      },
      {
        id: 'event-verifier',
        runId: run.id,
        sequence: 2,
        type: 'participant_output',
        message: 'Verifier independently confirmed the changed project and build output.',
        nodeId: 'verifier',
        roleSlotId: 'verifier',
        data: {
          toolEvidence: {
            successfulToolNames: ['fs_write', 'fs_read', 'fs_list', 'terminal_spawn', 'terminal_output'],
            targetPaths: [
              'C:\\Projekty\\TurboProject2\\src\\App.tsx',
              'C:\\Projekty\\TurboProject2\\dist',
            ],
          },
        },
        createdAt: 12,
      },
      {
        id: 'event-goal-master',
        runId: run.id,
        sequence: 3,
        type: 'router_decision',
        message: 'Goal Master accepted the later host verification. route_to(final-artifact, accepted)',
        nodeId: 'goal-master',
        roleSlotId: 'goal_master',
        route: {
          source: 'agent',
          fromNodeId: 'goal-master',
          selectedNodeIds: ['final-artifact'],
          rejectedNodeIds: ['implementer'],
          nextNodeId: 'final-artifact',
        },
        createdAt: 14,
      },
      {
        id: 'event-final',
        runId: run.id,
        sequence: 4,
        type: 'final_artifact',
        message: 'Verified delivery accepted.',
        nodeId: 'final-artifact',
        roleSlotId: 'finalizer',
        createdAt: 16,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-final-with-stale-cli-and-host-proof', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with CLI child and host verification',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('done');
    expect(snapshot?.result?.status).toBe('done');
    expect(snapshot?.events.some((event) => event.type === 'flow:unresolved_cli_children')).toBe(false);
  });

  it('allows finalization when later host verification is split across verifier and tester evidence', async () => {
    const run: ArchitectureRun = {
      id: 'run-final-with-split-host-proof',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with split host verification',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-final-with-split-host-proof-root',
      status: 'completed',
      createdAt: 1,
      updatedAt: 20,
      completedAt: 20,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-cli-running',
        runId: run.id,
        sequence: 1,
        type: 'participant_output',
        message: 'Materializer spawned a CLI child and moved on after partial evidence.',
        nodeId: 'materializer',
        roleSlotId: 'materializer',
        data: {
          toolEvidence: {
            successfulToolNames: ['spawn_cli_agent', 'wait_for'],
            targetPaths: ['C:\\Projekty\\TurboProject2'],
            childCliSessions: [{
              childSessionId: 'cli-child-running',
              agentId: 'gemini',
              status: 'running',
              workdir: 'C:\\Projekty\\TurboProject2',
            }],
          },
        },
        createdAt: 8,
      },
      {
        id: 'event-verifier-terminal',
        runId: run.id,
        sequence: 2,
        type: 'participant_output',
        message: 'Verifier ran the build command but did not include file reads in the same result.',
        nodeId: 'verifier',
        roleSlotId: 'verifier',
        data: {
          toolEvidence: {
            successfulToolNames: ['terminal_spawn', 'terminal_output'],
            targetPaths: [],
          },
        },
        createdAt: 12,
      },
      {
        id: 'event-tester-files',
        runId: run.id,
        sequence: 3,
        type: 'participant_output',
        message: 'Tester independently wrote and read source and dist artifacts.',
        nodeId: 'tester',
        roleSlotId: 'tester',
        data: {
          toolEvidence: {
            successfulToolNames: ['fs_write', 'fs_read', 'fs_list'],
            targetPaths: [
              'C:\\Projekty\\TurboProject2\\src\\App.tsx',
              'C:\\Projekty\\TurboProject2\\dist',
            ],
          },
        },
        createdAt: 14,
      },
      {
        id: 'event-goal-master',
        runId: run.id,
        sequence: 4,
        type: 'router_decision',
        message: 'Goal Master accepted the later split host verification. route_to(final-artifact, accepted)',
        nodeId: 'goal-master',
        roleSlotId: 'goal_master',
        route: {
          source: 'agent',
          fromNodeId: 'goal-master',
          selectedNodeIds: ['final-artifact'],
          rejectedNodeIds: ['implementer'],
          nextNodeId: 'final-artifact',
        },
        createdAt: 18,
      },
      {
        id: 'event-final',
        runId: run.id,
        sequence: 5,
        type: 'final_artifact',
        message: 'Verified delivery accepted.',
        nodeId: 'final-artifact',
        roleSlotId: 'finalizer',
        createdAt: 20,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-final-with-split-host-proof', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with split host verification',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('done');
    expect(snapshot?.result?.status).toBe('done');
    expect(snapshot?.events.some((event) => event.type === 'flow:unresolved_cli_children')).toBe(false);
  });

  it('blocks finalization when stale CLI child evidence is followed only by host reads and dist paths', async () => {
    const run: ArchitectureRun = {
      id: 'run-final-with-stale-cli-and-weak-host-proof',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with stale CLI child and weak host verification',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-final-with-stale-cli-and-weak-host-proof-root',
      status: 'completed',
      createdAt: 1,
      updatedAt: 20,
      completedAt: 20,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-cli-running',
        runId: run.id,
        sequence: 1,
        type: 'participant_output',
        message: 'Materializer timed out after spawning a CLI child.',
        nodeId: 'materializer',
        roleSlotId: 'materializer',
        data: {
          toolEvidence: {
            successfulToolNames: ['spawn_cli_agent', 'wait_for'],
            targetPaths: ['C:\\Projekty\\TurboProject2'],
            childCliSessions: [{
              childSessionId: 'cli-child-still-running',
              agentId: 'codex',
              status: 'running',
              workdir: 'C:\\Projekty\\TurboProject2',
            }],
          },
        },
        createdAt: 8,
      },
      {
        id: 'event-verifier-files',
        runId: run.id,
        sequence: 2,
        type: 'participant_output',
        message: 'Verifier listed source and dist artifacts, but did not prove a fresh write or build.',
        nodeId: 'verifier',
        roleSlotId: 'verifier',
        data: {
          toolEvidence: {
            successfulToolNames: ['fs_read', 'fs_list'],
            targetPaths: [
              'C:\\Projekty\\TurboProject2\\src\\App.tsx',
              'C:\\Projekty\\TurboProject2\\dist',
            ],
          },
        },
        createdAt: 12,
      },
      {
        id: 'event-goal-master',
        runId: run.id,
        sequence: 3,
        type: 'router_decision',
        message: 'Goal Master accepted weak host verification. route_to(final-artifact, accepted)',
        nodeId: 'goal-master',
        roleSlotId: 'goal_master',
        route: {
          source: 'agent',
          fromNodeId: 'goal-master',
          selectedNodeIds: ['final-artifact'],
          rejectedNodeIds: ['implementer'],
          nextNodeId: 'final-artifact',
        },
        createdAt: 18,
      },
      {
        id: 'event-final',
        runId: run.id,
        sequence: 4,
        type: 'final_artifact',
        message: 'Verified delivery accepted.',
        nodeId: 'final-artifact',
        roleSlotId: 'finalizer',
        createdAt: 20,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-final-with-stale-cli-and-weak-host-proof', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with stale CLI child and weak host verification',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('blocked');
    expect(snapshot?.result?.status).toBe('blocked');
    expect(snapshot?.events.some((event) => event.type === 'flow:unresolved_cli_children')).toBe(true);
  });

  it('blocks finalization when stale CLI child evidence is followed by build evidence without host write evidence', async () => {
    const run: ArchitectureRun = {
      id: 'run-final-with-stale-cli-and-read-build-proof',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with stale CLI child and read/build verification',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-final-with-stale-cli-and-read-build-proof-root',
      status: 'completed',
      createdAt: 1,
      updatedAt: 20,
      completedAt: 20,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-cli-running',
        runId: run.id,
        sequence: 1,
        type: 'participant_output',
        message: 'Materializer timed out after spawning a CLI child.',
        nodeId: 'materializer',
        roleSlotId: 'materializer',
        data: {
          toolEvidence: {
            successfulToolNames: ['spawn_cli_agent', 'wait_for'],
            targetPaths: ['C:\\Projekty\\TurboProject2'],
            childCliSessions: [{
              childSessionId: 'cli-child-read-build',
              agentId: 'codex',
              status: 'running',
              workdir: 'C:\\Projekty\\TurboProject2',
            }],
          },
        },
        createdAt: 8,
      },
      {
        id: 'event-verifier-read-build',
        runId: run.id,
        sequence: 2,
        type: 'participant_output',
        message: 'Verifier read source and ran the build, but no AgentFlow-owned host write was recorded.',
        nodeId: 'verifier',
        roleSlotId: 'verifier',
        data: {
          toolEvidence: {
            successfulToolNames: ['fs_read', 'fs_list', 'terminal_spawn', 'terminal_output'],
            targetPaths: [
              'C:\\Projekty\\TurboProject2\\src\\App.tsx',
              'C:\\Projekty\\TurboProject2\\dist',
            ],
          },
        },
        createdAt: 12,
      },
      {
        id: 'event-goal-master',
        runId: run.id,
        sequence: 3,
        type: 'router_decision',
        message: 'Goal Master accepted read/build verification. route_to(final-artifact, accepted)',
        nodeId: 'goal-master',
        roleSlotId: 'goal_master',
        route: {
          source: 'agent',
          fromNodeId: 'goal-master',
          selectedNodeIds: ['final-artifact'],
          rejectedNodeIds: ['implementer'],
          nextNodeId: 'final-artifact',
        },
        createdAt: 18,
      },
      {
        id: 'event-final',
        runId: run.id,
        sequence: 4,
        type: 'final_artifact',
        message: 'Verified delivery accepted.',
        nodeId: 'final-artifact',
        roleSlotId: 'finalizer',
        createdAt: 20,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-final-with-stale-cli-and-read-build-proof', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with stale CLI child and read/build verification',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('blocked');
    expect(snapshot?.result?.status).toBe('blocked');
    expect(snapshot?.events.some((event) => event.type === 'flow:unresolved_cli_children')).toBe(true);
  });

  it('allows finalization when later Goal Master router output carries host verification evidence', async () => {
    const run: ArchitectureRun = {
      id: 'run-final-with-router-output-host-proof',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with router-output verification',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-final-with-router-output-host-proof-root',
      status: 'completed',
      createdAt: 1,
      updatedAt: 20,
      completedAt: 20,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-cli-running',
        runId: run.id,
        sequence: 1,
        type: 'participant_output',
        message: 'Materializer timed out after spawning a CLI child.',
        nodeId: 'materializer',
        roleSlotId: 'materializer',
        data: {
          toolEvidence: {
            successfulToolNames: ['spawn_cli_agent', 'wait_for'],
            targetPaths: ['C:\\Projekty\\TurboProject2'],
            childCliSessions: [{
              childSessionId: 'cli-child-stale',
              agentId: 'codex',
              status: 'running',
              workdir: 'C:\\Projekty\\TurboProject2',
            }],
          },
        },
        createdAt: 8,
      },
      {
        id: 'event-goal-master-output',
        runId: run.id,
        sequence: 2,
        type: 'router_output',
        message: 'Goal Master accepted external QA: build exited 0, git status shows only the intended files, and branch is demo49. route_to(final-artifact, accepted)',
        nodeId: 'goal-master',
        roleSlotId: 'goal_master',
        route: {
          source: 'agent',
          fromNodeId: 'goal-master',
          selectedNodeIds: ['final-artifact'],
          rejectedNodeIds: ['implementer'],
          nextNodeId: 'final-artifact',
        },
        createdAt: 18,
      },
      {
        id: 'event-final',
        runId: run.id,
        sequence: 3,
        type: 'final_artifact',
        message: 'Verified delivery accepted.',
        nodeId: 'final-artifact',
        roleSlotId: 'finalizer',
        createdAt: 20,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-final-with-router-output-host-proof', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with router-output verification',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('done');
    expect(snapshot?.result?.status).toBe('done');
    expect(snapshot?.events.some((event) => event.type === 'flow:unresolved_cli_children')).toBe(false);
  });

  it('allows finalization when later final artifact text carries host verification evidence', async () => {
    const run: ArchitectureRun = {
      id: 'run-final-with-final-artifact-host-proof',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with final artifact verification',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-final-with-final-artifact-host-proof-root',
      status: 'completed',
      createdAt: 1,
      updatedAt: 20,
      completedAt: 20,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-cli-running',
        runId: run.id,
        sequence: 1,
        type: 'participant_output',
        message: 'Materializer timed out after spawning a CLI child.',
        nodeId: 'materializer',
        roleSlotId: 'materializer',
        data: {
          toolEvidence: {
            successfulToolNames: ['spawn_cli_agent', 'wait_for'],
            targetPaths: ['C:\\Projekty\\TurboProject2'],
            childCliSessions: [{
              childSessionId: 'cli-child-stale-final',
              agentId: 'codex',
              status: 'running',
              workdir: 'C:\\Projekty\\TurboProject2',
            }],
          },
        },
        createdAt: 8,
      },
      {
        id: 'event-goal-master-output',
        runId: run.id,
        sequence: 2,
        type: 'router_decision',
        message: 'Goal Master accepted external QA. route_to(final-artifact, accepted)',
        nodeId: 'goal-master',
        roleSlotId: 'goal_master',
        route: {
          source: 'agent',
          fromNodeId: 'goal-master',
          selectedNodeIds: ['final-artifact'],
          rejectedNodeIds: ['implementer'],
          nextNodeId: 'final-artifact',
        },
        createdAt: 18,
      },
      {
        id: 'event-final',
        runId: run.id,
        sequence: 3,
        type: 'final_artifact',
        message: 'Verified delivery accepted: build exited 0, git status shows only the intended file, and branch is demo60.',
        nodeId: 'final-artifact',
        roleSlotId: 'finalizer',
        createdAt: 20,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-final-with-final-artifact-host-proof', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with final artifact verification',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('done');
    expect(snapshot?.result?.status).toBe('done');
    expect(snapshot?.events.some((event) => event.type === 'flow:unresolved_cli_children')).toBe(false);
  });

  it('treats completed CLI child evidence as resolved when finalizing AgentFlow snapshots', async () => {
    const run: ArchitectureRun = {
      id: 'run-final-with-completed-cli',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with completed CLI child',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-final-with-completed-cli-root',
      status: 'completed',
      createdAt: 1,
      updatedAt: 12,
      completedAt: 12,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-cli',
        runId: run.id,
        sequence: 1,
        type: 'participant_output',
        message: 'Materializer spawned CLI children that all finished cleanly.',
        nodeId: 'materializer',
        roleSlotId: 'materializer',
        data: {
          toolEvidence: {
            successfulToolNames: ['spawn_cli_agent'],
            childCliSessions: [
              {
                childSessionId: 'cli-child-completed',
                agentId: 'codex',
                status: 'completed',
                workdir: 'C:\\Projekty\\TurboProject2',
              },
              {
                childSessionId: 'cli-child-success',
                agentId: 'gemini',
                status: 'success',
                workdir: 'C:\\Projekty\\TurboProject2',
              },
              {
                childSessionId: 'cli-child-exited',
                agentId: 'copilot',
                status: 'exited',
                workdir: 'C:\\Projekty\\TurboProject2',
              },
            ],
          },
        },
        createdAt: 8,
      },
      {
        id: 'event-goal-master',
        runId: run.id,
        sequence: 2,
        type: 'router_decision',
        message: 'Goal Master confirmed the delivery and accepted verified evidence.',
        nodeId: 'goal-master',
        roleSlotId: 'goal_master',
        route: {
          source: 'agent',
          fromNodeId: 'goal-master',
          selectedNodeIds: ['final-artifact'],
          rejectedNodeIds: ['implementer'],
          nextNodeId: 'final-artifact',
        },
        createdAt: 10,
      },
      {
        id: 'event-final',
        runId: run.id,
        sequence: 3,
        type: 'final_artifact',
        message: 'Sub-agent completed with no output.',
        nodeId: 'final-artifact',
        roleSlotId: 'finalizer',
        createdAt: 12,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-final-with-completed-cli', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with completed CLI child',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('done');
    expect(snapshot?.result?.status).toBe('done');
    expect(snapshot?.result?.summary).toBe('Goal Master confirmed the delivery and accepted verified evidence.');
    expect(snapshot?.events.some((event) => event.type === 'flow:unresolved_cli_children')).toBe(false);
  });

  it('RED: blocks reconstructed running architecture runs that are no longer live', async () => {
    const run: ArchitectureRun = {
      id: 'run-stale-durable',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-stale-durable-root',
      status: 'running',
      createdAt: 1,
      updatedAt: 5,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-stuck-tool',
        runId: run.id,
        sequence: 1,
        type: 'tool_call',
        message: 'Orchestrator started vfs_write.',
        nodeId: 'orchestrator',
        createdAt: 5,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRun: vi.fn().mockReturnValue(null),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-stale-durable', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('blocked');
    expect(snapshot?.run.finishedAt).toBe(5);
    expect(snapshot?.result).toMatchObject({
      status: 'blocked',
      summary: 'AgentFlow goal_guard_delivery_loop is blocked because its architecture runtime is no longer live.',
    });
    expect(snapshot?.events.at(-1)).toMatchObject({
      type: 'flow:runtime_missing',
      status: 'blocked',
    });
  });

  it('maps max-step runtime stops to a waiting checkpoint cursor', async () => {
    const run: ArchitectureRun = {
      id: 'run-waiting',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with bounded steps',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-waiting-root',
      status: 'running',
      createdAt: 1,
      updatedAt: 4,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-route',
        runId: run.id,
        sequence: 1,
        type: 'router_decision',
        message: 'Goal Master routed back to Implementer.',
        nodeId: 'goal-master',
        route: {
          source: 'agent',
          fromNodeId: 'goal-master',
          selectedNodeIds: ['implementer'],
          rejectedNodeIds: ['final-artifact'],
          nextNodeId: 'implementer',
          response: 'Need more evidence.',
        },
        createdAt: 2,
      },
      {
        id: 'event-completed',
        runId: run.id,
        sequence: 2,
        type: 'node_completed',
        message: 'Goal Master completed.',
        nodeId: 'goal-master',
        createdAt: 3,
      },
      {
        id: 'event-stop',
        runId: run.id,
        sequence: 3,
        type: 'router_decision',
        message: 'Runtime stopped after 2 graph steps.',
        data: {
          maxSteps: 2,
          pendingNodeIds: ['implementer'],
          visitCounts: { orchestrator: 1, 'goal-master': 1 },
        },
        createdAt: 4,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-waiting', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with bounded steps',
      parentSessionId: 'parent-1',
      maxSteps: 2,
    });

    expect(snapshot?.run.status).toBe('waiting_on_orchestrator');
    expect(snapshot?.run.waitingForNodeId).toBe('implementer');
    expect(snapshot?.run.activeNodeIds).toEqual(['implementer']);
    expect(snapshot?.run.nodeVisitCounts).toEqual({ orchestrator: 1, 'goal-master': 1 });
    expect(snapshot?.run.checkpoint?.continuation).toMatchObject({
      reason: 'max_steps',
      waitingNodeId: 'implementer',
      pendingNodeIds: ['implementer'],
      visitCounts: { orchestrator: 1, 'goal-master': 1 },
      lastCompletedNodeId: 'goal-master',
      lastRoute: {
        fromNodeId: 'goal-master',
        selectedNodeIds: ['implementer'],
        nextNodeId: 'implementer',
        source: 'agent',
        response: 'Need more evidence.',
      },
    });
    expect(snapshot?.result).toBeUndefined();
  });

  it('does not keep a stale return-to-orchestrator cursor after later runtime progress', async () => {
    const run: ArchitectureRun = {
      id: 'run-resumed-progress',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Continue after external QA',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-resumed-progress-root',
      status: 'running',
      createdAt: 1,
      updatedAt: 8,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-return',
        runId: run.id,
        sequence: 1,
        type: 'router_decision',
        message: 'Goal Master returned control to the orchestrator.',
        nodeId: 'goal-master',
        data: {
          returnToOrchestrator: true,
          pendingNodeIds: ['implementer'],
          visitCounts: { implementer: 1, 'goal-master': 1 },
        },
        createdAt: 4,
      },
      {
        id: 'event-resumed',
        runId: run.id,
        sequence: 2,
        type: 'node_started',
        message: 'Goal Master started.',
        nodeId: 'goal-master',
        createdAt: 7,
      },
      {
        id: 'event-tool',
        runId: run.id,
        sequence: 3,
        type: 'tool_call',
        message: 'Goal Master fs_read success.',
        nodeId: 'goal-master',
        createdAt: 8,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRun: vi.fn().mockReturnValue(run),
      findRunDurable: vi.fn(),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-resumed-progress', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Continue after external QA',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('running');
    expect(snapshot?.run.waitingForNodeId).toBeUndefined();
    expect(snapshot?.run.checkpoint?.continuation).toBeUndefined();
  });

  it('maps failed architecture max-step stops to waiting AgentFlow continuation', async () => {
    const run: ArchitectureRun = {
      id: 'run-failed-waiting',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with bounded steps',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-failed-waiting-root',
      status: 'failed',
      createdAt: 1,
      updatedAt: 4,
      completedAt: 4,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-stop',
        runId: run.id,
        sequence: 1,
        type: 'router_decision',
        message: 'Runtime stopped after 2 graph steps.',
        data: {
          maxSteps: 2,
          pendingNodeIds: ['implementer'],
          visitCounts: { orchestrator: 1, 'goal-master': 1 },
        },
        createdAt: 4,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-failed-waiting', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with bounded steps',
      parentSessionId: 'parent-1',
      maxSteps: 2,
    });

    expect(snapshot?.run.status).toBe('waiting_on_orchestrator');
    expect(snapshot?.run.waitingForNodeId).toBe('implementer');
    expect(snapshot?.result).toBeUndefined();
  });

  it('returns waiting_on_orchestrator from blocking calls when runtime stopped with pending nodes', async () => {
    const run: ArchitectureRun = {
      id: 'run-blocking-wait',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with bounded steps',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-blocking-wait-root',
      status: 'running',
      createdAt: 1,
      updatedAt: 4,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-stop',
        runId: run.id,
        sequence: 1,
        type: 'router_decision',
        message: 'Runtime stopped after 1 graph steps.',
        data: {
          maxSteps: 1,
          pendingNodeIds: ['goal-master'],
          visitCounts: { implementer: 1 },
        },
        createdAt: 4,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn().mockResolvedValue(run),
      createRunAsync: vi.fn(),
      getEvents: vi.fn().mockReturnValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const result = await adapter.run({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with bounded steps',
      parentSessionId: 'parent-1',
      startMode: 'blocking',
      maxSteps: 1,
    });

    expect(result.status).toBe('waiting_on_orchestrator');
    expect(result.nextActions).toEqual(['Runtime stopped after 1 graph steps.']);
    expect(result.summary).toBe('AgentFlow goal_guard_delivery_loop finished with status waiting_on_orchestrator.');
  });

  it('returns the handoff count when a blocking flow returns to the orchestrator', async () => {
    const run: ArchitectureRun = {
      id: 'run-blocking-return',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Pause for orchestrator QA',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-blocking-return-root',
      status: 'running',
      createdAt: 1,
      updatedAt: 4,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-return',
        runId: run.id,
        sequence: 1,
        type: 'router_decision',
        message: 'Goal Guard returned control to the orchestrator for QA evidence.',
        data: {
          returnToOrchestrator: true,
          pendingNodeIds: ['orchestrator'],
          visitCounts: { implementer: 1, 'goal-master': 1 },
        },
        createdAt: 4,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn().mockResolvedValue(run),
      createRunAsync: vi.fn(),
      getEvents: vi.fn().mockReturnValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const result = await adapter.run({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Pause for orchestrator QA',
      parentSessionId: 'parent-1',
      startMode: 'blocking',
      maxSteps: 4,
    });

    expect(result.status).toBe('waiting_on_orchestrator');
    expect(result.returnToOrchestratorCount).toBe(1);
    expect(result.tracePreview?.at(-1)).toMatchObject({
      type: 'flow:guard_result',
      message: 'Goal Guard returned control to the orchestrator for QA evidence.',
      data: expect.objectContaining({ sourceEventType: 'router_decision' }),
    });
  });

  it('RED: resume should continue through the architecture runtime with stored continuation args', async () => {
    const run: ArchitectureRun = {
      id: 'run-resume-adapter',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Continue bounded flow',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-resume-adapter-root',
      status: 'running',
      createdAt: 1,
      updatedAt: 4,
    };
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue([
        {
          id: 'event-resume-final',
          runId: run.id,
          sequence: 1,
          type: 'final_artifact',
          message: 'Resume completed with accepted final artifact.',
          nodeId: 'final-artifact',
          roleSlotId: 'finalizer',
          data: {
            finalArtifactStatus: 'accepted',
          },
          createdAt: 10,
        },
      ]),
      resumeRun: vi.fn().mockResolvedValue({
        ...run,
        status: 'completed',
        updatedAt: 10,
        completedAt: 10,
      }),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.resume?.('run-resume-adapter', {
      input: 'Continue from Goal Master cursor.',
      maxSteps: 8,
    }, {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Continue bounded flow',
      parentSessionId: 'parent-1',
      maxSteps: 8,
      continuation: {
        reason: 'max_steps',
        waitingNodeId: 'goal-master',
        pendingNodeIds: ['goal-master'],
        visitCounts: { implementer: 1 },
      },
    });

    expect(architectureRuntime.resumeRun).toHaveBeenCalledWith('run-resume-adapter', expect.objectContaining({
      input: 'Continue from Goal Master cursor.',
      context: expect.objectContaining({
        subAgentFlowContinuation: expect.objectContaining({
          waitingNodeId: 'goal-master',
        }),
      }),
    }));
    expect(snapshot?.run.status).toBe('done');
  });

  it('falls back to durable snapshot refresh when resumeRun is unavailable', async () => {
    const run: ArchitectureRun = {
      id: 'run-resume-fallback',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Resume after restart',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-resume-fallback-root',
      status: 'completed',
      createdAt: 1,
      updatedAt: 10,
      completedAt: 10,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-final',
        runId: run.id,
        sequence: 1,
        type: 'final_artifact',
        message: 'Recovered durable result.',
        nodeId: 'final-artifact',
        createdAt: 10,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRun: vi.fn().mockReturnValue(null),
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.resume?.('run-resume-fallback', {
      input: 'Continue from durable snapshot.',
    }, {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Resume after restart',
      parentSessionId: 'parent-1',
    });

    expect(architectureRuntime.findRunDurable).toHaveBeenCalledWith('run-resume-fallback');
    expect(architectureRuntime.getEventsDurable).toHaveBeenCalledWith('run-resume-fallback');
    expect(snapshot?.run.status).toBe('done');
    expect(snapshot?.result?.summary).toBe('Recovered durable result.');
  });

  it('blocks live running snapshots when the architecture runtime stops making progress', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 0, 1) + 10_000);
    const run: ArchitectureRun = {
      id: 'run-stale-live',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Do not spin forever',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-stale-live-root',
      status: 'running',
      createdAt: Date.UTC(2026, 0, 1),
      updatedAt: Date.UTC(2026, 0, 1),
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-tool',
        runId: run.id,
        sequence: 1,
        type: 'tool_call',
        message: 'Goal Master run_subagent success.',
        nodeId: 'goal-master',
        roleSlotId: 'goal_master',
        data: { toolName: 'run_subagent', status: 'success' },
        createdAt: 2,
      },
    ];
    const architectureRuntime = {
      createRun: vi.fn(),
      createRunAsync: vi.fn(),
      getEvents: vi.fn(),
      findRun: vi.fn().mockReturnValue(run),
      findRunDurable: vi.fn(),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-stale-live', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Do not spin forever',
      parentSessionId: 'parent-1',
      context: { maxArchitectureIdleMs: 100 },
    });

    expect(snapshot?.run.status).toBe('blocked');
    expect(snapshot?.events.at(-1)).toMatchObject({
      type: 'flow:runtime_stalled',
      status: 'blocked',
    });
    expect(snapshot?.result?.nextActions[0]).toContain('runtime watchdog detected stale running state');
    vi.useRealTimers();
  });
});

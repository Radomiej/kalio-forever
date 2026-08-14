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
      parentSessionId: 'parent-1',
      childSessionId: 'arch-run-1-root',
      status: 'done',
      summary: 'Goal Guard accepted the implementation.',
      tracePreview: [
        expect.objectContaining({
          type: 'flow:final_artifact',
          lifecycle: 'done',
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

  it('projects canonical AgentFlow lifecycle labels while preserving legacy trace event types', async () => {
    const run: ArchitectureRun = {
      id: 'run-lifecycle',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Audit lifecycle',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-lifecycle-root',
      status: 'completed',
      createdAt: 1,
      updatedAt: 4,
      completedAt: 4,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-created',
        runId: run.id,
        sequence: 1,
        type: 'run_created',
        message: 'AgentFlow run created.',
        createdAt: 1,
      },
      {
        id: 'event-started',
        runId: run.id,
        sequence: 2,
        type: 'node_started',
        message: 'Implementer started.',
        nodeId: 'implementer',
        createdAt: 2,
      },
      {
        id: 'event-completed',
        runId: run.id,
        sequence: 3,
        type: 'node_completed',
        message: 'Implementer completed.',
        nodeId: 'implementer',
        createdAt: 3,
      },
      {
        id: 'event-final',
        runId: run.id,
        sequence: 4,
        type: 'final_artifact',
        message: 'Lifecycle accepted.',
        nodeId: 'final-artifact',
        createdAt: 4,
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
      goal: 'Audit lifecycle',
      parentSessionId: 'parent-lifecycle',
      parentToolCallId: 'call-lifecycle',
      returnMode: 'full_trace',
    });

    expect(result).toMatchObject({
      parentSessionId: 'parent-lifecycle',
      parentToolCallId: 'call-lifecycle',
      openGraphRunId: 'run-lifecycle',
    });
    expect(result.tracePreview?.map((event) => event.type)).toEqual([
      'flow:run_created',
      'flow:node_start',
      'flow:node_result',
      'flow:final_artifact',
    ]);
    expect(result.tracePreview?.map((event) => event.lifecycle)).toEqual([
      'started',
      'node_started',
      'node_completed',
      'done',
    ]);
  });

  it('projects stopped architecture runs as cancelled AgentFlow snapshots', async () => {
    const run: ArchitectureRun = {
      id: 'run-stopped',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Stop cleanly',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-stopped-root',
      status: 'cancelled',
      createdAt: 1,
      updatedAt: 3,
      completedAt: 3,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-created',
        runId: run.id,
        sequence: 1,
        type: 'run_created',
        message: 'AgentFlow run created.',
        createdAt: 1,
      },
      {
        id: 'event-stopped',
        runId: run.id,
        sequence: 2,
        type: 'run_stopped',
        message: 'Architecture run stopped by user.',
        data: {
          reasonCode: 'user_stop',
          stoppedByUser: true,
          previousStatus: 'running',
          source: 'user',
        },
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
      goal: 'Stop cleanly',
      parentSessionId: 'parent-stopped',
      parentToolCallId: 'call-stopped',
      returnMode: 'full_trace',
    });

    expect(result).toMatchObject({
      flowRunId: 'run-stopped',
      parentSessionId: 'parent-stopped',
      parentToolCallId: 'call-stopped',
      childSessionId: 'arch-run-stopped-root',
      status: 'cancelled',
      summary: 'Architecture run stopped by user.',
      openChatSessionId: 'arch-run-stopped-root',
      openGraphRunId: 'run-stopped',
    });
    expect(result.tracePreview?.at(-1)).toMatchObject({
      type: 'flow:stopped',
      lifecycle: 'cancelled',
      message: 'Architecture run stopped by user.',
      data: expect.objectContaining({
        reasonCode: 'user_stop',
        sourceEventType: 'run_stopped',
      }),
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
        message: 'Implementer spawned a CLI child that has not completed yet.',
        nodeId: 'implementer',
        roleSlotId: 'implementer',
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
    expect(snapshot?.result?.summary).toBe('Blocked because linked CLI child agents are unresolved.');
    expect(snapshot?.events.at(-1)).toMatchObject({
      type: 'flow:unresolved_cli_children',
      lifecycle: 'blocked',
      status: 'blocked',
      data: {
        reasonCode: 'unresolved_cli_children',
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

  it('allows finalization when later typed verifier evidence proves child work even if an earlier child is still running', async () => {
    const run: ArchitectureRun = {
      id: 'run-final-with-verifier-terminal-evidence',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with terminal verifier evidence',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-final-with-verifier-terminal-evidence-root',
      status: 'completed',
      createdAt: 1,
      updatedAt: 18,
      completedAt: 18,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-cli',
        runId: run.id,
        sequence: 1,
        type: 'participant_output',
        message: 'Implementer delegated a running CLI child.',
        nodeId: 'implementer',
        roleSlotId: 'implementer',
        data: {
          toolEvidence: {
            successfulToolNames: ['spawn_cli_agent'],
            childCliSessions: [
              {
                childSessionId: 'cli-child-running-verifier-terminal',
                agentId: 'copilot',
                status: 'running',
                workdir: 'C:\\Projekty\\TurboProject2',
              },
            ],
          },
        },
        createdAt: 8,
      },
      {
        id: 'event-verifier-terminal',
        runId: run.id,
        sequence: 2,
        type: 'participant_output',
        message: 'Verifier validated terminal build output and repository state.',
        nodeId: 'verifier',
        roleSlotId: 'verifier',
        evidence: [
          {
            kind: 'BUILD_RESULT',
            source: 'terminal_output',
            status: 'passed',
            data: { exitCode: 0 },
          },
          {
            kind: 'GIT_STATUS',
            source: 'git',
            status: 'passed',
            data: { clean: true },
          },
        ],
        data: {
          toolEvidence: {
            toolCallCount: 1,
            toolResultCount: 1,
            toolNames: ['terminal_output'],
            successfulToolNames: ['terminal_output'],
            targetPaths: ['C:\\Projekty\\TurboProject2\\dist'],
          },
        },
        createdAt: 12,
      },
      {
        id: 'event-final',
        runId: run.id,
        sequence: 3,
        type: 'final_artifact',
        message: 'Delivery accepted after verifier terminal evidence.',
        nodeId: 'final-artifact',
        roleSlotId: 'finalizer',
        createdAt: 18,
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

    const snapshot = await adapter.getSnapshot('run-final-with-verifier-terminal-evidence', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with terminal verifier evidence',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('done');
    expect(snapshot?.result?.status).toBe('done');
    expect(snapshot?.events.some((event) => event.type === 'flow:unresolved_cli_children')).toBe(false);
    expect(snapshot?.result?.nextActions).not.toContain('Wait for linked CLI child agents to complete before accepting the AgentFlow result.');
  });

  it('does not accept finalization from status text without typed runtime decision', async () => {
    const run: ArchitectureRun = {
      id: 'run-text-only-finalization',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Continue after external QA',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-text-only-finalization-root',
      status: 'running',
      createdAt: 1,
      updatedAt: 12,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-goal-master',
        runId: run.id,
        sequence: 1,
        type: 'router_decision',
        message: 'Status: GO. Delivery accepted with build passes, git status clean, and final-artifact requested.',
        nodeId: 'goal-master',
        roleSlotId: 'goal_master',
        route: {
          source: 'runtime_fallback',
          fromNodeId: 'goal-master',
          selectedNodeIds: ['implementer'],
          rejectedNodeIds: ['final-artifact'],
          nextNodeId: 'implementer',
          response: 'CLI child implementation is incomplete: child status is failed.',
        },
        createdAt: 10,
      },
      {
        id: 'event-return',
        runId: run.id,
        sequence: 2,
        type: 'router_decision',
        message: 'Goal Master returned control to the orchestrator.',
        reasonCode: 'return_to_orchestrator',
        nodeId: 'goal-master',
        roleSlotId: 'goal_master',
        data: {
          reasonCode: 'return_to_orchestrator',
          returnToOrchestrator: true,
          pendingNodeIds: ['implementer'],
          visitCounts: { implementer: 3, 'goal-master': 3 },
        },
        createdAt: 12,
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

    const snapshot = await adapter.getSnapshot('run-text-only-finalization', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Continue after external QA',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('waiting_on_orchestrator');
    expect(snapshot?.result).toBeUndefined();
    expect(snapshot?.events.some((event) => event.type === 'flow:finalization_missing')).toBe(false);
  });

  it('blocks finalization-missing from typed acceptance without canonical node ids', async () => {
    const run: ArchitectureRun = {
      id: 'run-renamed-finalization-missing',
      schemaId: 'custom-release-loop',
      prompt: 'Continue release workflow',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-renamed-finalization-missing-root',
      status: 'running',
      createdAt: 1,
      updatedAt: 12,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-release-guard',
        runId: run.id,
        sequence: 1,
        type: 'router_decision',
        message: 'Release guard accepted typed finalization evidence.',
        nodeId: 'release-gate',
        roleSlotId: 'release_guard',
        reasonCode: 'final_artifact_accepted',
        runtimeDecision: {
          status: 'done',
          reasonCode: 'final_artifact_accepted',
          accepted: true,
          nextNodeId: 'release-report',
        },
        evidence: [
          {
            kind: 'BUILD_RESULT',
            source: 'terminal_output',
            status: 'passed',
            data: { exitCode: 0 },
          },
          {
            kind: 'GIT_STATUS',
            source: 'git',
            status: 'passed',
            data: { clean: true },
          },
        ],
        route: {
          source: 'runtime_fallback',
          fromNodeId: 'release-gate',
          selectedNodeIds: ['builder'],
          rejectedNodeIds: ['release-report'],
          nextNodeId: 'builder',
          response: 'CLI child implementation is incomplete: child status is failed.',
        },
        data: {
          slotType: 'judge',
        },
        createdAt: 10,
      },
      {
        id: 'event-return',
        runId: run.id,
        sequence: 2,
        type: 'router_decision',
        message: 'Release guard returned control to the orchestrator.',
        reasonCode: 'return_to_orchestrator',
        nodeId: 'release-gate',
        roleSlotId: 'release_guard',
        data: {
          slotType: 'judge',
          reasonCode: 'return_to_orchestrator',
          returnToOrchestrator: true,
          pendingNodeIds: ['builder'],
          visitCounts: { builder: 3, 'release-gate': 3 },
        },
        createdAt: 12,
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

    const snapshot = await adapter.getSnapshot('run-renamed-finalization-missing', {
      flowId: 'custom-release-loop',
      goal: 'Continue release workflow',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('blocked');
    expect(snapshot?.result?.status).toBe('blocked');
    expect(snapshot?.events.at(-1)).toMatchObject({
      type: 'flow:finalization_missing',
      status: 'blocked',
      data: { reasonCode: 'finalization_missing' },
    });
  });

  it('uses structured final artifact answer before placeholder display text', async () => {
    const run: ArchitectureRun = {
      id: 'run-final-artifact-answer',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Produce structured final answer',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-final-artifact-answer-root',
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
        message: 'Sub-agent finished without a printable artifact payload.',
        nodeId: 'final-artifact',
        roleSlotId: 'finalizer',
        data: {
          finalArtifactStatus: 'accepted',
          finalArtifactAnswer: 'Structured final answer from the finalizer contract.',
        },
        createdAt: 12,
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

    const snapshot = await adapter.getSnapshot('run-final-artifact-answer', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Produce structured final answer',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('done');
    expect(snapshot?.result?.summary).toBe('Structured final answer from the finalizer contract.');
  });

  it('does not block a completed final artifact from blocker prose without typed status data', async () => {
    const run: ArchitectureRun = {
      id: 'run-final-artifact-text-blocker',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with build proof',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-final-artifact-text-blocker-root',
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
        message: 'Status: blocked. Blocker: missing post-change build log.',
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

    const snapshot = await adapter.getSnapshot('run-final-artifact-text-blocker', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with build proof',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('done');
    expect(snapshot?.result?.status).toBe('done');
    expect(snapshot?.events.some((event) => event.type === 'flow:final_artifact_blocker')).toBe(false);
  });

  it('does not block a completed final artifact from display-only reason fields without typed status data', async () => {
    const run: ArchitectureRun = {
      id: 'run-final-artifact-reason-only',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with build proof',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-final-artifact-reason-only-root',
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
        message: 'Final artifact included display-only notes.',
        nodeId: 'final-artifact',
        roleSlotId: 'finalizer',
        data: {
          blockingReason: 'Display-only note from structured output.',
          incompleteReason: 'Display-only incomplete note from structured output.',
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

    const snapshot = await adapter.getSnapshot('run-final-artifact-reason-only', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with build proof',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('done');
    expect(snapshot?.result?.status).toBe('done');
    expect(snapshot?.events.some((event) => event.type === 'flow:final_artifact_blocker')).toBe(false);
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
      lifecycle: 'blocked',
      data: { reasonCode: 'final_artifact_blocker' },
      status: 'blocked',
    });
    expect(snapshot?.result?.nextActions).toEqual([
      'Resolve the blocker described in the final artifact before accepting the AgentFlow result.',
    ]);
  });

  it('does not finalize when final artifact evidence reports a typed blocker', async () => {
    const run: ArchitectureRun = {
      id: 'run-final-artifact-evidence-blocked',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with build proof',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-final-artifact-evidence-blocked-root',
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
        evidence: [
          {
            kind: 'FINAL_ARTIFACT',
            status: 'blocked',
            source: 'finalizer',
            data: {
              reasonCode: 'final_artifact_blocker',
            },
          },
        ],
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

    const snapshot = await adapter.getSnapshot('run-final-artifact-evidence-blocked', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with build proof',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('blocked');
    expect(snapshot?.result?.status).toBe('blocked');
    expect(snapshot?.events.find((event) => event.type === 'flow:final_artifact')).toMatchObject({
      lifecycle: 'blocked',
      status: 'blocked',
    });
    expect(snapshot?.events.at(-1)).toMatchObject({
      type: 'flow:final_artifact_blocker',
      lifecycle: 'blocked',
      data: { reasonCode: 'final_artifact_blocker' },
      status: 'blocked',
    });
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
      lifecycle: 'blocked',
      data: { reasonCode: 'missing_final_artifact' },
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
        message: 'Implementer spawned a CLI child and moved on after partial evidence.',
        nodeId: 'implementer',
        roleSlotId: 'implementer',
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

  it('allows finalization when later typed host evidence supersedes stale unresolved CLI child evidence', async () => {
    const run: ArchitectureRun = {
      id: 'run-final-with-stale-cli-and-typed-host-proof',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with CLI child and typed host verification',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-final-with-stale-cli-and-typed-host-proof-root',
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
        message: 'Implementer spawned a CLI child and moved on after partial evidence.',
        nodeId: 'implementer',
        roleSlotId: 'implementer',
        data: {
          toolEvidence: {
            successfulToolNames: ['spawn_cli_agent', 'wait_for', 'get_cli_agent_status'],
            targetPaths: ['C:\\Projekty\\TurboProject2'],
            childCliSessions: [
              {
                childSessionId: 'cli-child-typed-host-running',
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
        message: 'Verifier produced typed host write and build evidence.',
        nodeId: 'verifier',
        roleSlotId: 'verifier',
        evidence: [
          {
            kind: 'VFS_WRITE',
            source: 'host_project',
            status: 'passed',
            data: {
              path: 'C:\\Projekty\\TurboProject2\\src\\App.tsx',
            },
          },
          {
            kind: 'BUILD_RESULT',
            source: 'terminal_output',
            status: 'passed',
            data: {
              command: 'npm run build',
              exitCode: 0,
            },
          },
        ],
        createdAt: 12,
      },
      {
        id: 'event-goal-master',
        runId: run.id,
        sequence: 3,
        type: 'router_decision',
        message: 'Goal Master accepted the typed host verification.',
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

    const snapshot = await adapter.getSnapshot('run-final-with-stale-cli-and-typed-host-proof', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with CLI child and typed host verification',
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
        message: 'Implementer spawned a CLI child and moved on after partial evidence.',
        nodeId: 'implementer',
        roleSlotId: 'implementer',
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
        message: 'Implementer timed out after spawning a CLI child.',
        nodeId: 'implementer',
        roleSlotId: 'implementer',
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
        message: 'Implementer timed out after spawning a CLI child.',
        nodeId: 'implementer',
        roleSlotId: 'implementer',
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
        message: 'Implementer timed out after spawning a CLI child.',
        nodeId: 'implementer',
        roleSlotId: 'implementer',
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
        message: 'Goal Master accepted typed external QA evidence. route_to(final-artifact, accepted)',
        nodeId: 'goal-master',
        roleSlotId: 'goal_master',
        evidence: [
          {
            kind: 'BUILD_RESULT',
            source: 'terminal_output',
            status: 'passed',
            data: { exitCode: 0 },
          },
          {
            kind: 'GIT_STATUS',
            source: 'git',
            status: 'passed',
            data: { clean: true },
          },
        ],
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

  it('allows finalization when resume context carries a passed external quality gate', async () => {
    const run: ArchitectureRun = {
      id: 'run-final-with-external-quality-gate',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with external quality gate verification',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-final-with-external-quality-gate-root',
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
        message: 'Implementer timed out after spawning a CLI child.',
        nodeId: 'implementer',
        roleSlotId: 'implementer',
        data: {
          toolEvidence: {
            successfulToolNames: ['spawn_cli_agent', 'wait_for'],
            targetPaths: ['C:\\Projekty\\TurboProject2'],
            childCliSessions: [{
              childSessionId: 'cli-child-external-gate',
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
        message: 'Goal Master accepted external QA. route_to(final-artifact, accepted)',
        nodeId: 'goal-master',
        roleSlotId: 'goal_master',
        route: {
          source: 'router',
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
        data: {
          finalArtifactStatus: 'accepted',
        },
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

    const snapshot = await adapter.getSnapshot('run-final-with-external-quality-gate', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with external quality gate verification',
      parentSessionId: 'parent-1',
      context: {
        externalQualityGate: {
          status: 'passed',
          checkedBy: 'host-codex',
          evidence: [
            'target file exists',
            'no fake date remains',
          ],
        },
      },
    });

    expect(snapshot?.run.status).toBe('done');
    expect(snapshot?.result?.status).toBe('done');
    expect(snapshot?.events.some((event) => event.type === 'flow:unresolved_cli_children')).toBe(false);
  });

  it('allows finalization when later final artifact carries typed host verification evidence', async () => {
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
        message: 'Implementer timed out after spawning a CLI child.',
        nodeId: 'implementer',
        roleSlotId: 'implementer',
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
        message: 'Verified delivery accepted with typed host evidence.',
        nodeId: 'final-artifact',
        roleSlotId: 'finalizer',
        evidence: [
          {
            kind: 'BUILD_RESULT',
            source: 'terminal_output',
            status: 'passed',
            data: { exitCode: 0 },
          },
          {
            kind: 'GIT_STATUS',
            source: 'git',
            status: 'passed',
            data: { clean: true },
          },
        ],
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
        message: 'Implementer spawned CLI children that all finished cleanly.',
        nodeId: 'implementer',
        roleSlotId: 'implementer',
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
              {
                childSessionId: 'cli-child-terminal-success',
                agentId: 'copilot',
                status: 'terminal-success',
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
        reasonCode: 'max_steps',
        data: {
          reasonCode: 'max_steps',
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
        reasonCode: 'return_to_orchestrator',
        nodeId: 'goal-master',
        data: {
          reasonCode: 'return_to_orchestrator',
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

  it('blocks finalization-missing when Goal Master accepts host evidence but runtime fallback rejects final artifact', async () => {
    const run: ArchitectureRun = {
      id: 'run-finalization-missing',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Continue after external QA',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-finalization-missing-root',
      status: 'running',
      createdAt: 1,
      updatedAt: 12,
    };
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-goal-master',
        runId: run.id,
        sequence: 1,
        type: 'router_decision',
        message: 'Goal Master accepted typed finalization evidence.',
        nodeId: 'goal-master',
        roleSlotId: 'goal_master',
        reasonCode: 'final_artifact_accepted',
        runtimeDecision: {
          status: 'done',
          reasonCode: 'final_artifact_accepted',
          accepted: true,
          nextNodeId: 'final-artifact',
        },
        evidence: [
          {
            kind: 'BUILD_RESULT',
            source: 'terminal_output',
            status: 'passed',
            data: { exitCode: 0 },
          },
          {
            kind: 'GIT_STATUS',
            source: 'git',
            status: 'passed',
            data: { clean: true },
          },
        ],
        route: {
          source: 'runtime_fallback',
          fromNodeId: 'goal-master',
          selectedNodeIds: ['implementer'],
          rejectedNodeIds: ['final-artifact'],
          nextNodeId: 'implementer',
          response: 'CLI child implementation is incomplete: child status is failed.',
        },
        createdAt: 10,
      },
      {
        id: 'event-completed',
        runId: run.id,
        sequence: 2,
        type: 'node_completed',
        message: 'Goal Master completed.',
        nodeId: 'goal-master',
        roleSlotId: 'goal_master',
        createdAt: 11,
      },
      {
        id: 'event-return',
        runId: run.id,
        sequence: 3,
        type: 'router_decision',
        message: 'Goal Master returned control to the orchestrator.',
        reasonCode: 'return_to_orchestrator',
        nodeId: 'goal-master',
        roleSlotId: 'goal_master',
        data: {
          reasonCode: 'return_to_orchestrator',
          returnToOrchestrator: true,
          pendingNodeIds: ['implementer'],
          visitCounts: { implementer: 3, 'goal-master': 3 },
        },
        createdAt: 12,
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

    const snapshot = await adapter.getSnapshot('run-finalization-missing', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Continue after external QA',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('blocked');
    expect(snapshot?.run.summary).toBe('Blocked because Goal Master accepted finalization evidence, but the runtime could not produce the final artifact.');
    expect(snapshot?.result?.status).toBe('blocked');
    expect(snapshot?.events.at(-1)).toMatchObject({
      type: 'flow:finalization_missing',
      status: 'blocked',
      data: { reasonCode: 'finalization_missing' },
    });
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
        reasonCode: 'max_steps',
        data: {
          reasonCode: 'max_steps',
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

  it('clears a stale input continuation when the resumed architecture run reaches a terminal failure', async () => {
    const run: ArchitectureRun = {
      id: 'run-terminal-after-pause',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Resume after HITL',
      executionMode: 'subagent_execution',
      rootSessionId: 'architecture-root',
      status: 'failed',
      createdAt: 1,
      updatedAt: 5,
      completedAt: 5,
    };
    const events: ArchitectureExecutionEvent[] = [{
      id: 'event-failed',
      runId: run.id,
      sequence: 1,
      type: 'node_failed',
      nodeId: 'implementer',
      message: 'Implementer failed.',
      errorCode: 'CONTRACT_VIOLATION',
      failure: {
        code: 'CONTRACT_VIOLATION',
        retryable: false,
        message: 'Required tool evidence was not produced.',
      },
      createdAt: 5,
    }];
    const architectureRuntime = {
      findRunDurable: vi.fn().mockResolvedValue(run),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot(run.id, {
      flowId: 'goal_guard_delivery_loop',
      goal: run.prompt,
      parentSessionId: 'parent-1',
      continuation: {
        reason: 'runtime_pause',
        waitingNodeId: 'orchestrator',
        pendingNodeIds: ['orchestrator'],
        visitCounts: {},
      },
    });

    expect(snapshot?.run.status).toBe('failed');
    expect(snapshot?.run.checkpoint?.continuation).toBeUndefined();
  });

  it('maps typed run-stopped max-step events to waiting AgentFlow continuation', async () => {
    const run: ArchitectureRun = {
      id: 'run-stopped-waiting',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Implement with bounded steps',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-stopped-waiting-root',
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
        type: 'run_stopped',
        message: 'Runtime stopped after 2 graph steps.',
        reasonCode: 'max_steps',
        data: {
          reasonCode: 'max_steps',
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
      findRun: vi.fn().mockReturnValue(run),
      findRunDurable: vi.fn(),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot('run-stopped-waiting', {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with bounded steps',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('waiting_on_orchestrator');
    expect(snapshot?.run.waitingForNodeId).toBe('implementer');
    expect(snapshot?.run.checkpoint?.continuation).toMatchObject({
      reason: 'max_steps',
      waitingNodeId: 'implementer',
      pendingNodeIds: ['implementer'],
      visitCounts: { orchestrator: 1, 'goal-master': 1 },
    });
    expect(snapshot?.events.at(-1)).toMatchObject({
      type: 'flow:stopped',
      lifecycle: 'waiting_on_orchestrator',
      status: 'waiting_on_orchestrator',
    });
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
        reasonCode: 'max_steps',
        data: {
          reasonCode: 'max_steps',
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
        reasonCode: 'return_to_orchestrator',
        data: {
          reasonCode: 'return_to_orchestrator',
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

  it('projects a typed runtime pause as a durable continuation instead of stale running', async () => {
    const run: ArchitectureRun = {
      id: 'run-human-pause',
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Wait for approval',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-run-human-pause-root',
      status: 'running',
      createdAt: 1,
      updatedAt: 2,
    };
    const events: ArchitectureExecutionEvent[] = [{
      id: 'event-runtime-pause',
      runId: run.id,
      sequence: 1,
      type: 'router_decision',
      message: 'Implementer paused for human input.',
      lifecycle: 'waiting_on_orchestrator',
      status: 'waiting_on_orchestrator',
      nodeId: 'implementer',
      roleSlotId: 'implementer',
      reasonCode: 'runtime_pause',
      data: {
        reasonCode: 'runtime_pause',
        pendingNodeIds: ['implementer'],
        visitCounts: { orchestrator: 1 },
        waitEvent: 'tool:confirmation_required',
        waitIdentity: {
          requestId: 'confirm-1',
          childSessionId: 'child-implementer',
          childTurnId: 'turn-implementer',
          promptMessageId: 'prompt-implementer',
        },
      },
      createdAt: 2,
    }];
    const architectureRuntime = {
      findRun: vi.fn().mockReturnValue(run),
      findRunDurable: vi.fn(),
      getEventsDurable: vi.fn().mockResolvedValue(events),
    };
    const adapter = new ArchitectureAgentFlowAdapter(architectureRuntime as unknown as ArchitectureRuntimeService);

    const snapshot = await adapter.getSnapshot(run.id, {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Wait for approval',
      parentSessionId: 'parent-1',
    });

    expect(snapshot?.run.status).toBe('waiting_on_orchestrator');
    expect(snapshot?.run.checkpoint?.continuation).toEqual(expect.objectContaining({
      reason: 'runtime_pause',
      waitingNodeId: 'implementer',
      pendingNodeIds: ['implementer'],
      waitIdentity: {
        requestId: 'confirm-1',
        childSessionId: 'child-implementer',
        childTurnId: 'turn-implementer',
        promptMessageId: 'prompt-implementer',
      },
    }));
  });
});

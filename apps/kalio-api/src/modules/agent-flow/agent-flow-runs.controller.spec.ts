import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AgentFlowRunsController } from './agent-flow-runs.controller';
import type { AgentFlowRuntimeService } from './agent-flow-runtime.service';

describe('AgentFlowRunsController', () => {
  it('starts durable AgentFlow runs through the first-class API', async () => {
    const snapshot = {
      run: {
        id: 'run-1',
        parentSessionId: 'parent-1',
        childSessionId: 'child-1',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running' as const,
        startMode: 'durable' as const,
        returnMode: 'summary' as const,
        createdAt: 1,
        updatedAt: 1,
      },
      events: [],
    };
    const runtime = {
      start: vi.fn().mockResolvedValue(snapshot),
    };
    const controller = new AgentFlowRunsController(runtime as unknown as AgentFlowRuntimeService);

    const result = await controller.create({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Build project',
      parentSessionId: 'parent-1',
    });

    expect(runtime.start).toHaveBeenCalledWith(expect.objectContaining({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Build project',
      parentSessionId: 'parent-1',
      startMode: 'durable',
    }));

    await controller.create({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Build project',
      parentSessionId: 'parent-1',
      parentToolCallId: 'call-parent-tool',
    });

    expect(runtime.start).toHaveBeenCalledWith(expect.objectContaining({
      parentToolCallId: 'call-parent-tool',
    }));
    expect(result.run.status).toBe('running');
  });

  it('RED: rejects invalid create payloads before starting an orphaned run', async () => {
    const runtime = {
      start: vi.fn().mockResolvedValue({
        run: {
          id: 'run-invalid',
          parentSessionId: '',
          childSessionId: 'child-invalid',
          flowDefinitionId: 'goal_guard_delivery_loop',
          status: 'running' as const,
          startMode: 'durable' as const,
          returnMode: 'summary' as const,
          createdAt: 1,
          updatedAt: 1,
        },
        events: [],
      }),
    };
    const controller = new AgentFlowRunsController(runtime as unknown as AgentFlowRuntimeService);

    await expect(controller.create({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Build project',
      parentSessionId: '',
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create({
      flowId: '',
      goal: 'Build project',
      parentSessionId: 'parent-1',
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Build project',
      parentSessionId: 'parent-1',
      startMode: 'blocking',
      maxSteps: 0,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(runtime.start).not.toHaveBeenCalled();
  });

  it('exposes snapshots, events, and resume route', async () => {
    const snapshot = {
      run: {
        id: 'run-2',
        parentSessionId: 'parent-1',
        childSessionId: 'child-1',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator' as const,
        startMode: 'durable' as const,
        returnMode: 'summary' as const,
        createdAt: 1,
        updatedAt: 1,
      },
      events: [
        {
          id: 'event-1',
          sequence: 1,
          type: 'flow:return_to_orchestrator',
          message: 'Need more evidence.',
          createdAt: 2,
        },
      ],
    };
    const runtime = {
      getSnapshot: vi.fn().mockResolvedValue(snapshot),
      resume: vi.fn().mockResolvedValue({
        ...snapshot,
        run: { ...snapshot.run, status: 'running' as const, updatedAt: 3 },
      }),
      stop: vi.fn().mockResolvedValue({
        ...snapshot,
        run: { ...snapshot.run, status: 'cancelled' as const, updatedAt: 4, finishedAt: 4 },
      }),
    };
    const controller = new AgentFlowRunsController(runtime as unknown as AgentFlowRuntimeService);

    await expect(controller.findOne('missing')).resolves.toBe(snapshot);
    await expect(controller.events('run-2')).resolves.toEqual(snapshot.events);
    const resumed = await controller.resume('run-2', { input: 'Continue' });
    const stopped = await controller.stop('run-2');

    expect(runtime.getSnapshot).toHaveBeenCalledWith('run-2');
    expect(runtime.resume).toHaveBeenCalledWith('run-2', { input: 'Continue' });
    expect(runtime.stop).toHaveBeenCalledWith('run-2');
    expect(resumed.run.status).toBe('running');
    expect(stopped.run.status).toBe('cancelled');
  });

  it('maps legacy resume message payloads to canonical input', async () => {
    const snapshot = {
      run: {
        id: 'run-message',
        parentSessionId: 'parent-1',
        childSessionId: 'child-1',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'waiting_on_orchestrator' as const,
        startMode: 'durable' as const,
        returnMode: 'summary' as const,
        createdAt: 1,
        updatedAt: 1,
      },
      events: [],
    };
    const runtime = {
      resume: vi.fn().mockResolvedValue(snapshot),
    };
    const controller = new AgentFlowRunsController(runtime as unknown as AgentFlowRuntimeService);

    await controller.resume('run-message', { message: 'Continue with docs fix.' } as never);

    expect(runtime.resume).toHaveBeenCalledWith('run-message', { input: 'Continue with docs fix.' });
  });

  it('exposes AgentFlow runs by parent session for Conversations visibility', async () => {
    const snapshots = [
      {
        run: {
          id: 'run-visible',
          parentSessionId: 'parent-1',
          childSessionId: 'child-1',
          openChatSessionId: 'child-1',
          openGraphRunId: 'arch-run-1',
          flowDefinitionId: 'goal_guard_delivery_loop',
          status: 'running' as const,
          startMode: 'durable' as const,
          returnMode: 'summary' as const,
          createdAt: 1,
          updatedAt: 2,
        },
        events: [],
      },
    ];
    const runtime = {
      findByParentSessionId: vi.fn().mockResolvedValue(snapshots),
    };
    const controller = new AgentFlowRunsController(runtime as unknown as AgentFlowRuntimeService);
    const parentListApi = controller as unknown as {
      find(parentSessionId?: string): Promise<typeof snapshots>;
    };

    await expect(parentListApi.find('parent-1')).resolves.toEqual(snapshots);
    expect(runtime.findByParentSessionId).toHaveBeenCalledWith('parent-1');
  });

  it('exposes all AgentFlow runs so readiness checks can detect stale running work', async () => {
    const snapshots = [
      {
        run: {
          id: 'run-stale-check',
          parentSessionId: 'parent-1',
          childSessionId: 'child-1',
          flowDefinitionId: 'goal_guard_delivery_loop',
          status: 'running' as const,
          startMode: 'durable' as const,
          returnMode: 'summary' as const,
          createdAt: 1,
          updatedAt: 2,
        },
        events: [],
      },
    ];
    const runtime = {
      findAll: vi.fn().mockResolvedValue(snapshots),
    };
    const controller = new AgentFlowRunsController(runtime as unknown as AgentFlowRuntimeService);
    const listApi = controller as unknown as {
      find(parentSessionId?: string): Promise<typeof snapshots>;
    };

    await expect(listApi.find()).resolves.toEqual(snapshots);
    expect(runtime.findAll).toHaveBeenCalledOnce();
  });

  it('returns not found when snapshot is missing', async () => {
    const runtime = {
      getSnapshot: vi.fn().mockResolvedValue(null),
    };
    const controller = new AgentFlowRunsController(runtime as unknown as AgentFlowRuntimeService);

    await expect(controller.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

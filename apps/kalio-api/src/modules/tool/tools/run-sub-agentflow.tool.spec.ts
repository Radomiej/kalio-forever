import { describe, expect, it, vi } from 'vitest';
import type { ModuleRef } from '@nestjs/core';
import { TOOL_METADATA } from '../../../common/decorators/tool.decorator';
import { RunSubAgentFlowTool } from './run-sub-agentflow.tool';
import { AGENT_FLOW_RUNTIME, type AgentFlowRuntimePort } from '../../agent-flow/agent-flow-runtime.port';
import { AgentFlowRuntimeService } from '../../agent-flow/agent-flow-runtime.service';
import { AgentFlowRunRepository } from '../../agent-flow/agent-flow-run.repository';
import type { ToolCallRequest } from '@kalio/types';

function request(args: ToolCallRequest['args']): ToolCallRequest {
  return {
    sessionId: 'real-parent',
    toolName: 'run_sub_agentflow',
    callId: 'call-1',
    args,
  };
}

function runtime(): AgentFlowRuntimePort {
  return {
    run: vi.fn().mockResolvedValue({
      flowRunId: 'flow-1',
      childSessionId: 'child-1',
      status: 'done',
      summary: 'done',
      decisions: [],
      nextActions: [],
      artifacts: [],
    }),
    start: vi.fn().mockResolvedValue({
      run: {
        id: 'flow-1',
        parentSessionId: 'real-parent',
        childSessionId: 'child-1',
        openChatSessionId: 'child-1',
        openGraphRunId: 'flow-1',
        flowDefinitionId: 'goal_guard_delivery_loop',
        status: 'running',
        startMode: 'durable',
        returnMode: 'summary',
        createdAt: 1,
        updatedAt: 1,
      },
      result: {
        flowRunId: 'flow-1',
        childSessionId: 'child-1',
        openChatSessionId: 'child-1',
        openGraphRunId: 'flow-1',
        status: 'running',
        summary: 'AgentFlow goal_guard_delivery_loop started.',
        decisions: [],
        nextActions: ['Open the child AgentFlow graph to monitor completion.'],
        artifacts: [],
      },
      events: [],
    }),
  };
}

function moduleRef(agentFlowRuntime: AgentFlowRuntimePort): ModuleRef {
  return {
    get: vi.fn().mockImplementation((token: unknown) => {
      if (token === AGENT_FLOW_RUNTIME) return agentFlowRuntime;
      throw new Error('unexpected token');
    }),
  } as unknown as ModuleRef;
}

describe('RunSubAgentFlowTool', () => {
  it('registers as a confirmation-gated native tool', () => {
    const metadata = Reflect.getMetadata(TOOL_METADATA, RunSubAgentFlowTool);
    expect(metadata).toMatchObject({
      name: 'run_sub_agentflow',
      requiresConfirmation: true,
    });
    expect(metadata.parameters.required).toEqual(['flowId', 'goal']);
  });

  it('injects parentSessionId from ToolCallRequest instead of trusting args', async () => {
    const agentFlowRuntime = runtime();
    const tool = new RunSubAgentFlowTool(moduleRef(agentFlowRuntime));

    await tool.execute(request({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement',
      parentSessionId: 'spoofed-parent',
    }));

    expect(agentFlowRuntime.start).toHaveBeenCalledWith(expect.objectContaining({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement',
      parentSessionId: 'real-parent',
      parentToolCallId: 'call-1',
      startMode: 'durable',
      vfsMode: 'isolated',
      copyBack: false,
      returnMode: 'summary',
    }));
    expect(agentFlowRuntime.run).not.toHaveBeenCalled();
  });

  it('starts durable AgentFlows through the canonical runtime start path', async () => {
    const agentFlowRuntime = runtime();
    const tool = new RunSubAgentFlowTool(moduleRef(agentFlowRuntime));

    const result = await tool.execute(request({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Implement with Goal Guard',
      startMode: 'durable',
    }));

    expect(agentFlowRuntime.start).toHaveBeenCalledTimes(1);
    expect(agentFlowRuntime.run).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      flowRunId: 'flow-1',
      childSessionId: 'child-1',
      openChatSessionId: 'child-1',
      openGraphRunId: 'flow-1',
      status: 'running',
    });
  });

  it('RED: rejects empty request session ids before launching an orphaned AgentFlow', async () => {
    const agentFlowRuntime = runtime();
    const tool = new RunSubAgentFlowTool(moduleRef(agentFlowRuntime));
    const orphanedRequest = {
      ...request({
        flowId: 'goal_guard_delivery_loop',
        goal: 'Implement',
      }),
      sessionId: '',
    };

    await expect(tool.execute(orphanedRequest)).rejects.toThrow('INVALID_PARENT_SESSION_ID');
    expect(agentFlowRuntime.run).not.toHaveBeenCalled();
    expect(agentFlowRuntime.start).not.toHaveBeenCalled();
  });

  it('validates required arguments before calling runtime', async () => {
    const agentFlowRuntime = runtime();
    const tool = new RunSubAgentFlowTool(moduleRef(agentFlowRuntime));

    await expect(tool.execute(request({ flowId: '', goal: 'Build' }))).rejects.toThrow('INVALID_FLOWID');
    await expect(tool.execute(request({ flowId: 'goal_guard_delivery_loop', goal: '' }))).rejects.toThrow('INVALID_GOAL');
    expect(agentFlowRuntime.run).not.toHaveBeenCalled();
    expect(agentFlowRuntime.start).not.toHaveBeenCalled();
  });

  it('validates option arguments and caps maxSteps', async () => {
    const agentFlowRuntime = runtime();
    const tool = new RunSubAgentFlowTool(moduleRef(agentFlowRuntime));

    await expect(tool.execute(request({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Build',
      returnMode: 'raw',
    }))).rejects.toThrow('INVALID_RETURN_MODE');
    await expect(tool.execute(request({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Build',
      startMode: 'single_pass',
    }))).rejects.toThrow('INVALID_START_MODE');
    await expect(tool.execute(request({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Build',
      maxSteps: 0,
    }))).rejects.toThrow('INVALID_MAX_STEPS');

    await tool.execute(request({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Build',
      vfsMode: 'shared',
      startMode: 'blocking',
      copyBack: true,
      returnMode: 'full_trace',
      maxSteps: 500,
    }));

    expect(agentFlowRuntime.run).toHaveBeenCalledWith(expect.objectContaining({
      vfsMode: 'shared',
      startMode: 'blocking',
      copyBack: true,
      returnMode: 'full_trace',
      maxSteps: 50,
    }));
    expect(agentFlowRuntime.start).not.toHaveBeenCalled();
  });

  it('copies isolated blocking AgentFlow artifacts back when requested through the tool entrypoint', async () => {
    const adapter = {
      run: vi.fn().mockResolvedValue({
        flowRunId: 'flow-copy',
        childSessionId: 'child-copy',
        status: 'done',
        summary: 'done',
        decisions: [],
        nextActions: [],
        artifacts: [],
        tracePreview: [
          {
            id: 'event-final',
            sequence: 1,
            type: 'flow:final_artifact',
            message: 'done',
            status: 'done',
            createdAt: 1,
          },
        ],
        openChatSessionId: 'child-copy',
        openGraphRunId: 'flow-copy',
      }),
    };
    const repository = new AgentFlowRunRepository();
    const vfs = {
      copySessionFiles: vi.fn(() => [
        {
          fromSessionId: 'child-copy',
          toSessionId: 'real-parent',
          fromPath: 'dist/index.html',
          toPath: 'agent-flows/flow-copy/dist/index.html',
        },
      ]),
    };
    const agentFlowRuntime = new AgentFlowRuntimeService(
      adapter as unknown as ConstructorParameters<typeof AgentFlowRuntimeService>[0],
      repository,
      vfs as unknown as ConstructorParameters<typeof AgentFlowRuntimeService>[2],
    );
    const tool = new RunSubAgentFlowTool(moduleRef(agentFlowRuntime));

    const result = await tool.execute(request({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Build artifacts',
      startMode: 'blocking',
      vfsMode: 'isolated',
      copyBack: true,
    }));

    expect(adapter.run).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionId: 'real-parent',
      parentToolCallId: 'call-1',
      vfsMode: 'isolated',
      copyBack: true,
      startMode: 'blocking',
    }));
    expect(vfs.copySessionFiles).toHaveBeenCalledWith({
      fromSessionId: 'child-copy',
      toSessionId: 'real-parent',
      targetPrefix: 'agent-flows/flow-copy',
    });
    expect(result.artifacts).toEqual(['agent-flows/flow-copy/dist/index.html']);
    expect(repository.getSnapshot('flow-copy')?.events.at(-1)).toMatchObject({
      type: 'flow:copy_back',
      status: 'done',
    });
  });

  it('rejects when the AgentFlow runtime is unavailable', async () => {
    const tool = new RunSubAgentFlowTool({
      get: vi.fn().mockImplementation(() => {
        throw new Error('runtime missing');
      }),
    } as unknown as ModuleRef);

    await expect(tool.execute(request({
      flowId: 'goal_guard_delivery_loop',
      goal: 'Build',
    }))).rejects.toThrow('AgentFlow runtime is unavailable');
  });
});

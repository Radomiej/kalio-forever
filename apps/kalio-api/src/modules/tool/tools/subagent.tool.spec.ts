import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageSubagentTool, SpawnSubagentTool, SubagentTool } from './subagent.tool';
import type { ModuleRef } from '@nestjs/core';
import type { AgentRunContext, ToolCallRequest, ToolMeta } from '@kalio/types';
import { SUBAGENT_RUNTIME } from '../subagent-runtime.port';

function makeRequest(args: Record<string, unknown> = {}, sessionId = 'sess-sub'): ToolCallRequest {
  return { callId: 'call-1', sessionId, toolName: 'run_subagent', args };
}

function makeTool(name: string): ToolMeta {
  return {
    name,
    description: `${name} description`,
    parameters: { type: 'object' },
    requiresConfirmation: false,
  };
}

function makeRegistryMock(tools: ToolMeta[] = []) {
  return {
    getAllTools: vi.fn().mockReturnValue(tools),
    getToolsForSkills: vi.fn().mockReturnValue(tools),
  };
}

describe('SubagentTool', () => {
  let tool: SubagentTool;
  let moduleRef: Partial<ModuleRef>;
  let registry: ReturnType<typeof makeRegistryMock>;
  let runtime: { runSubagent: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    registry = makeRegistryMock([makeTool('vfs_read'), makeTool('vfs_write')]);
    runtime = {
      runSubagent: vi.fn().mockResolvedValue({
        result: 'runtime result',
        taskId: 'task-1',
        childSessionId: 'sub-runtime',
        parentSessionId: 'sess-sub',
        vfsMode: 'isolated',
        vfsSessionId: 'sub-runtime',
        copiedFiles: [],
        durationMs: 12,
      }),
    };

    moduleRef = {
      get: vi.fn().mockImplementation((token: unknown) => {
        if (token === SUBAGENT_RUNTIME) return runtime;
        return registry;
      }),
    };

    tool = new SubagentTool(moduleRef as ModuleRef);
  });

  it('forwards childSessionId to the runtime so the master can continue an existing subagent chat', async () => {
    runtime.runSubagent.mockResolvedValue({
      result: 'follow-up reply',
      taskId: 'task-1',
      childSessionId: 'sub-existing',
      parentSessionId: 'master-session',
      vfsMode: 'isolated',
      vfsSessionId: 'sub-existing',
      copiedFiles: [],
      durationMs: 12,
    });

    const result = await tool.execute(
      makeRequest({ objective: 'Refine the page', childSessionId: 'sub-existing' }, 'master-session'),
    );

    expect(runtime.runSubagent).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionId: 'master-session',
      objective: 'Refine the page',
      childSessionId: 'sub-existing',
    }));
    expect(result.childSessionId).toBe('sub-existing');
    expect(result.result).toBe('follow-up reply');
  });

  it('forwards the resolved tool list and execution options into the runtime', async () => {
    await tool.execute(makeRequest({
      objective: 'What is 6 times 7?',
      availableTools: ['vfs_read', 'vfs_write'],
      timeoutMs: 999_999,
      vfsMode: 'shared',
      copyOutputs: false,
      personaId: 'dev',
      childSessionId: 'sub-existing',
    }, 'master-session'));

    expect(runtime.runSubagent).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionId: 'master-session',
      objective: 'What is 6 times 7?',
      childSessionId: 'sub-existing',
      personaId: 'dev',
      timeoutMs: 180000,
      vfsMode: 'shared',
      copyOutputs: false,
      availableTools: [
        expect.objectContaining({ name: 'vfs_read' }),
        expect.objectContaining({ name: 'vfs_write' }),
      ],
    }));
  });

  it('returns the runtime result verbatim', async () => {
    runtime.runSubagent.mockResolvedValue({
      result: 'done',
      taskId: 'task-xyz',
      childSessionId: 'sub-xyz',
      parentSessionId: 'master-session',
      vfsMode: 'isolated',
      vfsSessionId: 'sub-xyz',
      copiedFiles: [],
      durationMs: 33,
    });

    const result = await tool.execute(makeRequest({ objective: 'create a test site' }, 'master-session'));

    expect(result).toEqual({
      result: 'done',
      taskId: 'task-xyz',
      childSessionId: 'sub-xyz',
      parentSessionId: 'master-session',
      vfsMode: 'isolated',
      vfsSessionId: 'sub-xyz',
      copiedFiles: [],
      durationMs: 33,
    });
  });

  it('passes request emit and agentRun through to the runtime', async () => {
    const emit = vi.fn();
    const agentRun: AgentRunContext = { agentRunId: 'run-parent', agentType: 'subagent' };

    await tool.execute({
      ...makeRequest({ objective: 'greet' }, 'sess-parent'),
      _emit: emit,
      agentRun,
    });

    expect(runtime.runSubagent).toHaveBeenCalledWith(expect.objectContaining({
      emit,
      parentAgentRun: agentRun,
    }));
  });

  it('calls getAllTools when no availableTools are provided', async () => {
    await tool.execute(makeRequest({ objective: 'task' }));

    expect(registry.getAllTools).toHaveBeenCalled();
    expect(registry.getToolsForSkills).not.toHaveBeenCalled();
  });

  it('calls getToolsForSkills when availableTools list is provided', async () => {
    await tool.execute(
      makeRequest({ objective: 'task', availableTools: ['vfs_read', 'vfs_write'] }),
    );

    expect(registry.getToolsForSkills).toHaveBeenCalledWith(['vfs_read', 'vfs_write']);
    expect(registry.getAllTools).not.toHaveBeenCalled();
  });

  it('works with the public ToolRegistryService API that exposes getEntries()', async () => {
    const entry = {
      meta: makeTool('vfs_read'),
      execute: vi.fn().mockResolvedValue({}),
    };

    moduleRef = {
      get: vi.fn().mockImplementation((token: unknown) => {
        if (token === SUBAGENT_RUNTIME) return runtime;
        return {
          getEntries: vi.fn().mockReturnValue([entry]),
        };
      }),
    };
    tool = new SubagentTool(moduleRef as ModuleRef);

    await expect(tool.execute(makeRequest({ objective: 'task' }))).resolves.toMatchObject({
      result: 'runtime result',
    });

    expect(runtime.runSubagent).toHaveBeenCalledWith(expect.objectContaining({
      availableTools: [entry.meta],
    }));
  });

  it('caps timeoutMs at 180000 before calling the runtime', async () => {
    await tool.execute(makeRequest({ objective: 'test cap', timeoutMs: 999_999_999 }));

    expect(runtime.runSubagent).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 180000 }));
  });

  it('uses empty availableTools list correctly (falls back to getAllTools)', async () => {
    await tool.execute(makeRequest({ objective: 'task', availableTools: [] }));

    expect(registry.getAllTools).toHaveBeenCalled();
  });

  it('resolves registry when moduleRef.get is called with class token instead of a string token', async () => {
    const stringRejectingModuleRef = {
      get: vi.fn().mockImplementation((token: unknown) => {
        if (typeof token === 'string') {
          throw new Error(
            `Nest could not find ${String(token)} element (this provider does not exist in the current context)`,
          );
        }
        if (token === SUBAGENT_RUNTIME) return runtime;
        return registry;
      }),
    };
    const toolWithClassToken = new SubagentTool(
      stringRejectingModuleRef as unknown as ModuleRef,
    );

    await expect(
      toolWithClassToken.execute(makeRequest({ objective: 'task' })),
    ).resolves.toBeDefined();
  });

  it('calls moduleRef.get with a class token and { strict: false }', async () => {
    await tool.execute(makeRequest({ objective: 'task' }));

    expect(moduleRef.get).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ strict: false }),
    );
  });

  it('rejects when the runtime is unavailable instead of silently falling back to direct LLM streaming', async () => {
    moduleRef = {
      get: vi.fn().mockImplementation((token: unknown) => {
        if (token === SUBAGENT_RUNTIME) {
          throw new Error('runtime missing');
        }
        return registry;
      }),
    };
    tool = new SubagentTool(moduleRef as ModuleRef);

    await expect(tool.execute(makeRequest({ objective: 'task' }))).rejects.toThrow(
      'Subagent runtime is unavailable',
    );
  });

  it('propagates runtime errors', async () => {
    runtime.runSubagent.mockRejectedValue(new Error('SUBAGENT_FAILED'));

    await expect(tool.execute(makeRequest({ objective: 'failing task' }))).rejects.toThrow('SUBAGENT_FAILED');
  });
});

describe('SpawnSubagentTool', () => {
  it('delegates to run_subagent semantics without forwarding childSessionId', async () => {
    const subagentTool = {
      execute: vi.fn().mockResolvedValue({ result: 'spawned', childSessionId: 'sub-new' }),
    } as unknown as SubagentTool;
    const tool = new SpawnSubagentTool(subagentTool);

    await tool.execute(makeRequest({ objective: 'Draft a landing page', childSessionId: 'sub-old' }, 'master-session'));

    expect(subagentTool.execute).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'run_subagent',
      sessionId: 'master-session',
      args: expect.objectContaining({ objective: 'Draft a landing page' }),
    }));
    expect(subagentTool.execute).toHaveBeenCalledWith(expect.not.objectContaining({
      args: expect.objectContaining({ childSessionId: expect.anything() }),
    }));
  });
});

describe('MessageSubagentTool', () => {
  it('requires childSessionId and forwards it into run_subagent semantics', async () => {
    const subagentTool = {
      execute: vi.fn().mockResolvedValue({ result: 'continued', childSessionId: 'sub-existing' }),
    } as unknown as SubagentTool;
    const tool = new MessageSubagentTool(subagentTool);

    await tool.execute(makeRequest({ objective: 'Refine the existing page', childSessionId: 'sub-existing' }, 'master-session'));

    expect(subagentTool.execute).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'run_subagent',
      args: expect.objectContaining({
        objective: 'Refine the existing page',
        childSessionId: 'sub-existing',
      }),
    }));
  });

  it('throws when childSessionId is missing', async () => {
    const subagentTool = {
      execute: vi.fn(),
    } as unknown as SubagentTool;
    const tool = new MessageSubagentTool(subagentTool);

    await expect(tool.execute(makeRequest({ objective: 'Continue working' }, 'master-session'))).rejects.toThrow(
      'message_subagent requires childSessionId',
    );
    expect(subagentTool.execute).not.toHaveBeenCalled();
  });
});

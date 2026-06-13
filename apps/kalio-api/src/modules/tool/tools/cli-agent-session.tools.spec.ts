import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ToolCallRequest } from '@kalio/types';
import type { AllowedPathsService } from '../../allowed-paths/allowed-paths.service';
import type { CLIAgentService } from '../../cli-agent/cli-agent.service';
import type { CLIAgentSessionRuntimeService } from '../../cli-agent/cli-agent-session-runtime.service';
import {
  GetCliAgentStatusTool,
  MessageCliAgentTool,
  SpawnCliAgentTool,
  StopCliAgentTool,
} from './cli-agent-session.tools';
import { TOOL_METADATA } from '../../../common/decorators/tool.decorator';

function makeRequest(
  toolName: string,
  args: Record<string, unknown>,
  emit: ToolCallRequest['_emit'] = vi.fn(),
): ToolCallRequest {
  return {
    callId: 'call-cli-tools',
    sessionId: 'sess-parent',
    toolName,
    args,
    _emit: emit,
  };
}

function makeAllowedPaths(isAllowed: boolean): AllowedPathsService {
  return { isAllowed: vi.fn().mockResolvedValue(isAllowed) } as unknown as AllowedPathsService;
}

function makeCLIAgentService(available = true): CLIAgentService {
  return {
    listAll: vi.fn().mockResolvedValue([
      { id: 'copilot', displayName: 'Copilot CLI', available },
      { id: 'codex', displayName: 'Codex CLI', available },
    ]),
  } as unknown as CLIAgentService;
}

function makeRuntime(): CLIAgentSessionRuntimeService {
  return {
    spawnSession: vi.fn().mockResolvedValue({
      childSessionId: 'cli-child-1',
      parentSessionId: 'sess-parent',
      agentId: 'codex',
      workdir: 'C:/repo',
      status: 'running',
      lastPrompt: 'Inspect repository',
      updatedAt: 10,
      startedAt: 10,
      activeCallId: 'cli-run-1',
      lastOutput: '',
    }),
    continueSession: vi.fn().mockResolvedValue({
      childSessionId: 'cli-child-1',
      parentSessionId: 'sess-parent',
      agentId: 'codex',
      workdir: 'C:/repo',
      status: 'running',
      lastPrompt: 'Continue with tests',
      updatedAt: 20,
      startedAt: 20,
      activeCallId: 'cli-run-2',
      lastOutput: 'running',
    }),
    getStatus: vi.fn().mockResolvedValue({
      childSessionId: 'cli-child-1',
      parentSessionId: 'sess-parent',
      agentId: 'codex',
      workdir: 'C:/repo',
      status: 'running',
      lastPrompt: 'Inspect repository',
      updatedAt: 10,
      startedAt: 10,
      activeCallId: 'cli-run-1',
      lastOutput: 'partial output',
    }),
    stopSession: vi.fn().mockResolvedValue({
      childSessionId: 'cli-child-1',
      parentSessionId: 'sess-parent',
      agentId: 'codex',
      workdir: 'C:/repo',
      status: 'stopped',
      lastPrompt: 'Inspect repository',
      updatedAt: 30,
      startedAt: 10,
      completedAt: 30,
      activeCallId: undefined,
      lastOutput: 'stopped',
    }),
  } as unknown as CLIAgentSessionRuntimeService;
}

describe('CLI agent session tool metadata', () => {
  const reflector = new Reflector();

  it('publishes orchestrator-facing CLI session tools', () => {
    const spawnMeta = reflector.get(TOOL_METADATA, SpawnCliAgentTool);
    const messageMeta = reflector.get(TOOL_METADATA, MessageCliAgentTool);
    const statusMeta = reflector.get(TOOL_METADATA, GetCliAgentStatusTool);
    const stopMeta = reflector.get(TOOL_METADATA, StopCliAgentTool);

    expect(spawnMeta.name).toBe('spawn_cli_agent');
    expect(messageMeta.name).toBe('message_cli_agent');
    expect(statusMeta.name).toBe('get_cli_agent_status');
    expect(stopMeta.name).toBe('stop_cli_agent');
  });
});

describe('CLI agent session tools', () => {
  let allowedPaths: AllowedPathsService;
  let cliAgent: CLIAgentService;
  let runtime: CLIAgentSessionRuntimeService;

  beforeEach(() => {
    vi.clearAllMocks();
    allowedPaths = makeAllowedPaths(true);
    cliAgent = makeCLIAgentService(true);
    runtime = makeRuntime();
  });

  it('spawn_cli_agent starts a background child session for the orchestrator and returns live status', async () => {
    const tool = new SpawnCliAgentTool(allowedPaths, cliAgent, runtime);

    const result = await tool.execute(makeRequest('spawn_cli_agent', {
      prompt: 'Inspect repository',
      workdir: 'C:/repo',
      agentId: 'codex',
      expectedChangedFiles: ['README.md'],
      verificationCommands: ['pnpm test'],
    }));

    expect(runtime.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionId: 'sess-parent',
      prompt: 'Inspect repository',
      workdir: 'C:/repo',
      agentId: 'codex',
      acceptanceHints: {
        expectedChangedFiles: ['README.md'],
        verificationCommands: ['pnpm test'],
      },
    }));
    expect(runtime.spawnSession).toHaveBeenCalledWith(expect.objectContaining({
      emit: expect.any(Function),
    }));
    expect(result).toMatchObject({
      childSessionId: 'cli-child-1',
      status: 'running',
      activeCallId: 'cli-run-1',
    });
  });

  it('spawn_cli_agent fails before creating a child session when the selected CLI agent is unavailable', async () => {
    cliAgent = makeCLIAgentService(false);
    const tool = new SpawnCliAgentTool(allowedPaths, cliAgent, runtime);

    await expect(tool.execute(makeRequest('spawn_cli_agent', {
      prompt: 'Inspect repository',
      workdir: 'C:/repo',
      agentId: 'codex',
    }))).rejects.toThrow('CLI_AGENT_UNAVAILABLE');

    expect(runtime.spawnSession).not.toHaveBeenCalled();
  });

  it('message_cli_agent does not interrupt an active CLI child unless explicitly requested', async () => {
    const tool = new MessageCliAgentTool(runtime);

    await tool.execute(makeRequest('message_cli_agent', {
      childSessionId: 'cli-child-1',
      prompt: 'Check status and continue when ready',
    }));

    expect(runtime.continueSession).toHaveBeenCalledWith(expect.objectContaining({
      interruptRunning: false,
    }));
  });

  it('message_cli_agent continues an existing child session instead of creating a new one', async () => {
    const tool = new MessageCliAgentTool(runtime);

    const result = await tool.execute(makeRequest('message_cli_agent', {
      childSessionId: 'cli-child-1',
      prompt: 'Continue with tests',
      interruptRunning: true,
      expectedChangedFiles: ['src/App.tsx'],
    }));

    expect(runtime.continueSession).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionId: 'sess-parent',
      childSessionId: 'cli-child-1',
      prompt: 'Continue with tests',
      interruptRunning: true,
      acceptanceHints: {
        expectedChangedFiles: ['src/App.tsx'],
      },
    }));
    expect(result).toMatchObject({
      childSessionId: 'cli-child-1',
      status: 'running',
      activeCallId: 'cli-run-2',
    });
  });

  it('get_cli_agent_status returns the current runtime snapshot for an existing child session', async () => {
    const tool = new GetCliAgentStatusTool(runtime);

    const result = await tool.execute(makeRequest('get_cli_agent_status', {
      childSessionId: 'cli-child-1',
    }));

    expect(runtime.getStatus).toHaveBeenCalledWith('sess-parent', 'cli-child-1');
    expect(result).toMatchObject({
      childSessionId: 'cli-child-1',
      status: 'running',
      lastOutput: 'partial output',
    });
  });

  it('stop_cli_agent interrupts the current child runtime and returns the settled state', async () => {
    const tool = new StopCliAgentTool(runtime);

    const result = await tool.execute(makeRequest('stop_cli_agent', {
      childSessionId: 'cli-child-1',
    }));

    expect(runtime.stopSession).toHaveBeenCalledWith('sess-parent', 'cli-child-1', expect.any(Function));
    expect(result).toMatchObject({
      childSessionId: 'cli-child-1',
      status: 'stopped',
    });
  });

  it('spawn_cli_agent rejects workdirs outside AllowedPaths', async () => {
    allowedPaths = makeAllowedPaths(false);
    const tool = new SpawnCliAgentTool(allowedPaths, cliAgent, runtime);

    await expect(tool.execute(makeRequest('spawn_cli_agent', {
      prompt: 'Inspect repository',
      workdir: 'C:/repo',
    }))).rejects.toThrow('ACCESS_DENIED');
    expect(runtime.spawnSession).not.toHaveBeenCalled();
  });
});

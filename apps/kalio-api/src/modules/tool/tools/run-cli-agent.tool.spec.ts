import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Reflector } from '@nestjs/core';
import { RunCliAgentTool } from './run-cli-agent.tool';
import type { AllowedPathsService } from '../../allowed-paths/allowed-paths.service';
import type { CLIAgentService } from '../../cli-agent/cli-agent.service';
import type { CLIAgentSessionService } from '../../cli-agent/cli-agent-session.service';
import type { RunCliAgentRequest } from '../../cli-agent/cli-agent.types';
import type { ToolCallRequest } from '@kalio/types';
import { TOOL_METADATA } from '../../../common/decorators/tool.decorator';

function makeRequest(args: Record<string, unknown>): ToolCallRequest {
  return { callId: 'call-cli', sessionId: 'sess-1', toolName: 'run_cli_agent', args };
}

function makeAllowedPaths(isAllowed: boolean): AllowedPathsService {
  return { isAllowed: vi.fn().mockResolvedValue(isAllowed) } as unknown as AllowedPathsService;
}

function makeCLIAgentService(result?: Partial<{ output: string; exitCode: number; durationMs: number; agentId: string }>): CLIAgentService {
  const defaults = { output: '', exitCode: 0, durationMs: 100, agentId: 'copilot' };
  return {
    getAdapter: vi.fn().mockReturnValue({ displayName: 'Copilot CLI' }),
    run: vi.fn().mockResolvedValue({ ...defaults, ...result }),
  } as unknown as CLIAgentService;
}

function makeCLIAgentSessions(): CLIAgentSessionService {
  return {
    createChildSession: vi.fn().mockResolvedValue({
      id: 'cli-child-1',
      personaId: 'default',
      title: 'Copilot CLI',
      kind: 'cli-agent',
      parentSessionId: 'sess-1',
      parentToolCallId: 'call-cli',
      createdAt: 1,
      updatedAt: 1,
    }),
    persistUserMessage: vi.fn().mockResolvedValue(undefined),
    saveToolResult: vi.fn().mockResolvedValue(undefined),
  } as unknown as CLIAgentSessionService;
}

describe('RunCliAgentTool metadata', () => {
  const reflector = new Reflector();

  it('publishes codex in the agentId enum (REGRESSION)', () => {
    const metadata = reflector.get(TOOL_METADATA, RunCliAgentTool);

    expect(metadata.parameters.properties.agentId.enum).toContain('codex');
  });
});

describe('RunCliAgentTool', () => {
  let tool: RunCliAgentTool;
  let allowedPaths: AllowedPathsService;
  let cliAgent: CLIAgentService;
  let cliAgentSessions: CLIAgentSessionService;

  beforeEach(() => {
    vi.clearAllMocks();
    allowedPaths = makeAllowedPaths(true);
    cliAgent = makeCLIAgentService();
    cliAgentSessions = makeCLIAgentSessions();
    tool = new RunCliAgentTool(allowedPaths, cliAgent, cliAgentSessions);
  });

  it('throws if workdir is not in AllowedPaths', async () => {
    allowedPaths = makeAllowedPaths(false);
    tool = new RunCliAgentTool(allowedPaths, cliAgent, cliAgentSessions);

    await expect(
      tool.execute(makeRequest({ prompt: 'do something', workdir: '/not/allowed' })),
    ).rejects.toThrow('ACCESS_DENIED');
  });

  it('defaults agentId to "copilot" when not provided', async () => {
    await tool.execute(makeRequest({ prompt: 'task', workdir: '/projects/app' }));

    expect(cliAgent.run).toHaveBeenCalledWith(
      expect.objectContaining<Partial<RunCliAgentRequest>>({
        agentId: 'copilot',
        prompt: 'task',
        workdir: '/projects/app',
        callId: 'call-cli',
        sessionId: 'cli-child-1',
        timeoutMs: 600_000,
      }),
    );
  });

  it('passes explicit agentId through to CLIAgentService', async () => {
    await tool.execute(makeRequest({ prompt: 'task', workdir: '/projects/app', agentId: 'gemini' }));

    expect(cliAgent.run).toHaveBeenCalledWith(
      expect.objectContaining<Partial<RunCliAgentRequest>>({ agentId: 'gemini' }),
    );
  });

  it('passes explicit codex agentId through to CLIAgentService (REGRESSION)', async () => {
    await tool.execute(makeRequest({ prompt: 'task', workdir: '/projects/app', agentId: 'codex' }));

    expect(cliAgent.run).toHaveBeenCalledWith(
      expect.objectContaining<Partial<RunCliAgentRequest>>({ agentId: 'codex' }),
    );
  });

  it('returns CLIAgentResult from CLIAgentService unchanged', async () => {
    cliAgent = makeCLIAgentService({ output: 'Files updated.', exitCode: 0, durationMs: 1234, agentId: 'copilot' });
    tool = new RunCliAgentTool(allowedPaths, cliAgent, cliAgentSessions);

    const result = await tool.execute(makeRequest({ prompt: 'do task', workdir: '/projects/app' }));

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('Files updated.');
    expect(result.durationMs).toBe(1234);
    expect(result.agentId).toBe('copilot');
  });

  it('creates a durable cli-agent child session, persists the prompt/result there, and returns childSessionId', async () => {
    const emitFn = vi.fn();
    const req: ToolCallRequest = {
      ...makeRequest({ prompt: 'do task', workdir: '/projects/app', agentId: 'codex' }),
      _emit: emitFn,
    };

    const result = await tool.execute(req);

    expect(cliAgentSessions.createChildSession).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionId: 'sess-1',
      parentToolCallId: 'call-cli',
      agentId: 'codex',
    }));
    expect(emitFn).toHaveBeenCalledWith('session:created', expect.objectContaining({
      id: 'cli-child-1',
      kind: 'cli-agent',
      parentSessionId: 'sess-1',
    }));
    expect(cliAgentSessions.persistUserMessage).toHaveBeenCalledWith('cli-child-1', 'do task');
    expect(cliAgent.run).toHaveBeenCalledWith(expect.objectContaining<Partial<RunCliAgentRequest>>({
      sessionId: 'cli-child-1',
      callId: 'call-cli',
      prompt: 'do task',
      workdir: '/projects/app',
    }));
    expect(cliAgentSessions.saveToolResult).toHaveBeenCalledWith(
      'cli-child-1',
      'call-cli',
      expect.stringContaining('"output":""'),
    );
    expect(result).toMatchObject({ childSessionId: 'cli-child-1' });
  });

  it('caps timeoutMs at 1 200 000 before passing to CLIAgentService', async () => {
    await tool.execute(makeRequest({ prompt: 'task', workdir: '/projects/app', timeoutMs: 9_999_999 }));

    const request = (cliAgent.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as RunCliAgentRequest;
    expect(request.timeoutMs).toBe(1_200_000);
  });

  it('passes _emit from ToolCallRequest as progress emitter', async () => {
    const emitFn = vi.fn();
    const req: ToolCallRequest = { ...makeRequest({ prompt: 'task', workdir: '/projects/app' }), _emit: emitFn };

    await tool.execute(req);

    // The progress wrapper passed to cliAgent.run should call _emit
    const request = (cliAgent.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as RunCliAgentRequest;
    const progressFn = request.emitFn as ((event: string, data: unknown) => void) | undefined;
    expect(progressFn).toBeDefined();
    progressFn!('cli_agent:progress', { callId: 'c', sessionId: 's', agentId: 'codex', chunk: 'x' });
    expect(emitFn).toHaveBeenCalledWith('cli_agent:progress', expect.objectContaining({ chunk: 'x' }));
  });

  it.each([
    { label: 'prompt is empty', args: { prompt: '', workdir: '/projects/app' }, error: 'INVALID_PROMPT' },
    { label: 'prompt is whitespace', args: { prompt: '   ', workdir: '/projects/app' }, error: 'INVALID_PROMPT' },
    { label: 'prompt is numeric', args: { prompt: 123, workdir: '/projects/app' }, error: 'INVALID_PROMPT' },
    { label: 'workdir is whitespace', args: { prompt: 'task', workdir: '   ' }, error: 'INVALID_WORKDIR' },
    { label: 'workdir is numeric', args: { prompt: 'task', workdir: 123 }, error: 'INVALID_WORKDIR' },
    { label: 'agentId is unsupported', args: { prompt: 'task', workdir: '/projects/app', agentId: 'cursor' }, error: 'INVALID_AGENT_ID' },
    { label: 'timeout is zero', args: { prompt: 'task', workdir: '/projects/app', timeoutMs: 0 }, error: 'INVALID_TIMEOUT_MS' },
    { label: 'timeout is negative', args: { prompt: 'task', workdir: '/projects/app', timeoutMs: -1 }, error: 'INVALID_TIMEOUT_MS' },
    { label: 'timeout is fractional', args: { prompt: 'task', workdir: '/projects/app', timeoutMs: 1.5 }, error: 'INVALID_TIMEOUT_MS' },
  ])('rejects malformed input when $label (REGRESSION)', async ({ args, error }) => {
    await expect(tool.execute(makeRequest(args))).rejects.toThrow(error);
    expect(cliAgent.run).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunCliAgentTool } from './run-cli-agent.tool';
import type { AllowedPathsService } from '../../allowed-paths/allowed-paths.service';
import type { CLIAgentService } from '../../cli-agent/cli-agent.service';
import type { ToolCallRequest } from '@kalio/types';

function makeRequest(args: Record<string, unknown>): ToolCallRequest {
  return { callId: 'call-cli', sessionId: 'sess-1', toolName: 'run_cli_agent', args };
}

function makeAllowedPaths(isAllowed: boolean): AllowedPathsService {
  return { isAllowed: vi.fn().mockResolvedValue(isAllowed) } as unknown as AllowedPathsService;
}

function makeCLIAgentService(result?: Partial<{ output: string; exitCode: number; durationMs: number; agentId: string }>): CLIAgentService {
  const defaults = { output: '', exitCode: 0, durationMs: 100, agentId: 'copilot' };
  return {
    run: vi.fn().mockResolvedValue({ ...defaults, ...result }),
  } as unknown as CLIAgentService;
}

describe('RunCliAgentTool', () => {
  let tool: RunCliAgentTool;
  let allowedPaths: AllowedPathsService;
  let cliAgent: CLIAgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    allowedPaths = makeAllowedPaths(true);
    cliAgent = makeCLIAgentService();
    tool = new RunCliAgentTool(allowedPaths, cliAgent);
  });

  it('throws if workdir is not in AllowedPaths', async () => {
    allowedPaths = makeAllowedPaths(false);
    tool = new RunCliAgentTool(allowedPaths, cliAgent);

    await expect(
      tool.execute(makeRequest({ prompt: 'do something', workdir: '/not/allowed' })),
    ).rejects.toThrow('ACCESS_DENIED');
  });

  it('defaults agentId to "copilot" when not provided', async () => {
    await tool.execute(makeRequest({ prompt: 'task', workdir: '/projects/app' }));

    expect(cliAgent.run).toHaveBeenCalledWith(
      'copilot',
      'task',
      '/projects/app',
      'call-cli',
      'sess-1',
      undefined,
      600_000,
    );
  });

  it('passes explicit agentId through to CLIAgentService', async () => {
    await tool.execute(makeRequest({ prompt: 'task', workdir: '/projects/app', agentId: 'gemini' }));

    expect(cliAgent.run).toHaveBeenCalledWith(
      'gemini',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      undefined,
      expect.any(Number),
    );
  });

  it('returns CLIAgentResult from CLIAgentService unchanged', async () => {
    cliAgent = makeCLIAgentService({ output: 'Files updated.', exitCode: 0, durationMs: 1234, agentId: 'copilot' });
    tool = new RunCliAgentTool(allowedPaths, cliAgent);

    const result = await tool.execute(makeRequest({ prompt: 'do task', workdir: '/projects/app' }));

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('Files updated.');
    expect(result.durationMs).toBe(1234);
    expect(result.agentId).toBe('copilot');
  });

  it('caps timeoutMs at 1 200 000 before passing to CLIAgentService', async () => {
    await tool.execute(makeRequest({ prompt: 'task', workdir: '/projects/app', timeoutMs: 9_999_999 }));

    const call = (cliAgent.run as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    expect(call[6]).toBe(1_200_000);
  });

  it('passes _emit from ToolCallRequest as progress emitter', async () => {
    const emitFn = vi.fn();
    const req: ToolCallRequest = { ...makeRequest({ prompt: 'task', workdir: '/projects/app' }), _emit: emitFn };

    await tool.execute(req);

    // The progress wrapper passed to cliAgent.run should call _emit
    const progressFn = (cliAgent.run as ReturnType<typeof vi.fn>).mock.calls[0][5] as ((event: string, data: unknown) => void) | undefined;
    expect(progressFn).toBeDefined();
    progressFn!('cli_agent:progress', { callId: 'c', sessionId: 's', agentId: 'copilot', chunk: 'x' });
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

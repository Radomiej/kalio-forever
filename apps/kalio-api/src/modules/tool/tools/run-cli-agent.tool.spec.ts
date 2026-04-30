import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunCliAgentTool } from './run-cli-agent.tool';
import type { AllowedPathsService } from '../../allowed-paths/allowed-paths.service';
import type { ToolCallRequest } from '@kalio/types';

// We mock node:child_process at the module level
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: (fn: unknown) => fn,
}));

import { execFile } from 'node:child_process';
const execFileMock = execFile as unknown as ReturnType<typeof vi.fn>;

function makeRequest(args: Record<string, unknown>): ToolCallRequest {
  return { callId: 'call-cli', sessionId: 'sess-1', toolName: 'run_cli_agent', args };
}

function makeAllowedPaths(isAllowed: boolean): AllowedPathsService {
  return { isAllowed: vi.fn().mockResolvedValue(isAllowed) } as unknown as AllowedPathsService;
}

describe('RunCliAgentTool', () => {
  let tool: RunCliAgentTool;
  let allowedPaths: AllowedPathsService;

  beforeEach(() => {
    vi.clearAllMocks();
    allowedPaths = makeAllowedPaths(true);
    tool = new RunCliAgentTool(allowedPaths);
  });

  it('throws if workdir is not in AllowedPaths', async () => {
    allowedPaths = makeAllowedPaths(false);
    tool = new RunCliAgentTool(allowedPaths);

    await expect(
      tool.execute(makeRequest({ prompt: 'do something', workdir: '/not/allowed' })),
    ).rejects.toThrow('ACCESS_DENIED');
  });

  it('calls copilot with correct arguments', async () => {
    execFileMock.mockResolvedValue({ stdout: 'done', stderr: '' });

    await tool.execute(makeRequest({ prompt: 'add tests', workdir: '/projects/myapp' }));

    expect(execFileMock).toHaveBeenCalledWith(
      'copilot',
      ['-p', 'add tests', '--allow-all', '--add-dir', '/projects/myapp', '--silent', '--output-format', 'text'],
      expect.objectContaining({ cwd: '/projects/myapp' }),
    );
  });

  it('returns CLIAgentResult with exitCode=0 on success', async () => {
    execFileMock.mockResolvedValue({ stdout: 'Files updated successfully.', stderr: '' });

    const result = await tool.execute(makeRequest({ prompt: 'do task', workdir: '/projects/app' }));

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('Files updated successfully.');
    expect(typeof result.durationMs).toBe('number');
  });

  it('returns CLIAgentResult with non-zero exitCode on failure (does not throw)', async () => {
    const err = Object.assign(new Error('exit 1'), {
      code: 1,
      stdout: 'partial output',
      stderr: 'error detail',
      killed: false,
    });
    execFileMock.mockRejectedValue(err);

    const result = await tool.execute(makeRequest({ prompt: 'bad task', workdir: '/projects/app' }));

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('partial output');
    expect(typeof result.durationMs).toBe('number');
  });

  it('throws on timeout (does not return a result)', async () => {
    const err = Object.assign(new Error('killed'), { killed: true, code: null, stdout: '', stderr: '' });
    execFileMock.mockRejectedValue(err);

    await expect(
      tool.execute(makeRequest({ prompt: 'slow task', workdir: '/projects/app' })),
    ).rejects.toThrow(/timed out/i);
  });

  it('caps timeoutMs at 1200000', async () => {
    execFileMock.mockResolvedValue({ stdout: '', stderr: '' });

    await tool.execute(makeRequest({ prompt: 'task', workdir: '/projects/app', timeoutMs: 9_999_999 }));

    expect(execFileMock).toHaveBeenCalledWith(
      'copilot',
      expect.any(Array),
      expect.objectContaining({ timeout: 1_200_000 }),
    );
  });
});

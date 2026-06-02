import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSession } from '@kalio/types';
import type { AllowedPathsService } from '../allowed-paths/allowed-paths.service';
import type { CLIAgentService } from './cli-agent.service';
import type { CLIAgentConfigService } from './cli-agent-config.service';
import type { CLIAgentSessionService } from './cli-agent-session.service';
import { CLIAgentSessionRuntimeService } from './cli-agent-session-runtime.service';

const { getWorktreeStatusSummaryMock } = vi.hoisted(() => ({
  getWorktreeStatusSummaryMock: vi.fn(),
}));

vi.mock('./cli-agent-worktree-summary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cli-agent-worktree-summary')>();
  return {
    ...actual,
    getWorktreeStatusSummary: getWorktreeStatusSummaryMock,
  };
});

function makeChildSession(): ChatSession {
  return {
    id: 'cli-child-1',
    personaId: 'default',
    title: 'Codex CLI',
    kind: 'cli-agent',
    parentSessionId: 'sess-parent',
    parentToolCallId: 'call-cli-tools',
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('CLIAgentSessionRuntimeService', () => {
  let cliAgent: CLIAgentService;
  let sessions: CLIAgentSessionService;
  let allowedPaths: AllowedPathsService;
  let config: CLIAgentConfigService;

  beforeEach(() => {
    getWorktreeStatusSummaryMock.mockReset();
    getWorktreeStatusSummaryMock.mockResolvedValue(null);

    cliAgent = {
      isRunning: vi.fn().mockReturnValue(false),
      run: vi.fn(),
      stop: vi.fn(),
    } as unknown as CLIAgentService;

    sessions = {
      getChildSession: vi.fn().mockResolvedValue(makeChildSession()),
      loadSessionMetadata: vi.fn().mockResolvedValue({ agentId: 'codex', workdir: 'C:/repo' }),
      listMessages: vi.fn().mockResolvedValue([]),
      persistUserMessage: vi.fn(),
      persistAssistantToolCallMessage: vi.fn(),
      persistAssistantMessage: vi.fn(),
      saveToolResult: vi.fn(),
      createChildSession: vi.fn(),
      saveSessionMetadata: vi.fn(),
      loadLatestToolResult: vi.fn(),
    } as unknown as CLIAgentSessionService;

    allowedPaths = {
      isAllowed: vi.fn().mockResolvedValue(false),
    } as unknown as AllowedPathsService;

    config = {
      getConfig: vi.fn().mockResolvedValue({
        enabled: true,
        cliPath: '',
        timeoutMs: 900_000,
        hardTimeoutEnabled: false,
        hardTimeoutMs: 3_600_000,
        autoRecoveryEnabled: false,
        autoRecoveryPrompt: 'continue',
        maxOutputChars: 16_000,
        model: '',
        architecturePreference: '',
        extraArgs: [],
      }),
    } as unknown as CLIAgentConfigService;
  });

  it('rejects continueSession when the stored workdir is no longer allowed', async () => {
    const service = new CLIAgentSessionRuntimeService(cliAgent, sessions, allowedPaths, config);

    await expect(service.continueSession({
      parentSessionId: 'sess-parent',
      childSessionId: 'cli-child-1',
      prompt: 'Continue with tests',
    })).rejects.toThrow('ACCESS_DENIED');

    expect(allowedPaths.isAllowed).toHaveBeenCalledWith('C:/repo');
    expect(cliAgent.run).not.toHaveBeenCalled();
    expect(sessions.listMessages).not.toHaveBeenCalled();
  });

  it('auto-recovers a durable CLI session after idle timeout when enabled', async () => {
    allowedPaths = {
      isAllowed: vi.fn().mockResolvedValue(true),
    } as unknown as AllowedPathsService;
    vi.mocked(config.getConfig).mockResolvedValue({
      enabled: true,
      cliPath: '',
      timeoutMs: 900_000,
      hardTimeoutEnabled: false,
      hardTimeoutMs: 3_600_000,
      autoRecoveryEnabled: true,
      autoRecoveryPrompt: 'continue',
      maxOutputChars: 16_000,
      model: '',
      architecturePreference: '',
      extraArgs: [],
    });
    vi.mocked(sessions.createChildSession).mockResolvedValue(makeChildSession());
    vi.mocked(cliAgent.run)
      .mockRejectedValueOnce(new Error('CLI agent "copilot" idle timed out after 900000ms'))
      .mockResolvedValueOnce({ agentId: 'copilot', output: 'done', exitCode: 0, durationMs: 10 });
    const service = new CLIAgentSessionRuntimeService(cliAgent, sessions, allowedPaths, config);

    const snapshot = await service.spawnSession({
      parentSessionId: 'sess-parent',
      parentToolCallId: 'call-cli-tools',
      prompt: 'Build the site',
      workdir: 'C:/repo',
      agentId: 'copilot',
    });

    expect(snapshot.status).toBe('running');
    await vi.waitFor(() => expect(cliAgent.run).toHaveBeenCalledTimes(2));
    expect(sessions.persistUserMessage).toHaveBeenCalledWith('cli-child-1', 'continue');
  });

  it('falls back to "continue" when auto-recovery prompt is blank', async () => {
    allowedPaths = {
      isAllowed: vi.fn().mockResolvedValue(true),
    } as unknown as AllowedPathsService;
    vi.mocked(config.getConfig).mockResolvedValue({
      enabled: true,
      cliPath: '',
      timeoutMs: 900_000,
      hardTimeoutEnabled: false,
      hardTimeoutMs: 3_600_000,
      autoRecoveryEnabled: true,
      autoRecoveryPrompt: '   ',
      maxOutputChars: 16_000,
      model: '',
      architecturePreference: '',
      extraArgs: [],
    });
    vi.mocked(sessions.createChildSession).mockResolvedValue(makeChildSession());
    vi.mocked(cliAgent.run)
      .mockRejectedValueOnce(new Error('CLI agent "copilot" idle timed out after 900000ms'))
      .mockResolvedValueOnce({ agentId: 'copilot', output: 'done', exitCode: 0, durationMs: 10 });
    const service = new CLIAgentSessionRuntimeService(cliAgent, sessions, allowedPaths, config);

    await service.spawnSession({
      parentSessionId: 'sess-parent',
      parentToolCallId: 'call-cli-tools',
      prompt: 'Build the site',
      workdir: 'C:/repo',
      agentId: 'copilot',
    });

    await vi.waitFor(() => expect(cliAgent.run).toHaveBeenCalledTimes(2));
    expect(sessions.persistUserMessage).toHaveBeenCalledWith('cli-child-1', 'continue');
  });

  it('does not auto-recover after reaching the max recovery attempts', async () => {
    allowedPaths = {
      isAllowed: vi.fn().mockResolvedValue(true),
    } as unknown as AllowedPathsService;
    vi.mocked(config.getConfig).mockResolvedValue({
      enabled: true,
      cliPath: '',
      timeoutMs: 900_000,
      hardTimeoutEnabled: false,
      hardTimeoutMs: 3_600_000,
      autoRecoveryEnabled: true,
      autoRecoveryPrompt: 'continue',
      maxOutputChars: 16_000,
      model: '',
      architecturePreference: '',
      extraArgs: [],
    });
    vi.mocked(sessions.createChildSession).mockResolvedValue(makeChildSession());
    vi.mocked(cliAgent.run)
      .mockRejectedValueOnce(new Error('CLI agent "copilot" idle timed out after 900000ms'))
      .mockRejectedValueOnce(new Error('CLI agent "copilot" idle timed out after 900000ms'))
      .mockRejectedValueOnce(new Error('CLI agent "copilot" idle timed out after 900000ms'))
      .mockRejectedValueOnce(new Error('CLI agent "copilot" idle timed out after 900000ms'));
    const service = new CLIAgentSessionRuntimeService(cliAgent, sessions, allowedPaths, config);

    await service.spawnSession({
      parentSessionId: 'sess-parent',
      parentToolCallId: 'call-cli-tools',
      prompt: 'Build the site',
      workdir: 'C:/repo',
      agentId: 'copilot',
    });

    await vi.waitFor(() => expect(cliAgent.run).toHaveBeenCalledTimes(4));
    const continuedPrompts = vi
      .mocked(sessions.persistUserMessage)
      .mock.calls.filter(([, prompt]) => prompt === 'continue');
    expect(continuedPrompts).toHaveLength(3);
  });

  it('marks a zero-exit CLI turn failed when expected changed files are missing', async () => {
    allowedPaths = {
      isAllowed: vi.fn().mockResolvedValue(true),
    } as unknown as AllowedPathsService;
    vi.mocked(sessions.createChildSession).mockResolvedValue(makeChildSession());
    vi.mocked(cliAgent.run).mockResolvedValue({
      agentId: 'gemini',
      output: 'Ready for next instruction.',
      exitCode: 0,
      durationMs: 10,
    });
    getWorktreeStatusSummaryMock.mockResolvedValue([
      'Worktree status after CLI agent: clean.',
      '',
      'Acceptance hints:',
      '- expected changed files present in worktree: 0/2',
      '- missing expected changed files: package.json, src/App.tsx',
    ].join('\n'));

    const service = new CLIAgentSessionRuntimeService(cliAgent, sessions, allowedPaths, config);

    await service.spawnSession({
      parentSessionId: 'sess-parent',
      parentToolCallId: 'call-cli-tools',
      prompt: 'Build the site',
      workdir: 'C:/repo',
      agentId: 'gemini',
      acceptanceHints: {
        expectedChangedFiles: ['package.json', 'src/App.tsx'],
      },
    });

    await vi.waitFor(() => expect(sessions.saveToolResult).toHaveBeenCalled());
    const saved = JSON.parse(vi.mocked(sessions.saveToolResult).mock.calls[0]?.[2] ?? '{}') as {
      status?: string;
      exitCode?: number;
      output?: string;
    };
    expect(saved.status).toBe('failed');
    expect(saved.exitCode).toBe(1);
    expect(saved.output).toContain('missing expected changed files: package.json, src/App.tsx');
  });
});

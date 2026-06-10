import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSession } from '@kalio/types';
import type { AllowedPathsService } from '../allowed-paths/allowed-paths.service';
import type { CLIAgentService } from './cli-agent.service';
import type { CLIAgentConfigService } from './cli-agent-config.service';
import type { CLIAgentSessionService } from './cli-agent-session.service';
import { CLIAgentSessionRuntimeService } from './cli-agent-session-runtime.service';
import { CLI_AGENT_STOPPED_ERROR } from './cli-agent.service';

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
      getAccessibleChildSession: vi.fn().mockResolvedValue(makeChildSession()),
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

  it('spawnSession emits session:created and child turn lifecycle events when emit is provided', async () => {
    allowedPaths = {
      isAllowed: vi.fn().mockResolvedValue(true),
    } as unknown as AllowedPathsService;
    vi.mocked(sessions.createChildSession).mockResolvedValue(makeChildSession());
    vi.mocked(cliAgent.run).mockResolvedValue({
      agentId: 'codex',
      output: 'build passed',
      exitCode: 0,
      durationMs: 42,
    });
    const emit = vi.fn();
    const service = new CLIAgentSessionRuntimeService(cliAgent, sessions, allowedPaths, config);

    await service.spawnSession({
      parentSessionId: 'sess-parent',
      parentToolCallId: 'call-cli-tools',
      prompt: 'Inspect repository',
      workdir: 'C:/repo',
      agentId: 'codex',
      emit,
    });

    await vi.waitFor(() => {
      expect(emit).toHaveBeenCalledWith('session:created', expect.objectContaining({ id: 'cli-child-1' }));
      expect(emit).toHaveBeenCalledWith('agent:start', expect.objectContaining({ sessionId: 'cli-child-1' }));
      expect(emit).toHaveBeenCalledWith('tool:start', expect.objectContaining({
        toolName: 'run_cli_agent',
        sessionId: 'cli-child-1',
      }));
      expect(emit).toHaveBeenCalledWith('tool:result', expect.objectContaining({ sessionId: 'cli-child-1' }));
      expect(emit).toHaveBeenCalledWith('agent:done', expect.objectContaining({ sessionId: 'cli-child-1' }));
    });
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

  it('reads CLI child status through architecture sibling sessions in the same session tree', async () => {
    vi.mocked(sessions.getAccessibleChildSession).mockResolvedValue({
      ...makeChildSession(),
      parentSessionId: 'arch-run-materializer',
    });
    vi.mocked(sessions.loadLatestToolResult).mockResolvedValue({
      id: 'tool-result-1',
      sessionId: 'cli-child-1',
      role: 'tool_result',
      toolCallId: 'cli-run-1',
      content: JSON.stringify({
        childSessionId: 'cli-child-1',
        parentSessionId: 'arch-run-materializer',
        agentId: 'codex',
        workdir: 'C:/repo',
        status: 'completed',
        lastPrompt: 'Change files',
        updatedAt: 20,
        lastOutput: 'build passed',
        lastExitCode: 0,
      }),
      createdAt: 20,
    });
    const service = new CLIAgentSessionRuntimeService(cliAgent, sessions, allowedPaths, config);

    const status = await service.getStatus('arch-run-verifier', 'cli-child-1');

    expect(sessions.getAccessibleChildSession).toHaveBeenCalledWith('arch-run-verifier', 'cli-child-1');
    expect(status).toMatchObject({
      childSessionId: 'cli-child-1',
      parentSessionId: 'arch-run-verifier',
      status: 'completed',
      lastOutput: 'build passed',
      lastExitCode: 0,
    });
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

  it('stopSession emits tool:result and agent:done when CLI run is interrupted', async () => {
    allowedPaths = {
      isAllowed: vi.fn().mockResolvedValue(true),
    } as unknown as AllowedPathsService;
    vi.mocked(sessions.createChildSession).mockResolvedValue(makeChildSession());

    let rejectRun: ((error: Error) => void) | undefined;
    vi.mocked(cliAgent.run).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRun = reject;
        }),
    );
    vi.mocked(cliAgent.stop).mockImplementation(() => {
      rejectRun?.(new Error(CLI_AGENT_STOPPED_ERROR));
      return true;
    });

    const emit = vi.fn();
    const service = new CLIAgentSessionRuntimeService(cliAgent, sessions, allowedPaths, config);

    await service.spawnSession({
      parentSessionId: 'sess-parent',
      parentToolCallId: 'call-cli-tools',
      prompt: 'Long running task',
      workdir: 'C:/repo',
      agentId: 'codex',
      emit,
    });

    await vi.waitFor(() => expect(cliAgent.run).toHaveBeenCalled());

    emit.mockClear();
    const snapshot = await service.stopSession('sess-parent', 'cli-child-1', emit);

    expect(snapshot.status).toBe('stopped');
    expect(emit).toHaveBeenCalledWith(
      'tool:result',
      expect.objectContaining({
        toolName: 'run_cli_agent',
        sessionId: 'cli-child-1',
        status: 'cancelled',
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      'agent:done',
      expect.objectContaining({ sessionId: 'cli-child-1' }),
    );
  });

  it('stopSession does not persist a stopped snapshot when cliAgent.stop returns false', async () => {
    allowedPaths = {
      isAllowed: vi.fn().mockResolvedValue(true),
    } as unknown as AllowedPathsService;
    vi.mocked(sessions.createChildSession).mockResolvedValue(makeChildSession());
    vi.mocked(cliAgent.run).mockImplementation(() => new Promise(() => {}));
    vi.mocked(cliAgent.stop).mockReturnValue(false);

    const service = new CLIAgentSessionRuntimeService(cliAgent, sessions, allowedPaths, config);

    await service.spawnSession({
      parentSessionId: 'sess-parent',
      parentToolCallId: 'call-cli-tools',
      prompt: 'Long running task',
      workdir: 'C:/repo',
      agentId: 'codex',
    });

    await vi.waitFor(() => expect(cliAgent.run).toHaveBeenCalled());
    vi.mocked(sessions.saveToolResult).mockClear();

    await service.stopSession('sess-parent', 'cli-child-1');

    expect(vi.mocked(sessions.saveToolResult)).not.toHaveBeenCalled();
  });

  it('stopSession does not emit cancelled when cliAgent.stop returns false while still running', async () => {
    allowedPaths = {
      isAllowed: vi.fn().mockResolvedValue(true),
    } as unknown as AllowedPathsService;
    vi.mocked(sessions.createChildSession).mockResolvedValue(makeChildSession());
    vi.mocked(cliAgent.run).mockImplementation(() => new Promise(() => {}));
    vi.mocked(cliAgent.stop).mockReturnValue(false);

    const emit = vi.fn();
    const service = new CLIAgentSessionRuntimeService(cliAgent, sessions, allowedPaths, config);

    await service.spawnSession({
      parentSessionId: 'sess-parent',
      parentToolCallId: 'call-cli-tools',
      prompt: 'Long running task',
      workdir: 'C:/repo',
      agentId: 'codex',
      emit,
    });

    await vi.waitFor(() => expect(cliAgent.run).toHaveBeenCalled());

    emit.mockClear();
    const snapshot = await service.stopSession('sess-parent', 'cli-child-1', emit);

    expect(snapshot.status).toBe('running');
    expect(emit).not.toHaveBeenCalledWith('tool:result', expect.anything());
    expect(emit).not.toHaveBeenCalledWith('agent:done', expect.anything());
  });

  it('stopSession does not double-emit when completion already finalized', async () => {
    allowedPaths = {
      isAllowed: vi.fn().mockResolvedValue(true),
    } as unknown as AllowedPathsService;
    vi.mocked(sessions.createChildSession).mockResolvedValue(makeChildSession());
    vi.mocked(cliAgent.run).mockResolvedValue({
      agentId: 'codex',
      output: 'done',
      exitCode: 0,
      durationMs: 10,
    });

    const emit = vi.fn();
    const service = new CLIAgentSessionRuntimeService(cliAgent, sessions, allowedPaths, config);

    await service.spawnSession({
      parentSessionId: 'sess-parent',
      parentToolCallId: 'call-cli-tools',
      prompt: 'Quick task',
      workdir: 'C:/repo',
      agentId: 'codex',
      emit,
    });

    await vi.waitFor(() => {
      expect(emit).toHaveBeenCalledWith('agent:done', expect.objectContaining({ sessionId: 'cli-child-1' }));
    });

    const toolResultCount = emit.mock.calls.filter(([event]) => event === 'tool:result').length;
    const agentDoneCount = emit.mock.calls.filter(([event]) => event === 'agent:done').length;

    vi.mocked(cliAgent.stop).mockReturnValue(false);
    await service.stopSession('sess-parent', 'cli-child-1', emit);

    expect(emit.mock.calls.filter(([event]) => event === 'tool:result').length).toBe(toolResultCount);
    expect(emit.mock.calls.filter(([event]) => event === 'agent:done').length).toBe(agentDoneCount);
  });
});

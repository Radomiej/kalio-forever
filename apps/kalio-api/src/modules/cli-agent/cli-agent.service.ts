import { Injectable, Logger, Optional } from '@nestjs/common';
import { spawn } from 'node:child_process';
import type { CLIAgentAdapterInfo } from '@kalio/types';
import { CopilotAdapter } from './adapters/copilot.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { ClaudeCodeAdapter } from './adapters/claude-code.adapter';
import { CodexAdapter } from './adapters/codex.adapter';
import type { ICLIAgentAdapter } from './adapters/cli-agent.adapter';
import { CLIAgentConfigService } from './cli-agent-config.service';
import { terminateCliAgentProcess, type KillableProcess } from './cli-agent-process-kill';
import { compressOutput } from './output-compressor';
import {
  EXIT_FALLBACK_GRACE_MS,
  extractCodexAgentMessage,
} from './cli-agent-utils';
import type { CLIAgentRunLimits, RunCliAgentRequest } from './cli-agent.types';
import { CLIAgentPtyService } from './cli-agent-pty.service';
import { applySemanticCliOutcome, type CLIAgentRunResult } from './cli-agent-outcome';
import { CLIAgentProbeService } from './cli-agent-probe.service';
import { CLIAgentLaunchPreparationService } from './cli-agent-launch-preparation.service';
import { CmdInvocationAuditService } from '../chat/cmd-invocation-audit.service';
import { createWorkflowError } from '../../common/utils/workflow-error.util';
export type { ProgressEmitFn } from './cli-agent.types';
export { applySemanticCliOutcome, type CLIAgentRunResult, type CLIAgentSemanticFailureCode } from './cli-agent-outcome';

export const CLI_AGENT_STOPPED_ERROR = 'CLI_AGENT_STOPPED';
function createCliStoppedError(): Error {
  return createWorkflowError('CLI_AGENT_STOPPED', CLI_AGENT_STOPPED_ERROR, {
    source: 'cli-agent',
    retryable: false,
  });
}

function createCliTimeoutError(agentId: string, limits: CLIAgentRunLimits, kind: 'idle' | 'hard'): Error {
  return createWorkflowError(
    'TIMEOUT',
    kind === 'idle'
      ? `CLI agent "${agentId}" idle timed out after ${limits.inactivityTimeoutMs}ms`
      : `CLI agent "${agentId}" hard timed out after ${limits.hardTimeoutMs}ms`,
    {
      source: kind === 'idle' ? 'cli-agent-idle-timeout' : 'cli-agent-hard-timeout',
    },
  );
}

interface ActiveRunState {
  sessionId: string;
  agentId: string;
  proc: KillableProcess;
  stopRequested: boolean;
  requestStop?: () => void; terminatePromise?: Promise<void>;
}

@Injectable()
export class CLIAgentService {
  private readonly logger = new Logger(CLIAgentService.name);
  private readonly adapters: Map<string, ICLIAgentAdapter>;
  private readonly activeRuns = new Map<string, ActiveRunState>();

  constructor(
    private readonly config: CLIAgentConfigService,
    copilot: CopilotAdapter,
    gemini: GeminiAdapter,
    claude: ClaudeCodeAdapter,
    codex: CodexAdapter,
    private readonly pty: CLIAgentPtyService,
    private readonly probes: CLIAgentProbeService,
    private readonly launchPreparation: CLIAgentLaunchPreparationService,
    @Optional() private readonly cmdAudit?: CmdInvocationAuditService,
  ) {
    this.adapters = new Map<string, ICLIAgentAdapter>([
      [copilot.id, copilot],
      [gemini.id, gemini],
      [claude.id, claude],
      [codex.id, codex],
    ]);
  }

  /** Re-probe every adapter and update the cache. Returns the fresh results. */
  async refreshAllProbes(): Promise<CLIAgentAdapterInfo[]> {
    return this.probes.refreshAllProbes();
  }

  /** Re-probe a single adapter, update cache, return result. */
  async refreshProbe(agentId: string): Promise<CLIAgentAdapterInfo | null> {
    return this.probes.refreshProbe(agentId);
  }

  /** Return cached probe results. If cache is empty (first request beat startup), probe fresh. */
  async listAll(): Promise<CLIAgentAdapterInfo[]> {
    return this.probes.listAll();
  }

  getAdapter(agentId: string): ICLIAgentAdapter | undefined {
    return this.adapters.get(agentId);
  }

  getAdapterIds(): string[] {
    return [...this.adapters.keys()];
  }

  isRunning(sessionId: string): boolean {
    return this.activeRuns.has(sessionId);
  }

  stop(sessionId: string): boolean {
    const activeRun = this.activeRuns.get(sessionId);
    if (!activeRun) {
      return false;
    }

    if (activeRun.stopRequested) {
      return true;
    }
    if (activeRun.proc.exitCode !== undefined && activeRun.proc.exitCode !== null) {
      return false;
    }

    activeRun.stopRequested = true;
    activeRun.requestStop?.();
    return true;
  }

  /**
   * Execute a CLI agent headlessly.
   * @param request  See {@link RunCliAgentRequest} for field docs.
   */
  async run(request: RunCliAgentRequest): Promise<CLIAgentRunResult> {
    const { agentId, prompt, workdir, callId, sessionId, turnId, emitFn } = request;
    const adapter = this.adapters.get(agentId);
    if (!adapter) {
      throw new Error(`Unknown CLI agent: "${agentId}". Available: ${[...this.adapters.keys()].join(', ')}`);
    }

    const agentConfig = await this.config.getConfig(agentId);

    if (!agentConfig.enabled) {
      throw new Error(
        `CLI agent "${agentId}" is disabled. Enable it in Settings → CLI Agents.`,
      );
    }

    const limits = this.launchPreparation.resolveRunLimits(agentId, request, agentConfig);

    const platform = this.getPlatform();
    const executable = agentConfig.cliPath || adapter.executable(platform);
    const wrapperArgs = agentConfig.cliPath ? [] : adapter.wrapperArgs(platform);
    const model = adapter.supportsModelSelection ? (request.model ?? agentConfig.model) : '';
    const preparedPrompt = await this.launchPreparation.preparePromptForAgent(agentId, platform, prompt);
    const extraArgs = preparedPrompt.includeDirectory
      ? [...agentConfig.extraArgs, '--include-directories', preparedPrompt.includeDirectory]
      : agentConfig.extraArgs;
    const promptArgs = adapter.buildArgs(preparedPrompt.prompt, workdir, extraArgs, model);
    const allArgs = [...wrapperArgs, ...promptArgs];

    this.logger.log(
      `[${agentId}] spawn: ${executable} (inactivityTimeout=${limits.inactivityTimeoutMs}ms, hardTimeout=${limits.hardTimeoutMs !== undefined ? `${limits.hardTimeoutMs}ms` : 'disabled'}, cwd=${workdir})`,
    );

    if (agentId === 'codex') {
      const ptyLaunch = await this.launchPreparation.buildCodexPtyLaunch(platform, agentConfig.cliPath, promptArgs, preparedPrompt.prompt);
      void this.cmdAudit?.recordInvocation({
        command: ptyLaunch.auditCommand,
        source: 'cli-agent.pty',
        launcher: 'pty',
        agentId,
        sessionId,
        turnId,
        callId,
      });
      try {
        return await this.runCodexWithPty({
          request,
          executable: ptyLaunch.executable,
          allArgs: ptyLaunch.args,
          limits,
          maxOutputChars: agentConfig.maxOutputChars,
        });
      } finally {
        await ptyLaunch.cleanup?.();
        await preparedPrompt.cleanup?.();
      }
    }

    const startedAt = Date.now();
    void this.cmdAudit?.recordInvocation({
      command: executable,
      source: 'cli-agent.run',
      launcher: 'spawn',
      agentId,
      sessionId,
      turnId,
      callId,
    });

    try {
      return await new Promise<CLIAgentRunResult>((resolve, reject) => {
      const proc = spawn(executable, allArgs, {
        cwd: workdir,
        // pipe stdin so the process doesn't hang waiting for input
        stdio: ['pipe', 'pipe', 'pipe'],
        // Use UTF-8 on all platforms to avoid Windows codepage issues
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        // Do NOT use shell:true — args are passed as array, not shell-interpolated
      });

      // Signal EOF on stdin immediately — CLI agents are non-interactive
      proc.stdin?.end();

      const activeRunState: ActiveRunState = {
        sessionId,
        agentId,
        proc,
        stopRequested: false,
      };
      this.activeRuns.set(sessionId, activeRunState);

      let rawOutput = '';
      const MAX_BUFFER = 4 * 1024 * 1024; // 4 MB hard cap
      let settled = false;
      let exitFallbackTimer: NodeJS.Timeout | null = null;
      let idleTimer: NodeJS.Timeout | null = null;
      let hardTimer: NodeJS.Timeout | null = null;

      const abortHandler = (): void => {
        this.stop(sessionId);
      };

      const onData = (chunk: Buffer | string): void => {
        const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');

        // Hard cap: stop accumulating if we hit 4 MB (still emit progress so user sees live output)
        if (rawOutput.length < MAX_BUFFER) {
          rawOutput += str;
        }

        if (emitFn) {
          emitFn('cli_agent:progress', {
            callId,
            sessionId,
            ...(turnId ? { turnId } : {}),
            agentId,
            chunk: str,
          });
        }
        resetIdleTimer();
      };

      const cleanup = (): void => {
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
        if (hardTimer) {
          clearTimeout(hardTimer);
          hardTimer = null;
        }
        if (exitFallbackTimer) {
          clearTimeout(exitFallbackTimer);
          exitFallbackTimer = null;
        }
        if (this.activeRuns.get(sessionId) === activeRunState) {
          this.activeRuns.delete(sessionId);
        }
        proc.stdout.off('data', onData);
        proc.stderr.off('data', onData);
        proc.removeListener('close', closeHandler);
        proc.removeListener('exit', exitHandler);
        proc.removeListener('error', errorHandler);
        request.abortSignal?.removeEventListener('abort', abortHandler);
      };

      const terminateAndReject = (reason: 'stopped' | 'idle-timeout' | 'hard-timeout'): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        void this.terminateActiveRun(activeRunState);

        if (reason === 'stopped') {
          reject(createCliStoppedError());
          return;
        }

        reject(createCliTimeoutError(agentId, limits, reason === 'idle-timeout' ? 'idle' : 'hard'));
      };

      activeRunState.requestStop = () => {
        terminateAndReject('stopped');
      };
      if (activeRunState.stopRequested) {
        activeRunState.requestStop();
        return;
      }

      const finalize = (code: number | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();

        if (activeRunState.stopRequested) {
          reject(createCliStoppedError());
          return;
        }

        const durationMs = Date.now() - startedAt;
        const rawExitCode = code ?? 1;
        const output = compressOutput(rawOutput.trim(), agentConfig.maxOutputChars);
        const normalizedResult = applySemanticCliOutcome({
          output,
          exitCode: rawExitCode,
          durationMs,
          agentId,
        });

        this.logger.log(
          `[${agentId}] Done in ${durationMs}ms, exitCode=${normalizedResult.exitCode}, rawExitCode=${normalizedResult.rawExitCode}, outputLen=${output.length}`,
        );

        resolve(normalizedResult);
      };

      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);

      const closeHandler = (code: number | null): void => {
        finalize(code);
      };

      const exitHandler = (code: number | null): void => {
        if (settled || exitFallbackTimer) {
          return;
        }

        // Some CLIs exit cleanly but keep stdio open briefly or indefinitely via descendants.
        // Wait a moment for the normal 'close' event, then finalize from 'exit' to avoid hanging the tool.
        exitFallbackTimer = setTimeout(() => {
          finalize(code);
        }, EXIT_FALLBACK_GRACE_MS);
      };

      const errorHandler = (err: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        this.logger.error(`[${agentId}] spawn error: ${err.message}`);
        reject(err);
      };

      const resetIdleTimer = (): void => {
        if (idleTimer) {
          clearTimeout(idleTimer);
        }
        idleTimer = setTimeout(() => {
          terminateAndReject('idle-timeout');
        }, limits.inactivityTimeoutMs);
      };

      resetIdleTimer();
      if (limits.hardTimeoutMs !== undefined) {
        hardTimer = setTimeout(() => {
          terminateAndReject('hard-timeout');
        }, limits.hardTimeoutMs);
      }

      proc.on('error', errorHandler);
      proc.on('exit', exitHandler);
      proc.on('close', closeHandler);

      if (request.abortSignal?.aborted) {
        abortHandler();
        return;
      }
      request.abortSignal?.addEventListener('abort', abortHandler, { once: true });
      });
    } finally {
      await preparedPrompt.cleanup?.();
    }
  }

  private async runCodexWithPty(params: {
    request: RunCliAgentRequest;
    executable: string;
    allArgs: string[];
    limits: CLIAgentRunLimits;
    maxOutputChars: number;
  }): Promise<CLIAgentRunResult> {
    const { request, executable, allArgs, limits, maxOutputChars } = params;
    let activeRunState: ActiveRunState | null = null;
    let stopReject: ((reason?: unknown) => void) | null = null;
    let stopSignalled = false;
    let abortRequested = request.abortSignal?.aborted ?? false;
    const stopPromise = new Promise<never>((_, reject) => {
      stopReject = reject;
    });
    const abortHandler = (): void => {
      abortRequested = true;
      this.stop(request.sessionId);
    };

    try {
      const runPromise = this.pty.run({
        agentId: request.agentId,
        executable,
        args: allArgs,
        workdir: request.workdir,
        callId: request.callId,
        sessionId: request.sessionId,
        turnId: request.turnId,
        inactivityTimeoutMs: limits.inactivityTimeoutMs,
        hardTimeoutMs: limits.hardTimeoutMs,
        maxOutputChars,
        emitFn: request.emitFn,
        onStart: (proc) => {
          activeRunState = {
            sessionId: request.sessionId,
            agentId: request.agentId,
            proc,
            stopRequested: false,
            requestStop: () => {
              if (!activeRunState || stopSignalled) {
                return;
              }
              stopSignalled = true;
              activeRunState.stopRequested = true;
              void this.terminateActiveRun(activeRunState);
              stopReject?.(createCliStoppedError());
            },
          };
          this.activeRuns.set(request.sessionId, activeRunState);
          if (abortRequested) {
            activeRunState.requestStop?.();
          }
        },
      });

      if (request.abortSignal?.aborted) {
        abortHandler();
      } else {
        request.abortSignal?.addEventListener('abort', abortHandler, { once: true });
      }

      const result = await Promise.race([runPromise, stopPromise]);
      const codexAgentMessage = extractCodexAgentMessage(result.output);

      if (this.activeRuns.get(request.sessionId)?.stopRequested) {
        throw createCliStoppedError();
      }

      return applySemanticCliOutcome(codexAgentMessage ? { ...result, output: codexAgentMessage } : result);
    } finally {
      request.abortSignal?.removeEventListener('abort', abortHandler);
      if (activeRunState && this.activeRuns.get(request.sessionId) === activeRunState) {
        this.activeRuns.delete(request.sessionId);
      }
    }
  }

  private getPlatform(): NodeJS.Platform {
    return process.platform;
  }

  private terminateActiveRun(activeRun: ActiveRunState): Promise<void> {
    if (activeRun.terminatePromise) {
      return activeRun.terminatePromise;
    }

    activeRun.terminatePromise = terminateCliAgentProcess({
      proc: activeRun.proc,
      platform: this.getPlatform(),
      agentId: activeRun.agentId,
      onWarn: (message) => this.logger.warn(message),
    });
    return activeRun.terminatePromise;
  }
}

import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { spawn, execFile } from 'node:child_process';
import type { CLIAgentAdapterInfo, CLIAgentResult } from '@kalio/types';
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
  WINDOWS_POWERSHELL_EXE,
  extractCodexAgentMessage,
  normalizeTimeoutMs,
  quotePowerShellArg,
} from './cli-agent-utils';
import type { RunCliAgentRequest } from './cli-agent.types';
import { CLIAgentPtyService } from './cli-agent-pty.service';

export type { ProgressEmitFn } from './cli-agent.types';

export const CLI_AGENT_STOPPED_ERROR = 'CLI_AGENT_STOPPED';

interface ActiveRunState {
  sessionId: string;
  agentId: string;
  proc: KillableProcess;
  stopRequested: boolean;
  requestStop?: () => void;
  terminatePromise?: Promise<void>;
}

@Injectable()
export class CLIAgentService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CLIAgentService.name);
  private readonly adapters: Map<string, ICLIAgentAdapter>;
  /** Probe results cached at startup and on explicit refresh. */
  private readonly probeCache = new Map<string, CLIAgentAdapterInfo>();
  private readonly activeRuns = new Map<string, ActiveRunState>();

  constructor(
    private readonly config: CLIAgentConfigService,
    copilot: CopilotAdapter,
    gemini: GeminiAdapter,
    claude: ClaudeCodeAdapter,
    codex: CodexAdapter,
    private readonly pty: CLIAgentPtyService,
  ) {
    this.adapters = new Map<string, ICLIAgentAdapter>([
      [copilot.id, copilot],
      [gemini.id, gemini],
      [claude.id, claude],
      [codex.id, codex],
    ]);
  }

  /** Probe all adapters in parallel at application start so the first FE request is instant. */
  onApplicationBootstrap(): void {
    void this.refreshAllProbes().catch((err: unknown) => {
      this.logger.warn(`[CLIAgentService] startup probe failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /** Re-probe every adapter and update the cache. Returns the fresh results. */
  async refreshAllProbes(): Promise<CLIAgentAdapterInfo[]> {
    const ids = [...this.adapters.keys()];
    const results = await Promise.all(ids.map((id) => this.refreshProbe(id)));
    return results.filter((r): r is CLIAgentAdapterInfo => r !== null);
  }

  /** Re-probe a single adapter, update cache, return result. */
  async refreshProbe(agentId: string): Promise<CLIAgentAdapterInfo | null> {
    const adapter = this.adapters.get(agentId);
    if (!adapter) return null;
    const probe = await this.probe(agentId);
    const info: CLIAgentAdapterInfo = {
      id: agentId,
      displayName: adapter.displayName,
      installUrl: adapter.installUrl,
      available: probe.available,
      version: probe.version,
      supportsModelSelection: adapter.supportsModelSelection,
    };
    this.probeCache.set(agentId, info);
    return info;
  }

  /** Return cached probe results. If cache is empty (first request beat startup), probe fresh. */
  async listAll(): Promise<CLIAgentAdapterInfo[]> {
    if (this.probeCache.size === 0) {
      return this.refreshAllProbes();
    }
    return [...this.adapters.keys()]
      .map((id) => this.probeCache.get(id))
      .filter((r): r is CLIAgentAdapterInfo => r !== undefined);
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
  async run(request: RunCliAgentRequest): Promise<CLIAgentResult> {
    const { agentId, prompt, workdir, callId, sessionId, emitFn, timeoutMs } = request;
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

    const effectiveTimeout = normalizeTimeoutMs(agentId, timeoutMs ?? agentConfig.timeoutMs);

    const platform = this.getPlatform();
    const executable = agentConfig.cliPath || adapter.executable(platform);
    const wrapperArgs = agentConfig.cliPath ? [] : adapter.wrapperArgs(platform);
    const model = adapter.supportsModelSelection ? (request.model ?? agentConfig.model) : '';
    const promptArgs = adapter.buildArgs(prompt, workdir, agentConfig.extraArgs, model);
    const allArgs = [...wrapperArgs, ...promptArgs];

    this.logger.log(
      `[${agentId}] spawn: ${executable} (timeout=${effectiveTimeout}ms, cwd=${workdir})`,
    );

    if (agentId === 'codex') {
      const ptyLaunch = this.buildCodexPtyLaunch(platform, agentConfig.cliPath, promptArgs);
      return this.runCodexWithPty({
        request,
        executable: ptyLaunch.executable,
        allArgs: ptyLaunch.args,
        effectiveTimeout,
        maxOutputChars: agentConfig.maxOutputChars,
      });
    }

    const startedAt = Date.now();

    return new Promise<CLIAgentResult>((resolve, reject) => {
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
      let timer: NodeJS.Timeout | null = null;

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
          emitFn('cli_agent:progress', { callId, sessionId, agentId, chunk: str });
        }
      };

      const cleanup = (): void => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
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

      const terminateAndReject = (reason: 'stopped' | 'timeout'): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        void this.terminateActiveRun(activeRunState);

        if (reason === 'stopped') {
          reject(new Error(CLI_AGENT_STOPPED_ERROR));
          return;
        }

        reject(new Error(`CLI agent "${agentId}" timed out after ${effectiveTimeout}ms`));
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
          reject(new Error(CLI_AGENT_STOPPED_ERROR));
          return;
        }

        const durationMs = Date.now() - startedAt;
        const exitCode = code ?? 1;
        const output = compressOutput(rawOutput.trim(), agentConfig.maxOutputChars);

        this.logger.log(`[${agentId}] Done in ${durationMs}ms, exitCode=${exitCode}, outputLen=${output.length}`);

        resolve({ output, exitCode, durationMs, agentId });
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

      timer = setTimeout(() => {
        terminateAndReject('timeout');
      }, effectiveTimeout);

      proc.on('error', errorHandler);
      proc.on('exit', exitHandler);
      proc.on('close', closeHandler);

      if (request.abortSignal?.aborted) {
        abortHandler();
        return;
      }
      request.abortSignal?.addEventListener('abort', abortHandler, { once: true });
    });
  }

  private buildCodexPtyLaunch(
    platform: NodeJS.Platform,
    cliPath: string,
    promptArgs: string[],
  ): { executable: string; args: string[] } {
    if (platform !== 'win32') {
      return { executable: cliPath || 'codex', args: promptArgs };
    }

    const codexCommand = cliPath || 'codex';
    const command = `& ${quotePowerShellArg(codexCommand)} ${promptArgs.map(quotePowerShellArg).join(' ')}`;
    return {
      executable: WINDOWS_POWERSHELL_EXE,
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
    };
  }

  private async runCodexWithPty(params: {
    request: RunCliAgentRequest;
    executable: string;
    allArgs: string[];
    effectiveTimeout: number;
    maxOutputChars: number;
  }): Promise<CLIAgentResult> {
    const { request, executable, allArgs, effectiveTimeout, maxOutputChars } = params;
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
        timeoutMs: effectiveTimeout,
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
              stopReject?.(new Error(CLI_AGENT_STOPPED_ERROR));
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
        throw new Error(CLI_AGENT_STOPPED_ERROR);
      }

      return codexAgentMessage ? { ...result, output: codexAgentMessage } : result;
    } finally {
      request.abortSignal?.removeEventListener('abort', abortHandler);
      if (activeRunState && this.activeRuns.get(request.sessionId) === activeRunState) {
        this.activeRuns.delete(request.sessionId);
      }
    }
  }

  /**
   * Probe whether a given CLI agent is installed and return its version.
   *
   * Uses execFile with an explicit args array — no shell interpolation.
   * On Windows, CopilotAdapter.executable() returns 'cmd' and wrapperArgs() returns ['/c', 'copilot'],
   * so the full invocation becomes: execFile('cmd', ['/c', 'copilot', '--version']).
   * This correctly resolves the .cmd shim without shell:true injection risk.
   */
  async probe(agentId: string): Promise<{ available: boolean; version: string | null }> {
    const adapter = this.adapters.get(agentId);
    if (!adapter) return { available: false, version: null };

    const agentConfig = await this.config.getConfig(agentId);
    const platform = this.getPlatform();

    // If cliPath override is set, call it directly with just probe args.
    // Otherwise use the adapter's full executable + wrapperArgs chain.
    const executable = agentConfig.cliPath || adapter.executable(platform);
    const wrapperArgs = agentConfig.cliPath ? [] : adapter.wrapperArgs(platform);
    const allArgs = [...wrapperArgs, ...adapter.probeArgs()];

    return new Promise((resolve) => {
      execFile(executable, allArgs, { timeout: 5000 }, (err, stdout, stderr) => {
        if (err) {
          resolve({ available: false, version: null });
          return;
        }
        const version = (stdout || stderr).trim() || null;
        resolve({ available: true, version });
      });
    });
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

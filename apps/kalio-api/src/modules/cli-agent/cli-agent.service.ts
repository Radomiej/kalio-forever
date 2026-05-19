import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { spawn, execFile } from 'node:child_process';
import type { CLIAgentAdapterInfo, CLIAgentResult } from '@kalio/types';
import { CopilotAdapter } from './adapters/copilot.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { ClaudeCodeAdapter } from './adapters/claude-code.adapter';
import { CodexAdapter } from './adapters/codex.adapter';
import type { ICLIAgentAdapter } from './adapters/cli-agent.adapter';
import { CLIAgentConfigService } from './cli-agent-config.service';
import { compressOutput } from './output-compressor';
import type { RunCliAgentRequest } from './cli-agent.types';
import { CLIAgentPtyService } from './cli-agent-pty.service';

export type { ProgressEmitFn } from './cli-agent.types';

/** Max timeout cap: 20 minutes */
const MAX_TIMEOUT_MS = 1_200_000;
/** Slow CLI agents commonly need auth/model startup time before producing useful output. */
const SLOW_AGENT_MIN_TIMEOUT_MS = 180_000;
const SLOW_AGENT_IDS = new Set(['gemini', 'codex']);
const EXIT_FALLBACK_GRACE_MS = 250;
export const CLI_AGENT_STOPPED_ERROR = 'CLI_AGENT_STOPPED';
const WINDOWS_POWERSHELL_EXE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

function normalizeTimeoutMs(agentId: string, timeoutMs: number): number {
  const cappedTimeout = Math.min(timeoutMs, MAX_TIMEOUT_MS);
  if (SLOW_AGENT_IDS.has(agentId)) {
    return Math.max(cappedTimeout, SLOW_AGENT_MIN_TIMEOUT_MS);
  }
  return cappedTimeout;
}

function quotePowerShellArg(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function parseJsonLine(line: string): unknown | null {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
  }
}

function extractCodexAgentMessage(output: string): string | null {
  let lastMessage: string | null = null;
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {
      continue;
    }

    const parsed = parseJsonLine(trimmed);
    if (!parsed || typeof parsed !== 'object') {
      continue;
    }

    const event = parsed as { type?: unknown; item?: unknown };
    if (event.type !== 'item.completed' || !event.item || typeof event.item !== 'object') {
      continue;
    }

    const item = event.item as { type?: unknown; text?: unknown };
    if (item.type === 'agent_message' && typeof item.text === 'string') {
      lastMessage = item.text;
    }
  }

  return lastMessage?.trim() || null;
}

interface ActiveRunState {
  sessionId: string;
  proc: { kill(signal?: string | number): unknown; exitCode?: number | null };
  stopRequested: boolean;
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
    if (!activeRun || (activeRun.proc.exitCode !== undefined && activeRun.proc.exitCode !== null)) {
      return false;
    }

    activeRun.stopRequested = true;
    activeRun.proc.kill('SIGTERM');
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

    const platform = process.platform;
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
        proc,
        stopRequested: false,
      };
      this.activeRuns.set(sessionId, activeRunState);

      let rawOutput = '';
      const MAX_BUFFER = 4 * 1024 * 1024; // 4 MB hard cap
      let settled = false;
      let exitFallbackTimer: NodeJS.Timeout | null = null;

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
        clearTimeout(timer);
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
      };

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

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        // Guard: only kill if the process is still running (exitCode is null when running)
        if (proc.exitCode === null) {
          proc.kill('SIGTERM');
        }
        cleanup();
        reject(new Error(`CLI agent "${agentId}" timed out after ${effectiveTimeout}ms`));
      }, effectiveTimeout);

      proc.on('error', errorHandler);
      proc.on('exit', exitHandler);
      proc.on('close', closeHandler);
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

    try {
      const result = await this.pty.run({
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
            proc,
            stopRequested: false,
          };
          this.activeRuns.set(request.sessionId, activeRunState);
        },
      });
      const codexAgentMessage = extractCodexAgentMessage(result.output);

      if (this.activeRuns.get(request.sessionId)?.stopRequested) {
        throw new Error(CLI_AGENT_STOPPED_ERROR);
      }

      return codexAgentMessage ? { ...result, output: codexAgentMessage } : result;
    } finally {
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
    const platform = process.platform;

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
}

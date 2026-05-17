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
import type { ProgressEmitFn, RunCliAgentRequest } from './cli-agent.types';

export type { ProgressEmitFn } from './cli-agent.types';

/** Max timeout cap: 20 minutes */
const MAX_TIMEOUT_MS = 1_200_000;

@Injectable()
export class CLIAgentService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CLIAgentService.name);
  private readonly adapters: Map<string, ICLIAgentAdapter>;
  /** Probe results cached at startup and on explicit refresh. */
  private readonly probeCache = new Map<string, CLIAgentAdapterInfo>();

  constructor(
    private readonly config: CLIAgentConfigService,
    copilot: CopilotAdapter,
    gemini: GeminiAdapter,
    claude: ClaudeCodeAdapter,
    codex: CodexAdapter,
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

    const effectiveTimeout = Math.min(timeoutMs ?? agentConfig.timeoutMs, MAX_TIMEOUT_MS);

    const platform = process.platform;
    const executable = agentConfig.cliPath || adapter.executable(platform);
    const wrapperArgs = adapter.wrapperArgs(platform);
    const promptArgs = adapter.buildArgs(prompt, workdir, agentConfig.extraArgs);
    const allArgs = [...wrapperArgs, ...promptArgs];

    this.logger.log(
      `[${agentId}] spawn: ${executable} (timeout=${effectiveTimeout}ms, cwd=${workdir})`,
    );

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

      let rawOutput = '';
      const MAX_BUFFER = 4 * 1024 * 1024; // 4 MB hard cap

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

      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);

      const closeHandler = (code: number | null): void => {
        clearTimeout(timer);
        const durationMs = Date.now() - startedAt;
        const exitCode = code ?? 1;
        const output = compressOutput(rawOutput.trim(), agentConfig.maxOutputChars);

        this.logger.log(`[${agentId}] Done in ${durationMs}ms, exitCode=${exitCode}, outputLen=${output.length}`);

        resolve({ output, exitCode, durationMs, agentId });
      };

      const timer = setTimeout(() => {
        // Guard: only kill if the process is still running (exitCode is null when running)
        if (proc.exitCode === null) {
          proc.kill('SIGTERM');
        }
        proc.stdout.off('data', onData);
        proc.stderr.off('data', onData);
        proc.removeListener('close', closeHandler);
        reject(new Error(`CLI agent "${agentId}" timed out after ${effectiveTimeout}ms`));
      }, effectiveTimeout);

      proc.on('error', (err) => {
        clearTimeout(timer);
        proc.stdout.off('data', onData);
        proc.stderr.off('data', onData);
        proc.removeListener('close', closeHandler);
        this.logger.error(`[${agentId}] spawn error: ${err.message}`);
        reject(err);
      });

      proc.on('close', closeHandler);
    });
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

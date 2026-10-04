import { Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { execFile } from 'node:child_process';
import type { CLIAgentAdapterInfo } from '@kalio/types';
import { CmdInvocationAuditService } from '../chat/cmd-invocation-audit.service';
import { CopilotAdapter } from './adapters/copilot.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { ClaudeCodeAdapter } from './adapters/claude-code.adapter';
import { CodexAdapter } from './adapters/codex.adapter';
import type { ICLIAgentAdapter } from './adapters/cli-agent.adapter';
import { CLIAgentConfigService } from './cli-agent-config.service';

interface ProbeResult {
  available: boolean;
  version: string | null;
}

@Injectable()
export class CLIAgentProbeService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CLIAgentProbeService.name);
  private readonly adapters: Map<string, ICLIAgentAdapter>;
  private readonly probeCache = new Map<string, CLIAgentAdapterInfo>();
  private readonly pendingProbes = new Map<string, Promise<CLIAgentAdapterInfo | null>>();
  private probeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: CLIAgentConfigService,
    copilot: CopilotAdapter,
    gemini: GeminiAdapter,
    claude: ClaudeCodeAdapter,
    codex: CodexAdapter,
    @Optional() private readonly cmdAudit?: CmdInvocationAuditService,
  ) {
    this.adapters = new Map<string, ICLIAgentAdapter>([
      [copilot.id, copilot],
      [gemini.id, gemini],
      [claude.id, claude],
      [codex.id, codex],
    ]);
  }

  onApplicationBootstrap(): void {
    void this.refreshAllProbes().catch((err: unknown) => {
      this.logger.warn(`[CLIAgentProbeService] startup probe failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  async refreshAllProbes(): Promise<CLIAgentAdapterInfo[]> {
    const results = await Promise.all([...this.adapters.keys()].map((id) => this.refreshProbe(id)));
    return results.filter((result): result is CLIAgentAdapterInfo => result !== null);
  }

  async refreshProbe(agentId: string): Promise<CLIAgentAdapterInfo | null> {
    const adapter = this.adapters.get(agentId);
    if (!adapter) return null;

    const existing = this.pendingProbes.get(agentId);
    if (existing) return existing;

    const pending = this.probeQueue.then(() => this.probe(agentId)).then((probe) => {
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
    });
    this.probeQueue = pending.then(() => undefined, () => undefined);
    this.pendingProbes.set(agentId, pending);

    try {
      return await pending;
    } finally {
      if (this.pendingProbes.get(agentId) === pending) this.pendingProbes.delete(agentId);
    }
  }

  async listAll(): Promise<CLIAgentAdapterInfo[]> {
    if (this.probeCache.size === 0) return this.refreshAllProbes();
    return [...this.adapters.keys()]
      .map((id) => this.probeCache.get(id))
      .filter((result): result is CLIAgentAdapterInfo => result !== undefined);
  }

  async probe(agentId: string): Promise<ProbeResult> {
    const adapter = this.adapters.get(agentId);
    if (!adapter) return { available: false, version: null };

    const agentConfig = await this.config.getConfig(agentId);
    const platform = process.platform;
    const executable = agentConfig.cliPath || adapter.executable(platform);
    const wrapperArgs = agentConfig.cliPath ? [] : adapter.wrapperArgs(platform);
    const allArgs = [...wrapperArgs, ...adapter.probeArgs()];

    await this.cmdAudit?.recordInvocation({
      command: executable,
      source: 'cli-agent.probe',
      launcher: 'execFile',
      agentId,
    });

    return new Promise((resolve) => {
      execFile(executable, allArgs, { timeout: 5000, windowsHide: true }, (err, stdout, stderr) => {
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

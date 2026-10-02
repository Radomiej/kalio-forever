import { Injectable } from '@nestjs/common';
import { DevinCliCommandQueueService } from './devin-cli-command-queue.service';
import { DevinCliModelCatalogService, resolveDevinCliPath, type DevinCliModelCatalog } from './devin-cli-model-catalog.service';

const PROBE_TIMEOUT_MS = 10_000;

export interface DevinCliProbeCommand {
  text: string;
  exitCode: number;
}

export interface DevinCliProbeOutput {
  version: DevinCliProbeCommand;
  authStatus: DevinCliProbeCommand;
  acpHelp: DevinCliProbeCommand;
  modelCatalog: DevinCliModelCatalog;
}

export interface DevinCliProbe {
  executable: string;
  version: string | null;
  authenticated: boolean;
  acp: boolean;
  models: string[];
  modelCatalogStatus: DevinCliModelCatalog['status'] | 'not-checked';
  modelCatalogStale: boolean;
  modelCatalogDiscoveredAt: number | null;
}

export interface DevinCliProbeStatus extends DevinCliProbe {
  probeChecked: boolean;
}

@Injectable()
export class DevinCliProbeService {
  private cachedProbe?: { executable: string; probe: DevinCliProbe };
  private pendingProbe?: { executable: string; request: Promise<DevinCliProbe> };

  constructor(
    private readonly modelCatalog: DevinCliModelCatalogService,
    private readonly commands: DevinCliCommandQueueService,
  ) {}

  async getStatus(refresh = false): Promise<DevinCliProbeStatus> {
    const executable = resolveDevinCliPath();
    if (refresh) await this.refreshProbe(executable);

    const cachedProbe = this.cachedProbe?.executable === executable ? this.cachedProbe.probe : undefined;
    return {
      ...(cachedProbe ?? {
        executable,
        version: null,
        authenticated: false,
        acp: false,
        models: [],
        modelCatalogStatus: 'not-checked' as const,
        modelCatalogStale: false,
        modelCatalogDiscoveredAt: null,
      }),
      probeChecked: cachedProbe !== undefined,
    };
  }

  private async refreshProbe(executable: string): Promise<void> {
    let pending = this.pendingProbe;
    if (!pending || pending.executable !== executable) {
      pending = { executable, request: this.probe(executable) };
      this.pendingProbe = pending;
    }

    try {
      this.cachedProbe = { executable, probe: await pending.request };
    } finally {
      if (this.pendingProbe === pending) this.pendingProbe = undefined;
    }
  }

  private async probe(executable: string): Promise<DevinCliProbe> {
    const output = await Promise.all([
      this.probeCommand(executable, ['--version']),
      this.probeCommand(executable, ['auth', 'status']),
      this.probeCommand(executable, ['acp', '--help']),
      this.modelCatalog.getCatalog(executable, true),
    ]);
    return parseDevinCliProbe(executable, {
      version: output[0],
      authStatus: output[1],
      acpHelp: output[2],
      modelCatalog: output[3],
    });
  }

  private async probeCommand(executable: string, args: string[]): Promise<DevinCliProbeCommand> {
    try {
      const result = await this.commands.run(executable, args, {
        timeout: PROBE_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 256 * 1024,
      }, 'devin.cli.probe');
      return { text: `${result.stdout}\n${result.stderr}`, exitCode: 0 };
    } catch (error) {
      const result = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
      const exitCode = typeof result.code === 'number' ? result.code : 1;
      return {
        text: `${typeof result.stdout === 'string' ? result.stdout : ''}\n${typeof result.stderr === 'string' ? result.stderr : ''}`,
        exitCode,
      };
    }
  }
}

export function parseDevinCliProbe(executable: string, output: DevinCliProbeOutput): DevinCliProbe {
  // Text alone is not trustworthy when the CLI has crashed after writing partial output.
  const versionMatch = output.version.exitCode === 0 ? output.version.text.match(/devin\s+([^\s]+)/i) : null;
  const authenticated = output.authStatus.exitCode === 0
    && /logged\s+in|authenticated/i.test(output.authStatus.text)
    && !/not\s+logged\s+in|unauthenticated|login required/i.test(output.authStatus.text);
  const acp = output.acpHelp.exitCode === 0
    && /\bacp\b/i.test(output.acpHelp.text)
    && /usage|run|mode|agent/i.test(output.acpHelp.text);
  return {
    executable,
    version: versionMatch?.[1] ?? null,
    authenticated,
    acp,
    models: [...output.modelCatalog.models],
    modelCatalogStatus: output.modelCatalog.status,
    modelCatalogStale: output.modelCatalog.stale,
    modelCatalogDiscoveredAt: output.modelCatalog.discoveredAt,
  };
}

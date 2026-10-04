import { Injectable, Logger } from '@nestjs/common';
import { DevinCliCommandQueueService } from './devin-cli-command-queue.service';

const MODEL_CATALOG_CACHE_TTL_MS = 30_000;
const MODEL_CATALOG_TIMEOUT_MS = 10_000;
const MODEL_CATALOG_MAX_BUFFER = 1024 * 1024;

export type DevinCliModelCatalogStatus = 'ready' | 'command-failed' | 'unrecognized-output';

export interface DevinCliModelCatalog {
  models: string[];
  status: DevinCliModelCatalogStatus;
  discoveredAt: number | null;
  stale: boolean;
}

interface CachedCatalog {
  executable: string;
  catalog: DevinCliModelCatalog;
}

export function resolveDevinCliPath(): string {
  return process.env['DEVIN_CLI_PATH']?.trim() || (process.platform === 'win32' ? 'devin.exe' : 'devin');
}

export function parseDevinCliModelCatalog(output: string): string[] {
  const escape = String.fromCharCode(27);
  const ansiSequence = new RegExp(`${escape}(?:\\[[0-?]*[ -/]*[@-~]|[@-_])`, 'g');
  const text = output.replace(ansiSequence, '');
  const models = new Set<string>();

  for (const line of text.split(/\r?\n/)) {
    const family = line.match(/^[^()\r\n]+\(([^\s()]+)\)\s*$/)?.[1];
    if (family && isModelToken(family)) models.add(family);

    const modelId = line.match(/^\s{2,}([^\s]+)\s{2,}\S/)?.[1];
    if (modelId && modelId !== 'aliases:' && isModelToken(modelId)) models.add(modelId);
  }

  return [...models];
}

@Injectable()
export class DevinCliModelCatalogService {
  private readonly logger = new Logger(DevinCliModelCatalogService.name);
  private cached?: CachedCatalog;
  private pending?: { executable: string; request: Promise<DevinCliModelCatalog> };

  constructor(private readonly commands: DevinCliCommandQueueService) {}

  async getCatalog(executable = resolveDevinCliPath(), refresh = false): Promise<DevinCliModelCatalog> {
    const now = Date.now();
    if (
      !refresh
      && this.cached?.executable === executable
      && this.cached.catalog.status === 'ready'
      && this.cached.catalog.discoveredAt !== null
      && now - this.cached.catalog.discoveredAt < MODEL_CATALOG_CACHE_TTL_MS
    ) {
      return copyCatalog(this.cached.catalog);
    }
    if (this.pending?.executable === executable) return this.pending.request;

    const request = this.discover(executable);
    this.pending = { executable, request };
    try {
      const catalog = await request;
      if (catalog.status === 'ready') {
        this.cached = { executable, catalog: copyCatalog(catalog) };
        return catalog;
      }
      if (this.cached?.executable === executable) {
        return { ...copyCatalog(this.cached.catalog), status: catalog.status, stale: true };
      }
      return catalog;
    } finally {
      if (this.pending?.request === request) this.pending = undefined;
    }
  }

  private async discover(executable: string): Promise<DevinCliModelCatalog> {
    const startedAt = Date.now();
    try {
      const result = await this.commands.run(executable, ['models', 'list'], {
        timeout: MODEL_CATALOG_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: MODEL_CATALOG_MAX_BUFFER,
      }, 'devin.cli.models');
      const models = parseDevinCliModelCatalog(result.stdout);
      const discoveredAt = Date.now();
      if (models.length === 0) {
        return { models, status: 'unrecognized-output', discoveredAt, stale: false };
      }
      return { models, status: 'ready', discoveredAt, stale: false };
    } catch (error) {
      const failure = error && typeof error === 'object' ? error : {};
      const rawCode = 'code' in failure ? failure.code : undefined;
      const code = typeof rawCode === 'number' && Number.isInteger(rawCode) ? rawCode
        : typeof rawCode === 'string' && /^(?:E[A-Z0-9_]{1,40}|ERR_[A-Z0-9_]{1,60})$/.test(rawCode) ? rawCode : 'unknown';
      const rawSignal = 'signal' in failure ? failure.signal : undefined;
      const signal = rawSignal == null ? 'none'
        : typeof rawSignal === 'string' && /^SIG[A-Z0-9]{1,16}$/.test(rawSignal) ? rawSignal : 'unknown';
      const killed = 'killed' in failure && failure.killed === true;
      this.logger.warn(`Devin CLI model discovery failed code=${code} signal=${signal} killed=${killed} durationMs=${Date.now() - startedAt}.`);
      return { models: [], status: 'command-failed', discoveredAt: null, stale: false };
    }
  }
}

function isModelToken(value: string): boolean {
  return value.length <= 200 && /^[\p{L}\p{N}][\p{L}\p{N}._:/+-]*$/u.test(value);
}

function copyCatalog(catalog: DevinCliModelCatalog): DevinCliModelCatalog {
  return { ...catalog, models: [...catalog.models] };
}

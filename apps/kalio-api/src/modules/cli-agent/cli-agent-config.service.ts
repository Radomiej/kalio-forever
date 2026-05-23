import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CLIAgentConfig } from '@kalio/types';
import { KalioConfigService } from '../../config/kalio-config.service';

export type { CLIAgentConfig };

const DEFAULTS: CLIAgentConfig = {
  enabled: true,
  cliPath: '',
  timeoutMs: 600_000,
  maxOutputChars: 16_000,
  model: '',
  extraArgs: [],
};

function configDir(): string {
  return join(homedir(), '.kalio', 'cli-agents');
}

function configPath(agentId: string): string {
  return join(configDir(), `${agentId}.json`);
}

@Injectable()
export class CLIAgentConfigService {
  private readonly logger = new Logger(CLIAgentConfigService.name);
  private readonly cache = new Map<string, CLIAgentConfig>();

  constructor(private readonly kalioConfig?: KalioConfigService) {}

  private normalizeConfig(config: Partial<CLIAgentConfig>): CLIAgentConfig {
    return {
      enabled: typeof config.enabled === 'boolean' ? config.enabled : DEFAULTS.enabled,
      cliPath: typeof config.cliPath === 'string' ? config.cliPath : DEFAULTS.cliPath,
      timeoutMs: typeof config.timeoutMs === 'number' && Number.isFinite(config.timeoutMs)
        ? Math.round(config.timeoutMs)
        : DEFAULTS.timeoutMs,
      maxOutputChars: typeof config.maxOutputChars === 'number' && Number.isFinite(config.maxOutputChars)
        ? Math.round(config.maxOutputChars)
        : DEFAULTS.maxOutputChars,
      model: typeof config.model === 'string' ? config.model.trim() : DEFAULTS.model,
      extraArgs: Array.isArray(config.extraArgs)
        ? config.extraArgs.filter((value): value is string => typeof value === 'string')
        : DEFAULTS.extraArgs,
    };
  }

  private async getManagedConfig(agentId: string): Promise<CLIAgentConfig | null> {
    const config = await this.kalioConfig?.getCliAgentConfig(agentId);
    return config ? this.normalizeConfig(config) : null;
  }

  private async getStoredConfig(agentId: string): Promise<CLIAgentConfig | null> {
    try {
      const raw = await readFile(configPath(agentId), 'utf8');
      const parsed = JSON.parse(raw) as Partial<CLIAgentConfig>;
      return this.normalizeConfig(parsed);
    } catch {
      return null;
    }
  }

  async getConfig(agentId: string): Promise<CLIAgentConfig> {
    const cached = this.cache.get(agentId);
    if (cached) return cached;

    const managed = await this.getManagedConfig(agentId);
    if (managed) {
      this.cache.set(agentId, managed);
      return managed;
    }

    const stored = await this.getStoredConfig(agentId);
    const resolved = stored ?? { ...DEFAULTS };
    this.cache.set(agentId, resolved);
    return resolved;
  }

  async saveConfig(agentId: string, config: Partial<CLIAgentConfig>): Promise<CLIAgentConfig> {
    // Validate provided fields
    if (config.timeoutMs !== undefined && config.timeoutMs < 1_000) {
      throw new BadRequestException('timeoutMs must be at least 1000ms');
    }
    if (config.timeoutMs !== undefined && config.timeoutMs > 1_200_000) {
      throw new BadRequestException('timeoutMs must not exceed 1 200 000ms (20 min)');
    }
    if (config.maxOutputChars !== undefined && config.maxOutputChars < 1_000) {
      throw new BadRequestException('maxOutputChars must be at least 1000');
    }
    if (config.model !== undefined && typeof config.model !== 'string') {
      throw new BadRequestException('model must be a string');
    }
    if (config.extraArgs !== undefined && !Array.isArray(config.extraArgs)) {
      throw new BadRequestException('extraArgs must be an array');
    }

    if (await this.getManagedConfig(agentId)) {
      throw new BadRequestException(`CLI agent ${agentId} is managed by .kalio/config.toml`);
    }

    const existing = this.cache.get(agentId) ?? await this.getStoredConfig(agentId) ?? { ...DEFAULTS };
    const merged = this.normalizeConfig({ ...existing, ...config });

    await mkdir(configDir(), { recursive: true });
    await writeFile(configPath(agentId), JSON.stringify(merged, null, 2), 'utf8');

    this.cache.set(agentId, merged);
    this.logger.log(`[CLIAgentConfig] Saved config for ${agentId}`);
    return merged;
  }

  /** Evict cached config — forces next getConfig() to re-read from disk. */
  invalidate(agentId: string): void {
    this.cache.delete(agentId);
  }
}

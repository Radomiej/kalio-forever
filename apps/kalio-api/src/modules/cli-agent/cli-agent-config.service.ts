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
  timeoutMs: 900_000,
  hardTimeoutEnabled: false,
  hardTimeoutMs: 3_600_000,
  autoRecoveryEnabled: false,
  autoRecoveryPrompt: 'continue',
  maxOutputChars: 16_000,
  model: '',
  architecturePreference: '',
  extraArgs: [],
};

const CODEX_DEFAULTS: Partial<CLIAgentConfig> = {
  model: 'gpt-5.4-mini',
  architecturePreference: 'Default Codex CLI backend for conservative development and verification.',
};

const MAX_TIMEOUT_MS = 86_400_000;

function configDir(): string {
  return join(homedir(), '.kalio', 'cli-agents');
}

function configPath(agentId: string): string {
  return join(configDir(), `${agentId}.json`);
}

function defaultConfigForAgent(agentId: string): CLIAgentConfig {
  return {
    ...DEFAULTS,
    ...(agentId === 'codex' ? CODEX_DEFAULTS : {}),
  };
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
        ? Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.round(config.timeoutMs)))
        : DEFAULTS.timeoutMs,
      hardTimeoutEnabled: typeof config.hardTimeoutEnabled === 'boolean'
        ? config.hardTimeoutEnabled
        : DEFAULTS.hardTimeoutEnabled,
      hardTimeoutMs: typeof config.hardTimeoutMs === 'number' && Number.isFinite(config.hardTimeoutMs)
        ? Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.round(config.hardTimeoutMs)))
        : DEFAULTS.hardTimeoutMs,
      autoRecoveryEnabled: typeof config.autoRecoveryEnabled === 'boolean'
        ? config.autoRecoveryEnabled
        : DEFAULTS.autoRecoveryEnabled,
      autoRecoveryPrompt: typeof config.autoRecoveryPrompt === 'string' && config.autoRecoveryPrompt.trim().length > 0
        ? config.autoRecoveryPrompt.trim()
        : DEFAULTS.autoRecoveryPrompt,
      maxOutputChars: typeof config.maxOutputChars === 'number' && Number.isFinite(config.maxOutputChars)
        ? Math.max(1_000, Math.round(config.maxOutputChars))
        : DEFAULTS.maxOutputChars,
      model: typeof config.model === 'string' ? config.model.trim() : DEFAULTS.model,
      architecturePreference: typeof config.architecturePreference === 'string'
        ? config.architecturePreference.trim()
        : DEFAULTS.architecturePreference,
      extraArgs: Array.isArray(config.extraArgs)
        ? config.extraArgs.filter((value): value is string => typeof value === 'string')
        : DEFAULTS.extraArgs,
    };
  }

  private applyAgentDefaults(agentId: string, config: CLIAgentConfig): CLIAgentConfig {
    if (agentId !== 'codex') return config;

    return {
      ...config,
      model: config.model.trim().length > 0 ? config.model : CODEX_DEFAULTS.model ?? '',
      architecturePreference: config.architecturePreference.trim().length > 0
        ? config.architecturePreference
        : CODEX_DEFAULTS.architecturePreference ?? '',
    };
  }

  private async getManagedConfig(agentId: string): Promise<CLIAgentConfig | null> {
    const config = await this.kalioConfig?.getCliAgentConfig(agentId);
    return config ? this.applyAgentDefaults(agentId, this.normalizeConfig(config)) : null;
  }

  private async getStoredConfig(agentId: string): Promise<CLIAgentConfig | null> {
    try {
      const raw = await readFile(configPath(agentId), 'utf8');
      const parsed = JSON.parse(raw) as Partial<CLIAgentConfig>;
      return this.applyAgentDefaults(agentId, this.normalizeConfig(parsed));
    } catch {
      return null;
    }
  }

  async getConfig(agentId: string): Promise<CLIAgentConfig> {
    const cached = this.cache.get(agentId);
    if (cached) return cached;

    const managed = await this.getManagedConfig(agentId);
    if (managed) {
      // Do NOT cache TOML-managed configs — they refresh when KalioConfigService TTL expires.
      return managed;
    }

    const stored = await this.getStoredConfig(agentId);
    const resolved = stored ?? defaultConfigForAgent(agentId);
    this.cache.set(agentId, resolved);
    return resolved;
  }

  async saveConfig(agentId: string, config: Partial<CLIAgentConfig>): Promise<CLIAgentConfig> {
    // Validate provided fields
    if (config.timeoutMs !== undefined && config.timeoutMs < 1_000) {
      throw new BadRequestException('inactivity timeoutMs must be at least 1000ms');
    }
    if (config.timeoutMs !== undefined && config.timeoutMs > MAX_TIMEOUT_MS) {
      throw new BadRequestException('inactivity timeoutMs must not exceed 86 400 000ms (24 h)');
    }
    if (config.hardTimeoutMs !== undefined && config.hardTimeoutMs < 1_000) {
      throw new BadRequestException('hardTimeoutMs must be at least 1000ms');
    }
    if (config.hardTimeoutMs !== undefined && config.hardTimeoutMs > MAX_TIMEOUT_MS) {
      throw new BadRequestException('hardTimeoutMs must not exceed 86 400 000ms (24 h)');
    }
    if (config.hardTimeoutEnabled !== undefined && typeof config.hardTimeoutEnabled !== 'boolean') {
      throw new BadRequestException('hardTimeoutEnabled must be a boolean');
    }
    if (config.autoRecoveryEnabled !== undefined && typeof config.autoRecoveryEnabled !== 'boolean') {
      throw new BadRequestException('autoRecoveryEnabled must be a boolean');
    }
    if (config.autoRecoveryPrompt !== undefined && typeof config.autoRecoveryPrompt !== 'string') {
      throw new BadRequestException('autoRecoveryPrompt must be a string');
    }
    if (config.maxOutputChars !== undefined && config.maxOutputChars < 1_000) {
      throw new BadRequestException('maxOutputChars must be at least 1000');
    }
    if (config.model !== undefined && typeof config.model !== 'string') {
      throw new BadRequestException('model must be a string');
    }
    if (config.architecturePreference !== undefined && typeof config.architecturePreference !== 'string') {
      throw new BadRequestException('architecturePreference must be a string');
    }
    if (config.extraArgs !== undefined && !Array.isArray(config.extraArgs)) {
      throw new BadRequestException('extraArgs must be an array');
    }

    if (await this.getManagedConfig(agentId)) {
      throw new BadRequestException(`CLI agent ${agentId} is managed by .kalio/config.toml`);
    }

    const existing = this.cache.get(agentId) ?? await this.getStoredConfig(agentId) ?? defaultConfigForAgent(agentId);
    const merged = this.applyAgentDefaults(agentId, this.normalizeConfig({ ...existing, ...config }));

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

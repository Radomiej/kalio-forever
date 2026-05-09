import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CLIAgentConfig } from '@kalio/types';

export type { CLIAgentConfig };

const DEFAULTS: CLIAgentConfig = {
  enabled: true,
  cliPath: '',
  timeoutMs: 600_000,
  maxOutputChars: 16_000,
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

  async getConfig(agentId: string): Promise<CLIAgentConfig> {
    const cached = this.cache.get(agentId);
    if (cached) return cached;

    try {
      const raw = await readFile(configPath(agentId), 'utf8');
      const parsed = JSON.parse(raw) as Partial<CLIAgentConfig>;
      const merged: CLIAgentConfig = { ...DEFAULTS, ...parsed };
      this.cache.set(agentId, merged);
      return merged;
    } catch {
      // File does not exist or is unreadable — return defaults (do NOT create file here)
      return { ...DEFAULTS };
    }
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
    if (config.extraArgs !== undefined && !Array.isArray(config.extraArgs)) {
      throw new BadRequestException('extraArgs must be an array');
    }

    const existing = await this.getConfig(agentId);
    const merged: CLIAgentConfig = { ...existing, ...config };

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

import { Body, Controller, Get, NotFoundException, Param, Post, Put } from '@nestjs/common';
import type { CLIAgentAdapterInfo } from '@kalio/types';
import { CLIAgentService } from './cli-agent.service';
import { CLIAgentConfigService } from './cli-agent-config.service';
import type { CLIAgentConfig } from './cli-agent-config.service';

@Controller('cli-agents')
export class CLIAgentController {
  constructor(
    private readonly agents: CLIAgentService,
    private readonly config: CLIAgentConfigService,
  ) {}

  /**
   * Return cached probe results (populated at app startup).
   * Fast — no subprocess spawning on each FE load.
   */
  @Get()
  async listAll(): Promise<CLIAgentAdapterInfo[]> {
    return this.agents.listAll();
  }

  /**
   * Re-probe all adapters and refresh the cache.
   * Called when the user clicks "Refresh" in the UI.
   */
  @Post('refresh')
  async refreshAll(): Promise<CLIAgentAdapterInfo[]> {
    return this.agents.refreshAllProbes();
  }

  /** Re-probe a single adapter and refresh its cache entry. */
  @Get(':id/probe')
  async probe(@Param('id') id: string): Promise<{ available: boolean; version: string | null }> {
    this.assertAdapterExists(id);
    const info = await this.agents.refreshProbe(id);
    return { available: info?.available ?? false, version: info?.version ?? null };
  }

  /** Get persisted config for an adapter (returns defaults if not saved yet). */
  @Get(':id/config')
  async getConfig(@Param('id') id: string): Promise<CLIAgentConfig> {
    this.assertAdapterExists(id);
    return this.config.getConfig(id);
  }

  /** Persist config for an adapter. */
  @Put(':id/config')
  async saveConfig(
    @Param('id') id: string,
    @Body() body: Partial<CLIAgentConfig>,
  ): Promise<CLIAgentConfig> {
    this.assertAdapterExists(id);
    return this.config.saveConfig(id, body);
  }

  private assertAdapterExists(id: string): void {
    if (!this.agents.getAdapter(id)) {
      throw new NotFoundException(`Unknown CLI agent: ${id}`);
    }
  }
}

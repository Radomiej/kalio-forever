import { BadRequestException, Body, Controller, Get, NotFoundException, Optional, Param, Patch, Post } from '@nestjs/common';
import type { CLIAgentAdapterInfo, ExecutionProfile } from '@kalio/types';
import { CLIAgentService } from '../cli-agent/cli-agent.service';
import { CodexAppServerHost, type CodexAppServerHostStatus } from './codex-app-server.host';
import { CodexMcpPolicyService, type CodexMcpPolicySettings } from './codex-mcp-policy.service';
import { ExecutionProfileService } from './execution-profile.service';
import { readCodexModels } from './codex-model-catalog';

export interface NativeCliIntegrationStatus extends CodexAppServerHostStatus {
  id: string;
  provider: 'codex' | 'claude';
  displayName: string;
  kind: 'codex-app-server' | 'claude-agent-sdk';
  probeChecked?: boolean;
  profileIds: string[];
  models: string[];
  mcp: CodexMcpPolicySettings;
}

interface UpdateCodexMcpSettingsDto {
  inheritConfiguredMcp?: unknown;
}

@Controller('runtime/native-cli-integrations')
export class NativeCliIntegrationController {
  private claudeProbe?: CLIAgentAdapterInfo;
  private readonly modelCatalogs = new Map<string, { processEpoch: string; models: string[]; checkedAt: number }>();
  private readonly modelChecks = new Map<string, { processEpoch: string; promise: Promise<string[]> }>();

  constructor(
    private readonly profiles: ExecutionProfileService,
    private readonly codexHost: CodexAppServerHost,
    private readonly codexMcpPolicy: CodexMcpPolicyService,
    @Optional() private readonly cliAgents?: CLIAgentService,
  ) {}

  @Get()
  async list(): Promise<NativeCliIntegrationStatus[]> {
    const profiles = await this.profiles.list();
    return this.toStatuses(profiles);
  }

  @Post(':authProfileId/check')
  async check(@Param('authProfileId') authProfileId: string): Promise<NativeCliIntegrationStatus> {
    const status = await this.findStatus(authProfileId);
    if (status.provider === 'codex') await this.codexHost.getConnection(authProfileId, 'settings-check');
    else {
      const probe = await this.cliAgents?.refreshProbe('claude');
      if (probe) this.claudeProbe = probe;
    }
    return (await this.list()).find((item) => item.authProfileId === authProfileId) ?? status;
  }

  @Post(':authProfileId/reset')
  async reset(@Param('authProfileId') authProfileId: string): Promise<NativeCliIntegrationStatus> {
    const status = await this.findStatus(authProfileId);
    if (status.provider === 'codex') await this.codexHost.reset(authProfileId);
    return this.findStatus(authProfileId);
  }

  @Get(':authProfileId/models')
  async getModels(@Param('authProfileId') authProfileId: string) {
    const status = await this.findStatus(authProfileId);
    const catalog = this.modelCatalogs.get(authProfileId);
    // Polling must never start a CLI process, and a restarted host invalidates its catalog.
    return status.connected && catalog?.processEpoch === status.processEpoch ? catalog : null;
  }

  @Post(':authProfileId/models/check')
  async checkModels(@Param('authProfileId') authProfileId: string) {
    const status = await this.findStatus(authProfileId);
    if (status.provider !== 'codex') throw new BadRequestException('Model discovery requires a Codex integration.');
    const connection = await this.codexHost.getConnection(authProfileId, 'model-catalog');
    let check = this.modelChecks.get(authProfileId);
    if (check?.processEpoch !== connection.processEpoch) {
      this.modelCatalogs.delete(authProfileId);
      check = { processEpoch: connection.processEpoch, promise: readCodexModels(connection) };
      this.modelChecks.set(authProfileId, check);
    }
    try {
      const models = await check.promise;
      const current = this.codexHost.getStatus(authProfileId);
      if (!current.connected || current.processEpoch !== connection.processEpoch) {
        throw new BadRequestException('Codex host changed during model discovery; recheck the integration.');
      }
      const catalog = { processEpoch: connection.processEpoch, models, checkedAt: Date.now() };
      this.modelCatalogs.set(authProfileId, catalog);
      return catalog;
    } finally {
      if (this.modelChecks.get(authProfileId) === check) this.modelChecks.delete(authProfileId);
    }
  }

  @Get(':authProfileId/settings')
  async getSettings(@Param('authProfileId') authProfileId: string): Promise<CodexMcpPolicySettings> {
    await this.findStatus(authProfileId);
    return this.codexMcpPolicy.get(authProfileId);
  }

  @Patch(':authProfileId/settings')
  async updateSettings(
    @Param('authProfileId') authProfileId: string,
    @Body() dto: UpdateCodexMcpSettingsDto,
  ): Promise<CodexMcpPolicySettings> {
    await this.findStatus(authProfileId);
    if (typeof dto.inheritConfiguredMcp !== 'boolean') {
      throw new BadRequestException('inheritConfiguredMcp must be a boolean.');
    }

    const settings = await this.codexMcpPolicy.update(authProfileId, dto.inheritConfiguredMcp);
    await this.codexHost.reset(authProfileId);
    return settings;
  }

  private async findStatus(authProfileId: string): Promise<NativeCliIntegrationStatus> {
    const status = (await this.list()).find((item) => item.authProfileId === authProfileId);
    if (!status) {
      throw new NotFoundException(`Native CLI integration not found: ${authProfileId}`);
    }
    return status;
  }

  private async toStatuses(profiles: ExecutionProfile[]): Promise<NativeCliIntegrationStatus[]> {
    const codexGroups = new Map<string, ExecutionProfile[]>();
    const claudeGroups = new Map<string, ExecutionProfile[]>();
    for (const profile of profiles) {
      if (profile.kind !== 'codex-app-server' && profile.kind !== 'claude-agent-sdk') continue;
      const authProfileId = profile.authProfileId?.trim() || profile.id;
      const groups = profile.kind === 'codex-app-server' ? codexGroups : claudeGroups;
      const group = groups.get(authProfileId) ?? [];
      group.push(profile);
      groups.set(authProfileId, group);
    }

    const codexStatuses = await Promise.all([...codexGroups.entries()].map(async ([authProfileId, group]) => ({
      id: `codex:${authProfileId}`,
      provider: 'codex' as const,
      displayName: `Codex App Server (${authProfileId})`,
      kind: 'codex-app-server' as const,
      profileIds: group.map((profile) => profile.id),
      models: [...new Set(group.map((profile) => profile.model).filter(Boolean))],
      mcp: await this.codexMcpPolicy.get(authProfileId),
      ...this.codexHost.getStatus(authProfileId),
    })));
    const claudeStatuses = await Promise.all([...claudeGroups.entries()].map(async ([authProfileId, group]) => {
      const probe = this.claudeProbe ?? null;
      return {
        id: `claude:${authProfileId}`,
        provider: 'claude' as const,
        displayName: 'Claude — local login',
        kind: 'claude-agent-sdk' as const,
        authProfileId,
        status: probe?.available ? 'online' as const : probe ? 'error' as const : 'offline' as const,
        connected: probe?.available ?? false,
        openSessionCount: 0,
        probeChecked: probe !== null,
        ...(probe?.version ? { processEpoch: probe.version } : {}),
        ...(probe && !probe.available ? { lastError: 'Claude Code CLI is not available on this workstation.' } : {}),
        profileIds: group.map((profile) => profile.id),
        models: [...new Set(group.map((profile) => profile.model).filter(Boolean))],
        mcp: { inheritConfiguredMcp: false, source: 'default' as const },
      };
    }));
    return [...codexStatuses, ...claudeStatuses];
  }
}

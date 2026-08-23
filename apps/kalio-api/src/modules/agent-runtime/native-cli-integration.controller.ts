import { BadRequestException, Body, Controller, Get, NotFoundException, Optional, Param, Patch, Post } from '@nestjs/common';
import type { ExecutionProfile } from '@kalio/types';
import { CLIAgentService } from '../cli-agent/cli-agent.service';
import { CodexAppServerHost, type CodexAppServerHostStatus } from './codex-app-server.host';
import { CodexMcpPolicyService, type CodexMcpPolicySettings } from './codex-mcp-policy.service';
import { ExecutionProfileService } from './execution-profile.service';

export interface NativeCliIntegrationStatus extends CodexAppServerHostStatus {
  id: string;
  provider: 'codex' | 'claude';
  displayName: string;
  kind: 'codex-app-server' | 'claude-agent-sdk';
  profileIds: string[];
  models: string[];
  mcp: CodexMcpPolicySettings;
}

interface UpdateCodexMcpSettingsDto {
  inheritConfiguredMcp?: unknown;
}

@Controller('runtime/native-cli-integrations')
export class NativeCliIntegrationController {
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
    else await this.cliAgents?.probe('claude');
    return (await this.list()).find((item) => item.authProfileId === authProfileId) ?? status;
  }

  @Post(':authProfileId/reset')
  async reset(@Param('authProfileId') authProfileId: string): Promise<NativeCliIntegrationStatus> {
    const status = await this.findStatus(authProfileId);
    if (status.provider === 'codex') await this.codexHost.reset(authProfileId);
    return this.findStatus(authProfileId);
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
      const probe = await this.cliAgents?.probe('claude') ?? { available: false, version: null };
      return {
        id: `claude:${authProfileId}`,
        provider: 'claude' as const,
        displayName: 'Claude — local login',
        kind: 'claude-agent-sdk' as const,
        authProfileId,
        status: probe.available ? 'online' as const : 'error' as const,
        connected: probe.available,
        openSessionCount: 0,
        ...(probe.version ? { processEpoch: probe.version } : {}),
        ...(probe.available ? {} : { lastError: 'Claude Code CLI is not available on this workstation.' }),
        profileIds: group.map((profile) => profile.id),
        models: [...new Set(group.map((profile) => profile.model).filter(Boolean))],
        mcp: { inheritConfiguredMcp: false, source: 'default' as const },
      };
    }));
    return [...codexStatuses, ...claudeStatuses];
  }
}

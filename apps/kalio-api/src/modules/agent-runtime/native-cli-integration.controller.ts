import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import type { ExecutionProfile } from '@kalio/types';
import { CodexAppServerHost, type CodexAppServerHostStatus } from './codex-app-server.host';
import { CodexMcpPolicyService, type CodexMcpPolicySettings } from './codex-mcp-policy.service';
import { ExecutionProfileService } from './execution-profile.service';

export interface NativeCliIntegrationStatus extends CodexAppServerHostStatus {
  id: string;
  provider: 'codex';
  displayName: string;
  kind: 'codex-app-server';
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
  ) {}

  @Get()
  async list(): Promise<NativeCliIntegrationStatus[]> {
    const profiles = await this.profiles.list();
    return this.toStatuses(profiles);
  }

  @Post(':authProfileId/check')
  async check(@Param('authProfileId') authProfileId: string): Promise<NativeCliIntegrationStatus> {
    const status = await this.findStatus(authProfileId);
    await this.codexHost.getConnection(authProfileId, 'settings-check');
    return (await this.list()).find((item) => item.authProfileId === authProfileId) ?? status;
  }

  @Post(':authProfileId/reset')
  async reset(@Param('authProfileId') authProfileId: string): Promise<NativeCliIntegrationStatus> {
    await this.findStatus(authProfileId);
    await this.codexHost.reset(authProfileId);
    return (await this.list()).find((item) => item.authProfileId === authProfileId) as NativeCliIntegrationStatus;
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
    const grouped = new Map<string, ExecutionProfile[]>();
    for (const profile of profiles) {
      if (profile.kind !== 'codex-app-server') continue;
      const authProfileId = profile.authProfileId?.trim() || profile.id;
      const group = grouped.get(authProfileId) ?? [];
      group.push(profile);
      grouped.set(authProfileId, group);
    }

    return Promise.all([...grouped.entries()].map(async ([authProfileId, group]) => ({
      id: `codex:${authProfileId}`,
      provider: 'codex',
      displayName: `Codex App Server (${authProfileId})`,
      kind: 'codex-app-server',
      profileIds: group.map((profile) => profile.id),
      models: [...new Set(group.map((profile) => profile.model).filter(Boolean))],
      mcp: await this.codexMcpPolicy.get(authProfileId),
      ...this.codexHost.getStatus(authProfileId),
    })));
  }
}

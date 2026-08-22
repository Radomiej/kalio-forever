import { Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import type { ExecutionProfile } from '@kalio/types';
import { CodexAppServerHost, type CodexAppServerHostStatus } from './codex-app-server.host';
import { ExecutionProfileService } from './execution-profile.service';

export interface NativeCliIntegrationStatus extends CodexAppServerHostStatus {
  id: string;
  provider: 'codex';
  displayName: string;
  kind: 'codex-app-server';
  profileIds: string[];
  models: string[];
}

@Controller('runtime/native-cli-integrations')
export class NativeCliIntegrationController {
  constructor(
    private readonly profiles: ExecutionProfileService,
    private readonly codexHost: CodexAppServerHost,
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

  private async findStatus(authProfileId: string): Promise<NativeCliIntegrationStatus> {
    const status = (await this.list()).find((item) => item.authProfileId === authProfileId);
    if (!status) {
      throw new NotFoundException(`Native CLI integration not found: ${authProfileId}`);
    }
    return status;
  }

  private toStatuses(profiles: ExecutionProfile[]): NativeCliIntegrationStatus[] {
    const grouped = new Map<string, ExecutionProfile[]>();
    for (const profile of profiles) {
      if (profile.kind !== 'codex-app-server') continue;
      const authProfileId = profile.authProfileId?.trim() || profile.id;
      const group = grouped.get(authProfileId) ?? [];
      group.push(profile);
      grouped.set(authProfileId, group);
    }

    return [...grouped.entries()].map(([authProfileId, group]) => ({
      id: `codex:${authProfileId}`,
      provider: 'codex',
      displayName: `Codex App Server (${authProfileId})`,
      kind: 'codex-app-server',
      profileIds: group.map((profile) => profile.id),
      models: [...new Set(group.map((profile) => profile.model).filter(Boolean))],
      ...this.codexHost.getStatus(authProfileId),
    }));
  }
}

import { BadRequestException, Injectable, Logger, Optional, type OnApplicationBootstrap } from '@nestjs/common';
import { AppSettingsService } from '../../database/app-settings.service';
import { ExecutionProfileService } from './execution-profile.service';
import { DevinCliProbeService } from './devin-cli-probe.service';

const DEFAULT_PROFILE_KEY = 'runtime.defaultExecutionProfileId';

/** Persist user choice separately from transient host availability. */
@Injectable()
export class DefaultExecutionProfileService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DefaultExecutionProfileService.name);
  constructor(
    private readonly settings: AppSettingsService,
    private readonly profiles: ExecutionProfileService,
    @Optional() private readonly devinProbe?: DevinCliProbeService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const id = await this.getId();
    if (!id) return;
    try {
      const profile = await this.profiles.assertEnabled(id);
      if (profile.kind === 'devin-cli-acp') await this.devinProbe?.getStatus(true);
    } catch {
      this.logger.warn('Saved default runtime is unavailable; retaining the user selection.');
    }
  }

  getId(): Promise<string | null> {
    return this.settings.get(DEFAULT_PROFILE_KEY);
  }

  async select(id: string): Promise<{ executionProfileId: string }> {
    const normalized = id.trim();
    if (!normalized) throw new BadRequestException('An execution profile is required.');
    await this.profiles.assertEnabled(normalized);
    await this.settings.set(DEFAULT_PROFILE_KEY, normalized);
    return { executionProfileId: normalized };
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import type { ProjectContextSettings } from '@kalio/types';
import { AppSettingsService } from '../../database/app-settings.service';

export const PROJECT_CONTEXT_SETTINGS_KEY = 'project_context_settings';
export function parseProjectContextSettings(value: unknown): ProjectContextSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('INVALID_PROJECT_CONTEXT_SETTINGS');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 3 || Object.keys(input).some(key => !['enabled', 'modelRevision', 'providerScope'].includes(key))
    || typeof input.enabled !== 'boolean' || typeof input.modelRevision !== 'string' || typeof input.providerScope !== 'string') {
    throw new BadRequestException('INVALID_PROJECT_CONTEXT_SETTINGS');
  }
  if (input.modelRevision.length > 256 || input.providerScope.length > 256
    || input.modelRevision !== input.modelRevision.trim() || input.providerScope !== input.providerScope.trim()
    || input.enabled && !input.modelRevision || !input.providerScope) {
    throw new BadRequestException('INVALID_PROJECT_CONTEXT_SETTINGS');
  }
  return { enabled: input.enabled, modelRevision: input.modelRevision, providerScope: input.providerScope };
}

@Injectable()
export class ProjectContextSettingsService {
  constructor(private readonly settings: AppSettingsService) {}
  async get(): Promise<ProjectContextSettings> {
    const raw = await this.settings.get(PROJECT_CONTEXT_SETTINGS_KEY);
    const parsed = raw === null ? { enabled: false } : this.parseInput(JSON.parse(raw));
    return { enabled: parsed.enabled, modelRevision: 'unresolved', providerScope: 'unresolved' };
  }
  async put(value: unknown): Promise<ProjectContextSettings> {
    const next = { enabled: this.parseInput(value).enabled };
    await this.settings.set(PROJECT_CONTEXT_SETTINGS_KEY, JSON.stringify(next));
    return { enabled: next.enabled, modelRevision: 'unresolved', providerScope: 'unresolved' };
  }
  private parseInput(value: unknown): Pick<ProjectContextSettings, 'enabled'> | ProjectContextSettings {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const input = value as Record<string, unknown>;
      if (Object.keys(input).length === 1 && typeof input.enabled === 'boolean') return { enabled: input.enabled };
    }
    // TODO: legacy fallback — old clients and saved settings still carry manual identity fields; never trust them.
    return parseProjectContextSettings(value);
  }
  async assertEnabled(): Promise<void> {
    if (!(await this.get()).enabled) throw new Error('PROJECT_CONTEXT_DISABLED');
  }
}

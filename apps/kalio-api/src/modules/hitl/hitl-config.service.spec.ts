import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../database/schema';
import { DrizzleService } from '../../database/drizzle.service';
import { AppSettingsService } from '../../database/app-settings.service';
import { HitlConfigService } from './hitl-config.service';

function makeTestDrizzle(): DrizzleService {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  const db = drizzle(sqlite, { schema });

  const drizzleSvc = new DrizzleService(null as never);
  (drizzleSvc as unknown as { db: typeof db }).db = db;
  return drizzleSvc;
}

describe('HitlConfigService', () => {
  let service: HitlConfigService;
  let personaService: { findOne: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    const drizzleService = makeTestDrizzle();
    const appSettings = new AppSettingsService(drizzleService);
    personaService = {
      findOne: vi.fn().mockResolvedValue({ id: 'reviewer-persona' }),
    };
    service = new HitlConfigService(appSettings, personaService as never);
  });

  it('returns manual defaults when no HITL config is stored', async () => {
    await expect(service.getConfig()).resolves.toEqual({
      mode: 'manual',
      autoPersonaId: null,
    });
  });

  it('persists auto mode with the configured persona id', async () => {
    await expect(service.updateConfig({ mode: 'auto', autoPersonaId: 'reviewer-persona' })).resolves.toEqual({
      mode: 'auto',
      autoPersonaId: 'reviewer-persona',
    });

    expect(personaService.findOne).toHaveBeenCalledWith('reviewer-persona');
    await expect(service.getConfig()).resolves.toEqual({
      mode: 'auto',
      autoPersonaId: 'reviewer-persona',
    });
  });

  it('rejects auto mode when no persona is configured', async () => {
    await expect(service.updateConfig({ mode: 'auto', autoPersonaId: null })).rejects.toThrow(BadRequestException);
  });

  it('rejects auto mode when the configured persona does not exist', async () => {
    personaService.findOne.mockRejectedValue(new NotFoundException('missing persona'));

    await expect(service.updateConfig({ mode: 'auto', autoPersonaId: 'missing' })).rejects.toThrow(BadRequestException);
  });

  it('allows switching to manual when the previously saved auto persona no longer exists', async () => {
    await expect(service.updateConfig({ mode: 'auto', autoPersonaId: 'reviewer-persona' })).resolves.toEqual({
      mode: 'auto',
      autoPersonaId: 'reviewer-persona',
    });

    personaService.findOne.mockRejectedValue(new NotFoundException('missing persona'));

    await expect(service.updateConfig({ mode: 'manual' })).resolves.toEqual({
      mode: 'manual',
      autoPersonaId: 'reviewer-persona',
    });
  });
});
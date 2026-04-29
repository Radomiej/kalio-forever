import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DrizzleService } from './drizzle.service';
import { appSettings } from './schema';

/**
 * Key-value store for application-level configuration.
 * Backed by the `app_settings` table — survives restarts.
 */
@Injectable()
export class AppSettingsService {
  constructor(private readonly drizzle: DrizzleService) {}

  async get(key: string): Promise<string | null> {
    const row = await this.drizzle.db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .then((r) => r[0]);
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.drizzle.db
      .insert(appSettings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt: new Date() },
      });
  }

  async delete(key: string): Promise<void> {
    await this.drizzle.db
      .delete(appSettings)
      .where(eq(appSettings.key, key));
  }

  async getAll(prefix: string): Promise<Record<string, string>> {
    const rows = await this.drizzle.db
      .select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings);
    const result: Record<string, string> = {};
    for (const row of rows) {
      if (row.key.startsWith(prefix)) {
        result[row.key] = row.value;
      }
    }
    return result;
  }
}

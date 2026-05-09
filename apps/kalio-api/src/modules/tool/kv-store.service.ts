import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import { sessions, personaKV } from '../../database/schema';

/**
 * Persona-scoped KV store backed by the persona_kv SQLite table.
 * Scope: per-persona — all sessions of the same persona share the same KV namespace.
 */
@Injectable()
export class KVStoreService {
  private readonly logger = new Logger(KVStoreService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  private async resolvePersonaId(sessionId: string): Promise<string> {
    const row = await this.drizzle.db
      .select({ personaId: sessions.personaId })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .then((r) => r[0]);

    if (!row) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }
    return row.personaId;
  }

  async get(sessionId: string, key: string): Promise<string | undefined> {
    const personaId = await this.resolvePersonaId(sessionId);
    const row = await this.drizzle.db
      .select({ value: personaKV.value })
      .from(personaKV)
      .where(and(eq(personaKV.personaId, personaId), eq(personaKV.key, key)))
      .then((r) => r[0]);
    return row?.value;
  }

  async set(sessionId: string, key: string, value: string): Promise<void> {
    const personaId = await this.resolvePersonaId(sessionId);
    const now = new Date();
    const existing = await this.drizzle.db
      .select({ id: personaKV.id })
      .from(personaKV)
      .where(and(eq(personaKV.personaId, personaId), eq(personaKV.key, key)))
      .then((r) => r[0]);

    if (existing) {
      await this.drizzle.db
        .update(personaKV)
        .set({ value, updatedAt: now })
        .where(eq(personaKV.id, existing.id));
    } else {
      await this.drizzle.db.insert(personaKV).values({
        id: nanoid(),
        personaId,
        key,
        value,
        updatedAt: now,
      });
    }
    this.logger.debug(`[kv_set] persona=${personaId} key=${key}`);
  }

  async delete(sessionId: string, key: string): Promise<boolean> {
    const personaId = await this.resolvePersonaId(sessionId);
    const existing = await this.drizzle.db
      .select({ id: personaKV.id })
      .from(personaKV)
      .where(and(eq(personaKV.personaId, personaId), eq(personaKV.key, key)))
      .then((r) => r[0]);

    if (!existing) return false;
    await this.drizzle.db.delete(personaKV).where(eq(personaKV.id, existing.id));
    return true;
  }

  async list(sessionId: string): Promise<Record<string, string>> {
    const personaId = await this.resolvePersonaId(sessionId);
    const rows = await this.drizzle.db
      .select({ key: personaKV.key, value: personaKV.value })
      .from(personaKV)
      .where(eq(personaKV.personaId, personaId));

    const result: Record<string, string> = {};
    for (const row of rows) result[row.key] = row.value;
    return result;
  }
}

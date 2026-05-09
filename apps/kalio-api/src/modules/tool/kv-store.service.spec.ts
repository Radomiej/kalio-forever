import { describe, it, expect, beforeEach } from 'vitest';
import { KVStoreService } from './kv-store.service';
import { DrizzleService } from '../../database/drizzle.service';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../database/schema';

// ── In-memory DB helper ───────────────────────────────────────────────────────

function makeTestDrizzle(): DrizzleService {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL,
      allowed_tools TEXT NOT NULL DEFAULT '[]',
      skill_ids TEXT NOT NULL DEFAULT '[]',
      mcp_policy TEXT NOT NULL DEFAULT 'allow_all',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      persona_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'chat',
      parent_session_id TEXT,
      parent_turn_id TEXT,
      parent_tool_call_id TEXT,
      interlocutor_label TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS persona_kv (
      id TEXT PRIMARY KEY,
      persona_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  const db = drizzle(sqlite, { schema });
  const drizzleSvc = new DrizzleService(null as never);
  (drizzleSvc as unknown as { db: typeof db }).db = db;
  return drizzleSvc;
}

// ── Seed helpers ──────────────────────────────────────────────────────────────

const NOW = Date.now();

async function seedPersona(drizzleSvc: DrizzleService, id: string) {
  await drizzleSvc.db.insert(schema.personas).values({
    id,
    name: `Persona ${id}`,
    systemPrompt: '',
    model: 'test-model',
    allowedTools: [],
    skillIds: [],
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
  });
}

async function seedSession(drizzleSvc: DrizzleService, sessionId: string, personaId: string) {
  await drizzleSvc.db.insert(schema.sessions).values({
    id: sessionId,
    personaId,
    title: '',
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('KVStoreService (persona_kv integration)', () => {
  let drizzleSvc: DrizzleService;
  let svc: KVStoreService;

  beforeEach(async () => {
    drizzleSvc = makeTestDrizzle();
    svc = new KVStoreService(drizzleSvc);
    await seedPersona(drizzleSvc, 'persona-1');
    await seedSession(drizzleSvc, 'session-1', 'persona-1');
  });

  describe('set / get round-trip', () => {
    it('stores and retrieves a value by key', async () => {
      await svc.set('session-1', 'greeting', 'hello');
      const value = await svc.get('session-1', 'greeting');
      expect(value).toBe('hello');
    });

    it('returns undefined for a key that was never written', async () => {
      const value = await svc.get('session-1', 'nonexistent');
      expect(value).toBeUndefined();
    });

    it('overwrites an existing key on second set', async () => {
      await svc.set('session-1', 'counter', '1');
      await svc.set('session-1', 'counter', '2');
      const value = await svc.get('session-1', 'counter');
      expect(value).toBe('2');
    });
  });

  describe('list', () => {
    it('returns all key-value pairs for the persona', async () => {
      await svc.set('session-1', 'a', 'alpha');
      await svc.set('session-1', 'b', 'beta');
      const entries = await svc.list('session-1');
      expect(entries).toEqual({ a: 'alpha', b: 'beta' });
    });

    it('returns empty object when no keys exist', async () => {
      const entries = await svc.list('session-1');
      expect(entries).toEqual({});
    });
  });

  describe('delete', () => {
    it('removes a key and returns true', async () => {
      await svc.set('session-1', 'tmp', 'value');
      const deleted = await svc.delete('session-1', 'tmp');
      expect(deleted).toBe(true);
      expect(await svc.get('session-1', 'tmp')).toBeUndefined();
    });

    it('returns false when key does not exist', async () => {
      const deleted = await svc.delete('session-1', 'missing');
      expect(deleted).toBe(false);
    });
  });

  describe('persona-scope: two sessions share the same KV namespace', () => {
    it('data written from session-1 is visible from session-2 (same persona)', async () => {
      await seedSession(drizzleSvc, 'session-2', 'persona-1');

      await svc.set('session-1', 'shared-key', 'shared-value');
      const fromSession2 = await svc.get('session-2', 'shared-key');

      expect(fromSession2).toBe('shared-value');
    });

    it('data written from session-A is NOT visible from session-B (different personas)', async () => {
      await seedPersona(drizzleSvc, 'persona-2');
      await seedSession(drizzleSvc, 'session-p2', 'persona-2');

      await svc.set('session-1', 'isolated-key', 'persona1-value');
      const fromOtherPersona = await svc.get('session-p2', 'isolated-key');

      expect(fromOtherPersona).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('throws NotFoundException when sessionId does not exist', async () => {
      await expect(svc.get('bad-session-id', 'key')).rejects.toThrow('bad-session-id');
    });

    it('throws NotFoundException on set for unknown session', async () => {
      await expect(svc.set('ghost-session', 'k', 'v')).rejects.toThrow('ghost-session');
    });

    it('throws NotFoundException on list for unknown session', async () => {
      await expect(svc.list('phantom-session')).rejects.toThrow('phantom-session');
    });
  });
});

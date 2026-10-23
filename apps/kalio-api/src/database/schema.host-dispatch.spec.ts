import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('host dispatch receipt migration', () => {
  it('creates an exact composite-key store without cascading session ownership', () => {
    const client = new Database(':memory:');
    try {
      migrate(drizzle(client), { migrationsFolder: resolve(__dirname, 'migrations') });
      const columns = client.prepare('PRAGMA table_info(host_dispatch_receipts)').all() as
        { name: string; type: string; notnull: number; pk: number }[];
      expect(columns.map(column => column.name)).toEqual(['run_id', 'session_id', 'turn_id',
        'prompt_message_id', 'call_id', 'record_json', 'record_sha256', 'created_at']);
      expect(columns.every(column => column.notnull === 1)).toBe(true);
      expect(columns.filter(column => column.pk).map(column => column.pk)).toEqual([1, 2, 3, 4, 5]);
      expect(client.prepare('PRAGMA foreign_key_list(host_dispatch_receipts)').all()).toEqual([]);
      const insert = client.prepare('INSERT INTO host_dispatch_receipts VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const values = ['run', 'session', 'turn', 'prompt', 'call', '{"version":1}', 'a'.repeat(64), 1];
      insert.run(...values);
      expect(() => insert.run(...values)).toThrow(/UNIQUE constraint/);
      insert.run('run', 'session', 'turn', 'prompt', 'other-call', '{"version":1}', 'a'.repeat(64), 2);
      expect(client.prepare('SELECT count(*) AS count FROM host_dispatch_receipts').get()).toEqual({ count: 2 });
      expect(client.prepare("SELECT name FROM sqlite_master WHERE name = 'credentials'").get()).toEqual({ name: 'credentials' });
    } finally { client.close(); }
  });
});

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(__dirname, 'migrations/0036_shared_decision_settings.sql'), 'utf8');

describe('shared Decision Settings migration', () => {
  it.each([false, true])('preserves credential selection without retaining old configuration (new config: %s)', (hasNewConfig) => {
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)');
      const insert = db.prepare('INSERT INTO app_settings VALUES (?, ?, 1)');
      insert.run('hitl.jevCredentialId', 'selected-router');
      insert.run('hitl.mode', 'jev');
      const custom = { provider: 'custom', model: 'local', credentialId: null, endpoint: 'http://127.0.0.1:9090/decide' };
      if (hasNewConfig) insert.run('decision.config', JSON.stringify(custom));
      db.exec(sql);
      db.exec(sql);
      const selected = db.prepare('SELECT value FROM app_settings WHERE key = ?');
      expect(selected.get('hitl.jevCredentialId')).toBeUndefined();
      expect(selected.get('hitl.mode')).toEqual({ value: 'jev' });
      expect(JSON.parse((selected.get('decision.config') as { value: string }).value)).toEqual(hasNewConfig ? custom : { provider: 'openrouter', model: 'typesafe/jev-1.13', credentialId: 'selected-router', endpoint: '' });
    } finally {
      db.close();
    }
  });
});

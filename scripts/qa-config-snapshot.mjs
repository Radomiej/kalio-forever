import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Local backup contains secrets: never print rows, export to docs, or commit it.
const require = createRequire(new URL('../apps/kalio-api/package.json', import.meta.url));
const Database = require('better-sqlite3');
const qaDataRoot = process.env.KALIO_QA_DATA_ROOT
  ?? `${process.env.LOCALAPPDATA}/kalio-forever-qa`;
const db = new Database(`${qaDataRoot}/kalio-qa.db`, { readonly: true });
try {
  const configuration = ['app_settings', 'execution_profiles'].map(table => {
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
    return { table, count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
  });
  if (process.argv.includes('--backup')) {
    const directory = resolve('.tmp', 'qa-backups');
    mkdirSync(directory, { recursive: true });
    const path = resolve(directory, `qa-${Date.now()}-${process.pid}.db`);
    await db.backup(path);
    const copy = new Database(path, { readonly: true });
    try {
      const integrity = copy.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') throw new Error('Backup integrity failed');
      console.log(JSON.stringify({ backupPath: path, integrity }));
    } finally { copy.close(); }
  }
  console.log(JSON.stringify({ configuration }));
} finally { db.close(); }

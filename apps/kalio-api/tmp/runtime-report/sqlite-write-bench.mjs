import { performance } from 'node:perf_hooks';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = './tmp/runtime-report/sqlite-write-bench.db';
const DIM = 384;
const ROWS = 1000;

const abs = path.resolve(DB_PATH);
fs.mkdirSync(path.dirname(abs), { recursive: true });
if (fs.existsSync(abs)) {
  fs.unlinkSync(abs);
}

const db = new Database(abs);
sqliteVec.load(db);

db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    embedding_model TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
    id TEXT PRIMARY KEY,
    embedding float[${DIM}]
  );
`);

function makeVec(seed) {
  const arr = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) {
    arr[i] = ((seed + i) % 97) / 97;
  }
  return arr;
}

const insertMeta = db.prepare('INSERT OR REPLACE INTO memories (id, content, metadata, embedding_model, created_at) VALUES (?, ?, ?, ?, ?)');
const deleteVec = db.prepare('DELETE FROM memories_vec WHERE id = ?');
const insertVec = db.prepare('INSERT INTO memories_vec (id, embedding) VALUES (?, ?)');

const tx = db.transaction((rows) => {
  const now = Date.now();
  for (let i = 0; i < rows; i++) {
    const id = `row-${i}`;
    insertMeta.run(id, `content ${i}`, '{}', 'bench-model', now);
    deleteVec.run(id);
    insertVec.run(id, makeVec(i));
  }
});

const t0 = performance.now();
tx(ROWS);
const t1 = performance.now();

const count = db.prepare('SELECT COUNT(*) as cnt FROM memories').get().cnt;
const ms = +(t1 - t0).toFixed(2);
const rowsPerSec = +((ROWS / ms) * 1000).toFixed(2);
const avgRowMs = +(ms / ROWS).toFixed(4);

console.log(JSON.stringify({
  dbPath: abs,
  dimensions: DIM,
  rows: ROWS,
  stored: count,
  writeMs: ms,
  rowsPerSec,
  avgRowMs,
}, null, 2));

db.close();

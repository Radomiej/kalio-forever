import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fuseMemoryRanks, listMemorySources, readMemorySource } from './memory-partitions';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('memory partition migration sources', () => {
  it('reads legacy metadata without adding embedding columns, vector or FTS tables', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kalio-partitions-'));
    directories.push(directory);
    const source = path.join(directory, 'persona.ollama-old.db');
    const db = new Database(source);
    db.exec(`CREATE TABLE memories (id TEXT, content TEXT, metadata TEXT, created_at INTEGER);
      INSERT INTO memories VALUES ('old', 'old text', '{"source":"conversation"}', 123);`);
    db.close();
    const bytes = fs.readFileSync(source);
    expect(readMemorySource(source)).toEqual([{ id: 'old', content: 'old text', metadata: { source: 'conversation' }, embeddingModel: '', createdAt: 123 }]);
    expect(fs.readFileSync(source)).toEqual(bytes);
    expect(listMemorySources(directory, 'persona')).toEqual([{ dbPath: source, kind: undefined }]);
  });

  it('fuses ranks without mixing incomparable scores', () => {
    const entry = (id: string, score: number) => ({ id, score, content: id, metadata: {}, createdAt: 1 });
    const result = fuseMemoryRanks([[entry('a', 1000), entry('b', 1)], [entry('b', -1000)]], 2);
    expect(result.map(entry => entry.id)).toEqual(['b', 'a']);
    expect(result[0]?.score).toBeCloseTo(1 / 62 + 1 / 61);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ProjectResourceIndexStorage } from './project-resource-index-storage';

const roots: string[] = [];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'kalio-index-storage-'));
  roots.push(root);
  return { root, base: join(root, 'project-resources'), storage: new ProjectResourceIndexStorage(root) };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
describe('project resource VFS storage', () => {
  it('observes missing databases without allocating directories and preserves the exact hashed path', () => {
    const { root, base, storage } = fixture();
    expect(storage.exists('project', 'space')).toBe(false);
    expect(fs.existsSync(base)).toBe(false);
    const filename = storage.prepare('project', 'space');
    expect(filename).toBe(join(root, 'project-resources', hash('project'), `${hash('space')}.db`));
    expect(fs.existsSync(filename)).toBe(false);
    expect(storage.exists('project', 'space')).toBe(false);
    fs.writeFileSync(filename, 'existing');
    expect(storage.exists('project', 'space')).toBe(true);
  });
  it('exposes permission failures instead of treating them as missing databases', () => {
    const { storage } = fixture();
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' });
    vi.spyOn(fs, 'statSync').mockImplementation(() => { throw denied; });
    expect(() => storage.exists('project', 'space')).toThrow(denied);
    expect(() => storage.prepare('project', 'space')).toThrow(denied);
  });
  it.each([32, 33])('preserves the project-entry quota boundary at %i', count => {
    const { base, storage } = fixture();
    for (let i = 0; i < count; i++) fs.mkdirSync(join(base, hash(`project-${i}`)), { recursive: true });
    if (count === 32) expect(storage.prepare('new', 'space')).toContain(hash('new'));
    else {
      expect(() => storage.prepare('new', 'space')).toThrow('PROJECT_RESOURCE_STORAGE_LIMIT');
      expect(fs.existsSync(join(base, hash('new')))).toBe(false);
    }
  });
  it.each([64, 65])('preserves the per-directory entry quota boundary at %i', count => {
    const { base, storage } = fixture();
    const dir = join(base, hash('existing'));
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < count; i++) fs.writeFileSync(join(dir, `entry-${i}`), '');
    if (count === 64) expect(storage.prepare('new', 'space')).toContain(hash('new'));
    else {
      expect(() => storage.prepare('new', 'space')).toThrow('PROJECT_RESOURCE_STORAGE_LIMIT');
      expect(fs.existsSync(join(base, hash('new')))).toBe(false);
    }
  });
  it('allows the sixteenth database, refuses a seventeenth, and reopens existing paths at quota', () => {
    const { base, storage } = fixture();
    const dir = join(base, hash('existing'));
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 15; i++) fs.writeFileSync(join(dir, `${i}.db`), '');
    const filename = storage.prepare('new', 'space');
    fs.writeFileSync(filename, 'retained');
    expect(() => storage.prepare('overflow', 'space')).toThrow('PROJECT_RESOURCE_STORAGE_LIMIT');
    expect(fs.existsSync(join(base, hash('overflow')))).toBe(false);
    expect(storage.prepare('new', 'space')).toBe(filename);
    expect(fs.readFileSync(filename, 'utf8')).toBe('retained');
  });
  it('rejects malformed project entries without allocating a new database directory', () => {
    const { base, storage } = fixture();
    fs.mkdirSync(base);
    fs.writeFileSync(join(base, 'unexpected'), '');
    expect(() => storage.prepare('new', 'space')).toThrow('PROJECT_RESOURCE_STORAGE_LIMIT');
    expect(fs.existsSync(join(base, hash('new')))).toBe(false);
  });
});

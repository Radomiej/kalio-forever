import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VFSService } from './vfs.service';

describe('VFS canonical project execution scope', () => {
  let scratch: string;
  let root: string;
  let outside: string;
  let vfs: VFSService;
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'kalio-receipt-scope-'));
    root = join(scratch, 'project'); outside = join(scratch, 'project-foreign');
    mkdirSync(join(root, 'src'), { recursive: true }); mkdirSync(outside);
    vfs = new VFSService({ get: () => join(scratch, 'vfs') } as never, {} as never);
  });
  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  it('returns canonical existing root and contained cwd', () => {
    expect(vfs.assertProjectExecutionCwd(root, join(root, 'src', '..', 'src'))).toEqual({ projectRoot: realpathSync(root), cwd: realpathSync(join(root, 'src')) });
  });
  it('rejects an outside sibling despite a matching lexical prefix', () => {
    expect(() => vfs.assertProjectExecutionCwd(root, outside)).toThrow(/scope|outside/i);
  });
  it('rejects a junction inside the project resolving to a foreign directory', () => {
    const link = join(root, 'escape'); symlinkSync(outside, link, 'junction');
    expect(() => vfs.assertProjectExecutionCwd(root, link)).toThrow(/scope|outside/i);
  });
  it('permits a contained junction and returns its canonical target', () => {
    const link = join(root, 'alias'); symlinkSync(join(root, 'src'), link, 'junction');
    expect(vfs.assertProjectExecutionCwd(root, link).cwd).toBe(realpathSync(join(root, 'src')));
  });
  it.each(['root', 'cwd'] as const)('rejects a missing %s without creating it', missing => {
    expect(() => vfs.assertProjectExecutionCwd(missing === 'root' ? join(scratch, 'missing') : root, missing === 'cwd' ? join(root, 'missing') : root)).toThrow(/ENOENT/);
  });
  it('rejects a file as cwd', () => {
    const file = join(root, 'file'); writeFileSync(file, 'fixture');
    expect(() => vfs.assertProjectExecutionCwd(root, file)).toThrow(/directory/i);
  });
});

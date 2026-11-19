import { describe, expect, it, vi } from 'vitest';
import { projectJevOperationMetadata as projectOperation } from './hitl-jev-operation-metadata';
import { hashGoalLaunchJson } from '../../common/goal-launch-canonical';

const projectJevOperationMetadata = (name: string, args: Record<string, unknown>) => projectOperation(name, args).args;

describe('Jev operation metadata', () => {
  it.each(['fs_write', 'fs_edit', 'vfs_write'])('rejects unknown %s fields without exposing a small body', name => {
    const args = name === 'vfs_write' ? { filePath: 'a.txt', content: 'small-private-body' }
      : name === 'fs_edit' ? { path: '/p/a', expectedSha256: 'a'.repeat(64), oldText: 'private-old', newText: 'private-new' }
      : { path: '/p/a', content: 'small-private-body' };
    expect(() => projectOperation(name, { ...args, extra: 'opaque' })).toThrow('Incomplete approval evidence');
  });
  it('owns the metadata flag outside untrusted arguments', () => {
    for (const name of ['terminal_spawn', 'unknown']) {
      const args = { path: '/p/a', content: 'full-body', command: 'rg',
        evidenceKind: 'host_derived_filesystem_mutation_metadata', omittedFields: ['content'], metadataOnly: true };
      expect(projectOperation(name, args)).toEqual({ args, metadataOnly: false });
    }
    expect(projectOperation('fs_write', { path: '/p/a', content: 'body' }).metadataOnly).toBe(true);
  });
  it('projects only the exact VFS write schema with relative path', () => {
    const args = { filePath: 'notes/a.txt', content: 'private-vfs-body'.repeat(6000) };
    expect(projectJevOperationMetadata('vfs_write', args)).toMatchObject({ filePath: args.filePath,
      pathScope: 'conversation_vfs_relative', fullArgsSha256: hashGoalLaunchJson(args), mutationBytes: { written: Buffer.byteLength(args.content) } });
    expect(JSON.stringify(projectJevOperationMetadata('vfs_write', args))).not.toContain(args.content);
    expect(() => projectJevOperationMetadata('vfs_write', { ...args, reason: 'unsupported' })).toThrow('Incomplete approval evidence');
    for (const filePath of ['/absolute', 'C:\\absolute', '../escape', 'notes/../escape']) {
      expect(() => projectJevOperationMetadata('vfs_write', { ...args, filePath })).toThrow();
    }
  });
  it('projects an 89KB write without its body and hashes complete canonical arguments', () => {
    const args = { path: '/project/a.ts', content: 'x'.repeat(89_000), reason: 'Implement requested change' };
    const result = projectJevOperationMetadata('fs_write', args);
    expect(result).toMatchObject({ path: args.path, fullArgsSha256: hashGoalLaunchJson(args), mutationBytes: { written: 89_000 } });
    expect(JSON.stringify(result)).not.toContain(args.content);
    expect(projectJevOperationMetadata('fs_write', { reason: args.reason, content: args.content, path: args.path })).toEqual(result);
  });
  it('includes edit precondition and UTF8 byte counts without text', () => {
    expect(projectJevOperationMetadata('fs_edit', { path: '/p/a', expectedSha256: 'a'.repeat(64), oldText: '界', newText: '' }))
      .toMatchObject({ expectedSha256: 'a'.repeat(64), mutationBytes: { removed: 3, inserted: 0 } });
  });
  it.each([
    { path: '/p/a' }, { path: 1, content: 'a' }, { path: '', content: 'a' },
    { path: '/p/a', content: 1 }, { path: '/p/a', content: 'a', reason: 'x'.repeat(241) },
  ])('fails closed for malformed known write %j', args => {
    expect(() => projectJevOperationMetadata('fs_write', args)).toThrow();
  });
  it('rejects invalid edit hashes and empty match', () => {
    for (const args of [{ path: '/p/a', expectedSha256: 'bad', oldText: 'a', newText: 'b' },
      { path: '/p/a', expectedSha256: 'a'.repeat(64), oldText: '', newText: 'b' }]) {
      expect(() => projectJevOperationMetadata('fs_edit', args)).toThrow();
    }
  });
  it('retains complete unknown-tool arguments and terminal argv without elision', () => {
    for (const [name, args] of [
      ['terminal_spawn', { command: 'pwsh', args: ['-EncodedCommand', 'opaque'], cwd: '/p' }],
      ['unknown', { content: 'opaque' }]] as const) {
      expect(projectJevOperationMetadata(name, args)).toEqual(args);
    }
  });
  it('rejects accessors before invoking them, including in omitted bodies', () => {
    const get = vi.fn(() => 'hidden');
    const args = { path: '/p/a' };
    Object.defineProperty(args, 'content', { get, enumerable: true });
    expect(() => projectJevOperationMetadata('fs_write', args)).toThrow();
    expect(get).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VFSService } from '../../../vfs/vfs.service';
import { NativeSystemRegistry } from '../native-system-registry.service';
import { VfsNativeSystems } from './vfs.systems';

describe('VfsNativeSystems', () => {
  let registry: NativeSystemRegistry;
  let vfs: {
    readFile: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    deleteFile: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    registry = new NativeSystemRegistry();
    vfs = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      deleteFile: vi.fn(),
    };

    new VfsNativeSystems(registry, vfs as unknown as VFSService).onModuleInit();
  });

  it('registers VFS native systems with the expected approval policy', () => {
    const systems = registry.getAll().map((system) => ({ id: system.id, approval_required: system.approval_required }));

    expect(systems).toEqual(expect.arrayContaining([
      { id: 'vfs_read', approval_required: false },
      { id: 'vfs_write', approval_required: true },
      { id: 'vfs_delete', approval_required: true },
    ]));
  });

  it('executes vfs_read with the active session context', async () => {
    vfs.readFile.mockReturnValue({ filePath: 'notes/todo.txt', content: 'ship it' });

    const response = await registry.execute('vfs_read', { path: 'notes/todo.txt' }, { sessionId: 'session-1' });

    expect(vfs.readFile).toHaveBeenCalledWith('session-1', 'notes/todo.txt');
    expect(response).toEqual({
      result: {
        path: 'notes/todo.txt',
        content: 'ship it',
      },
      approval_required: false,
    });
  });

  it('requires approval before vfs_write touches the filesystem service', async () => {
    const pending = await registry.execute('vfs_write', { path: 'notes/todo.txt', content: 'done' }, { sessionId: 'session-1' });

    expect(pending).toEqual({ result: null, approval_required: true });
    expect(vfs.writeFile).not.toHaveBeenCalled();

    const approved = await registry.executeApproved('vfs_write', { path: 'notes/todo.txt', content: 'done' }, { sessionId: 'session-1' });

    expect(vfs.writeFile).toHaveBeenCalledWith({ sessionId: 'session-1', filePath: 'notes/todo.txt', content: 'done' });
    expect(approved).toEqual({ path: 'notes/todo.txt', bytesWritten: 4 });
  });

  it('requires approval before vfs_delete touches the filesystem service', async () => {
    const pending = await registry.execute('vfs_delete', { path: 'notes/todo.txt' }, { sessionId: 'session-1' });

    expect(pending).toEqual({ result: null, approval_required: true });
    expect(vfs.deleteFile).not.toHaveBeenCalled();

    const approved = await registry.executeApproved('vfs_delete', { path: 'notes/todo.txt' }, { sessionId: 'session-1' });

    expect(vfs.deleteFile).toHaveBeenCalledWith('session-1', 'notes/todo.txt');
    expect(approved).toEqual({ path: 'notes/todo.txt', deleted: true });
  });

  it('validates VFS args before calling the service', async () => {
    await expect(registry.execute('vfs_read', {}, { sessionId: 'session-1' })).rejects.toThrow('vfs_read: "path" argument is required');
    await expect(registry.executeApproved('vfs_write', { path: 'notes/todo.txt' }, { sessionId: 'session-1' })).rejects.toThrow('vfs_write: "content" must be a string');
    await expect(registry.executeApproved('vfs_delete', {}, { sessionId: 'session-1' })).rejects.toThrow('vfs_delete: "path" is required');

    expect(vfs.readFile).not.toHaveBeenCalled();
    expect(vfs.writeFile).not.toHaveBeenCalled();
    expect(vfs.deleteFile).not.toHaveBeenCalled();
  });
});

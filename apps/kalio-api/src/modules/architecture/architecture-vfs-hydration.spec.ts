import { describe, expect, it, vi } from 'vitest';
import type { VFSService } from '../vfs/vfs.service';
import { hydrateArchitectureRootVfs, parseArchitectureVfsHydration } from './architecture-vfs-hydration';

describe('architecture-vfs-hydration', () => {
  it('parses VFS hydration context with a default project target prefix', () => {
    expect(parseArchitectureVfsHydration({
      hydrateFromSessionId: 'source-1',
      hydrateFilePaths: ['README.md', 42, ''],
    })).toEqual({
      fromSessionId: 'source-1',
      targetPrefix: 'project',
      filePaths: ['README.md'],
    });
  });

  it('copies selected files into the architecture root VFS', () => {
    const vfs = {
      listFiles: vi.fn(() => ({ files: [{ path: 'README.md' }] })),
      readBinary: vi.fn(() => Buffer.from('readme')),
      writeBinary: vi.fn(),
    };

    const result = hydrateArchitectureRootVfs(vfs as unknown as VFSService, 'root-1', {
      hydrateFromSessionId: 'source-1',
      hydrateTargetPrefix: 'target',
      hydrateFilePaths: ['README.md'],
    });

    expect(vfs.readBinary).toHaveBeenCalledWith('source-1', 'README.md');
    expect(vfs.writeBinary).toHaveBeenCalledWith('root-1', 'target/README.md', Buffer.from('readme'));
    expect(result).toMatchObject({
      copiedFiles: [{ fromPath: 'README.md', toPath: 'target/README.md', sizeBytes: 6 }],
      skippedPaths: [],
    });
  });

  it('preserves prefixed selected file paths when the source session already stores the prefix', () => {
    const vfs = {
      listFiles: vi.fn(() => ({ files: [{ path: 'project/SimulationApp.tsx' }] })),
      readBinary: vi.fn(() => Buffer.from('source')),
      writeBinary: vi.fn(),
    };

    const result = hydrateArchitectureRootVfs(vfs as unknown as VFSService, 'root-1', {
      hydrateFromSessionId: 'source-1',
      hydrateTargetPrefix: 'project',
      hydrateFilePaths: ['project/SimulationApp.tsx'],
    });

    expect(vfs.readBinary).toHaveBeenCalledWith('source-1', 'project/SimulationApp.tsx');
    expect(vfs.writeBinary).toHaveBeenCalledWith('root-1', 'project/SimulationApp.tsx', Buffer.from('source'));
    expect(result?.copiedFiles).toEqual([{ fromPath: 'project/SimulationApp.tsx', toPath: 'project/SimulationApp.tsx', sizeBytes: 6 }]);
  });

  it('falls back to stripped source paths when selected files are stored without the target prefix', () => {
    const vfs = {
      listFiles: vi.fn(() => ({ files: [{ path: 'SimulationApp.tsx' }] })),
      readBinary: vi.fn(() => Buffer.from('source')),
      writeBinary: vi.fn(),
    };

    hydrateArchitectureRootVfs(vfs as unknown as VFSService, 'root-1', {
      hydrateFromSessionId: 'source-1',
      hydrateTargetPrefix: 'project',
      hydrateFilePaths: ['project/SimulationApp.tsx'],
    });

    expect(vfs.readBinary).toHaveBeenCalledWith('source-1', 'SimulationApp.tsx');
    expect(vfs.writeBinary).toHaveBeenCalledWith('root-1', 'project/SimulationApp.tsx', Buffer.from('source'));
  });

  it('returns skipped paths when selected source files are missing', () => {
    const missing = new Error('VFS_FILE_NOT_FOUND: missing.md not found');
    (missing as NodeJS.ErrnoException).code = 'VFS_FILE_NOT_FOUND';
    const vfs = {
      listFiles: vi.fn(() => ({ files: [] })),
      readBinary: vi.fn(() => { throw missing; }),
      writeBinary: vi.fn(),
    };

    const result = hydrateArchitectureRootVfs(vfs as unknown as VFSService, 'root-1', {
      hydrateFromSessionId: 'source-1',
      hydrateTargetPrefix: 'project',
      hydrateFilePaths: ['project/missing.md'],
    });

    expect(result).toMatchObject({
      copiedFiles: [],
      skippedPaths: ['project/missing.md'],
    });
    expect(vfs.writeBinary).not.toHaveBeenCalled();
  });
});

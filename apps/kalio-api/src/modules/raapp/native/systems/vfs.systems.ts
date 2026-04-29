import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { NativeSystemRegistry } from '../native-system-registry.service';
import type { NativeSessionContext } from '../native-system-registry.service';
import { VFSService } from '../../../vfs/vfs.service';

/**
 * Registers VFS-scoped native systems:
 *
 * - `vfs_read`   (no approval) — reads a file from the session VFS sandbox
 * - `vfs_write`  (approval required) — writes content to a file in the session VFS
 * - `vfs_delete` (approval required) — deletes a file from the session VFS
 *
 * All operations go through VFSService so path-traversal protection is
 * enforced at the service level — no duplicated logic here.
 */
@Injectable()
export class VfsNativeSystems implements OnModuleInit {
  private readonly logger = new Logger(VfsNativeSystems.name);

  constructor(
    private readonly registry: NativeSystemRegistry,
    private readonly vfs: VFSService,
  ) {}

  onModuleInit(): void {
    this.registerVfsRead();
    this.registerVfsWrite();
    this.registerVfsDelete();
  }

  private registerVfsRead(): void {
    const vfs = this.vfs;
    this.registry.register({
      id: 'vfs_read',
      description: 'Read a file from the current session VFS sandbox. Path is relative to the session root.',
      approval_required: false,
      input_schema: {
        path: { type: 'string', description: 'VFS-relative file path, e.g. "output/report.txt"' },
      },
      handler: async (args, ctx: NativeSessionContext) => {
        const filePath = args['path'];
        if (typeof filePath !== 'string' || !filePath) {
          throw new Error('vfs_read: "path" argument is required');
        }
        const result = vfs.readFile(ctx.sessionId, filePath);
        return { path: result.filePath, content: result.content };
      },
    });
    this.logger.log('vfs_read native system registered');
  }

  private registerVfsWrite(): void {
    const vfs = this.vfs;
    this.registry.register({
      id: 'vfs_write',
      description: 'Write content to a file in the current session VFS sandbox. Requires user approval.',
      approval_required: true,
      input_schema: {
        path: { type: 'string', description: 'VFS-relative file path' },
        content: { type: 'string', description: 'Text content to write' },
      },
      handler: async (args, ctx: NativeSessionContext) => {
        const filePath = args['path'];
        const content = args['content'];
        if (typeof filePath !== 'string' || !filePath) throw new Error('vfs_write: "path" is required');
        if (typeof content !== 'string') throw new Error('vfs_write: "content" must be a string');
        vfs.writeFile({ sessionId: ctx.sessionId, filePath, content });
        return { path: filePath, bytesWritten: Buffer.byteLength(content, 'utf8') };
      },
    });
    this.logger.log('vfs_write native system registered');
  }

  private registerVfsDelete(): void {
    const vfs = this.vfs;
    this.registry.register({
      id: 'vfs_delete',
      description: 'Delete a file from the current session VFS sandbox. Requires user approval.',
      approval_required: true,
      input_schema: {
        path: { type: 'string', description: 'VFS-relative file path to delete' },
      },
      handler: async (args, ctx: NativeSessionContext) => {
        const filePath = args['path'];
        if (typeof filePath !== 'string' || !filePath) throw new Error('vfs_delete: "path" is required');
        vfs.deleteFile(ctx.sessionId, filePath);
        return { path: filePath, deleted: true };
      },
    });
    this.logger.log('vfs_delete native system registered');
  }
}

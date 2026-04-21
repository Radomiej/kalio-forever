import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
} from 'node:fs';
import { join, resolve, normalize, basename } from 'node:path';
import type { VFSWriteRequest, VFSReadResult, VFSListResult, VFSFile } from '@kalio/types';

const PATH_TRAVERSAL_ERROR = 'PATH_TRAVERSAL_DENIED';

@Injectable()
export class VFSService {
  private readonly logger = new Logger(VFSService.name);
  private readonly workspaceRoot: string;

  constructor(private readonly config: ConfigService) {
    this.workspaceRoot = this.config.get<string>('WORKSPACE_ROOT', './data/workspaces');
    mkdirSync(this.workspaceRoot, { recursive: true });
  }

  writeFile(req: VFSWriteRequest): void {
    const safePath = this.resolveSafe(req.conversationId, req.filePath);
    mkdirSync(resolve(safePath, '..'), { recursive: true });
    writeFileSync(safePath, req.content, 'utf8');
    this.logger.debug(`VFS write: ${safePath}`);
  }

  readFile(conversationId: string, filePath: string): VFSReadResult {
    const safePath = this.resolveSafe(conversationId, filePath);
    const content = readFileSync(safePath, 'utf8');
    return { conversationId, filePath, content };
  }

  listFiles(conversationId: string): VFSListResult {
    const dir = this.conversationDir(conversationId);
    if (!existsSync(dir)) return { conversationId, files: [] };

    const files: VFSFile[] = this.walkDir(dir, dir, conversationId);
    return { conversationId, files };
  }

  private walkDir(baseDir: string, currentDir: string, conversationId: string): VFSFile[] {
    const result: VFSFile[] = [];
    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        result.push(...this.walkDir(baseDir, fullPath, conversationId));
      } else {
        result.push({
          conversationId,
          path: fullPath.slice(baseDir.length + 1).replace(/\\/g, '/'),
          sizeBytes: stat.size,
          updatedAt: stat.mtimeMs,
        });
      }
    }
    return result;
  }

  private conversationDir(conversationId: string): string {
    return join(this.workspaceRoot, 'conversations', conversationId, 'files');
  }

  private resolveSafe(conversationId: string, filePath: string): string {
    const base = this.conversationDir(conversationId);
    const resolved = resolve(base, normalize(filePath));

    if (!resolved.startsWith(resolve(base) + '/') && resolved !== resolve(base)) {
      const err = new Error(`${PATH_TRAVERSAL_ERROR}: "${filePath}" escapes conversation sandbox`);
      (err as NodeJS.ErrnoException).code = PATH_TRAVERSAL_ERROR;
      throw err;
    }
    return resolved;
  }
}

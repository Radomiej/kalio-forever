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
import { join, resolve, normalize, basename, sep } from 'node:path';
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
    const safePath = this.resolveSafe(req.sessionId, req.filePath);
    mkdirSync(resolve(safePath, '..'), { recursive: true });
    writeFileSync(safePath, req.content, 'utf8');
    this.logger.debug(`VFS write: ${safePath}`);
  }

  readFile(sessionId: string, filePath: string): VFSReadResult {
    const safePath = this.resolveSafe(sessionId, filePath);
    const content = readFileSync(safePath, 'utf8');
    return { sessionId, filePath, content };
  }

  listFiles(sessionId: string): VFSListResult {
    const dir = this.sessionDir(sessionId);
    if (!existsSync(dir)) return { sessionId, files: [] };

    const files: VFSFile[] = this.walkDir(dir, dir, sessionId);
    return { sessionId, files };
  }

  private walkDir(baseDir: string, currentDir: string, sessionId: string): VFSFile[] {
    const result: VFSFile[] = [];
    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        result.push(...this.walkDir(baseDir, fullPath, sessionId));
      } else {
        result.push({
          sessionId,
          path: fullPath.slice(baseDir.length + 1).replace(/\\/g, '/'),
          sizeBytes: stat.size,
          updatedAt: stat.mtimeMs,
        });
      }
    }
    return result;
  }

  private sessionDir(sessionId: string): string {
    return join(this.workspaceRoot, 'sessions', sessionId, 'files');
  }

  private resolveSafe(sessionId: string, filePath: string): string {
    const base = this.sessionDir(sessionId);
    // Decode URL-encoded characters to catch encoded traversal attempts like ..%2f
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(filePath);
    } catch {
      decodedPath = filePath;
    }
    const resolved = resolve(base, normalize(decodedPath));

    if (!resolved.startsWith(resolve(base) + sep) && resolved !== resolve(base)) {
      const err = new Error(`${PATH_TRAVERSAL_ERROR}: "${filePath}" escapes conversation sandbox`);
      (err as NodeJS.ErrnoException).code = PATH_TRAVERSAL_ERROR;
      throw err;
    }
    return resolved;
  }
}

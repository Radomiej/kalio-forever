import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  unlinkSync,
  createReadStream,
} from 'node:fs';
import { join, resolve, normalize, basename, extname, sep } from 'node:path';
import type { Readable } from 'node:stream';
import archiver from 'archiver';
import type { VFSWriteRequest, VFSReadResult, VFSListResult, VFSFile } from '@kalio/types';

const PATH_TRAVERSAL_ERROR = 'PATH_TRAVERSAL_DENIED';

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function injectPreviewBridge(rawHtml: string): string {
  const bridge = `\n<script>(function(){\n  const sendHeight=function(){\n    try{\n      const doc=document.documentElement;\n      const body=document.body;\n      const h=Math.max(\n        doc?doc.scrollHeight:0,\n        body?body.scrollHeight:0,\n        doc?doc.offsetHeight:0,\n        body?body.offsetHeight:0\n      );\n      parent.postMessage({type:'raapp_resize',height:h},'*');\n    }catch(e){console.error('[RAApp:Bridge] sendHeight failed',e);}\n  };\n  window.addEventListener('load',function(){sendHeight();setTimeout(sendHeight,80);setTimeout(sendHeight,300);});\n  window.addEventListener('resize',sendHeight);\n  window.addEventListener('message',function(event){\n    if(event&&event.data&&event.data.type==='raapp_query_height'){sendHeight();}\n  });\n  var ro=new ResizeObserver(function(){sendHeight();});\n  if(document&&document.documentElement){ro.observe(document.documentElement);}\n})();</script>\n`;
  const bodyClose = rawHtml.toLowerCase().lastIndexOf('</body>');
  if (bodyClose >= 0) {
    return `${rawHtml.slice(0, bodyClose)}${bridge}${rawHtml.slice(bodyClose)}`;
  }
  return `${rawHtml}${bridge}`;
}

export interface VFSCopySessionFilesRequest {
  fromSessionId: string;
  toSessionId: string;
  targetPrefix: string;
  filePaths?: string[];
}

export interface VFSCopiedFile {
  fromPath: string;
  toPath: string;
  sizeBytes: number;
}

export interface VFSServedFile {
  content?: Buffer;
  stream?: Readable;
  mimeType: string;
}

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

  /**
   * Write raw bytes to the session sandbox. Same path-traversal guard as
   * `writeFile`, but accepts a Buffer so binary uploads (images, etc.)
   * keep their original encoding.
   */
  writeBinary(sessionId: string, filePath: string, buffer: Buffer): void {
    const safePath = this.resolveSafe(sessionId, filePath);
    mkdirSync(resolve(safePath, '..'), { recursive: true });
    writeFileSync(safePath, buffer);
    this.logger.debug(`VFS writeBinary: ${safePath} (${buffer.length} bytes)`);
  }

  /**
   * Read raw bytes from the session sandbox.
   * Throws on missing file. Used by ImageHydratorService to assemble
   * multimodal LLM payloads.
   */
  readBinary(sessionId: string, filePath: string): Buffer {
    const safePath = this.resolveSafe(sessionId, filePath);
    try {
      return readFileSync(safePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        const typedErr = new Error(`VFS_FILE_NOT_FOUND: ${filePath} not found in session ${sessionId}`);
        (typedErr as NodeJS.ErrnoException).code = 'VFS_FILE_NOT_FOUND';
        throw typedErr;
      }
      throw err;
    }
  }

  readFile(sessionId: string, filePath: string): VFSReadResult {
    const safePath = this.resolveSafe(sessionId, filePath);
    const content = readFileSync(safePath, 'utf8');
    return { sessionId, filePath, content };
  }

  downloadFile(sessionId: string, filePath: string): { stream: Readable; filename: string } {
    const safePath = this.resolveSafe(sessionId, filePath);
    const stream = createReadStream(safePath);
    return { stream, filename: basename(safePath) };
  }

  serveFile(sessionId: string, filePath: string): VFSServedFile {
    const mimeType = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    const extension = extname(filePath).toLowerCase();

    if (extension === '.html' || extension === '.htm') {
      const html = this.readBinary(sessionId, filePath).toString('utf8');
      return {
        content: Buffer.from(injectPreviewBridge(html), 'utf8'),
        mimeType,
      };
    }

    const safePath = this.resolveSafe(sessionId, filePath);
    return {
      stream: createReadStream(safePath),
      mimeType,
    };
  }

  archiveSession(sessionId: string): archiver.Archiver {
    const dir = this.sessionDir(sessionId);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      this.logger.error(`[VFSService] Archive error for session ${sessionId}`, err);
    });
    if (existsSync(dir)) {
      archive.directory(dir, false);
    }
    archive.finalize();
    return archive;
  }

  deleteFile(sessionId: string, filePath: string): void {
    const safePath = this.resolveSafe(sessionId, filePath);
    unlinkSync(safePath);
    this.logger.debug(`VFS delete: ${safePath}`);
  }

  listFiles(sessionId: string): VFSListResult {
    const dir = this.sessionDir(sessionId);
    if (!existsSync(dir)) return { sessionId, files: [] };

    const files: VFSFile[] = this.walkDir(dir, dir, sessionId);
    return { sessionId, files };
  }

  copySessionFiles(req: VFSCopySessionFilesRequest): VFSCopiedFile[] {
    const targetPrefix = this.normalizeRelativePath(req.targetPrefix);
    const sourcePaths = req.filePaths?.length
      ? req.filePaths.map((filePath) => this.normalizeRelativePath(filePath))
      : this.listFiles(req.fromSessionId).files.map((file) => file.path);

    const copied: VFSCopiedFile[] = [];
    for (const fromPath of sourcePaths) {
      let buffer: Buffer;
      try {
        buffer = this.readBinary(req.fromSessionId, fromPath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'VFS_FILE_NOT_FOUND' || code === 'ENOENT') {
          const error = err instanceof Error ? err : new Error(String(err));
          this.logger.warn(
            `[VFSService] Skipping missing file during copy from ${req.fromSessionId}: ${fromPath} (${error.message})`,
          );
          continue;
        }
        throw err;
      }
      const toPath = `${targetPrefix}/${fromPath}`;
      this.writeBinary(req.toSessionId, toPath, buffer);
      copied.push({ fromPath, toPath, sizeBytes: buffer.length });
    }
    return copied;
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

  private normalizeRelativePath(filePath: string): string {
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(filePath);
    } catch {
      decodedPath = filePath;
    }
    const normalized = normalize(decodedPath).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized === '.' || normalized.split('/').some((part) => part === '..')) {
      const err = new Error(`${PATH_TRAVERSAL_ERROR}: "${filePath}" escapes conversation sandbox`);
      (err as NodeJS.ErrnoException).code = PATH_TRAVERSAL_ERROR;
      throw err;
    }
    return normalized;
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

    // Treat "\" as a separator on POSIX too, blocking Windows-style traversal payloads.
    const canonical = decodedPath.replace(/\\/g, '/');

    // Reject absolute paths (POSIX, UNC, and Windows drive-letter) before any stripping.
    if (canonical.startsWith('/') || canonical.startsWith('//') || /^[a-zA-Z]:\//.test(canonical)) {
      const err = new Error(`${PATH_TRAVERSAL_ERROR}: "${filePath}" escapes conversation sandbox`);
      (err as NodeJS.ErrnoException).code = PATH_TRAVERSAL_ERROR;
      throw err;
    }

    // Normalize using POSIX semantics so "/" is the only separator we reason about.
    const normalized = normalize(canonical).replace(/\\/g, '/');

    // Reject any segment that is ".." after normalization.
    if (!normalized || normalized === '.' || normalized.split('/').some((p) => p === '..')) {
      const err = new Error(`${PATH_TRAVERSAL_ERROR}: "${filePath}" escapes conversation sandbox`);
      (err as NodeJS.ErrnoException).code = PATH_TRAVERSAL_ERROR;
      throw err;
    }

    const resolved = resolve(base, normalized);
    const baseResolved = resolve(base);

    if (!resolved.startsWith(baseResolved + sep) && resolved !== baseResolved) {
      const err = new Error(`${PATH_TRAVERSAL_ERROR}: "${filePath}" escapes conversation sandbox`);
      (err as NodeJS.ErrnoException).code = PATH_TRAVERSAL_ERROR;
      throw err;
    }
    return resolved;
  }
}

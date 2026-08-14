import fs from 'node:fs/promises';
import path from 'node:path';
import yauzl from 'yauzl';
import yaml from 'js-yaml';
import type { RAAppMeta } from './raapp.service.helpers';

export const RAAPP_ZIP_LIMITS = {
  maxCompressedBytes: 5 * 1024 * 1024,
  maxUncompressedBytes: 10 * 1024 * 1024,
  maxFileBytes: 5 * 1024 * 1024,
  maxYamlBytes: 512 * 1024,
  maxFiles: 7,
} as const;

const ALLOWED_FILES = new Set([
  'meta.yml',
  'main.html',
  'index.html',
  'ui.gui',
  'systems.yml',
  'tests.yml',
  'components.yml',
]);

export class RAAppPackageError extends Error {
  constructor(
    message: string,
    readonly statusCode: 409 | 413 | 422 = 422,
  ) {
    super(message);
    this.name = 'RAAppPackageError';
  }
}

export interface RAAppPackageInspection {
  meta: RAAppMeta;
  files: string[];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateMeta(value: unknown): RAAppMeta {
  if (!isPlainRecord(value)) {
    throw new RAAppPackageError('meta.yml must contain a YAML object');
  }

  const id = value.id;
  const name = value.name;
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
    throw new RAAppPackageError('meta.yml id must use lowercase letters, numbers, and hyphens (1-64 chars)');
  }
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 120) {
    throw new RAAppPackageError('meta.yml name must contain 1-120 characters');
  }
  if (value.version !== undefined && typeof value.version !== 'string') {
    throw new RAAppPackageError('meta.yml version must be a string');
  }
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string'))) {
    throw new RAAppPackageError('meta.yml tags must be an array of strings');
  }

  return value as unknown as RAAppMeta;
}

export function parseRAAppMeta(raw: string): RAAppMeta {
  try {
    return validateMeta(yaml.load(raw, { schema: yaml.JSON_SCHEMA }));
  } catch (error) {
    if (error instanceof RAAppPackageError) throw error;
    throw new RAAppPackageError(`Invalid meta.yml: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateEntryName(fileName: string): string {
  if (!fileName || fileName.includes('\0') || fileName.includes('\\') || fileName.includes('/')) {
    throw new RAAppPackageError(`ZIP entry must be a single root file: ${fileName || '<empty>'}`);
  }
  if (path.isAbsolute(fileName) || /^[A-Za-z]:/.test(fileName) || fileName === '.' || fileName === '..') {
    throw new RAAppPackageError(`ZIP entry path is not allowed: ${fileName}`);
  }
  if (!ALLOWED_FILES.has(fileName)) {
    throw new RAAppPackageError(`ZIP entry is not supported: ${fileName}`);
  }
  return fileName;
}

function isSymlink(entry: yauzl.Entry): boolean {
  const madeBy = entry.versionMadeBy >>> 8;
  if (madeBy !== 3) return false;
  const unixType = (entry.externalFileAttributes >>> 16) & 0xf000;
  return unixType !== 0 && unixType !== 0x8000;
}

function readEntry(entry: yauzl.Entry, zipFile: yauzl.ZipFile): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > RAAPP_ZIP_LIMITS.maxYamlBytes) {
          stream.destroy(new RAAppPackageError('meta.yml exceeds the 512 KiB limit'));
          return;
        }
        chunks.push(chunk);
      });
      stream.once('error', reject);
      stream.once('end', () => resolve(Buffer.concat(chunks)));
    });
  });
}

function inspectZipEntries(zipPath: string): Promise<RAAppPackageInspection> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipPath,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (openError, zipFile) => {
        if (openError || !zipFile) {
          reject(new RAAppPackageError(`Invalid RA-App ZIP: ${openError?.message ?? 'cannot open archive'}`));
          return;
        }

        const files: string[] = [];
        let totalUncompressedBytes = 0;
        let meta: RAAppMeta | undefined;
        let settled = false;
        const fail = (error: unknown) => {
          if (settled) return;
          settled = true;
          zipFile.close();
          reject(error instanceof RAAppPackageError ? error : new RAAppPackageError(String(error)));
        };

        zipFile.once('error', fail);
        zipFile.once('end', () => {
          if (settled) return;
          settled = true;
          if (!meta) {
            reject(new RAAppPackageError('Every RA-App ZIP must contain a root meta.yml'));
            return;
          }
          const hasHtml = files.includes('main.html') || files.includes('index.html');
          if (files.includes('main.html') && files.includes('index.html')) {
            reject(new RAAppPackageError('Use either main.html or index.html, not both'));
            return;
          }
          if (!hasHtml && !files.includes('ui.gui')) {
            reject(new RAAppPackageError('Every RA-App ZIP must contain main.html, index.html, or ui.gui'));
            return;
          }
          resolve({ meta, files });
        });

        zipFile.on('entry', (entry) => {
          void (async () => {
            if (settled) return;
            const fileName = validateEntryName(entry.fileName);
            if (entry.fileName.endsWith('/') || isSymlink(entry) || entry.isEncrypted()) {
              throw new RAAppPackageError(`ZIP entry is not a regular unencrypted file: ${fileName}`);
            }
            if (files.includes(fileName)) {
              throw new RAAppPackageError(`ZIP contains duplicate entry: ${fileName}`);
            }
            if (files.length >= RAAPP_ZIP_LIMITS.maxFiles) {
              throw new RAAppPackageError(`ZIP contains more than ${RAAPP_ZIP_LIMITS.maxFiles} files`);
            }
            if (entry.uncompressedSize > RAAPP_ZIP_LIMITS.maxFileBytes) {
              throw new RAAppPackageError(`ZIP entry exceeds the ${RAAPP_ZIP_LIMITS.maxFileBytes} byte limit: ${fileName}`);
            }
            totalUncompressedBytes += entry.uncompressedSize;
            if (totalUncompressedBytes > RAAPP_ZIP_LIMITS.maxUncompressedBytes) {
              throw new RAAppPackageError('ZIP exceeds the total uncompressed size limit');
            }
            files.push(fileName);
            if (fileName === 'meta.yml') {
              const raw = await readEntry(entry, zipFile);
              meta = parseRAAppMeta(raw.toString('utf8'));
            }
            if (!settled) zipFile.readEntry();
          })().catch(fail);
        });

        zipFile.readEntry();
      },
    );
  });
}

export async function inspectRAAppZip(zipPath: string): Promise<RAAppPackageInspection> {
  const stats = await fs.stat(zipPath);
  if (stats.size > RAAPP_ZIP_LIMITS.maxCompressedBytes) {
    throw new RAAppPackageError(`RA-App ZIP exceeds the ${RAAPP_ZIP_LIMITS.maxCompressedBytes} byte limit`, 413);
  }
  return inspectZipEntries(zipPath);
}

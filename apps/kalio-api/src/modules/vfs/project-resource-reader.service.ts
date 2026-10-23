import { Injectable } from '@nestjs/common';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { extname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { eq } from 'drizzle-orm';
import type { ProjectResourceReaderPort, ProjectResourceSnapshot } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { projects } from '../../database/schema';

const MAX_FILES = 500;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * MAX_FILE_BYTES;
const MAX_DEPTH = 16;
// Bound enumeration/skipped metadata too, including trees with no supported files.
const MAX_ENTRIES = 5000;
const EXCLUDED = new Set(['node_modules', 'vendor', 'bower_components', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.cache', '.turbo', 'target', 'bin', 'obj', 'generated', '__pycache__', '.venv', 'venv', '.ssh', '.aws', '.azure', '.kalio', '.codex', '.npmrc', '.pypirc', '.netrc', 'credentials', 'keys', 'private', 'secrets']);
const EXTENSIONS = new Set(('.txt .md .mdx .rst .csv .tsv .json .jsonc .yaml .yml .toml .xml .html .htm .css .scss .sass .less .js .jsx .ts .tsx .mts .cts .mjs .cjs .vue .svelte .py .rb .go .rs .java .kt .kts .cs .c .h .cpp .hpp .sql .sh .ps1 .bat .cmd .lua .luau .php .swift .dart .png .jpg .jpeg .gif .webp .svg .ico .bmp .avif .pdf .mp3 .wav .ogg .flac .m4a .aac .mp4 .webm .mov .mkv').split(' '));
const TEXT_NAMES = new Set(['readme', 'license', 'licence', 'dockerfile', 'makefile']);
function excluded(name: string): boolean {
  const lower = name.toLowerCase();
  return EXCLUDED.has(lower) || lower.startsWith('.env')
    || /(?:^|[._-])(credentials?|secrets?|private|keys?|tokens?)(?:[._-]|$)/i.test(lower)
    || /^(?:id_rsa|id_ed25519|id_ecdsa|id_dsa)(?:\.|$)/i.test(lower)
    || ['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore'].includes(extname(lower));
}
function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  // Windows lstat reports dev=0 while handle fstat reports the volume ID.
  const sameDevice = left.dev === right.dev || (process.platform === 'win32' && (left.dev === 0n || right.dev === 0n));
  return sameDevice && left.ino === right.ino;
}
function within(root: string, path: string): boolean {
  const pathRelative = relative(root, path);
  return !isAbsolute(pathRelative) && pathRelative !== '..' && !pathRelative.startsWith(`..${sep}`);
}
function limit(): never { throw new Error('PROJECT_RESOURCE_LIMIT'); }

@Injectable()
export class ProjectResourceReaderService implements ProjectResourceReaderPort {
  constructor(private readonly database: DrizzleService) {}

  async readProject(projectId: string, signal?: AbortSignal): Promise<ProjectResourceSnapshot> {
    signal?.throwIfAborted();
    if (typeof projectId !== 'string' || !projectId.trim()) throw new Error('PROJECT_NOT_REGISTERED');
    const project = this.database.db.select({ path: projects.path }).from(projects).where(eq(projects.id, projectId)).get();
    if (!project) throw new Error('PROJECT_NOT_REGISTERED');
    if (!project.path || !isAbsolute(project.path)) throw new Error('PROJECT_ROOT_INVALID');
    const persistedRoot = resolve(project.path);
    if (persistedRoot === parse(persistedRoot).root) throw new Error('PROJECT_ROOT_INVALID');
    const rootStat = await lstat(persistedRoot, { bigint: true });
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('PROJECT_ROOT_INVALID');
    const root = await realpath(persistedRoot);
    if (root === parse(root).root) throw new Error('PROJECT_ROOT_INVALID');
    const rootHandle = await open(persistedRoot, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let rootDevice: bigint;
    try {
      const openedRoot = await rootHandle.stat({ bigint: true });
      if (!openedRoot.isDirectory() || !sameFile(rootStat, openedRoot) || await realpath(persistedRoot) !== root) throw new Error('PROJECT_RESOURCE_CHANGED');
      rootDevice = openedRoot.dev;
    } finally { await rootHandle.close(); }
    const files: ProjectResourceSnapshot['files'][number][] = [];
    const skipped: ProjectResourceSnapshot['skipped'][number][] = [];
    let total = 0;
    let entries = 0;
    const assertRoot = async () => {
      signal?.throwIfAborted();
      const current = await lstat(persistedRoot, { bigint: true });
      if (current.isSymbolicLink() || !sameFile(current, rootStat) || await realpath(persistedRoot) !== root) throw new Error('PROJECT_RESOURCE_CHANGED');
    };
    const visit = async (directory: string, prefix: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH) limit();
      await assertRoot();
      const directoryStat = await lstat(directory, { bigint: true });
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error('PROJECT_RESOURCE_CHANGED');
      if (!within(root, await realpath(directory))) throw new Error('PROJECT_RESOURCE_ESCAPE');
      const handle = await opendir(directory);
      for await (const entry of handle) {
        signal?.throwIfAborted();
        if (++entries > MAX_ENTRIES) limit();
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (excluded(entry.name)) { skipped.push({ path, reason: 'excluded' }); continue; }
        const absolute = join(directory, entry.name);
        const stat = await lstat(absolute, { bigint: true });
        if (stat.isSymbolicLink()) { skipped.push({ path, reason: 'link' }); continue; }
        const canonical = await realpath(absolute);
        if (!within(root, canonical)) throw new Error('PROJECT_RESOURCE_ESCAPE');
        if (stat.isDirectory()) { await visit(absolute, path, depth + 1); continue; }
        if (!stat.isFile() || (!EXTENSIONS.has(extname(entry.name).toLowerCase()) && !TEXT_NAMES.has(entry.name.toLowerCase()))) {
          skipped.push({ path, reason: 'unsupported' }); continue;
        }
        if (files.length >= MAX_FILES || stat.size > MAX_FILE_BYTES || total + Number(stat.size) > MAX_TOTAL_BYTES) limit();
        await assertRoot();
        const descriptor = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const opened = await descriptor.stat({ bigint: true });
          const current = await lstat(absolute, { bigint: true });
          if (!opened.isFile() || opened.dev !== rootDevice || current.isSymbolicLink() || !sameFile(stat, opened) || !sameFile(current, opened)
            || await realpath(absolute) !== canonical) throw new Error('PROJECT_RESOURCE_CHANGED');
          if (opened.size > MAX_FILE_BYTES || total + Number(opened.size) > MAX_TOTAL_BYTES) limit();
          const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
          let size = 0;
          while (size < buffer.length) {
            signal?.throwIfAborted();
            const read = await descriptor.read(buffer, size, buffer.length - size, size);
            if (!read.bytesRead) break;
            size += read.bytesRead;
          }
          if (size > MAX_FILE_BYTES || total + size > MAX_TOTAL_BYTES) limit();
          await assertRoot();
          const after = await descriptor.stat({ bigint: true });
          if (after.size !== BigInt(size) || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) throw new Error('PROJECT_RESOURCE_CHANGED');
          files.push({ path, sizeBytes: size, content: Uint8Array.from(buffer.subarray(0, size)) });
          total += size;
        } finally { await descriptor.close(); }
      }
      if (!sameFile(directoryStat, await lstat(directory, { bigint: true })) || !within(root, await realpath(directory))) throw new Error('PROJECT_RESOURCE_CHANGED');
    };
    await visit(root, '', 0);
    await assertRoot();
    files.sort((left, right) => left.path.localeCompare(right.path));
    skipped.sort((left, right) => left.path.localeCompare(right.path));
    return { projectId, files, skipped, complete: true };
  }
}

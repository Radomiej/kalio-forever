/**
 * RAAppVersioningService — versioned RA-App catalog for user-uploaded apps.
 *
 * Folder layout (user apps only — core apps remain flat / read-only):
 *   {userDir}/{slug}/
 *     current.zip          — live production version
 *     draft.zip            — pending approval (optional)
 *     history/
 *       1.0.0.zip
 *       1.1.0.zip
 *       1.1.0-{ts}.zip     — deduplicated when same version re-archived
 *     .manifest.json       — tracks versions & timestamps
 *
 * Approval workflow:
 *   1. saveAsDraft(slug, buffer)       — writes draft.zip (overwrites)
 *   2. approveDraft(slug, bumpType)    — draft → current; old current → history
 *   3. rollback(slug, version)         — history → draft (requires re-approval)
 *   4. discardDraft(slug)              — deletes draft without promoting
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import extractZip from 'extract-zip';
import yaml from 'js-yaml';
import type { RAAppGroup, RAAppVersionInfo, RAAppMetaSummary } from '@kalio/types';
import type { RAAppMeta } from './raapp.service';
import { archiveDirectoryToZip } from './zip-archive.util';

export const RAAPP_RELEASE_NOT_FOUND_CODE = 'RAAPP_RELEASE_NOT_FOUND';
const RAAPP_SLUG_PATTERN = /^[a-z0-9-]+$/;

// ── Semver helpers ────────────────────────────────────────────────────────────

export function parseSemver(v: string): [number, number, number] {
  const parts = v.replace(/^v/, '').split('.').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function bumpVersion(version: string, type: 'patch' | 'minor' | 'major'): string {
  const [major, minor, patch] = parseSemver(version);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Manifest ──────────────────────────────────────────────────────────────────

interface GroupManifest {
  slug: string;
  currentVersion: string;
  draftVersion?: string;
  history: string[];
  createdAt: number;
  updatedAt: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ensureDir(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function metaToSummary(meta: RAAppMeta): RAAppMetaSummary {
  return {
    id: meta.id,
    name: meta.name,
    version: meta.version ?? '1.0.0',
    description: meta.description,
    tags: meta.tags,
    expose_as_tool: meta.expose_as_tool,
    tool_description: meta.tool_description,
  };
}

function createReleaseNotFoundError(message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = RAAPP_RELEASE_NOT_FOUND_CODE;
  return error;
}

function isValidRAAppSlug(slug: string): boolean {
  return RAAPP_SLUG_PATTERN.test(slug);
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class RAAppVersioningService implements OnModuleInit {
  private readonly logger = new Logger(RAAppVersioningService.name);
  private readonly groups: Map<string, RAAppGroup> = new Map();
  private readonly userDir: string;
  private tmpDir: string;

  constructor(private readonly config: ConfigService) {
    const base = this.config.get<string>('RA_APPS_PATH', './data/ra-apps');
    this.userDir = path.resolve(base, 'user');
    this.tmpDir = path.resolve(base, 'tmp');
  }

  async onModuleInit(): Promise<void> {
    await this.init();
  }

  async init(): Promise<void> {
    this.groups.clear();
    await ensureDir(this.userDir);
    await ensureDir(this.tmpDir);
    await this.migrateFlatZips();
    await this.loadGroupsFromDisk();
    this.logger.log(`Loaded ${this.groups.size} RA-App group(s) from ${this.userDir}`);
  }

  // ── Migration (legacy flat ZIPs → versioned folders) ─────────────────────

  /**
   * One-time idempotent migration: flat {slug}.zip → {slug}/current.zip + manifest.
   * Skips entries that already have a matching sub-folder.
   */
  private async migrateFlatZips(): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.userDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.zip')) continue;
      const zipPath = path.join(this.userDir, entry);

      let meta: RAAppMeta;
      try {
        const buf = await fs.readFile(zipPath);
        meta = await this.extractMeta(buf);
      } catch (err) {
        this.logger.warn(`Migration: failed to parse ${entry}, skipping`, err);
        continue;
      }

      let slug: string;
      let slugDir: string;
      try {
        ({ slug, slugDir } = this.resolveUserSlugPath(meta.id));
      } catch (err) {
        this.logger.warn(`Migration: invalid slug in ${entry}, skipping`, err instanceof Error ? err : new Error(String(err)));
        continue;
      }

      if (fsSync.existsSync(slugDir)) continue; // already migrated

      await ensureDir(path.join(slugDir, 'history'));
      await fs.copyFile(zipPath, path.join(slugDir, 'current.zip'));
      await fs.unlink(zipPath);

      const manifest: GroupManifest = {
        slug,
        currentVersion: meta.version ?? '1.0.0',
        history: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await this.writeManifest(slugDir, manifest);
      this.logger.log(`Migrated flat ${entry} → ${slug}/`);
    }
  }

  // ── Disk loading ──────────────────────────────────────────────────────────

  private async loadGroupsFromDisk(): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.userDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const slugDir = path.join(this.userDir, entry);
      try {
        const stat = await fs.stat(slugDir);
        if (!stat.isDirectory()) continue;
        await this.loadGroupFromDir(entry, slugDir);
      } catch (err) {
        this.logger.warn(`loadGroups: failed for slug=${entry}`, err);
      }
    }
  }

  private async loadGroupFromDir(slug: string, slugDir: string): Promise<void> {
    const manifest = await this.readManifest(slugDir);

    const currentZip = path.join(slugDir, 'current.zip');
    const currentMeta = await this.parseZipMeta(currentZip);
    const currentStat = await fs.stat(currentZip);

    const current: RAAppVersionInfo = {
      version: currentMeta.version ?? '1.0.0',
      meta: metaToSummary(currentMeta),
      status: 'current',
      zipPath: currentZip,
      createdAt: currentStat.mtimeMs,
      approvedAt: manifest.updatedAt,
    };

    let draft: RAAppVersionInfo | undefined;
    const draftZip = path.join(slugDir, 'draft.zip');
    if (fsSync.existsSync(draftZip)) {
      try {
        const draftMeta = await this.parseZipMeta(draftZip);
        const draftStat = await fs.stat(draftZip);
        draft = {
          version: draftMeta.version ?? '1.0.0',
          meta: metaToSummary(draftMeta),
          status: 'draft',
          zipPath: draftZip,
          createdAt: draftStat.mtimeMs,
        };
      } catch (err) {
        this.logger.warn(`loadGroup: draft.zip invalid for slug=${slug}, ignoring`, err);
      }
    }

    const history: RAAppVersionInfo[] = [];
    const histDir = path.join(slugDir, 'history');
    try {
      const histEntries = await fs.readdir(histDir);
      for (const h of histEntries) {
        if (!h.endsWith('.zip')) continue;
        const hp = path.join(histDir, h);
        try {
          const hMeta = await this.parseZipMeta(hp);
          const hStat = await fs.stat(hp);
          history.push({
            version: hMeta.version ?? '1.0.0',
            meta: metaToSummary(hMeta),
            status: 'archived',
            zipPath: hp,
            createdAt: hStat.mtimeMs,
          });
        } catch {
          // skip corrupt history entry
        }
      }
    } catch {
      // history dir may not exist yet
    }

    // Newest version first (semver descending)
    history.sort((a, b) => {
      const [mja, mia, pa] = parseSemver(a.version);
      const [mjb, mib, pb] = parseSemver(b.version);
      if (mjb !== mja) return mjb - mja;
      if (mib !== mia) return mib - mia;
      return pb - pa;
    });

    this.groups.set(slug, { slug, name: currentMeta.name, source: 'user', current, draft, history });
  }

  // ── Read API ──────────────────────────────────────────────────────────────

  getGroups(): RAAppGroup[] {
    return Array.from(this.groups.values());
  }

  getGroupBySlug(slug: string): RAAppGroup | undefined {
    return this.groups.get(slug.trim());
  }

  downloadRelease(slug: string, version: string): { stream: fsSync.ReadStream; filename: string } {
    const group = this.groups.get(slug);
    if (!group) throw createReleaseNotFoundError(`No RA-App group found for slug: ${slug}`);

    const release = group.current.version === version
      ? group.current
      : group.history.find((entry) => entry.version === version);

    if (!release) {
      throw createReleaseNotFoundError(`Release version ${version} not found for slug: ${slug}`);
    }

    try {
      const stat = fsSync.statSync(release.zipPath);
      if (!stat.isFile()) {
        throw createReleaseNotFoundError(`Release version ${version} not found for slug: ${slug}`);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === 'ENOENT' || code === 'ENOTDIR' || code === RAAPP_RELEASE_NOT_FOUND_CODE) {
        throw createReleaseNotFoundError(`Release version ${version} not found for slug: ${slug}`);
      }
      throw err;
    }

    const stream = fsSync.createReadStream(release.zipPath);
    stream.once('error', (err) => {
      this.logger.error(`[downloadRelease] Stream failed for ${slug}@${version}`, err);
    });

    return {
      stream,
      filename: `${slug}-${release.version}.zip`,
    };
  }

  // ── Write API ─────────────────────────────────────────────────────────────

  /**
   * Save a ZIP buffer as the draft for the given slug.
   * If no current exists yet, writes directly as current (first upload).
   */
  async saveAsDraft(slug: string, buffer: Buffer): Promise<RAAppGroup> {
    let meta: RAAppMeta;
    try {
      meta = await this.extractMeta(buffer);
    } catch (err) {
      throw new Error(`Invalid RA-App ZIP: could not parse meta.yml — ${(err as Error).message}`, {
        cause: err,
      });
    }

    const resolved = this.resolveUserSlugPath(slug);
    slug = resolved.slug;
    const slugDir = resolved.slugDir;
    const currentZip = path.join(slugDir, 'current.zip');

    if (meta.id && meta.id !== slug) {
      this.logger.warn(`saveAsDraft: meta.id '${meta.id}' differs from slug '${slug}'; tool registered under slug`);
    }

    if (!fsSync.existsSync(currentZip)) {
      // Brand new — write directly as current
      await ensureDir(path.join(slugDir, 'history'));
      await fs.writeFile(currentZip, buffer);
      const manifest: GroupManifest = {
        slug,
        currentVersion: meta.version ?? '1.0.0',
        history: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await this.writeManifest(slugDir, manifest);
      await this.loadGroupFromDir(slug, slugDir);
      this.logger.log(`saveAsDraft: new app '${slug}' created as current v${meta.version}`);
    } else {
      // Existing app — save as draft
      await ensureDir(path.join(slugDir, 'history'));
      await fs.writeFile(path.join(slugDir, 'draft.zip'), buffer);
      await this.loadGroupFromDir(slug, slugDir);
      this.logger.log(`saveAsDraft: draft saved for '${slug}' v${meta.version}`);
    }

    return this.groups.get(slug)!;
  }

  /**
   * Approve the current draft:
   *   1. current.zip → history/{currentVersion}.zip
   *   2. draft.zip   → current.zip  (with version bump in meta.yml)
   *   3. Reload group in memory
   */
  async approveDraft(slug: string, bumpType: 'patch' | 'minor' | 'major' = 'minor'): Promise<RAAppGroup> {
    const resolved = this.resolveUserSlugPath(slug);
    slug = resolved.slug;
    const group = this.groups.get(slug);
    if (!group) throw new Error(`No RA-App group found for slug: ${slug}`);
    if (!group.draft) throw new Error(`No draft to approve for slug: ${slug}`);

    const slugDir = resolved.slugDir;
    const currentZip = path.join(slugDir, 'current.zip');
    const draftZip = path.join(slugDir, 'draft.zip');
    const histDir = path.join(slugDir, 'history');
    await ensureDir(histDir);

    const oldVersion = group.current.version;
    const histEntry = path.join(histDir, `${oldVersion}.zip`);
    if (fsSync.existsSync(histEntry)) {
      // Deduplicate — same version re-archived during rollback cycle
      const deduped = path.join(histDir, `${oldVersion}-${Date.now()}.zip`);
      this.logger.warn(`approveDraft: history entry ${oldVersion}.zip exists, deduplicating to ${path.basename(deduped)}`);
      await fs.copyFile(currentZip, deduped);
    } else {
      await fs.copyFile(currentZip, histEntry);
    }

    // Promote draft → current and bump version
    await fs.copyFile(draftZip, currentZip);
    await fs.unlink(draftZip);

    const newVersion = bumpVersion(oldVersion, bumpType);
    await this.patchVersionInZip(currentZip, newVersion);

    const oldManifest = await this.readManifest(slugDir);
    const manifest: GroupManifest = {
      slug,
      currentVersion: newVersion,
      history: [...oldManifest.history, oldVersion],
      createdAt: oldManifest.createdAt,
      updatedAt: Date.now(),
    };
    await this.writeManifest(slugDir, manifest);
    await this.loadGroupFromDir(slug, slugDir);
    this.logger.log(`approveDraft: '${slug}' ${oldVersion} → ${newVersion}`);

    return this.groups.get(slug)!;
  }

  /** Copy a historical version to draft for re-approval. */
  async rollback(slug: string, version: string): Promise<RAAppGroup> {
    const resolved = this.resolveUserSlugPath(slug);
    slug = resolved.slug;
    const group = this.groups.get(slug);
    if (!group) throw new Error(`No RA-App group found for slug: ${slug}`);

    // Use the in-memory zipPath rather than constructing the filename from the version string.
    // History entries may have dedup-suffixed filenames (e.g. 1.0.0-{ts}.zip) when the same
    // version was archived more than once. Constructing "history/1.0.0.zip" would miss them.
    const histEntry = group.history.find((h) => h.version === version);
    if (!histEntry) {
      throw new Error(`Version ${version} not found in history for slug: ${slug}`);
    }

    const slugDir = resolved.slugDir;
    const draftZip = path.join(slugDir, 'draft.zip');
    if (fsSync.existsSync(draftZip)) {
      throw new Error(`Cannot rollback: a draft already exists for '${slug}'. Discard it first.`);
    }

    await fs.copyFile(histEntry.zipPath, draftZip);
    await this.loadGroupFromDir(slug, slugDir);
    this.logger.log(`rollback: '${slug}' v${version} promoted to draft`);
    return this.groups.get(slug)!;
  }

  /** Delete draft without approving it. */
  async discardDraft(slug: string): Promise<RAAppGroup> {
    const resolved = this.resolveUserSlugPath(slug);
    slug = resolved.slug;
    const group = this.groups.get(slug);
    if (!group) throw new Error(`No RA-App group found for slug: ${slug}`);
    if (!group.draft) throw new Error(`No draft to discard for slug: ${slug}`);

    await fs.unlink(path.join(resolved.slugDir, 'draft.zip'));
    await this.loadGroupFromDir(slug, resolved.slugDir);
    this.logger.log(`discardDraft: '${slug}'`);
    return this.groups.get(slug)!;
  }

  /** Delete an entire group (folder). Core apps are never stored here. */
  async deleteGroup(slug: string): Promise<void> {
    const resolved = this.resolveUserSlugPath(slug);
    slug = resolved.slug;
    const group = this.groups.get(slug);
    if (!group) throw new Error(`No RA-App group found for slug: ${slug}`);

    await fs.rm(resolved.slugDir, { recursive: true, force: true });
    this.groups.delete(slug);
    this.logger.log(`deleteGroup: '${slug}'`);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Extract meta.yml from a ZIP buffer (uses a tmp directory). */
  private async extractMeta(buffer: Buffer): Promise<RAAppMeta> {
    const tmpId = randomUUID();
    const tmpDir = path.join(this.tmpDir, tmpId);
    try {
      await ensureDir(tmpDir);
      const zipPath = path.join(tmpDir, '_upload.zip');
      await fs.writeFile(zipPath, buffer);
      await extractZip(zipPath, { dir: tmpDir });

      let raw: string;
      try {
        raw = await fs.readFile(path.join(tmpDir, 'meta.yml'), 'utf-8');
      } catch {
        throw new Error('meta.yml not found at the ZIP root — every RA-App must include a meta.yml');
      }

      try {
        return yaml.load(raw) as RAAppMeta;
      } catch (err) {
        throw new Error(`meta.yml is not valid YAML: ${(err as Error).message}`, {
          cause: err,
        });
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {/* best effort */});
    }
  }

  private async parseZipMeta(zipPath: string): Promise<RAAppMeta> {
    const buf = await fs.readFile(zipPath);
    return this.extractMeta(buf);
  }

  private resolveUserSlugPath(slug: string): { slug: string; slugDir: string } {
    const normalizedSlug = slug.trim();
    if (!isValidRAAppSlug(normalizedSlug)) {
      throw new Error(`Invalid RA-App slug "${slug}". Slugs must match ^[a-z0-9-]+$`);
    }

    const slugDir = path.resolve(this.userDir, normalizedSlug);
    const relative = path.relative(this.userDir, slugDir);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Invalid RA-App slug "${slug}". Resolved path escapes the RA-App root.`);
    }

    return { slug: normalizedSlug, slugDir };
  }

  private async readManifest(slugDir: string): Promise<GroupManifest> {
    const manifestPath = path.join(slugDir, '.manifest.json');
    try {
      const raw = await fs.readFile(manifestPath, 'utf-8');
      return JSON.parse(raw) as GroupManifest;
    } catch {
      return {
        slug: path.basename(slugDir),
        currentVersion: '1.0.0',
        history: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }
  }

  private async writeManifest(slugDir: string, manifest: GroupManifest): Promise<void> {
    await fs.writeFile(
      path.join(slugDir, '.manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    );
  }

  /**
   * Patch the version field in meta.yml inside a ZIP in-place.
   * Extracts → edits meta.yml → re-archives back to the same path.
   */
  private async patchVersionInZip(zipPath: string, newVersion: string): Promise<void> {
    const tmpDir = path.join(this.tmpDir, randomUUID());
    const tmpZip = zipPath + '.tmp'; // declared outside try so finally can clean it up
    try {
      await ensureDir(tmpDir);
      await extractZip(zipPath, { dir: tmpDir });

      const metaPath = path.join(tmpDir, 'meta.yml');
      const raw = await fs.readFile(metaPath, 'utf-8');
      const meta = yaml.load(raw) as RAAppMeta;
      meta.version = newVersion;
      await fs.writeFile(metaPath, yaml.dump(meta), 'utf-8');

      await archiveDirectoryToZip({
        sourceDir: tmpDir,
        zipPath: tmpZip,
        cleanupOnError: async () => {
          await fs.rm(tmpZip, { force: true });
        },
      });
      await fs.rename(tmpZip, zipPath);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {/* best effort */});
      // Clean up the .tmp file if rename didn't happen (e.g. archiver error or rename failure).
      // fs.rm with force:true is a no-op when the file doesn't exist, so this is always safe.
      await fs.rm(tmpZip, { force: true }).catch(() => {/* best effort */});
    }
  }
}

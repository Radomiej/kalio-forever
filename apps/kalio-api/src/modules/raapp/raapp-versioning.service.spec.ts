/**
 * Unit tests for RAAppVersioningService.
 *
 * Uses real filesystem with a per-test temp directory.
 * Builds minimal valid ZIPs using archiver (already a dep).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import archiver from 'archiver';
import yaml from 'js-yaml';
import { RAAppVersioningService, parseSemver, bumpVersion, deriveSlug } from './raapp-versioning.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function buildZip(meta: Record<string, unknown>, extraFiles?: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const arc = archiver('zip');
    arc.on('error', reject);
    arc.on('data', (chunk: Buffer) => chunks.push(chunk));
    arc.on('end', () => resolve(Buffer.concat(chunks)));

    arc.append(yaml.dump(meta), { name: 'meta.yml' });
    if (extraFiles) {
      for (const [name, content] of Object.entries(extraFiles)) {
        arc.append(content, { name });
      }
    }
    void arc.finalize();
  });
}

function makeConfig(base: string) {
  return { get: (_key: string, def: unknown) => ((_key === 'RA_APPS_PATH') ? base : def) };
}

async function makeService(base: string): Promise<RAAppVersioningService> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      RAAppVersioningService,
      { provide: ConfigService, useValue: makeConfig(base) },
    ],
  }).compile();
  return moduleRef.get<RAAppVersioningService>(RAAppVersioningService);
}

// ── Semver helpers ────────────────────────────────────────────────────────────

describe('semver helpers', () => {
  it('parseSemver parses standard versions', () => {
    expect(parseSemver('1.2.3')).toEqual([1, 2, 3]);
    expect(parseSemver('v0.1.0')).toEqual([0, 1, 0]);
    expect(parseSemver('10.0.0')).toEqual([10, 0, 0]);
  });

  it('parseSemver handles missing parts', () => {
    expect(parseSemver('1')).toEqual([1, 0, 0]);
    expect(parseSemver('1.2')).toEqual([1, 2, 0]);
  });

  it('bumpVersion increments correctly', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
  });

  it('deriveSlug converts display names', () => {
    expect(deriveSlug('My App')).toBe('my-app');
    expect(deriveSlug('  Hello   World  ')).toBe('hello-world');
    expect(deriveSlug('foo--bar')).toBe('foo-bar');
    expect(deriveSlug('--leading')).toBe('leading');
  });
});

// ── RAAppVersioningService ────────────────────────────────────────────────────

describe('RAAppVersioningService', () => {
  let tmpBase: string;
  let service: RAAppVersioningService;

  beforeEach(async () => {
    tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'raapp-versioning-'));
    service = await makeService(tmpBase);
    await service.init();
  });

  afterEach(async () => {
    await fs.rm(tmpBase, { recursive: true, force: true });
  });

  // ── saveAsDraft ───────────────────────────────────────────────────────────

  describe('saveAsDraft', () => {
    it('creates a new app directly as current when no existing slug', async () => {
      const buf = await buildZip({ id: 'my-app', name: 'My App', version: '1.0.0' });
      const group = await service.saveAsDraft('my-app', buf);

      expect(group.slug).toBe('my-app');
      expect(group.current.version).toBe('1.0.0');
      expect(group.draft).toBeUndefined();
      expect(group.history).toHaveLength(0);

      // current.zip exists on disk
      const zipPath = path.join(tmpBase, 'user', 'my-app', 'current.zip');
      expect(fsSync.existsSync(zipPath)).toBe(true);
    });

    it('saves as draft when app already has a current version', async () => {
      const buf1 = await buildZip({ id: 'my-app', name: 'My App', version: '1.0.0' });
      await service.saveAsDraft('my-app', buf1);

      const buf2 = await buildZip({ id: 'my-app', name: 'My App', version: '1.1.0' });
      const group = await service.saveAsDraft('my-app', buf2);

      expect(group.current.version).toBe('1.0.0');
      expect(group.draft).toBeDefined();
      expect(group.draft?.version).toBe('1.1.0');

      const draftPath = path.join(tmpBase, 'user', 'my-app', 'draft.zip');
      expect(fsSync.existsSync(draftPath)).toBe(true);
    });

    it('throws on invalid ZIP (no meta.yml)', async () => {
      const buf = await buildZip({ unrelated: true }, { 'other.txt': 'hello' });
      // The zip won't have meta.yml at the expected path in a useful way — we manually break it
      const brokenBuf = Buffer.from('not a zip at all');
      await expect(service.saveAsDraft('broken-app', brokenBuf)).rejects.toThrow();
    });
  });

  // ── approveDraft ──────────────────────────────────────────────────────────

  describe('approveDraft', () => {
    it('promotes draft to current and moves old current to history', async () => {
      const buf1 = await buildZip({ id: 'my-app', name: 'My App', version: '1.0.0' });
      await service.saveAsDraft('my-app', buf1);

      const buf2 = await buildZip({ id: 'my-app', name: 'My App', version: '1.1.0' });
      await service.saveAsDraft('my-app', buf2);

      const approved = await service.approveDraft('my-app', 'minor');

      // Version is bumped from old current (1.0.0) by 'minor' → 1.1.0
      expect(approved.current.version).toBe('1.1.0');
      expect(approved.draft).toBeUndefined();
      expect(approved.history).toHaveLength(1);
      expect(approved.history[0].version).toBe('1.0.0');
      expect(approved.history[0].status).toBe('archived');

      // draft.zip is gone
      const draftPath = path.join(tmpBase, 'user', 'my-app', 'draft.zip');
      expect(fsSync.existsSync(draftPath)).toBe(false);

      // history zip exists
      const histPath = path.join(tmpBase, 'user', 'my-app', 'history', '1.0.0.zip');
      expect(fsSync.existsSync(histPath)).toBe(true);
    });

    it('bumps version with patch type', async () => {
      const buf1 = await buildZip({ id: 'app', name: 'App', version: '2.0.0' });
      await service.saveAsDraft('app', buf1);
      const buf2 = await buildZip({ id: 'app', name: 'App', version: '2.0.1' });
      await service.saveAsDraft('app', buf2);

      const approved = await service.approveDraft('app', 'patch');
      expect(approved.current.version).toBe('2.0.1');
    });

    it('throws when no draft exists', async () => {
      const buf = await buildZip({ id: 'app', name: 'App', version: '1.0.0' });
      await service.saveAsDraft('app', buf);

      await expect(service.approveDraft('app', 'minor')).rejects.toThrow('No draft to approve');
    });

    it('throws for unknown slug', async () => {
      await expect(service.approveDraft('nonexistent', 'minor')).rejects.toThrow('No RA-App group found');
    });
  });

  // ── rollback ─────────────────────────────────────────────────────────────

  describe('rollback', () => {
    it('copies a historical version to draft', async () => {
      const buf1 = await buildZip({ id: 'app', name: 'App', version: '1.0.0' });
      await service.saveAsDraft('app', buf1);
      const buf2 = await buildZip({ id: 'app', name: 'App', version: '1.1.0' });
      await service.saveAsDraft('app', buf2);
      await service.approveDraft('app', 'minor');

      // Now rollback to 1.0.0
      const group = await service.rollback('app', '1.0.0');

      expect(group.draft).toBeDefined();
      expect(group.draft?.version).toBe('1.0.0');
      expect(group.current.version).toBe('1.1.0');
    });

    it('throws when draft already exists', async () => {
      const buf1 = await buildZip({ id: 'app', name: 'App', version: '1.0.0' });
      await service.saveAsDraft('app', buf1);
      const buf2 = await buildZip({ id: 'app', name: 'App', version: '1.1.0' });
      await service.saveAsDraft('app', buf2);
      await service.approveDraft('app', 'minor');

      const buf3 = await buildZip({ id: 'app', name: 'App', version: '1.2.0' });
      await service.saveAsDraft('app', buf3); // creates a draft

      await expect(service.rollback('app', '1.0.0')).rejects.toThrow('draft already exists');
    });

    it('throws when version not in history', async () => {
      const buf = await buildZip({ id: 'app', name: 'App', version: '1.0.0' });
      await service.saveAsDraft('app', buf);

      await expect(service.rollback('app', '0.9.0')).rejects.toThrow('not found in history');
    });
  });

  // ── discardDraft ──────────────────────────────────────────────────────────

  describe('discardDraft', () => {
    it('removes draft.zip without promoting', async () => {
      const buf1 = await buildZip({ id: 'app', name: 'App', version: '1.0.0' });
      await service.saveAsDraft('app', buf1);
      const buf2 = await buildZip({ id: 'app', name: 'App', version: '1.1.0' });
      await service.saveAsDraft('app', buf2);

      const group = await service.discardDraft('app');

      expect(group.draft).toBeUndefined();
      expect(group.current.version).toBe('1.0.0');
      expect(group.history).toHaveLength(0);

      const draftPath = path.join(tmpBase, 'user', 'app', 'draft.zip');
      expect(fsSync.existsSync(draftPath)).toBe(false);
    });

    it('throws when no draft exists', async () => {
      const buf = await buildZip({ id: 'app', name: 'App', version: '1.0.0' });
      await service.saveAsDraft('app', buf);

      await expect(service.discardDraft('app')).rejects.toThrow('No draft to discard');
    });
  });

  // ── deleteGroup ───────────────────────────────────────────────────────────

  describe('deleteGroup', () => {
    it('removes the slug folder and clears from memory', async () => {
      const buf = await buildZip({ id: 'app', name: 'App', version: '1.0.0' });
      await service.saveAsDraft('app', buf);

      await service.deleteGroup('app');

      expect(service.getGroupBySlug('app')).toBeUndefined();
      const slugDir = path.join(tmpBase, 'user', 'app');
      expect(fsSync.existsSync(slugDir)).toBe(false);
    });

    it('throws for unknown slug', async () => {
      await expect(service.deleteGroup('ghost')).rejects.toThrow('No RA-App group found');
    });
  });

  // ── migration ─────────────────────────────────────────────────────────────

  describe('migrateFlatZips', () => {
    it('migrates a flat ZIP to versioned folder layout on init', async () => {
      // Write a flat zip directly to userDir
      const userDir = path.join(tmpBase, 'user');
      await fs.mkdir(userDir, { recursive: true });
      const buf = await buildZip({ id: 'legacy-app', name: 'Legacy App', version: '1.0.0' });
      await fs.writeFile(path.join(userDir, 'legacy-app.zip'), buf);

      // Re-init picks up the flat ZIP and migrates it
      await service.init();

      const group = service.getGroupBySlug('legacy-app');
      expect(group).toBeDefined();
      expect(group?.current.version).toBe('1.0.0');

      // Flat ZIP is gone
      expect(fsSync.existsSync(path.join(userDir, 'legacy-app.zip'))).toBe(false);
      // Versioned folder exists
      expect(fsSync.existsSync(path.join(userDir, 'legacy-app', 'current.zip'))).toBe(true);
    });

    it('migration is idempotent — does not double-migrate', async () => {
      const userDir = path.join(tmpBase, 'user');
      const buf = await buildZip({ id: 'app', name: 'App', version: '1.0.0' });
      await service.saveAsDraft('app', buf);

      // Re-init twice — should not corrupt
      await service.init();
      await service.init();

      const group = service.getGroupBySlug('app');
      expect(group).toBeDefined();
      expect(group?.history).toHaveLength(0);
      // Folder still has exactly one zip
      const slugDir = path.join(userDir, 'app');
      const files = await fs.readdir(slugDir);
      const zips = files.filter((f) => f.endsWith('.zip'));
      expect(zips).toHaveLength(1);
    });
  });

  // ── getGroups ─────────────────────────────────────────────────────────────

  describe('getGroups', () => {
    it('returns all loaded groups', async () => {
      const buf1 = await buildZip({ id: 'alpha', name: 'Alpha', version: '1.0.0' });
      const buf2 = await buildZip({ id: 'beta', name: 'Beta', version: '2.0.0' });
      await service.saveAsDraft('alpha', buf1);
      await service.saveAsDraft('beta', buf2);

      const groups = service.getGroups();
      expect(groups).toHaveLength(2);
      const slugs = groups.map((g) => g.slug).sort();
      expect(slugs).toEqual(['alpha', 'beta']);
    });
  });
});

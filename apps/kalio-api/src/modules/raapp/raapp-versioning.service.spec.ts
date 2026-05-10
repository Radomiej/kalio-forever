/**
 * Tests for RAAppVersioningService.
 *
 * Uses real filesystem with a per-test temp directory.
 * Builds minimal valid ZIPs using archiver (already a dep).
 *
 * Sections:
 *  - semver helpers (unit)
 *  - RAAppVersioningService (integration, real FS)
 *    - saveAsDraft
 *    - saveAsDraft validation (bug #4 — specific error messages)
 *    - approveDraft  (incl. dedup trigger)
 *    - rollback
 *    - rollback with dedup history entries (bugs #1 & #2)
 *    - discardDraft
 *    - deleteGroup
 *    - patchVersionInZip cleanup (bug #3 — no .tmp leak)
 *    - migrateFlatZips
 *    - getGroups
 *  - Full lifecycle integration (end-to-end)
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

/** Builds a valid ZIP WITHOUT a meta.yml — used to test validation error messages. */
async function buildZipNoMeta(files: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const arc = archiver('zip');
    arc.on('error', reject);
    arc.on('data', (chunk: Buffer) => chunks.push(chunk));
    arc.on('end', () => resolve(Buffer.concat(chunks)));
    for (const [name, content] of Object.entries(files)) {
      arc.append(content, { name });
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

    it('overwrites existing draft with new upload', async () => {
      const buf1 = await buildZip({ id: 'app', name: 'App', version: '1.0.0' });
      await service.saveAsDraft('app', buf1);
      const buf2 = await buildZip({ id: 'app', name: 'App', version: '1.1.0' });
      await service.saveAsDraft('app', buf2);
      const buf3 = await buildZip({ id: 'app', name: 'App', version: '1.2.0' });
      const group = await service.saveAsDraft('app', buf3);

      expect(group.draft?.version).toBe('1.2.0');
    });

    it('throws on completely invalid (non-ZIP) buffer', async () => {
      const brokenBuf = Buffer.from('not a zip at all');
      await expect(service.saveAsDraft('broken-app', brokenBuf)).rejects.toThrow(/Invalid RA-App ZIP/);
    });
  });

  // ── saveAsDraft validation (bug #4) ──────────────────────────────────────

  describe('saveAsDraft validation — specific error messages (bug #4)', () => {
    it('gives a clear error message when meta.yml is missing from an otherwise valid ZIP', async () => {
      // Valid ZIP but no meta.yml inside it
      const buf = await buildZipNoMeta({ 'index.html': '<html/>', 'app.js': 'console.log("hi")' });
      await expect(service.saveAsDraft('no-meta', buf)).rejects.toThrow(/meta\.yml/);
    });

    it('error message for non-ZIP buffer mentions Invalid RA-App ZIP', async () => {
      const buf = Buffer.from('this is plain text, not a zip');
      await expect(service.saveAsDraft('not-zip', buf)).rejects.toThrow(/Invalid RA-App ZIP/);
    });

    it('gives a clear error for malformed YAML inside meta.yml', async () => {
      const badYamlBuf = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const arc = archiver('zip');
        arc.on('error', reject);
        arc.on('data', (chunk: Buffer) => chunks.push(chunk));
        arc.on('end', () => resolve(Buffer.concat(chunks)));
        arc.append(': this: is: {{{{ broken yaml', { name: 'meta.yml' });
        void arc.finalize();
      });
      await expect(service.saveAsDraft('bad-yaml', badYamlBuf)).rejects.toThrow(/Invalid RA-App ZIP/);
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

      expect(approved.current.version).toBe('1.1.0');
      expect(approved.draft).toBeUndefined();
      expect(approved.history).toHaveLength(1);
      expect(approved.history[0].version).toBe('1.0.0');
      expect(approved.history[0].status).toBe('archived');

      const draftPath = path.join(tmpBase, 'user', 'my-app', 'draft.zip');
      expect(fsSync.existsSync(draftPath)).toBe(false);

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

    it('bumps version with major type', async () => {
      const buf1 = await buildZip({ id: 'app', name: 'App', version: '1.5.3' });
      await service.saveAsDraft('app', buf1);
      const buf2 = await buildZip({ id: 'app', name: 'App', version: '1.5.4' });
      await service.saveAsDraft('app', buf2);

      const approved = await service.approveDraft('app', 'major');
      expect(approved.current.version).toBe('2.0.0');
    });

    it('accumulates history entries across successive approvals', async () => {
      await service.saveAsDraft('app', await buildZip({ id: 'app', name: 'App', version: '1.0.0' }));

      for (const v of ['1.1.0', '1.2.0', '1.3.0']) {
        await service.saveAsDraft('app', await buildZip({ id: 'app', name: 'App', version: v }));
        await service.approveDraft('app', 'minor');
      }

      const group = service.getGroupBySlug('app');
      expect(group?.history).toHaveLength(3);
      const versions = group!.history.map((h) => h.version);
      expect(versions).toContain('1.0.0');
      expect(versions).toContain('1.1.0');
      expect(versions).toContain('1.2.0');
    });

    it('deduplicates history when same-version zip already exists', async () => {
      // Set up: current=1.1.0 AND history/1.1.0.zip already present (crash/rollback edge case)
      const slugDir = path.join(tmpBase, 'user', 'cycle-app');
      await fs.mkdir(path.join(slugDir, 'history'), { recursive: true });

      const currentBuf = await buildZip({ id: 'cycle-app', name: 'Cycle App', version: '1.1.0' });
      await fs.writeFile(path.join(slugDir, 'current.zip'), currentBuf);

      const histBuf = await buildZip({ id: 'cycle-app', name: 'Cycle App', version: '1.1.0' });
      await fs.writeFile(path.join(slugDir, 'history', '1.1.0.zip'), histBuf);

      const draftBuf = await buildZip({ id: 'cycle-app', name: 'Cycle App', version: '1.2.0' });
      await fs.writeFile(path.join(slugDir, 'draft.zip'), draftBuf);

      await fs.writeFile(
        path.join(slugDir, '.manifest.json'),
        JSON.stringify({ slug: 'cycle-app', currentVersion: '1.1.0', history: ['1.1.0'], createdAt: Date.now(), updatedAt: Date.now() }),
      );

      await service.init();

      // Must NOT throw even though history/1.1.0.zip already exists
      const approved = await service.approveDraft('cycle-app', 'minor');
      expect(approved.current.version).toBe('1.2.0');

      // A dedup file (1.1.0-{ts}.zip) should have been created
      const histDir = path.join(slugDir, 'history');
      const files = await fs.readdir(histDir);
      const dedupEntry = files.find((f) => f.startsWith('1.1.0-') && f.endsWith('.zip'));
      expect(dedupEntry).toBeDefined();
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

  describe('downloadRelease', () => {
    it('throws when the selected release zip is missing on disk', async () => {
      const buf = await buildZip({ id: 'my-app', name: 'My App', version: '1.0.0' });
      await service.saveAsDraft('my-app', buf);

      const currentZip = path.join(tmpBase, 'user', 'my-app', 'current.zip');
      await fs.unlink(currentZip);

      expect(() => service.downloadRelease('my-app', '1.0.0')).toThrow(/release|zip|not found|missing/i);
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
      await service.saveAsDraft('app', buf3);

      await expect(service.rollback('app', '1.0.0')).rejects.toThrow('draft already exists');
    });

    it('throws when version not in history', async () => {
      const buf = await buildZip({ id: 'app', name: 'App', version: '1.0.0' });
      await service.saveAsDraft('app', buf);

      await expect(service.rollback('app', '0.9.0')).rejects.toThrow('not found in history');
    });
  });

  // ── rollback with dedup history entries (bugs #1 & #2) ───────────────────

  describe('rollback with dedup-named history entries (bugs #1 & #2)', () => {
    it('rollback works when only a timestamp-dedup zip exists — not a plain version.zip (bug #1)', async () => {
      // Simulate: approveDraft wrote "1.0.0-1746000000000.zip" because "1.0.0.zip" was already taken.
      // The regular history/1.0.0.zip does NOT exist.
      const slugDir = path.join(tmpBase, 'user', 'dedup-app');
      await fs.mkdir(path.join(slugDir, 'history'), { recursive: true });

      const currentBuf = await buildZip({ id: 'dedup-app', name: 'Dedup App', version: '2.0.0' });
      await fs.writeFile(path.join(slugDir, 'current.zip'), currentBuf);

      const histBuf = await buildZip({ id: 'dedup-app', name: 'Dedup App', version: '1.0.0' });
      await fs.writeFile(path.join(slugDir, 'history', '1.0.0-1746000000000.zip'), histBuf);
      // No history/1.0.0.zip — only the dedup'd file exists

      await fs.writeFile(
        path.join(slugDir, '.manifest.json'),
        JSON.stringify({ slug: 'dedup-app', currentVersion: '2.0.0', history: ['1.0.0'], createdAt: Date.now(), updatedAt: Date.now() }),
      );

      await service.init();

      // In-memory entry must store the actual (dedup) zipPath, not a constructed path (bug #2)
      const loaded = service.getGroupBySlug('dedup-app');
      expect(loaded?.history[0].version).toBe('1.0.0');
      expect(loaded?.history[0].zipPath).toContain('1.0.0-1746000000000.zip');

      // Rollback must use zipPath from in-memory group — not construct "history/1.0.0.zip"
      const result = await service.rollback('dedup-app', '1.0.0');
      expect(result.draft).toBeDefined();
      expect(result.draft?.version).toBe('1.0.0');
    });

    it('history zipPath survives service re-init from disk (bug #2)', async () => {
      const buf1 = await buildZip({ id: 'app', name: 'App', version: '1.0.0' });
      await service.saveAsDraft('app', buf1);
      await service.saveAsDraft('app', await buildZip({ id: 'app', name: 'App', version: '1.1.0' }));
      await service.approveDraft('app', 'minor');

      // Re-init simulates a server restart
      await service.init();

      const group = service.getGroupBySlug('app');
      expect(group?.history).toHaveLength(1);
      const entry = group!.history[0];
      expect(fsSync.existsSync(entry.zipPath)).toBe(true);
      expect(entry.zipPath).toContain('1.0.0.zip');
    });

    it('rollback after dedup-trigger cycle works end-to-end', async () => {
      // Standard setup: get two versions into history
      await service.saveAsDraft('app', await buildZip({ id: 'app', name: 'App', version: '1.0.0' }));
      await service.saveAsDraft('app', await buildZip({ id: 'app', name: 'App', version: '1.1.0' }));
      await service.approveDraft('app', 'minor'); // current=1.1.0, hist=[1.0.0.zip]

      // Manually inject a 1.1.0.zip into history to force dedup on next approve
      const slugDir = path.join(tmpBase, 'user', 'app');
      const dupBuf = await buildZip({ id: 'app', name: 'App', version: '1.1.0' });
      await fs.writeFile(path.join(slugDir, 'history', '1.1.0.zip'), dupBuf);

      // Add draft and approve — this MUST create 1.1.0-{ts}.zip (dedup)
      await service.saveAsDraft('app', await buildZip({ id: 'app', name: 'App', version: '1.2.0' }));
      await service.init(); // reload to pick up injected file
      const approved = await service.approveDraft('app', 'minor');
      expect(approved.current.version).toBe('1.2.0');

      // history now has 1.1.0.zip (original) and 1.1.0-{ts}.zip (dedup)
      // Rollback to '1.1.0' must find ONE of them via zipPath and succeed
      const rolled = await service.rollback('app', '1.1.0');
      expect(rolled.draft).toBeDefined();
      expect(rolled.draft?.version).toBe('1.1.0');
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

  // ── patchVersionInZip cleanup (bug #3) ────────────────────────────────────

  describe('patchVersionInZip — no .tmp file leak (bug #3)', () => {
    it('leaves no current.zip.tmp after a successful approveDraft', async () => {
      await service.saveAsDraft('app', await buildZip({ id: 'app', name: 'App', version: '1.0.0' }));
      await service.saveAsDraft('app', await buildZip({ id: 'app', name: 'App', version: '1.1.0' }));

      await service.approveDraft('app', 'minor');

      const currentZip = path.join(tmpBase, 'user', 'app', 'current.zip');
      expect(fsSync.existsSync(currentZip + '.tmp')).toBe(false);
    });

    it('leaves no .tmp file across multiple sequential approvals', async () => {
      await service.saveAsDraft('app', await buildZip({ id: 'app', name: 'App', version: '1.0.0' }));

      for (let i = 1; i <= 3; i++) {
        await service.saveAsDraft('app', await buildZip({ id: 'app', name: 'App', version: `1.${i}.0` }));
        await service.approveDraft('app', 'minor');

        const currentZip = path.join(tmpBase, 'user', 'app', 'current.zip');
        expect(fsSync.existsSync(currentZip + '.tmp'), `stale .tmp after approval #${i}`).toBe(false);
      }
    });
  });

  // ── migration ─────────────────────────────────────────────────────────────

  describe('migrateFlatZips', () => {
    it('migrates a flat ZIP to versioned folder layout on init', async () => {
      const userDir = path.join(tmpBase, 'user');
      await fs.mkdir(userDir, { recursive: true });
      const buf = await buildZip({ id: 'legacy-app', name: 'Legacy App', version: '1.0.0' });
      await fs.writeFile(path.join(userDir, 'legacy-app.zip'), buf);

      await service.init();

      const group = service.getGroupBySlug('legacy-app');
      expect(group).toBeDefined();
      expect(group?.current.version).toBe('1.0.0');

      expect(fsSync.existsSync(path.join(userDir, 'legacy-app.zip'))).toBe(false);
      expect(fsSync.existsSync(path.join(userDir, 'legacy-app', 'current.zip'))).toBe(true);
    });

    it('migration is idempotent — does not double-migrate', async () => {
      const userDir = path.join(tmpBase, 'user');
      const buf = await buildZip({ id: 'app', name: 'App', version: '1.0.0' });
      await service.saveAsDraft('app', buf);

      await service.init();
      await service.init();

      const group = service.getGroupBySlug('app');
      expect(group).toBeDefined();
      expect(group?.history).toHaveLength(0);
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

// ── Full lifecycle integration ────────────────────────────────────────────────

describe('Full lifecycle integration', () => {
  let tmpBase: string;
  let service: RAAppVersioningService;

  beforeEach(async () => {
    tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'raapp-lifecycle-'));
    service = await makeService(tmpBase);
    await service.init();
  });

  afterEach(async () => {
    await fs.rm(tmpBase, { recursive: true, force: true });
  });

  it('upload → approve → rollback → re-approve → delete', async () => {
    // 1. Initial upload becomes current directly
    const g1 = await service.saveAsDraft('app', await buildZip({ id: 'app', name: 'App', version: '1.0.0' }));
    expect(g1.current.version).toBe('1.0.0');
    expect(g1.draft).toBeUndefined();

    // 2. First approve
    await service.saveAsDraft('app', await buildZip({ id: 'app', name: 'App', version: '1.1.0' }));
    const g2 = await service.approveDraft('app', 'minor');
    expect(g2.current.version).toBe('1.1.0');
    expect(g2.history).toHaveLength(1);
    expect(g2.history[0].version).toBe('1.0.0');

    // 3. Second approve
    await service.saveAsDraft('app', await buildZip({ id: 'app', name: 'App', version: '1.2.0' }));
    const g3 = await service.approveDraft('app', 'minor');
    expect(g3.current.version).toBe('1.2.0');
    expect(g3.history).toHaveLength(2);

    // 4. Rollback to 1.0.0
    const g4 = await service.rollback('app', '1.0.0');
    expect(g4.draft?.version).toBe('1.0.0');
    expect(g4.current.version).toBe('1.2.0'); // unchanged

    // 5. Approve the rollback — bumps from old current (1.2.0) → 1.3.0
    const g5 = await service.approveDraft('app', 'minor');
    expect(g5.current.version).toBe('1.3.0');
    expect(g5.history).toHaveLength(3);

    // 6. Discard a subsequent draft (no promotion)
    await service.saveAsDraft('app', await buildZip({ id: 'app', name: 'App', version: '1.4.0' }));
    const g6 = await service.discardDraft('app');
    expect(g6.draft).toBeUndefined();
    expect(g6.current.version).toBe('1.3.0');

    // 7. Delete group entirely
    await service.deleteGroup('app');
    expect(service.getGroupBySlug('app')).toBeUndefined();
    expect(fsSync.existsSync(path.join(tmpBase, 'user', 'app'))).toBe(false);
  });

  it('state is fully recoverable after service re-init (simulated restart)', async () => {
    await service.saveAsDraft('persist', await buildZip({ id: 'persist', name: 'Persist', version: '1.0.0' }));
    await service.saveAsDraft('persist', await buildZip({ id: 'persist', name: 'Persist', version: '1.1.0' }));
    await service.approveDraft('persist', 'minor');

    await service.init(); // simulate restart

    const group = service.getGroupBySlug('persist');
    expect(group?.current.version).toBe('1.1.0');
    expect(group?.history).toHaveLength(1);
    expect(group?.history[0].version).toBe('1.0.0');
    expect(fsSync.existsSync(group!.history[0].zipPath)).toBe(true);
  });

  it('concurrent saveAsDraft for different slugs are independent', async () => {
    const [g1, g2, g3] = await Promise.all([
      service.saveAsDraft('alpha', await buildZip({ id: 'alpha', name: 'Alpha', version: '1.0.0' })),
      service.saveAsDraft('beta', await buildZip({ id: 'beta', name: 'Beta', version: '2.0.0' })),
      service.saveAsDraft('gamma', await buildZip({ id: 'gamma', name: 'Gamma', version: '3.0.0' })),
    ]);

    expect(g1.slug).toBe('alpha');
    expect(g2.slug).toBe('beta');
    expect(g3.slug).toBe('gamma');
    expect(service.getGroups()).toHaveLength(3);
  });

  it('rollback → re-approve produces correct semver and accumulated history', async () => {
    await service.saveAsDraft('app', await buildZip({ id: 'app', name: 'App', version: '1.0.0' }));

    for (const v of ['1.1.0', '1.2.0', '1.3.0']) {
      await service.saveAsDraft('app', await buildZip({ id: 'app', name: 'App', version: v }));
      await service.approveDraft('app', 'minor');
    }
    // current=1.3.0, history=[1.0.0, 1.1.0, 1.2.0]

    await service.rollback('app', '1.1.0');
    const reapproved = await service.approveDraft('app', 'major'); // 1.3.0 → 2.0.0
    expect(reapproved.current.version).toBe('2.0.0');
    expect(reapproved.history).toHaveLength(4); // 1.0.0, 1.1.0, 1.2.0, 1.3.0

    // All prior versions still accessible for rollback
    const rolled = await service.rollback('app', '1.0.0');
    expect(rolled.draft?.version).toBe('1.0.0');
  });
});


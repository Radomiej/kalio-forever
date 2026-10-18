import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { resolveCorepackEntrypoint } from './corepack-path.mjs';

for (const location of ['lib/node_modules/corepack/dist/corepack.js', 'bin/node_modules/corepack/dist/corepack.js']) {
  test(`finds Corepack in ${location}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'kalio-corepack-'));
    try {
      const entrypoint = join(root, location);
      mkdirSync(dirname(entrypoint), { recursive: true });
      writeFileSync(entrypoint, '');
      assert.equal(resolveCorepackEntrypoint(join(root, 'bin/node'), undefined), entrypoint);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('reports missing Corepack instead of spawning a nonexistent script', () => {
  assert.throws(() => resolveCorepackEntrypoint('/nonexistent/kalio/bin/node', undefined), /Corepack.*not found/);
});

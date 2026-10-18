import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeDependencies } from './runtime-dependencies.mjs';

test('runtime packages pin the installed workspace versions and omit internal type-only packages', () => {
  const deps = { 'better-sqlite3': '^12.9.0', sharp: '^0.34.5', '@kalio/types': 'workspace:*' };
  const installed = { 'better-sqlite3': '12.9.0', sharp: '0.34.5' };
  assert.deepEqual(createRuntimeDependencies(deps, installed, 'node'), installed);
  assert.deepEqual(createRuntimeDependencies(deps, installed, 'bun'), { sharp: '0.34.5' });
  assert.throws(() => createRuntimeDependencies({ missing: '^1' }, {}, 'node'), /missing/);
});

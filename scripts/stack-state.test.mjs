import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  readStackApiUrl,
  readStackState,
  resolveStackPaths,
  stackApiUrlFromState,
} from './stack-state.mjs';

test('managed stack state paths are rooted under .tmp qa-stack', () => {
  const root = mkdtempSync(join(tmpdir(), 'kalio-stack-state-paths-'));
  const paths = resolveStackPaths(root);

  assert.equal(paths.stackDir, join(root, '.tmp', 'qa-stack'));
  assert.equal(paths.logsDir, join(root, '.tmp', 'qa-stack-logs'));
  assert.equal(paths.statePath, join(root, '.tmp', 'qa-stack', 'qa-stack-state.json'));
  assert.equal(paths.lastStatePath, join(root, '.tmp', 'qa-stack', 'qa-stack-last-state.json'));
});

test('managed stack API URL comes from the canonical .tmp state file', () => {
  const root = mkdtempSync(join(tmpdir(), 'kalio-stack-state-read-'));
  const paths = resolveStackPaths(root);
  mkdirSync(paths.stackDir, { recursive: true });
  writeFileSync(paths.statePath, JSON.stringify({ backendPort: 51052 }), 'utf8');

  assert.deepEqual(readStackState(root), { backendPort: 51052 });
  assert.equal(readStackApiUrl(root), 'http://127.0.0.1:51052/api');
});

test('stack API URL rejects missing or invalid backend ports', () => {
  assert.equal(stackApiUrlFromState(null), null);
  assert.equal(stackApiUrlFromState({ backendPort: 0 }), null);
  assert.equal(stackApiUrlFromState({ backendPort: 'not-a-port' }), null);
});

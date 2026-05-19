import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStackRuntime, getBackendStartArgs, getEnvFilePath, loadOptionalEnvFile } from './start-playwright-stack.mjs';

const ENV_KEYS = [
  'PLAYWRIGHT_BASE_URL',
  'PLAYWRIGHT_API_ORIGIN',
  'PLAYWRIGHT_KEEP_EXISTING',
  'PLAYWRIGHT_LOADED_FROM_FILE',
];

const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const TEMP_DIRS = [];

afterEach(() => {
  for (const key of ENV_KEYS) {
    const originalValue = ORIGINAL_ENV[key];
    if (originalValue === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = originalValue;
  }

  while (TEMP_DIRS.length > 0) {
    rmSync(TEMP_DIRS.pop(), { recursive: true, force: true });
  }
});

describe('start-playwright-stack', () => {
  it('treats .env.test as optional', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'playwright-stack-'));
    TEMP_DIRS.push(repoRoot);

    assert.equal(getEnvFilePath(repoRoot), join(repoRoot, '.env.test'));
    assert.equal(loadOptionalEnvFile(getEnvFilePath(repoRoot)), false);
  });

  it('loads .env.test into process.env without overriding CI-provided values', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'playwright-stack-'));
    const envFilePath = getEnvFilePath(repoRoot);
    TEMP_DIRS.push(repoRoot);

    writeFileSync(
      envFilePath,
      [
        'PLAYWRIGHT_BASE_URL=http://localhost:6200',
        'PLAYWRIGHT_API_ORIGIN=http://localhost:4216',
        'PLAYWRIGHT_KEEP_EXISTING=from-file',
        'PLAYWRIGHT_LOADED_FROM_FILE=yes',
      ].join('\n'),
    );

    process.env.PLAYWRIGHT_KEEP_EXISTING = 'from-env';
    delete process.env.PLAYWRIGHT_BASE_URL;
    delete process.env.PLAYWRIGHT_API_ORIGIN;
    delete process.env.PLAYWRIGHT_LOADED_FROM_FILE;

    const loaded = loadOptionalEnvFile(envFilePath);
    const runtime = createStackRuntime(repoRoot);

    assert.equal(loaded, true);
    assert.equal(process.env.PLAYWRIGHT_KEEP_EXISTING, 'from-env');
    assert.equal(process.env.PLAYWRIGHT_LOADED_FROM_FILE, 'yes');
    assert.equal(runtime.webUrl.origin, 'http://localhost:6200');
    assert.equal(runtime.apiUrl.origin, 'http://localhost:4216');
    assert.deepEqual(getBackendStartArgs(), ['dist/main.js']);
  });
});

#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const e2eDir = resolve(repoRoot, 'apps/e2e');
const playwrightCli = resolve(e2eDir, 'node_modules/@playwright/test/cli.js');
const stackManager = resolve(repoRoot, 'scripts/stack-manager.mjs');
const statePath = resolve(repoRoot, '.kalio-stack/qa-stack-state.json');

function normalizedWindowsEnv(baseEnv) {
  if (process.platform !== 'win32') {
    return { ...baseEnv };
  }

  const env = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (key.toLowerCase() === 'path') {
      continue;
    }
    env[key] = value;
  }

  const nodeDir = dirname(process.execPath);
  const pathValue = baseEnv.PATH ?? baseEnv.Path ?? '';
  env.Path = `${nodeDir};${pathValue}`;
  return env;
}

function run(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, options);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      resolvePromise({ code: code ?? (signal ? 1 : 0), signal });
    });
  });
}

function readStackState() {
  const raw = readFileSync(statePath, 'utf8');
  const state = JSON.parse(raw);
  if (!state.backendPort || !state.frontendPort) {
    throw new Error(`[qa-ac13] missing ports in ${statePath}`);
  }
  return state;
}

let stackStarted = false;

async function stopStack() {
  if (!stackStarted) {
    return;
  }

  console.log('[qa-ac13] stopping QA stack...');
  await run(process.execPath, [stackManager, 'stop'], {
    cwd: repoRoot,
    env: normalizedWindowsEnv(process.env),
    stdio: 'inherit',
  });
  stackStarted = false;
}

process.once('SIGINT', () => {
  void stopStack().finally(() => process.exit(130));
});
process.once('SIGTERM', () => {
  void stopStack().finally(() => process.exit(143));
});

let exitCode = 1;

try {
  console.log('[qa-ac13] starting isolated QA stack (mock LLM)...');
  const startResult = await run(
    process.execPath,
    [stackManager, 'start', '--backend-port', '0', '--frontend-port', '0'],
    {
      cwd: repoRoot,
      env: normalizedWindowsEnv(process.env),
      stdio: 'inherit',
    },
  );

  if (startResult.code !== 0) {
    throw new Error(`[qa-ac13] stack-manager start failed with code ${startResult.code}`);
  }

  stackStarted = true;
  const state = readStackState();
  const frontendUrl = `http://127.0.0.1:${state.frontendPort}`;
  const backendUrl = `http://127.0.0.1:${state.backendPort}`;

  console.log(`[qa-ac13] QA stack ready: frontend=${frontendUrl} backend=${backendUrl} provider=${state.provider ?? 'mock'}`);

  const playwrightEnv = normalizedWindowsEnv({
    ...process.env,
    KALIO_PLAYWRIGHT_EXTERNAL_SERVER: '1',
    PLAYWRIGHT_BASE_URL: frontendUrl,
    PLAYWRIGHT_API_ORIGIN: backendUrl,
    TEST_API_URL: `${backendUrl}/api`,
  });

  console.log('[qa-ac13] running AC-13 Playwright spec...');
  const testResult = await run(
    process.execPath,
    [playwrightCli, 'test', 'tests/ac-13-anti-spam.spec.ts'],
    {
      cwd: e2eDir,
      env: playwrightEnv,
      stdio: 'inherit',
    },
  );

  exitCode = testResult.code;
  if (exitCode === 0) {
    console.log('[qa-ac13] AC-13 passed on isolated QA stack');
  } else {
    console.error(`[qa-ac13] AC-13 failed with exit code ${exitCode}`);
  }
} catch (error) {
  console.error('[qa-ac13] failed', error);
  exitCode = 1;
} finally {
  await stopStack();
}

process.exit(exitCode);

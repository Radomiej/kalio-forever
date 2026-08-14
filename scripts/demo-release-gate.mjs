#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);

function run(commandArgs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, commandArgs, {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolvePromise(code ?? (signal ? 1 : 0)));
  });
}

try {
  const freeGateCode = await run(['scripts/workflow-release-gate.mjs', ...rawArgs]);
  if (freeGateCode !== 0) {
    throw new Error(`Free workflow release gate failed with exit code ${freeGateCode}; paid canary was not started.`);
  }
  const liveStackCode = await run([
    'scripts/stack-manager.mjs', 'start', '--backend-port', '0', '--frontend-port', '0',
    '--force-restart', '--runtime', 'direct',
  ]);
  if (liveStackCode !== 0) {
    throw new Error(`Persistent live QA stack restart failed with exit code ${liveStackCode}; paid canary was not started.`);
  }
  const paidCanaryCode = await run(['scripts/paid-live-canary.mjs', ...rawArgs]);
  if (paidCanaryCode !== 0) throw new Error(`Paid live canary failed with exit code ${paidCanaryCode}.`);
  console.log('[demo-release-gate] passed');
} catch (error) {
  console.error('[demo-release-gate] failed', error);
  process.exit(1);
}

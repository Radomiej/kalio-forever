#!/usr/bin/env node

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const e2eDir = resolve(repoRoot, 'apps/e2e');
const playwrightCli = resolve(e2eDir, 'node_modules/@playwright/test/cli.js');
const webDistDir = resolve(repoRoot, 'apps/kalio-web/dist');
const rawArgs = process.argv.slice(2);
const lockPath = resolve(tmpdir(), 'kalio-paid-live-canary.lock');
const maxTokens = 128;
const maxToolAttempts = 2;

function getArg(flag) {
  const index = rawArgs.indexOf(flag);
  return index >= 0 ? rawArgs[index + 1]?.trim() : undefined;
}

function requireArg(flag) {
  const value = getArg(flag);
  if (!value) throw new Error(`Missing required ${flag} <value>.`);
  return value;
}

function normalizedWindowsEnv(baseEnv) {
  if (process.platform !== 'win32') return { ...baseEnv };
  const env = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (key.toLowerCase() !== 'path') env[key] = value;
  }
  env.Path = `${dirname(process.execPath)};${baseEnv.PATH ?? baseEnv.Path ?? ''}`;
  return env;
}

function run(command, commandArgs, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, options);
    child.once('error', reject);
    child.once('exit', (code, signal) => resolvePromise({ code: code ?? (signal ? 1 : 0), signal }));
  });
}

function capture(command, commandArgs, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, options);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolvePromise({
      code: code ?? (signal ? 1 : 0), signal, stdout, stderr,
    }));
  });
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${url} failed with ${response.status}`);
  if (response.status === 204) return null;
  return await response.json();
}

async function putJson(url, body) {
  await fetchJson(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function readStackStatus() {
  const result = await capture(process.execPath, ['scripts/stack-manager.mjs', 'status', '--json'], {
    cwd: repoRoot,
    env: normalizedWindowsEnv(process.env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.code !== 0) throw new Error(`stack-manager status failed:\n${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout);
}

function writeFrontendRuntimeConfig(apiOrigin) {
  const runtimeConfigPath = resolve(webDistDir, 'runtime-config.js');
  mkdirSync(dirname(runtimeConfigPath), { recursive: true });
  writeFileSync(
    runtimeConfigPath,
    `window.__KALIO_RUNTIME_CONFIG__ = ${JSON.stringify({ apiUrl: apiOrigin, wsUrl: apiOrigin })};\n`,
    'utf8',
  );
}

function acquireLock() {
  try {
    return openSync(lockPath, 'wx');
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`Another paid canary owns ${lockPath}. Remove it only after confirming no canary is running.`);
    }
    throw error;
  }
}

function releaseLock(handle) {
  closeSync(handle);
  unlinkSync(lockPath);
}

function writeReceipt(receipt) {
  const receiptPath = resolve(tmpdir(), `kalio-paid-tool-canary-${Date.now()}.json`);
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return receiptPath;
}

async function main() {
  if (!rawArgs.includes('--confirm-paid')) {
    throw new Error('Paid tool canary requires explicit --confirm-paid. It permits one fs_write attempt and its bounded follow-up.');
  }
  const expectedProvider = requireArg('--expected-provider');
  const expectedModel = requireArg('--expected-model');
  const requestedSafeRoot = requireArg('--safe-project-path');
  if (!existsSync(requestedSafeRoot) || !statSync(requestedSafeRoot).isDirectory()) {
    throw new Error(`Safe project path must be an existing directory: ${requestedSafeRoot}`);
  }
  const safeRoot = realpathSync(requestedSafeRoot);
  if (safeRoot.toLowerCase() === realpathSync(repoRoot).toLowerCase()) {
    throw new Error('Paid tool canary refuses to use the Kalio repository as its safe project path.');
  }

  const lockHandle = acquireLock();
  let originalSettings;
  let originalToolAttempts;
  let apiOrigin;
  let providerConfig;
  let receiptStatus = 'failed';

  try {
    const status = await readStackStatus();
    if (status.status !== 'running' || !status.backendUp || !status.frontendUp) {
      throw new Error(`Managed QA stack is not ready: ${JSON.stringify(status)}`);
    }
    apiOrigin = `http://127.0.0.1:${status.state.backendPort}`;
    const baseUrl = `http://127.0.0.1:${status.state.frontendPort}`;
    providerConfig = await fetchJson(`${apiOrigin}/api/llm/config`);
    if (providerConfig.source !== 'db') throw new Error(`Expected DB-backed provider, received source=${providerConfig.source}.`);
    if (providerConfig.provider !== expectedProvider || providerConfig.model !== expectedModel) {
      throw new Error(
        `Effective provider mismatch: received ${providerConfig.provider}/${providerConfig.model}, ` +
        `expected ${expectedProvider}/${expectedModel}.`,
      );
    }
    const active = await fetchJson(`${apiOrigin}/api/credentials/active`);
    if (!active?.credentialId) throw new Error('No active live credential is configured.');
    const snapshots = await fetchJson(`${apiOrigin}/api/agent-flows/runs`);
    const nonTerminal = Array.isArray(snapshots)
      ? snapshots.filter((snapshot) => ['queued', 'running', 'waiting_on_orchestrator'].includes(snapshot?.run?.status))
      : [];
    if (nonTerminal.length > 0) {
      throw new Error(`Active AgentFlow runs block paid tool canary: ${nonTerminal.map((item) => item.run.id).join(', ')}`);
    }

    const readiness = await run(process.execPath, [
      'scripts/agentflow-paid-readiness.mjs', '--api', `${apiOrigin}/api`, '--static-only',
    ], {
      cwd: repoRoot,
      env: normalizedWindowsEnv(process.env),
      stdio: 'inherit',
    });
    if (readiness.code !== 0) throw new Error(`Static paid readiness failed with exit code ${readiness.code}.`);

    originalSettings = await fetchJson(`${apiOrigin}/api/credentials/settings/generation`);
    originalToolAttempts = await fetchJson(`${apiOrigin}/api/credentials/settings/max-tool-attempts`);
    await putJson(`${apiOrigin}/api/credentials/settings/generation`, { maxTokens });
    await putJson(`${apiOrigin}/api/credentials/settings/max-tool-attempts`, { size: maxToolAttempts });
    writeFrontendRuntimeConfig(apiOrigin);

    const result = await run(process.execPath, [
      playwrightCli, 'test', 'tests/paid-live-tool-canary.spec.ts', '--project=chromium', '--workers=1',
    ], {
      cwd: e2eDir,
      env: normalizedWindowsEnv({
        ...process.env,
        KALIO_RUN_PAID_TOOL_CANARY: '1',
        KALIO_SAFE_TOOL_PATH: safeRoot,
        KALIO_PLAYWRIGHT_EXTERNAL_SERVER: '1',
        PLAYWRIGHT_BASE_URL: baseUrl,
        PLAYWRIGHT_API_ORIGIN: apiOrigin,
        TEST_API_URL: `${apiOrigin}/api`,
        DATABASE_PATH: status.state.databasePath,
      }),
      stdio: 'inherit',
    });
    if (result.code !== 0) throw new Error(`Paid live tool Playwright canary failed with exit code ${result.code}.`);
    receiptStatus = 'passed';
  } finally {
    const restoreErrors = [];
    if (originalSettings && apiOrigin) {
      try {
        await putJson(`${apiOrigin}/api/credentials/settings/generation`, originalSettings);
      } catch (error) {
        restoreErrors.push(error);
      }
    }
    if (originalToolAttempts && apiOrigin) {
      try {
        await putJson(`${apiOrigin}/api/credentials/settings/max-tool-attempts`, originalToolAttempts);
      } catch (error) {
        restoreErrors.push(error);
      }
    }
    const receiptPath = writeReceipt({
      status: restoreErrors.length > 0 ? 'restore_failed' : receiptStatus,
      provider: providerConfig?.provider ?? null,
      model: providerConfig?.model ?? null,
      maxTokens,
      maxToolAttempts,
      safeRoot,
      restored: Boolean(originalSettings && originalToolAttempts) && restoreErrors.length === 0,
      finishedAt: new Date().toISOString(),
    });
    releaseLock(lockHandle);
    console.log(`[paid-live-tool-canary] receipt=${receiptPath}`);
    if (restoreErrors.length > 0) {
      throw new Error(`Canary finished but settings restore failed: ${restoreErrors.map((error) => error.message).join('; ')}`);
    }
  }
}

main().catch((error) => {
  console.error('[paid-live-tool-canary] failed', error);
  process.exit(1);
});

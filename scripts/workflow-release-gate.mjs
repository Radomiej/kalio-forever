import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const e2eDir = resolve(repoRoot, 'apps/e2e');
const webDistDir = resolve(repoRoot, 'apps/kalio-web/dist');
const playwrightCli = resolve(e2eDir, 'node_modules/@playwright/test/cli.js');

const args = new Set(process.argv.slice(2));
const requireLive = args.has('--require-live');

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

function run(command, commandArgs, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, options);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      resolvePromise({ code: code ?? (signal ? 1 : 0), signal });
    });
  });
}

async function capture(command, commandArgs, options) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, options);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      resolvePromise({ code: code ?? (signal ? 1 : 0), signal, stdout, stderr });
    });
  });
}

async function readStackStatus() {
  const result = await capture(process.execPath, ['scripts/stack-manager.mjs', 'status', '--json'], {
    cwd: repoRoot,
    env: normalizedWindowsEnv(process.env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.code !== 0) {
    throw new Error(`stack-manager status failed:\n${result.stdout}${result.stderr}`);
  }

  return JSON.parse(result.stdout);
}

async function readLlmConfig(apiOrigin) {
  const response = await fetch(`${apiOrigin}/api/llm/config`);
  if (!response.ok) {
    throw new Error(`GET /api/llm/config failed with ${response.status}`);
  }
  return await response.json();
}

async function readActiveCredential(apiOrigin) {
  const response = await fetch(`${apiOrigin}/api/credentials/active`);
  if (!response.ok) {
    throw new Error(`GET /api/credentials/active failed with ${response.status}`);
  }
  return await response.json();
}

async function restoreActiveCredential(apiOrigin, credentialId) {
  const targetUrl = credentialId
    ? `${apiOrigin}/api/credentials/active/${credentialId}`
    : `${apiOrigin}/api/credentials/active`;
  const response = await fetch(targetUrl, { method: credentialId ? 'PUT' : 'DELETE' });
  if (!response.ok) {
    throw new Error(`Failed to restore active credential via ${targetUrl}: ${response.status}`);
  }
}

function writeFrontendRuntimeConfig(backendUrl) {
  const runtimeConfigPath = resolve(webDistDir, 'runtime-config.js');
  mkdirSync(dirname(runtimeConfigPath), { recursive: true });
  writeFileSync(
    runtimeConfigPath,
    `window.__KALIO_RUNTIME_CONFIG__ = ${JSON.stringify({ apiUrl: backendUrl, wsUrl: backendUrl })};\n`,
    'utf8',
  );
}

async function runPlaywrightGroup({ name, grep }, baseUrl, apiOrigin) {
  console.log(`[workflow-release-gate] ${name}`);
  const env = normalizedWindowsEnv({
    ...process.env,
    KALIO_PLAYWRIGHT_EXTERNAL_SERVER: '1',
    PLAYWRIGHT_BASE_URL: baseUrl,
    PLAYWRIGHT_API_ORIGIN: apiOrigin,
    TEST_API_URL: `${apiOrigin}/api`,
  });
  const result = await run(process.execPath, [playwrightCli, 'test', '--project=chromium', '--grep', grep], {
    cwd: e2eDir,
    env,
    stdio: 'inherit',
  });
  if (result.code !== 0) {
    throw new Error(`${name} failed with exit code ${result.code}`);
  }
}

const groups = [
  {
    name: 'workflow visibility/replay/graph child-chat gate',
    grep: 'renders council branches',
  },
  {
    name: 'reconnect and hydration gate',
    grep: 'reconnect clears a stale pending confirmation without reloading the page',
  },
  {
    name: 'stop and HITL gate',
    grep: 'stop drains the active turn|replayed stale confirmation|workflow stop clears the stop action',
  },
  {
    name: 'RA-App HITL gate',
    grep: 'manual mode shows tool confirmation and RA-App approval overlay|bypass mode auto-executes tool confirmation and RA-App approval',
  },
  {
    name: 'workflow failure projection gate',
    grep: 'malformed router structured output becomes terminal failed graph state',
  },
  {
    name: 'workflow follow-up hydration gate',
    grep: 'keeps the earlier workflow bubble stable',
  },
  {
    name: 'normal chat gate',
    grep: 'assistant turn appears|agent response streams|multiple turns',
  },
];

try {
  const status = await readStackStatus();
  if (status.status !== 'running' || !status.backendUp || !status.frontendUp) {
    throw new Error(`fixed QA stack is not ready: ${JSON.stringify(status)}`);
  }

  const backendPort = status.state?.backendPort;
  const frontendPort = status.state?.frontendPort;
  const baseUrl = `http://127.0.0.1:${frontendPort}`;
  const apiOrigin = `http://127.0.0.1:${backendPort}`;
  const llmConfig = await readLlmConfig(apiOrigin);
  const activeCredential = await readActiveCredential(apiOrigin);
  const originalActiveCredentialId = activeCredential?.credentialId ?? null;

  console.log(`[workflow-release-gate] fixed QA ${baseUrl} -> ${apiOrigin}`);
  console.log(`[workflow-release-gate] llm provider=${llmConfig.provider} model=${llmConfig.model} source=${llmConfig.source}`);
  console.log(`[workflow-release-gate] active credential=${originalActiveCredentialId ?? 'none'}`);
  writeFrontendRuntimeConfig(apiOrigin);

  if (requireLive) {
    const liveFailures = [
      llmConfig.provider === 'mock' ? 'provider is mock' : null,
      llmConfig.source !== 'db' ? `source is ${llmConfig.source}` : null,
      originalActiveCredentialId === null ? 'active credential is missing' : null,
    ].filter(Boolean);
    if (liveFailures.length > 0) {
      throw new Error(`live workflow gate requires a saved live credential: ${liveFailures.join(', ')}`);
    }
  }

  try {
    for (const group of groups) {
      await runPlaywrightGroup(group, baseUrl, apiOrigin);
    }
  } finally {
    await restoreActiveCredential(apiOrigin, originalActiveCredentialId);
  }

  console.log('[workflow-release-gate] passed');
} catch (error) {
  console.error('[workflow-release-gate] failed', error);
  process.exit(1);
}

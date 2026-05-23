#!/usr/bin/env node
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = resolve(fileURLToPath(import.meta.url), '..');
const repoRoot = resolve(scriptDir, '..');
const stackDir = resolve(repoRoot, '.kalio-stack');
const logsDir = resolve(stackDir, 'logs');
const statePath = resolve(stackDir, 'qa-stack-state.json');
const lastStatePath = resolve(stackDir, 'qa-stack-last-state.json');
const backendLogPath = resolve(logsDir, 'backend.log');
const frontendLogPath = resolve(logsDir, 'frontend.log');

const action = process.argv[2] ?? 'status';
const args = process.argv.slice(3);
const backendPortArg = Number.parseInt(getArgValue(args, '--backend-port', '0'), 10);
const frontendPortArg = Number.parseInt(getArgValue(args, '--frontend-port', '0'), 10);

const apiDir = resolve(repoRoot, 'apps/kalio-api');
const backendDist = resolve(apiDir, 'dist/main.js');
const webDir = resolve(repoRoot, 'apps/kalio-web');
const workspaceRoot = resolve(repoRoot, 'data/workspaces-qa');
const databasePath = resolve(repoRoot, 'data/kalio-qa.db');

if (!Number.isInteger(backendPortArg) || backendPortArg < 0 || !Number.isInteger(frontendPortArg) || frontendPortArg < 0) {
  throw new Error('backend-port and frontend-port must be non-negative integers. Use 0 for an allocated free port.');
}

if (action === 'start') {
  await startStack();
} else if (action === 'status') {
  await showStatus();
} else if (action === 'stop') {
  await stopStack();
} else {
  console.error(`[stack] unknown action: ${action}`);
  showUsage();
  process.exit(1);
}

function getArgValue(argv, flag, fallback) {
  const direct = argv.find((item) => item === flag || item.startsWith(`${flag}=`));
  if (!direct) {
    return fallback;
  }
  if (direct.includes('=')) {
    return direct.split('=')[1];
  }
  const index = argv.indexOf(direct);
  return argv[index + 1] ?? fallback;
}

function showUsage() {
  console.log('Usage: node scripts/stack-manager.mjs <start|status|stop> [--backend-port <port|0>] [--frontend-port <port|0>] [--use-env-llm] [--provider xiaomimimo] [--model mimo-v2.5] [--base-url https://api.xiaomimimo.com/v1] [--database-path data/kalio-qa.db] [--workspace-root data/workspaces-qa]');
}

function resolveCommand(name) {
  const pathValue = process.env.PATH ?? process.env.Path ?? '';
  const dirs = pathValue.split(process.platform === 'win32' ? ';' : ':').filter(Boolean);
  for (const dir of dirs) {
    const candidate = resolve(dir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getPnpmLauncher() {
  const nodeDir = resolve(process.execPath, '..');
  const programFilesNodeDir = resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'nodejs');
  const corepackFromProgramFiles = resolve(programFilesNodeDir, 'node_modules/corepack/dist/corepack.js');
  const corepackFromNodeDir = resolve(nodeDir, 'node_modules/corepack/dist/corepack.js');
  const corepackEntrypoint = existsSync(corepackFromNodeDir)
    ? corepackFromNodeDir
    : existsSync(corepackFromProgramFiles)
      ? corepackFromProgramFiles
      : null;

  if (corepackEntrypoint) {
    return { command: process.execPath, argsPrefix: [corepackEntrypoint, 'pnpm'], shell: false };
  }

  const pnpmOnPath = process.platform === 'win32'
    ? resolveCommand('pnpm.cmd')
    : resolveCommand('pnpm');

  if (pnpmOnPath) {
    return { command: pnpmOnPath, argsPrefix: [], shell: false };
  }

  throw new Error('pnpm launcher not found. Re-run setup with pnpm available.');
}

function quoteShellArg(arg) {
  if (/^[a-zA-Z0-9_./:\\-]+$/.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/"/g, '\\"')}"`;
}

function spawnProcess(command, commandArgs, options) {
  if (process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')) {
    const shellCommand = process.env.ComSpec ?? 'cmd.exe';
    const commandLine = ['call', command, ...commandArgs].map(quoteShellArg).join(' ');
    return spawn(shellCommand, ['/d', '/s', '/c', commandLine], options);
  }

  return spawn(command, commandArgs, options);
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const env = {};
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return env;
}

async function getFreePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    await once(server, 'close');
    throw new Error('Could not resolve a free TCP port');
  }

  const { port } = address;
  server.close();
  await once(server, 'close');
  return port;
}

function resolveQaEnv() {
  const envFile = getArgValue(args, '--env-file', '.env');
  const testEnvFile = getArgValue(args, '--test-env-file', '.env.test');
  const useEnvLlm = args.includes('--use-env-llm');
  const fileEnv = {
    ...readEnvFile(resolve(repoRoot, testEnvFile)),
    ...readEnvFile(resolve(repoRoot, envFile)),
  };
  const llmEnv = useEnvLlm ? { ...fileEnv, ...process.env } : {};

  return {
    ...process.env,
    ...fileEnv,
    LLM_PROVIDER: getArgValue(args, '--provider', llmEnv.LLM_PROVIDER ?? 'mock'),
    LLM_API_KEY: getArgValue(args, '--api-key', llmEnv.LLM_API_KEY ?? 'mock'),
    LLM_BASE_URL: getArgValue(args, '--base-url', llmEnv.LLM_BASE_URL ?? 'mock'),
    LLM_MODEL: getArgValue(args, '--model', llmEnv.LLM_MODEL ?? 'mock'),
  };
}

function commonEnv(qaEnv) {
  const resolvedDatabasePath = resolve(repoRoot, getArgValue(args, '--database-path', databasePath));
  const resolvedWorkspaceRoot = resolve(repoRoot, getArgValue(args, '--workspace-root', workspaceRoot));

  return {
    ...qaEnv,
    NODE_ENV: 'production',
    CREDENTIALS_MASTER_KEY: qaEnv.CREDENTIALS_MASTER_KEY ?? 'playwright-test-master-key-32-chars-minimum',
    DATABASE_PATH: resolvedDatabasePath,
    WORKSPACE_ROOT: resolvedWorkspaceRoot,
  };
}

async function startStack() {
  await clearIfRunning();

  if (args.includes('--skip-build') && (backendPortArg === 0 || frontendPortArg === 0)) {
    throw new Error('--skip-build requires explicit --backend-port and --frontend-port so the existing frontend bundle matches the running API URL.');
  }

  const backendPort = backendPortArg === 0 ? await getFreePort() : backendPortArg;
  const frontendPort = frontendPortArg === 0 ? await getFreePort() : frontendPortArg;
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const frontendUrl = `http://127.0.0.1:${frontendPort}`;
  const qaEnv = resolveQaEnv();
  const baseEnv = commonEnv(qaEnv);

  mkdirSync(logsDir, { recursive: true });
  const backendLog = openSync(backendLogPath, 'a');
  const frontendLog = openSync(frontendLogPath, 'a');
  const backendEnv = {
    ...baseEnv,
    PORT: String(backendPort),
    CORS_ORIGIN: frontendUrl,
  };
  const frontendEnv = {
    ...baseEnv,
    VITE_API_URL: backendUrl,
    VITE_WS_URL: backendUrl,
    VITE_PORT: String(frontendPort),
  };

  const pnpm = getPnpmLauncher();
  if (!args.includes('--skip-build')) {
    await buildStack(pnpm, backendEnv, frontendEnv);
  }
  if (!existsSync(backendDist) || !existsSync(resolve(webDir, 'dist/index.html'))) {
    throw new Error('QA stack requires built backend and frontend artifacts. Run without --skip-build or run: pnpm build');
  }

  const backend = spawn(process.execPath, [backendDist], {
    cwd: apiDir,
    env: {
      ...backendEnv,
      PATH: process.env.PATH ?? process.env.Path ?? '',
      Path: process.env.Path ?? process.env.PATH ?? '',
    },
    detached: true,
    stdio: ['ignore', backendLog, backendLog],
    windowsHide: true,
  });
  const frontend = spawnProcess(
    pnpm.command,
    [...pnpm.argsPrefix, '--filter', 'kalio-web', 'exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'],
    {
      cwd: repoRoot,
      env: {
        ...frontendEnv,
        PATH: process.env.PATH ?? process.env.Path ?? '',
        Path: process.env.Path ?? process.env.PATH ?? '',
      },
      stdio: ['ignore', frontendLog, frontendLog],
      shell: pnpm.shell,
      detached: true,
      windowsHide: true,
    },
  );

  backend.on('error', (error) => {
    console.error('[stack] backend spawn failed:', error.message);
  });
  frontend.on('error', (error) => {
    console.error('[stack] frontend spawn failed:', error.message);
  });

  closeSync(backendLog);
  closeSync(frontendLog);

  if (!backend.pid || !frontend.pid) {
    throw new Error('failed to start QA stack children');
  }

  writeState({
    backend: {
      pid: backend.pid,
      cwd: apiDir,
      command: `${process.execPath} ${backendDist}`,
    },
    frontend: {
      pid: frontend.pid,
      cwd: repoRoot,
      command: `${pnpm.command} ${pnpm.argsPrefix.join(' ')} --filter kalio-web exec vite preview --strictPort`,
    },
    backendPort,
    frontendPort,
    startedAt: new Date().toISOString(),
    backendLogPath,
    frontendLogPath,
    provider: backendEnv.LLM_PROVIDER,
    model: backendEnv.LLM_MODEL,
    databasePath: backendEnv.DATABASE_PATH,
    workspaceRoot: backendEnv.WORKSPACE_ROOT,
  });

  try {
    await waitForUrl(`${backendUrl}/api/health`, 60_000);
    await waitForUrl(frontendUrl, 60_000);
  } catch (error) {
    await stopStack();
    throw error;
  }

  console.log(`[stack] QA stack started: ${backendUrl} + ${frontendUrl}`);
  console.log(`[stack] provider=${backendEnv.LLM_PROVIDER} model=${backendEnv.LLM_MODEL}`);
  console.log(`[stack] logs: ${backendLogPath}, ${frontendLogPath}`);

  backend.unref();
  frontend.unref();
}

async function buildStack(pnpm, backendEnv, frontendEnv) {
  const pathEnv = {
    PATH: process.env.PATH ?? process.env.Path ?? '',
    Path: process.env.Path ?? process.env.PATH ?? '',
  };

  await runProcess(
    pnpm.command,
    [...pnpm.argsPrefix, '--filter', 'kalio-api', 'run', 'build'],
    { cwd: repoRoot, env: { ...backendEnv, ...pathEnv }, shell: pnpm.shell },
    'building backend',
  );
  await runProcess(
    pnpm.command,
    [...pnpm.argsPrefix, '--filter', 'kalio-web', 'run', 'build'],
    { cwd: repoRoot, env: { ...frontendEnv, ...pathEnv }, shell: pnpm.shell },
    'building frontend preview bundle',
  );
}

async function runProcess(command, commandArgs, options, label) {
  console.log(`[stack] ${label}`);
  await new Promise((resolve, reject) => {
    const child = spawnProcess(command, commandArgs, {
      ...options,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with ${signal ?? `exit code ${code}`}`));
    });
  });
}

async function showStatus() {
  const state = readState();
  if (!state) {
    const lastState = readLastState();
    if (hasAliveChild(lastState)) {
      console.log('[stack] status: orphaned managed process');
      reportStateProcesses(lastState);
      return;
    }

    clearLastState();
    console.log('[stack] status: stopped');
    return;
  }

  const backendUp = isProcessAlive(state?.backend?.pid);
  const frontendUp = isProcessAlive(state?.frontend?.pid);
  if (!backendUp || !frontendUp) {
    console.log('[stack] status: partial/stale state');
    reportStateProcesses(state);
    return;
  }

  console.log('[stack] status: running');
  reportStateProcesses(state);
  await reportHealth(`http://127.0.0.1:${state.backendPort}/api/health`, 'backend');
  await reportHealth(`http://127.0.0.1:${state.frontendPort}`, 'frontend');
}

async function stopStack(exitCode) {
  const state = readState() ?? readLastState();
  if (!state) {
    console.log('[stack] stop: already stopped');
    return;
  }

  const pids = new Set([state.backend?.pid, state.frontend?.pid]);
  const jobs = [...pids].filter(Boolean).map((pid) => killProcessTree(pid));
  const results = await Promise.allSettled(jobs);
  let failed = false;
  results.forEach((result) => {
    if (result.status === 'rejected') {
      failed = true;
      console.error('[stack] stop error:', result.reason);
    }
  });

  if (failed) {
    console.error('[stack] stop incomplete; keeping state for retry');
    if (exitCode !== undefined && Number.isInteger(exitCode)) {
      process.exit(1);
    }
    process.exitCode = 1;
    return;
  }

  clearState();
  clearLastState();
  console.log('[stack] stopped');
  if (exitCode !== undefined && Number.isInteger(exitCode)) {
    process.exit(exitCode);
  }
}

function writeState(state) {
  mkdirSync(stackDir, { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
  writeFileSync(lastStatePath, JSON.stringify(state, null, 2), 'utf8');
}

function readState() {
  if (!existsSync(statePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function readLastState() {
  if (!existsSync(lastStatePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(lastStatePath, 'utf8'));
  } catch {
    return null;
  }
}

function clearState() {
  if (existsSync(statePath)) {
    rmSync(statePath, { force: true });
  }
}

function clearLastState() {
  if (existsSync(lastStatePath)) {
    rmSync(lastStatePath, { force: true });
  }
}

async function clearIfRunning() {
  const state = readState();
  if (!state && !hasAliveChild(readLastState())) {
    clearLastState();
    return;
  }
  if (!hasAliveChild(state)) {
    clearState();
    clearLastState();
    return;
  }
  await stopStack();
}

function hasAliveChild(state) {
  return Boolean(state && (isProcessAlive(state?.backend?.pid) || isProcessAlive(state?.frontend?.pid)));
}

function reportStateProcesses(state) {
  console.log(`[stack] backend pid ${state.backend?.pid ?? 'unknown'}  (${state.backend?.cwd ?? 'unknown cwd'})`);
  console.log(`[stack] frontend pid ${state.frontend?.pid ?? 'unknown'} (${state.frontend?.cwd ?? 'unknown cwd'})`);
  console.log(`[stack] ports: backend=${state.backendPort ?? 'unknown'}, frontend=${state.frontendPort ?? 'unknown'}`);
}

function isProcessAlive(pid) {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcessTree(pid) {
  if (!isProcessAlive(pid)) {
    return Promise.resolve();
  }

  if (process.platform === 'win32') {
    return new Promise((resolve, reject) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
      killer.once('exit', async (code) => {
        if (code !== 0 && isProcessAlive(pid)) {
          reject(new Error(`taskkill failed for pid ${pid} with exit code ${code}`));
          return;
        }

        try {
          await waitForProcessExit(pid, 10_000);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      killer.once('error', reject);
    });
  }

  process.kill(pid, 'SIGTERM');
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
      resolve();
    }, 5000);

    const check = setInterval(() => {
      if (!isProcessAlive(pid)) {
        clearInterval(check);
        clearTimeout(timer);
        resolve();
      }
    }, 200);
  });
}

function waitForProcessExit(pid, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = setInterval(() => {
      if (!isProcessAlive(pid)) {
        clearInterval(check);
        resolve();
        return;
      }

      if (Date.now() - start >= timeoutMs) {
        clearInterval(check);
        reject(new Error(`pid ${pid} did not exit within ${timeoutMs}ms`));
      }
    }, 200);
  });
}

function isUrlReady(url) {
  return fetch(url).then((response) => response.ok).catch(() => false);
}

async function waitForUrl(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isUrlReady(url)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function reportHealth(url, label) {
  const ok = await isUrlReady(url);
  console.log(`[stack] health ${label}: ${ok ? 'ok' : 'not ready'}`);
}

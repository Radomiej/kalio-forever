#!/usr/bin/env node
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStackState, resolveStackPaths } from './stack-state.mjs';
import { buildStackStatusReport, hasAliveChild, renderEffectiveLlmLine, renderStateProcesses } from './stack-status.mjs';

const scriptDir = resolve(fileURLToPath(import.meta.url), '..');
const repoRoot = resolve(scriptDir, '..');
const { stackDir, logsDir, statePath, lastStatePath } = resolveStackPaths(repoRoot);
const logRunId = `${Date.now()}-${process.pid}`;
const backendLogPath = resolve(logsDir, `backend-${logRunId}.log`);
const frontendLogPath = resolve(logsDir, `frontend-${logRunId}.log`);

const action = process.argv[2] ?? 'status';
const args = process.argv.slice(3);
const outputJson = args.includes('--json');
const stackProfile = getArgValue(args, '--profile', '');
const isProdProfile = stackProfile === 'prod' || process.env.KALIO_INSTALL_PROFILE === 'prod';
const backendPortDefault = isProdProfile ? '4016' : '0';
const frontendPortDefault = isProdProfile ? '6188' : '0';
const backendPortArg = Number.parseInt(getArgValue(args, '--backend-port', backendPortDefault), 10);
const frontendPortArg = Number.parseInt(getArgValue(args, '--frontend-port', frontendPortDefault), 10);
const useDirectRuntime = args.includes('--runtime') && getArgValue(args, '--runtime', '') === 'direct';

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
  console.log('Usage: node scripts/stack-manager.mjs <start|status|stop> [--json] [--profile prod] [--backend-port <port|0>] [--frontend-port <port|0>] [--skip-build] [--runtime direct] [--use-env-llm] [--force-env-llm] [--env-file <path>] [--data-root <path>] [--database-path <path>] [--workspace-root <path>] [--memory-db-path <path>] [--embedding-cache-dir <path>] [--provider xiaomimimo] [--model mimo-v2.5] [--base-url https://api.xiaomimimo.com/v1]');
}

function resolveConfiguredPath(pathValue) {
  if (!pathValue) {
    return pathValue;
  }

  return resolve(repoRoot, pathValue);
}

function resolveDataPaths() {
  const dataRootArg = getArgValue(args, '--data-root', '');
  if (dataRootArg) {
    const dataRoot = resolveConfiguredPath(dataRootArg);
    const defaultDatabaseName = isProdProfile ? 'kalio.db' : 'kalio-qa.db';
    return {
      databasePath: resolveConfiguredPath(getArgValue(args, '--database-path', resolve(dataRoot, defaultDatabaseName))),
      workspaceRoot: resolveConfiguredPath(getArgValue(args, '--workspace-root', resolve(dataRoot, 'workspaces'))),
      memoryDbPath: resolveConfiguredPath(getArgValue(args, '--memory-db-path', resolve(dataRoot, 'memory'))),
      embeddingCacheDir: resolveConfiguredPath(getArgValue(args, '--embedding-cache-dir', resolve(dataRoot, 'embeddings-cache'))),
    };
  }

  const defaultDatabasePath = isProdProfile ? resolve(repoRoot, 'data/kalio.db') : databasePath;
  const defaultWorkspaceRoot = isProdProfile ? resolve(repoRoot, 'data/workspaces') : workspaceRoot;
  const defaultMemoryDbPath = isProdProfile ? resolve(repoRoot, 'data/memory') : resolve(repoRoot, 'data/memory-qa');
  const defaultEmbeddingCacheDir = isProdProfile ? resolve(repoRoot, 'data/embeddings-cache') : resolve(repoRoot, 'data/embeddings-cache-qa');

  return {
    databasePath: resolveConfiguredPath(getArgValue(args, '--database-path', defaultDatabasePath)),
    workspaceRoot: resolveConfiguredPath(getArgValue(args, '--workspace-root', defaultWorkspaceRoot)),
    memoryDbPath: resolveConfiguredPath(getArgValue(args, '--memory-db-path', defaultMemoryDbPath)),
    embeddingCacheDir: resolveConfiguredPath(getArgValue(args, '--embedding-cache-dir', defaultEmbeddingCacheDir)),
  };
}

function ensureDataDirs(paths) {
  for (const dirPath of [dirname(paths.databasePath), paths.workspaceRoot, paths.memoryDbPath, paths.embeddingCacheDir]) {
    if (dirPath) {
      mkdirSync(dirPath, { recursive: true });
    }
  }
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

function resolveEnvFilePath(envFile) {
  if (!envFile) {
    return resolve(repoRoot, '.env');
  }

  return isAbsolute(envFile) ? envFile : resolve(repoRoot, envFile);
}

function resolveWorkspaceCli(primaryPath, packagePrefix, relativePath) {
  if (existsSync(primaryPath)) {
    return primaryPath;
  }

  const pnpmStore = resolve(repoRoot, 'node_modules/.pnpm');
  if (!existsSync(pnpmStore)) {
    return null;
  }

  const match = readdirSync(pnpmStore)
    .filter((entry) => entry.startsWith(packagePrefix))
    .sort()[0];

  if (!match) {
    return null;
  }

  const candidate = resolve(pnpmStore, match, relativePath);
  return existsSync(candidate) ? candidate : null;
}

function resolveViteBin() {
  return resolveWorkspaceCli(
    resolve(webDir, 'node_modules/vite/bin/vite.js'),
    'vite@',
    'node_modules/vite/bin/vite.js',
  );
}

function getPnpmLauncherOrNull() {
  try {
    return getPnpmLauncher();
  } catch {
    return null;
  }
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
  const forceEnvLlm = args.includes('--force-env-llm');
  const fileEnv = {
    ...readEnvFile(resolveEnvFilePath(testEnvFile)),
    ...readEnvFile(resolveEnvFilePath(envFile)),
  };
  const llmEnv = useEnvLlm ? { ...fileEnv, ...process.env } : {};

  return {
    ...process.env,
    ...fileEnv,
    LLM_PROVIDER: getArgValue(args, '--provider', llmEnv.LLM_PROVIDER ?? 'mock'),
    LLM_API_KEY: getArgValue(args, '--api-key', llmEnv.LLM_API_KEY ?? 'mock'),
    LLM_BASE_URL: getArgValue(args, '--base-url', llmEnv.LLM_BASE_URL ?? 'mock'),
    LLM_MODEL: getArgValue(args, '--model', llmEnv.LLM_MODEL ?? 'mock'),
    KALIO_FORCE_ENV_LLM: forceEnvLlm ? '1' : (process.env.KALIO_FORCE_ENV_LLM ?? fileEnv.KALIO_FORCE_ENV_LLM ?? ''),
  };
}

function resolveCredentialsMasterKey(qaEnv) {
  const configured = qaEnv.CREDENTIALS_MASTER_KEY?.trim();
  if (configured) {
    return configured;
  }

  if (isProdProfile) {
    throw new Error('CREDENTIALS_MASTER_KEY is required for prod profile. Set it in --env-file before starting the stack.');
  }

  return 'playwright-test-master-key-32-chars-minimum';
}

function commonEnv(qaEnv) {
  const dataPaths = resolveDataPaths();
  ensureDataDirs(dataPaths);

  return {
    ...qaEnv,
    NODE_ENV: 'production',
    KALIO_INSTALL_PROFILE: isProdProfile ? 'prod' : qaEnv.KALIO_INSTALL_PROFILE,
    KALIO_ENABLE_TEST_SUPPORT: isProdProfile ? 'false' : 'true',
    CREDENTIALS_MASTER_KEY: resolveCredentialsMasterKey(qaEnv),
    DATABASE_PATH: dataPaths.databasePath,
    WORKSPACE_ROOT: dataPaths.workspaceRoot,
    MEMORY_DB_PATH: dataPaths.memoryDbPath,
    EMBEDDING_CACHE_DIR: dataPaths.embeddingCacheDir,
  };
}

function resolveFrontendLauncher() {
  if (useDirectRuntime) {
    const viteBin = resolveViteBin();
    if (!viteBin) {
      throw new Error('vite CLI not found for direct runtime. Run pnpm install from repo root.');
    }

    return {
      mode: 'direct',
      command: process.execPath,
      argsPrefix: [viteBin],
      cwd: webDir,
      shell: false,
      label: `${process.execPath} ${viteBin} preview --configLoader runner --strictPort`,
    };
  }

  try {
    const pnpm = getPnpmLauncher();
    return {
      mode: 'pnpm',
      command: pnpm.command,
      argsPrefix: [...pnpm.argsPrefix, '--filter', 'kalio-web', 'exec', 'vite'],
      cwd: repoRoot,
      shell: pnpm.shell,
      label: `${pnpm.command} ${pnpm.argsPrefix.join(' ')} --filter kalio-web exec vite preview --configLoader runner --strictPort`,
    };
  } catch (error) {
    const viteBin = resolveViteBin();
    if (!viteBin) {
      throw error;
    }

    return {
      mode: 'direct',
      command: process.execPath,
      argsPrefix: [viteBin],
      cwd: webDir,
      shell: false,
      label: `${process.execPath} ${viteBin} preview --configLoader runner --strictPort`,
    };
  }
}

async function captureCommand(command, commandArgs) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let stdout = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      resolvePromise({ code: code ?? 1, stdout });
    });
  });
}

async function resolveListeningPid(port) {
  if (!Number.isInteger(port) || port <= 0) {
    return null;
  }

  if (process.platform === 'win32') {
    let result;
    try {
      result = await captureCommand(
        resolve(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess`,
        ],
      );
    } catch {
      return null;
    }
    if (result.code !== 0) {
      return null;
    }
    const pid = Number.parseInt(result.stdout.trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  }

  let result;
  try {
    result = await captureCommand('lsof', ['-tiTCP:' + String(port), '-sTCP:LISTEN']);
  } catch {
    return null;
  }
  if (result.code !== 0) {
    return null;
  }
  const pid = Number.parseInt(result.stdout.trim().split(/\r?\n/)[0] ?? '', 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

async function refreshStatePortOwners(state) {
  if (!state) {
    return state;
  }

  const backendPid = await resolveListeningPid(Number(state.backendPort));
  const frontendPid = await resolveListeningPid(Number(state.frontendPort));
  const nextState = structuredClone(state);
  let changed = false;

  if (backendPid && nextState.backend?.pid !== backendPid) {
    nextState.backend.pid = backendPid;
    changed = true;
  }
  if (frontendPid && nextState.frontend?.pid !== frontendPid) {
    nextState.frontend.pid = frontendPid;
    changed = true;
  }

  if (changed) {
    writeState(nextState);
  }

  return nextState;
}

async function ensureRequestedPortsAreFree(ports) {
  const occupied = [];
  for (const port of ports) {
    const ownerPid = await resolveListeningPid(port);
    if (ownerPid) {
      occupied.push({ port, pid: ownerPid });
    }
  }

  if (occupied.length > 0) {
    const detail = occupied.map(({ port, pid }) => `${port}=>pid ${pid}`).join(', ');
    throw new Error(`requested ports already in use by unmanaged listeners: ${detail}`);
  }
}

async function detectKnownManagedPortConflicts() {
  const conflictEntries = [];
  for (const [profile, ports] of [
    ['qa', [3316, 5288]],
    ['prod', [4016, 6188]],
  ]) {
    for (const port of ports) {
      const pid = await resolveListeningPid(port);
      if (pid) {
        conflictEntries.push({ profile, port, pid });
      }
    }
  }
  return conflictEntries;
}

async function startStack() {
  await clearIfRunning();

  if (args.includes('--skip-build') && (backendPortArg === 0 || frontendPortArg === 0)) {
    throw new Error('--skip-build requires explicit --backend-port and --frontend-port so the existing frontend bundle matches the running API URL.');
  }

  const backendPort = backendPortArg === 0 ? await getFreePort() : backendPortArg;
  const frontendPort = frontendPortArg === 0 ? await getFreePort() : frontendPortArg;
  await ensureRequestedPortsAreFree([backendPort, frontendPort]);
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const frontendUrl = `http://127.0.0.1:${frontendPort}`;
  const frontendLocalhostUrl = `http://localhost:${frontendPort}`;
  const qaEnv = resolveQaEnv();
  const baseEnv = commonEnv(qaEnv);

  mkdirSync(logsDir, { recursive: true });
  const backendLog = openSync(backendLogPath, 'a');
  const frontendLog = openSync(frontendLogPath, 'a');
  const backendEnv = {
    ...baseEnv,
    PORT: String(backendPort),
    CORS_ORIGIN: `${frontendUrl},${frontendLocalhostUrl}`,
  };
  const frontendEnv = {
    ...baseEnv,
    VITE_API_URL: backendUrl,
    VITE_WS_URL: backendUrl,
    VITE_PORT: String(frontendPort),
  };

  const pnpm = getPnpmLauncherOrNull();
  if (!args.includes('--skip-build')) {
    if (!pnpm) {
      throw new Error('pnpm launcher not found. Install dependencies before building the stack.');
    }
    await buildStack(pnpm, backendEnv, frontendEnv);
  }
  if (!existsSync(backendDist) || !existsSync(resolve(webDir, 'dist/index.html'))) {
    throw new Error('Built stack requires backend and frontend dist artifacts. Run without --skip-build or run: pnpm build');
  }

  const frontendLauncher = resolveFrontendLauncher();

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
    frontendLauncher.command,
    [
      ...frontendLauncher.argsPrefix,
      'preview',
      '--configLoader',
      'runner',
      '--host',
      '127.0.0.1',
      '--port',
      String(frontendPort),
      '--strictPort',
    ],
    {
      cwd: frontendLauncher.cwd,
      env: {
        ...frontendEnv,
        PATH: process.env.PATH ?? process.env.Path ?? '',
        Path: process.env.Path ?? process.env.PATH ?? '',
      },
      stdio: ['ignore', frontendLog, frontendLog],
      shell: frontendLauncher.shell,
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
      cwd: frontendLauncher.cwd,
      command: frontendLauncher.label,
      runtime: frontendLauncher.mode,
    },
    backendPort,
    frontendPort,
    startedAt: new Date().toISOString(),
    backendLogPath,
    frontendLogPath,
    provider: backendEnv.LLM_PROVIDER,
    model: backendEnv.LLM_MODEL,
    forceEnvLlm: backendEnv.KALIO_FORCE_ENV_LLM === '1',
    databasePath: backendEnv.DATABASE_PATH,
    workspaceRoot: backendEnv.WORKSPACE_ROOT,
    memoryDbPath: backendEnv.MEMORY_DB_PATH,
    embeddingCacheDir: backendEnv.EMBEDDING_CACHE_DIR,
    dataRoot: getArgValue(args, '--data-root', ''),
    profile: isProdProfile ? 'prod' : stackProfile || 'qa',
    installRoot: repoRoot,
  });

  try {
    await waitForUrl(`${backendUrl}/api/health`, 60_000);
    await waitForUrl(frontendUrl, 60_000);
    await refreshStatePortOwners(readState());
  } catch (error) {
    await stopStack();
    throw error;
  }

  const stackLabel = isProdProfile ? 'prod' : 'built';
  console.log(`[stack] ${stackLabel} stack started: ${backendUrl} + ${frontendUrl}`);
  console.log(`[stack] provider=${backendEnv.LLM_PROVIDER} model=${backendEnv.LLM_MODEL}`);
  console.log(`[stack] database=${backendEnv.DATABASE_PATH}`);
  console.log(`[stack] workspace=${backendEnv.WORKSPACE_ROOT}`);
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
  const state = await refreshStatePortOwners(readState());
  if (!state) {
    const conflicts = await detectKnownManagedPortConflicts();
    if (conflicts.length > 0) {
      const report = await buildStackStatusReport({ status: 'unmanaged listeners', state: null, repoRoot, isProcessAlive });
      report.conflicts = conflicts;
      if (outputJson) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      console.log('[stack] status: unmanaged listeners');
      conflicts.forEach(({ profile, port, pid }) => {
        console.log(`[stack] ${profile} port ${port} is held by pid ${pid}`);
      });
      return;
    }
    const lastState = readLastState();
    if (hasAliveChild(lastState, isProcessAlive)) {
      if (outputJson) {
        console.log(
          JSON.stringify(
            await buildStackStatusReport({ status: 'orphaned managed process', state: lastState, repoRoot, isProcessAlive }),
            null,
            2,
          ),
        );
        return;
      }
      console.log('[stack] status: orphaned managed process');
      reportStateProcesses(lastState);
      return;
    }

    clearLastState();
    if (outputJson) {
      console.log(JSON.stringify(await buildStackStatusReport({ status: 'stopped', state: null, repoRoot, isProcessAlive }), null, 2));
      return;
    }
    console.log('[stack] status: stopped');
    return;
  }

  const backendUp = isProcessAlive(state?.backend?.pid);
  const frontendUp = isProcessAlive(state?.frontend?.pid);
  if (!backendUp || !frontendUp) {
    if (outputJson) {
      console.log(
        JSON.stringify(
          await buildStackStatusReport({ status: 'partial/stale state', state, repoRoot, isProcessAlive }),
          null,
          2,
        ),
      );
      return;
    }
    console.log('[stack] status: partial/stale state');
    reportStateProcesses(state);
    return;
  }

  const report = await buildStackStatusReport({ status: 'running', state, repoRoot, isProcessAlive });
  if (outputJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log('[stack] status: running');
  reportStateProcesses(state);
  const effectiveLlmLine = renderEffectiveLlmLine(report.effectiveLlm);
  if (effectiveLlmLine) {
    console.log(effectiveLlmLine);
  }
  await reportHealth(`http://127.0.0.1:${state.backendPort}/api/health`, 'backend');
  await reportHealth(`http://127.0.0.1:${state.frontendPort}`, 'frontend');
}

async function stopStack(exitCode) {
  const state = await refreshStatePortOwners(readState() ?? readLastState());
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
  return readStackState(repoRoot);
}

function readLastState() {
  return readStackState(repoRoot, { last: true });
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
  if (!state && !hasAliveChild(readLastState(), isProcessAlive)) {
    clearLastState();
    return;
  }
  if (!hasAliveChild(state, isProcessAlive)) {
    clearState();
    clearLastState();
    return;
  }
  await stopStack();
}

function reportStateProcesses(state) {
  for (const line of renderStateProcesses(state)) {
    console.log(line);
  }
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

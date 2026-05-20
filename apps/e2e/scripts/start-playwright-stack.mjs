import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../..');
const apiDir = resolve(repoRoot, 'apps/kalio-api');
const e2eStateDir = process.env.KALIO_PLAYWRIGHT_STATE_DIR ?? resolve(repoRoot, 'data/playwright-stack');
const envFilePath = resolve(repoRoot, '.env.test');

if (existsSync(envFilePath)) {
  process.loadEnvFile?.(envFilePath);
}

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5288';
const apiOrigin = process.env.PLAYWRIGHT_API_ORIGIN ?? 'http://localhost:3316';
const skipBuild = process.env.KALIO_PLAYWRIGHT_SKIP_BUILD === '1';
const webUrl = new URL(baseUrl);
const apiUrl = new URL(apiOrigin);
const nodeBinDir = dirname(process.execPath);
const programFilesNodeDir = resolve(process.env.ProgramFiles ?? 'C:/Program Files', 'nodejs');
const corepackNodeCommand = process.env.KALIO_PLAYWRIGHT_NODE_COMMAND
  ?? (existsSync(resolve(programFilesNodeDir, 'node.exe'))
  ? resolve(programFilesNodeDir, 'node.exe')
  : process.execPath);
const corepackEntrypoint = process.env.KALIO_PLAYWRIGHT_COREPACK_ENTRYPOINT
  ?? (existsSync(resolve(programFilesNodeDir, 'node_modules/corepack/dist/corepack.js'))
  ? resolve(programFilesNodeDir, 'node_modules/corepack/dist/corepack.js')
  : resolve(nodeBinDir, 'node_modules/corepack/dist/corepack.js'));
const corepackPnpmCandidate = { command: corepackNodeCommand, argsPrefix: [corepackEntrypoint, 'pnpm'] };

function isCommandOnPath(command) {
  const pathValue = process.env.PATH;
  if (!pathValue) {
    return false;
  }

  const candidates = pathValue
    .split(process.platform === 'win32' ? ';' : ':')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolve(entry, command));

  return candidates.some((candidatePath) => existsSync(candidatePath));
}

const pnpmCandidates = process.platform === 'win32'
  ? [
      ...(isCommandOnPath('pnpm.cmd') ? [{ command: 'pnpm.cmd', argsPrefix: [] }] : []),
      ...(isCommandOnPath('corepack.cmd') ? [{ command: 'corepack.cmd', argsPrefix: ['pnpm'] }] : []),
      ...(existsSync(corepackEntrypoint) ? [corepackPnpmCandidate] : []),
    ]
  : [{ command: 'pnpm', argsPrefix: [] }];

if (pnpmCandidates.length === 0) {
  throw new Error(
    `Unable to resolve a pnpm launcher on Windows. Checked pnpm.cmd on PATH and corepack entrypoint at ${corepackEntrypoint}.`,
  );
}

let selectedPnpm = pnpmCandidates[0];

const sharedEnv = {
  ...process.env,
  NODE_ENV: 'test',
  LLM_PROVIDER: process.env.LLM_PROVIDER ?? 'mock',
  LLM_API_KEY: process.env.LLM_API_KEY ?? 'mock',
  LLM_BASE_URL: process.env.LLM_BASE_URL ?? 'mock',
  LLM_MODEL: process.env.LLM_MODEL ?? 'mock',
  CREDENTIALS_MASTER_KEY: process.env.CREDENTIALS_MASTER_KEY ?? 'playwright-test-master-key-32-chars-minimum',
};

const backendEnv = {
  ...sharedEnv,
  PORT: apiUrl.port || '3316',
  DATABASE_PATH: process.env.DATABASE_PATH ?? './data/kalio-e2e.db',
  WORKSPACE_ROOT: process.env.WORKSPACE_ROOT ?? './data/workspaces-e2e',
  CORS_ORIGIN: webUrl.origin,
};

const frontendEnv = {
  ...process.env,
  VITE_API_URL: apiUrl.origin,
  VITE_WS_URL: apiUrl.origin,
  VITE_PORT: webUrl.port || '5288',
  VITE_CACHE_DIR: process.env.VITE_CACHE_DIR ?? resolve(e2eStateDir, 'vite-cache'),
};

const managedChildren = [];
let shuttingDown = false;

function renderExit(code, signal) {
  return signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
}

function attachOutput(child) {
  child.stdout?.on('data', (chunk) => {
    process.stdout.write(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    process.stderr.write(chunk);
  });
}

function quoteShellArg(arg) {
  if (/^[a-zA-Z0-9_./:-]+$/.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/"/g, '\\"')}"`;
}

function spawnProcess(command, args, options) {
  if (process.platform === 'win32' && command.endsWith('.cmd')) {
    const cmd = process.env.ComSpec ?? 'cmd.exe';
    const commandLine = ['call', command, ...args].map(quoteShellArg).join(' ');
    return spawn(cmd, ['/d', '/c', commandLine], options);
  }

  return spawn(command, args, options);
}

async function runPnpm(label, args, env) {
  const failures = [];

  for (const candidate of pnpmCandidates) {
    try {
      await new Promise((resolvePromise, reject) => {
        const child = spawnProcess(candidate.command, [...candidate.argsPrefix, ...args], {
          cwd: repoRoot,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        attachOutput(child);

        child.once('error', reject);
        child.once('exit', (code, signal) => {
          if (code === 0) {
            resolvePromise();
            return;
          }

          reject(new Error(`${candidate.command} exited with ${renderExit(code, signal)}`));
        });
      });
      selectedPnpm = candidate;
      return;
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }

  throw new Error(`${label} failed: ${failures.join('; ')}`);
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet.
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function spawnManaged(label, command, args, cwd, env) {
  const child = spawnProcess(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  attachOutput(child);

  child.once('error', (err) => {
    if (!shuttingDown) {
      console.error(`[playwright-stack] ${label} failed to start`, err);
      void shutdown(1);
    }
  });

  child.once('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`[playwright-stack] ${label} exited unexpectedly with ${renderExit(code, signal)}`);
      void shutdown(code ?? 1);
    }
  });

  managedChildren.push(child);
  return child;
}

async function killChild(child) {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  if (process.platform === 'win32') {
    await new Promise((resolvePromise) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      killer.once('exit', () => resolvePromise());
      killer.once('error', () => resolvePromise());
    });
    return;
  }

  child.kill('SIGTERM');
  await new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolvePromise();
    }, 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  await Promise.allSettled(managedChildren.map((child) => killChild(child)));
  process.exit(exitCode);
}

process.on('SIGINT', () => {
  void shutdown(0);
});

process.on('SIGTERM', () => {
  void shutdown(0);
});

async function main() {
  if (skipBuild) {
    console.log('[playwright-stack] skipping builds because KALIO_PLAYWRIGHT_SKIP_BUILD=1');
  } else {
    console.log('[playwright-stack] building backend');
    await runPnpm('Backend build', ['--filter', 'kalio-api', 'build'], backendEnv);

    console.log('[playwright-stack] building frontend');
    await runPnpm('Frontend build', ['--filter', 'kalio-web', 'build'], frontendEnv);
  }

  console.log(`[playwright-stack] starting backend on ${apiUrl.origin}`);
  spawnManaged('backend', process.execPath, ['dist/main.js'], apiDir, backendEnv);
  await waitForUrl(`${apiUrl.origin}/api/health`, 60_000);

  console.log(`[playwright-stack] starting frontend preview on ${webUrl.origin}`);
  spawnManaged(
    'frontend',
    selectedPnpm.command,
    [
      ...selectedPnpm.argsPrefix,
      '--filter',
      'kalio-web',
      'exec',
      'vite',
      'preview',
      '--configLoader',
      'runner',
      '--host',
      webUrl.hostname,
      '--port',
      webUrl.port || '5288',
      '--strictPort',
    ],
    repoRoot,
    frontendEnv,
  );
  await waitForUrl(webUrl.origin, 60_000);

  console.log('[playwright-stack] backend and frontend are ready');
}

main().catch(async (err) => {
  console.error('[playwright-stack] failed to start', err);
  await shutdown(1);
});

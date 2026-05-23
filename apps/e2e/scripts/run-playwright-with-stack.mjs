import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const e2eDir = resolve(scriptDir, '..');
const repoRoot = resolve(e2eDir, '../..');
const envFilePath = resolve(repoRoot, '.env.test');
const playwrightCli = resolve(e2eDir, 'node_modules/@playwright/test/cli.js');

const legacyPlaywrightPorts = new Set(['3016', '5188', '3316', '5288']);
const allowLegacyPlaywrightPorts = process.env.KALIO_PLAYWRIGHT_ALLOW_LEGACY_PORTS === '1';

const explicitEnvBeforeFile = new Set(Object.keys(process.env ?? {}));
const explicitPlaywrightBase = process.env.PLAYWRIGHT_BASE_URL;
const explicitPlaywrightApi = process.env.PLAYWRIGHT_API_ORIGIN;
const explicitDatabasePath = process.env.DATABASE_PATH;
const explicitWorkspaceRoot = process.env.WORKSPACE_ROOT;

if (existsSync(envFilePath)) {
  process.loadEnvFile?.(envFilePath);
}

function shouldIgnoreLegacyPlaywrightUrl(urlLike, wasExplicitlySet, key) {
  if (!urlLike) {
    return false;
  }

  try {
    const parsed = new URL(urlLike);
    if (legacyPlaywrightPorts.has(parsed.port)) {
      if (allowLegacyPlaywrightPorts) {
        return false;
      }
      if (wasExplicitlySet) {
        throw new Error(`[playwright-runner] ${key} cannot use legacy port ${parsed.port}. Set KALIO_PLAYWRIGHT_ALLOW_LEGACY_PORTS=1 only for manual debugging.`);
      }
      console.log(`[playwright-runner] ignoring ${key} from .env.test because it uses legacy port ${parsed.port}`);
      return true;
    }
  } catch (error) {
    console.log(`[playwright-runner] ${key} in .env.test is not a valid URL, ignoring and allocating free port`, error instanceof Error ? error.message : error);
  }

  return false;
}

const forwardedArgs = process.argv.slice(2);

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

async function killProcessTree(child) {
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

function run(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, options);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      resolvePromise({ code: code ?? (signal ? 1 : 0), signal });
    });
  });
}

const playwrightBaseWasExplicit = explicitEnvBeforeFile.has('PLAYWRIGHT_BASE_URL') || explicitPlaywrightBase !== undefined;
const playwrightApiWasExplicit = explicitEnvBeforeFile.has('PLAYWRIGHT_API_ORIGIN') || explicitPlaywrightApi !== undefined;
const databasePathWasExplicit = explicitEnvBeforeFile.has('DATABASE_PATH') || explicitDatabasePath !== undefined;
const workspaceRootWasExplicit = explicitEnvBeforeFile.has('WORKSPACE_ROOT') || explicitWorkspaceRoot !== undefined;
const resolvedPlaywrightBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const resolvedPlaywrightApiOrigin = process.env.PLAYWRIGHT_API_ORIGIN;
if (shouldIgnoreLegacyPlaywrightUrl(resolvedPlaywrightBaseUrl, playwrightBaseWasExplicit, 'PLAYWRIGHT_BASE_URL')) {
  delete process.env.PLAYWRIGHT_BASE_URL;
}
if (shouldIgnoreLegacyPlaywrightUrl(resolvedPlaywrightApiOrigin, playwrightApiWasExplicit, 'PLAYWRIGHT_API_ORIGIN')) {
  delete process.env.PLAYWRIGHT_API_ORIGIN;
}
if (!databasePathWasExplicit) {
  delete process.env.DATABASE_PATH;
}
if (!workspaceRootWasExplicit) {
  delete process.env.WORKSPACE_ROOT;
}

const playwrightBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${await getFreePort()}`;
const playwrightApiOrigin = process.env.PLAYWRIGHT_API_ORIGIN ?? `http://127.0.0.1:${await getFreePort()}`;
const runId = `${Date.now()}-${process.pid}`;
const playwrightStateDir = resolve(repoRoot, 'data/playwright-stack', runId);
const playwrightDatabasePath = process.env.DATABASE_PATH ?? resolve(playwrightStateDir, 'kalio-e2e.db');
const playwrightWorkspaceRoot = process.env.WORKSPACE_ROOT ?? resolve(playwrightStateDir, 'workspaces');
mkdirSync(playwrightStateDir, { recursive: true });
const stackEnv = normalizedWindowsEnv(process.env);
const stack = spawn(process.execPath, ['./scripts/start-playwright-stack.mjs'], {
  cwd: e2eDir,
  env: {
    ...stackEnv,
    PLAYWRIGHT_BASE_URL: playwrightBaseUrl,
    PLAYWRIGHT_API_ORIGIN: playwrightApiOrigin,
    KALIO_PLAYWRIGHT_STATE_DIR: playwrightStateDir,
    DATABASE_PATH: playwrightDatabasePath,
    WORKSPACE_ROOT: playwrightWorkspaceRoot,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let shuttingDown = false;
let stackOutput = '';

function attachOutput(child) {
  const handleChunk = (chunk) => {
    const text = String(chunk);
    stackOutput += text;
    process.stdout.write(text);
  };

  child.stdout?.on('data', handleChunk);
  child.stderr?.on('data', handleChunk);
}

attachOutput(stack);

function waitForStackExit(child) {
  return new Promise((resolvePromise) => {
    child.once('exit', (code, signal) => {
      resolvePromise({ code: code ?? (signal ? 1 : 0), signal });
    });
    child.once('error', (error) => {
      resolvePromise({ code: 1, signal: null, error });
    });
  });
}

async function waitForStackReady(timeoutMs) {
  const readyMarker = '[playwright-stack] backend and frontend are ready';
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (stackOutput.includes(readyMarker)) {
      return;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }

  throw new Error(`Timed out waiting for Playwright stack readiness.\n\n${stackOutput}`);
}

async function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  await killProcessTree(stack);
  process.exit(exitCode);
}

process.once('SIGINT', () => {
  void shutdown(130);
});
process.once('SIGTERM', () => {
  void shutdown(143);
});
process.once('uncaughtException', (error) => {
  console.error('[playwright-runner] uncaught exception', error);
  void shutdown(1);
});
process.once('unhandledRejection', (reason) => {
  console.error('[playwright-runner] unhandled rejection', reason);
  void shutdown(1);
});

try {
  const stackExit = waitForStackExit(stack);
  await Promise.race([
    waitForStackReady(240_000),
    stackExit.then((result) => {
      throw new Error(`Playwright stack exited before readiness (code ${result.code}, signal ${result.signal ?? 'none'})`);
    }),
  ]);

  const playwrightEnv = normalizedWindowsEnv({
    ...process.env,
    KALIO_PLAYWRIGHT_EXTERNAL_SERVER: '1',
    PLAYWRIGHT_BASE_URL: playwrightBaseUrl,
    PLAYWRIGHT_API_ORIGIN: playwrightApiOrigin,
    TEST_API_URL: `${playwrightApiOrigin}/api`,
    DATABASE_PATH: playwrightDatabasePath,
    WORKSPACE_ROOT: playwrightWorkspaceRoot,
  });
  const result = await run(process.execPath, [playwrightCli, 'test', ...forwardedArgs], {
    cwd: e2eDir,
    env: playwrightEnv,
    stdio: 'inherit',
  });

  await shutdown(result.code);
} catch (err) {
  console.error('[playwright-runner] failed', err);
  await shutdown(1);
}

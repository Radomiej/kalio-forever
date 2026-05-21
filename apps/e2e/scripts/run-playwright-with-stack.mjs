import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const e2eDir = resolve(scriptDir, '..');
const repoRoot = resolve(e2eDir, '../..');
const envFilePath = resolve(repoRoot, '.env.test');
const playwrightCli = resolve(e2eDir, 'node_modules/@playwright/test/cli.js');

if (existsSync(envFilePath)) {
  process.loadEnvFile?.(envFilePath);
}

const forwardedArgs = process.argv.slice(2);

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

const stackEnv = normalizedWindowsEnv(process.env);
const stack = spawn(process.execPath, ['./scripts/start-playwright-stack.mjs'], {
  cwd: e2eDir,
  env: stackEnv,
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

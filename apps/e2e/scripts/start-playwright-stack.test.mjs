import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourceScriptPath = resolve(scriptDir, 'start-playwright-stack.mjs');
const sourceRunnerPath = resolve(scriptDir, 'run-playwright-with-stack.mjs');
const playwrightConfigPath = resolve(scriptDir, '../playwright.config.ts');
const launcherReadyTimeoutMs = 15_000;

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

async function createSandboxRepo(rootDir, options = {}) {
  const {
    includePnpmCmd = true,
    includeCorepackCmd = false,
    includeCorepackShim = false,
  } = options;
  const launcherDir = resolve(rootDir, 'apps/e2e/scripts');
  const playwrightCliDir = resolve(rootDir, 'apps/e2e/node_modules/@playwright/test');
  const apiDistDir = resolve(rootDir, 'apps/kalio-api/dist');
  const binDir = resolve(rootDir, 'bin');

  await mkdir(launcherDir, { recursive: true });
  await mkdir(playwrightCliDir, { recursive: true });
  await mkdir(apiDistDir, { recursive: true });
  await mkdir(binDir, { recursive: true });

  await copyFile(sourceScriptPath, resolve(launcherDir, 'start-playwright-stack.mjs'));
  await copyFile(sourceRunnerPath, resolve(launcherDir, 'run-playwright-with-stack.mjs'));
  await copyFile(playwrightConfigPath, resolve(rootDir, 'apps/e2e/playwright.config.ts'));
  await writeFile(
    resolve(playwrightCliDir, 'package.json'),
    JSON.stringify({ type: 'module', main: './index.js' }),
    'utf8',
  );
  await writeFile(
    resolve(playwrightCliDir, 'index.js'),
    `export function defineConfig(config) {
  return config;
}

export const devices = {
  'Desktop Chrome': {},
};
`,
    'utf8',
  );
  await writeFile(
    resolve(playwrightCliDir, 'cli.js'),
    `if (process.env.KALIO_PLAYWRIGHT_EXTERNAL_SERVER !== '1') {
  console.error('[fake-playwright] external server flag missing');
  process.exit(1);
}

console.log('[fake-playwright] ran with ' + process.env.PLAYWRIGHT_BASE_URL);
`,
    'utf8',
  );

  await writeFile(
    resolve(apiDistDir, 'main.js'),
    `const http = require('node:http');

const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) {
  console.error('[fake-backend] PORT must be set');
  process.exit(1);
}
const server = http.createServer((request, response) => {
  if (request.url === '/api/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end('backend ok');
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(port, () => {
  console.log('[fake-backend] listening on', port, 'db=' + process.env.DATABASE_PATH, 'workspace=' + process.env.WORKSPACE_ROOT);
});
`,
    'utf8',
  );

  await writeFile(
    resolve(binDir, 'fake-pnpm.cjs'),
    `const http = require('node:http');

const args = process.argv.slice(2);
const normalizedArgs = args[0] === 'pnpm' ? args.slice(1) : args;

if (normalizedArgs.includes('build')) {
  console.log('[fake-pnpm] build', normalizedArgs.join(' '));
  process.exit(0);
}

if (normalizedArgs[0] === '--filter' && normalizedArgs[1] === 'kalio-web' && normalizedArgs[2] === 'exec' && normalizedArgs[3] === 'vite' && normalizedArgs[4] === 'preview') {
  const hostIndex = normalizedArgs.indexOf('--host');
  const portIndex = normalizedArgs.indexOf('--port');
  if (!normalizedArgs.includes('--configLoader') || !normalizedArgs.includes('runner')) {
    console.error('[fake-pnpm] preview must use Vite config loader runner');
    process.exit(1);
  }

  const host = hostIndex >= 0 ? normalizedArgs[hostIndex + 1] : '127.0.0.1';
  const port = Number(portIndex >= 0 ? normalizedArgs[portIndex + 1] : 0);
  if (!Number.isInteger(port) || port <= 0) {
    console.error('[fake-pnpm] preview port must be set');
    process.exit(1);
  }
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>preview</title><body>preview ok</body>');
  });

  function shutdown() {
    server.close(() => process.exit(0));
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.listen(port, host, () => {
    console.log('[fake-pnpm] preview ready on', host + ':' + port);
  });
  return;
}

console.error('[fake-pnpm] unexpected arguments', normalizedArgs);
process.exit(1);
`,
    'utf8',
  );

  await writeFile(resolve(binDir, 'pnpm'), `#!/usr/bin/env node
require('./fake-pnpm.cjs');
`, 'utf8');
  await chmod(resolve(binDir, 'pnpm'), 0o755);

  if (includePnpmCmd) {
    await writeFile(
      resolve(binDir, 'pnpm.cmd'),
      '@echo off\r\nnode "%~dp0\\fake-pnpm.cjs" %*\r\n',
      'utf8',
    );
  }

  if (includeCorepackCmd) {
    await writeFile(
      resolve(binDir, 'corepack.cmd'),
      '@echo off\r\nnode "%~dp0\\fake-pnpm.cjs" pnpm %*\r\n',
      'utf8',
    );
  }

  if (includeCorepackShim) {
    const fakeProgramFilesDir = resolve(rootDir, 'program-files/nodejs/node_modules/corepack/dist');
    await mkdir(fakeProgramFilesDir, { recursive: true });
    await writeFile(
      resolve(fakeProgramFilesDir, 'corepack.js'),
      `require(process.env.KALIO_FAKE_PNPM_PATH);`,
      'utf8',
    );
  }

  return {
    launcherPath: resolve(launcherDir, 'start-playwright-stack.mjs'),
    runnerPath: resolve(launcherDir, 'run-playwright-with-stack.mjs'),
    binDir,
  };
}

function collectOutput(child, output) {
  const handleChunk = (chunk) => {
    output.push(String(chunk));
  };

  child.stdout?.on('data', handleChunk);
  child.stderr?.on('data', handleChunk);

  return () => {
    child.stdout?.off('data', handleChunk);
    child.stderr?.off('data', handleChunk);
  };
}

function withoutPlaywrightUrls(env) {
  const nextEnv = { ...env };
  delete nextEnv.PLAYWRIGHT_BASE_URL;
  delete nextEnv.PLAYWRIGHT_API_ORIGIN;
  delete nextEnv.TEST_API_URL;
  return nextEnv;
}

async function waitForReady(child, output, timeoutMs) {
  const readyMarker = '[playwright-stack] backend and frontend are ready';

  if (output.join('').includes(readyMarker)) {
    return;
  }

  await new Promise((resolvePromise, reject) => {
    const cleanupOutput = collectOutput(child, output);
    const timer = setTimeout(() => {
      cleanupOutput();
      reject(new Error(`Timed out waiting for launcher readiness.\n\n${output.join('')}`));
    }, timeoutMs);

    const onExit = (code, signal) => {
      clearTimeout(timer);
      cleanupOutput();
      reject(new Error(`Launcher exited before readiness with code ${code ?? 'unknown'} signal ${signal ?? 'none'}.\n\n${output.join('')}`));
    };

    const onChunk = () => {
      if (!output.join('').includes(readyMarker)) {
        return;
      }

      clearTimeout(timer);
      cleanupOutput();
      child.off('exit', onExit);
      resolvePromise();
    };

    child.on('exit', onExit);
    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);
  });
}

async function terminateProcess(child) {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    await once(killer, 'exit');
    if (child.exitCode === null && !child.killed) {
      child.kill();
    }
    await Promise.race([
      once(child, 'exit'),
      new Promise((resolvePromise) => {
        setTimeout(resolvePromise, 5000);
      }),
    ]);
    return;
  }

  child.kill('SIGTERM');

  await Promise.race([
    once(child, 'exit'),
    new Promise((resolvePromise) => {
      setTimeout(() => {
        child.kill('SIGKILL');
        resolvePromise();
      }, 5000);
    }),
  ]);
}

async function removeSandbox(rootPath) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(rootPath, { recursive: true, force: true });
      return;
    } catch (error) {
      const isRetryable =
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error.code === 'EBUSY' || error.code === 'EPERM');

      if (!isRetryable) {
        throw error;
      }

      if (attempt === 19) {
        return;
      }

      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }
}
test('launcher starts without a repo .env.test file', async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), 'kalio-playwright-stack-'));
  const output = [];

  try {
    const { launcherPath, binDir } = await createSandboxRepo(sandboxRoot);
    const frontendPort = await getFreePort();
    const backendPort = await getFreePort();
    const child = spawn(process.execPath, [launcherPath], {
      cwd: sandboxRoot,
      env: {
        ...process.env,
        CI: 'true',
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
        PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${frontendPort}`,
        PLAYWRIGHT_API_ORIGIN: `http://127.0.0.1:${backendPort}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stopCollecting = collectOutput(child, output);

    try {
      await waitForReady(child, output, launcherReadyTimeoutMs);
      assert.match(output.join(''), /backend and frontend are ready/);
      assert.doesNotMatch(output.join(''), /\.env\.test/);
    } finally {
      stopCollecting();
      await terminateProcess(child);
    }
  } finally {
    await removeSandbox(sandboxRoot);
  }
});

test('launcher loads PLAYWRIGHT URLs from repo .env.test file when present', async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), 'kalio-playwright-stack-envfile-'));
  const output = [];

  try {
    const { launcherPath, binDir } = await createSandboxRepo(sandboxRoot);
    const frontendPort = await getFreePort();
    const backendPort = await getFreePort();
    await writeFile(
      resolve(sandboxRoot, '.env.test'),
      `PLAYWRIGHT_BASE_URL=http://127.0.0.1:${frontendPort}
PLAYWRIGHT_API_ORIGIN=http://127.0.0.1:${backendPort}
`,
      'utf8',
    );

    const child = spawn(process.execPath, [launcherPath], {
      cwd: sandboxRoot,
      env: {
        ...process.env,
        CI: 'true',
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stopCollecting = collectOutput(child, output);

    try {
      await waitForReady(child, output, launcherReadyTimeoutMs);
      const fullOutput = output.join('');
      assert.match(fullOutput, new RegExp(`starting backend on http://127\\.0\\.0\\.1:${backendPort}\\b`));
      assert.match(fullOutput, new RegExp(`starting frontend preview on http://127\\.0\\.0\\.1:${frontendPort}\\b`));
    } finally {
      stopCollecting();
      await terminateProcess(child);
    }
  } finally {
    await removeSandbox(sandboxRoot);
  }
});

test('launcher starts on Windows without pnpm.cmd when corepack entrypoint is available', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows-only fallback test');
    return;
  }

  const sandboxRoot = await mkdtemp(join(tmpdir(), 'kalio-playwright-stack-win-corepack-'));
  const output = [];

  try {
    const { launcherPath, binDir } = await createSandboxRepo(sandboxRoot, {
      includePnpmCmd: false,
      includeCorepackCmd: true,
      includeCorepackShim: true,
    });
    const frontendPort = await getFreePort();
    const backendPort = await getFreePort();
    const fakeProgramFiles = resolve(sandboxRoot, 'program-files');
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const controlledPath = `${binDir}${delimiter}${resolve(systemRoot, 'System32')}`;

    const child = spawn(process.execPath, [launcherPath], {
      cwd: sandboxRoot,
      env: {
        ...process.env,
        CI: 'true',
        PATH: controlledPath,
        PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${frontendPort}`,
        PLAYWRIGHT_API_ORIGIN: `http://127.0.0.1:${backendPort}`,
        ProgramFiles: fakeProgramFiles,
        KALIO_PLAYWRIGHT_COREPACK_ENTRYPOINT: resolve(fakeProgramFiles, 'nodejs/node_modules/corepack/dist/corepack.js'),
        KALIO_PLAYWRIGHT_NODE_COMMAND: process.execPath,
        KALIO_FAKE_PNPM_PATH: resolve(binDir, 'fake-pnpm.cjs'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stopCollecting = collectOutput(child, output);

    try {
      await waitForReady(child, output, launcherReadyTimeoutMs);
      const fullOutput = output.join('');
      assert.match(fullOutput, /backend and frontend are ready/);
      assert.doesNotMatch(fullOutput, /'pnpm\.cmd' is not recognized/i);
    } finally {
      stopCollecting();
      await terminateProcess(child);
    }
  } finally {
    await removeSandbox(sandboxRoot);
  }
});

test('launcher can start from prebuilt artifacts when build step is skipped', async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), 'kalio-playwright-stack-skip-build-'));
  const output = [];

  try {
    const { launcherPath, binDir } = await createSandboxRepo(sandboxRoot);
    const frontendPort = await getFreePort();
    const backendPort = await getFreePort();
    const child = spawn(process.execPath, [launcherPath], {
      cwd: sandboxRoot,
      env: {
        ...process.env,
        CI: 'true',
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
        PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${frontendPort}`,
        PLAYWRIGHT_API_ORIGIN: `http://127.0.0.1:${backendPort}`,
        KALIO_PLAYWRIGHT_SKIP_BUILD: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stopCollecting = collectOutput(child, output);

    try {
      await waitForReady(child, output, launcherReadyTimeoutMs);
      const fullOutput = output.join('');
      assert.match(fullOutput, /skipping builds because KALIO_PLAYWRIGHT_SKIP_BUILD=1/);
      assert.doesNotMatch(fullOutput, /\[fake-pnpm\] build/);
      assert.match(fullOutput, /backend and frontend are ready/);
    } finally {
      stopCollecting();
      await terminateProcess(child);
    }
  } finally {
    await removeSandbox(sandboxRoot);
  }
});

test('playwright wrapper waits on PLAYWRIGHT_BASE_URL from repo .env.test file', async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), 'kalio-playwright-runner-envfile-'));
  const output = [];

  try {
    const { runnerPath, binDir } = await createSandboxRepo(sandboxRoot);
    const frontendPort = await getFreePort();
    const backendPort = await getFreePort();
    await writeFile(
      resolve(sandboxRoot, '.env.test'),
      `PLAYWRIGHT_BASE_URL=http://127.0.0.1:${frontendPort}
PLAYWRIGHT_API_ORIGIN=http://127.0.0.1:${backendPort}
KALIO_PLAYWRIGHT_SKIP_BUILD=1
`,
      'utf8',
    );

    const child = spawn(process.execPath, [runnerPath], {
      cwd: sandboxRoot,
      env: {
        ...process.env,
        CI: 'true',
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stopCollecting = collectOutput(child, output);

    try {
      const [code] = await once(child, 'exit');
      const fullOutput = output.join('');
      assert.equal(code, 0, fullOutput);
      assert.match(fullOutput, new RegExp(`starting frontend preview on http://127\\.0\\.0\\.1:${frontendPort}\\b`));
      assert.match(fullOutput, new RegExp(`\\[fake-playwright\\] ran with http://127\\.0\\.0\\.1:${frontendPort}`));
    } finally {
      stopCollecting();
    }
  } finally {
    await removeSandbox(sandboxRoot);
  }
});

test('playwright wrapper allocates E2E ports when URLs are not pinned', async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), 'kalio-playwright-runner-random-ports-'));
  const output = [];

  try {
    const { runnerPath, binDir } = await createSandboxRepo(sandboxRoot);
    await writeFile(
      resolve(sandboxRoot, '.env.test'),
      'KALIO_PLAYWRIGHT_SKIP_BUILD=1\n',
      'utf8',
    );

    const child = spawn(process.execPath, [runnerPath], {
      cwd: sandboxRoot,
      env: {
        ...withoutPlaywrightUrls(process.env),
        CI: 'true',
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stopCollecting = collectOutput(child, output);

    try {
      const [code] = await once(child, 'exit');
      const fullOutput = output.join('');
      assert.equal(code, 0, fullOutput);
      assert.doesNotMatch(fullOutput, /http:\/\/127\.0\.0\.1:3016\b/);
      assert.doesNotMatch(fullOutput, /http:\/\/127\.0\.0\.1:5188\b/);
      assert.doesNotMatch(fullOutput, /http:\/\/127\.0\.0\.1:3316\b/);
      assert.doesNotMatch(fullOutput, /http:\/\/127\.0\.0\.1:5288\b/);
      assert.match(fullOutput, /starting backend on http:\/\/127\.0\.0\.1:\d+\b/);
      assert.match(fullOutput, /starting frontend preview on http:\/\/127\.0\.0\.1:\d+\b/);
      assert.match(fullOutput, /\[fake-playwright\] ran with http:\/\/127\.0\.0\.1:\d+\b/);
    } finally {
      stopCollecting();
    }
  } finally {
    await removeSandbox(sandboxRoot);
  }
});

test('playwright wrapper gives each run isolated database and workspace paths', async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), 'kalio-playwright-runner-isolated-state-'));
  const output = [];

  try {
    const { runnerPath, binDir } = await createSandboxRepo(sandboxRoot);
    await writeFile(
      resolve(sandboxRoot, '.env.test'),
      'KALIO_PLAYWRIGHT_SKIP_BUILD=1\nDATABASE_PATH=./data/shared-from-env-file.db\nWORKSPACE_ROOT=./data/shared-workspaces-from-env-file\n',
      'utf8',
    );

    const child = spawn(process.execPath, [runnerPath], {
      cwd: sandboxRoot,
      env: {
        ...withoutPlaywrightUrls(process.env),
        CI: 'true',
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stopCollecting = collectOutput(child, output);

    try {
      const [code] = await once(child, 'exit');
      const fullOutput = output.join('');
      assert.equal(code, 0, fullOutput);
      assert.match(fullOutput, /data[\\/]playwright-stack[\\/]\d+-\d+[\\/]kalio-e2e\.db/);
      assert.match(fullOutput, /data[\\/]playwright-stack[\\/]\d+-\d+[\\/]workspaces/);
      assert.doesNotMatch(fullOutput, /shared-from-env-file/);
    } finally {
      stopCollecting();
    }
  } finally {
    await removeSandbox(sandboxRoot);
  }
});

test('playwright wrapper ignores legacy ports from repo .env.test when not explicitly set', async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), 'kalio-playwright-runner-env-legacy-'));
  const output = [];

  try {
    const { runnerPath, binDir } = await createSandboxRepo(sandboxRoot);
    await writeFile(
      resolve(sandboxRoot, '.env.test'),
      'PLAYWRIGHT_BASE_URL=http://127.0.0.1:3316\nPLAYWRIGHT_API_ORIGIN=http://127.0.0.1:5188\nKALIO_PLAYWRIGHT_SKIP_BUILD=1\n',
      'utf8',
    );

    const child = spawn(process.execPath, [runnerPath], {
      cwd: sandboxRoot,
      env: {
        ...withoutPlaywrightUrls(process.env),
        CI: 'true',
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stopCollecting = collectOutput(child, output);

    try {
      const [code] = await once(child, 'exit');
      const fullOutput = output.join('');
      assert.equal(code, 0, fullOutput);
      assert.match(fullOutput, /\[playwright-runner\] ignoring PLAYWRIGHT_BASE_URL from \.env\.test because it uses legacy port 3316/);
      assert.match(fullOutput, /\[playwright-runner\] ignoring PLAYWRIGHT_API_ORIGIN from \.env\.test because it uses legacy port 5188/);
      assert.doesNotMatch(fullOutput, /3316:\b/);
      assert.doesNotMatch(fullOutput, /5188:\b/);
      assert.match(fullOutput, /starting backend on http:\/\/127\.0\.0\.1:\d+\b/);
      assert.match(fullOutput, /starting frontend preview on http:\/\/127\.0\.0\.1:\d+\b/);
      assert.match(fullOutput, /\[fake-playwright\] ran with http:\/\/127\.0\.0\.1:\d+\b/);
    } finally {
      stopCollecting();
    }
  } finally {
    await removeSandbox(sandboxRoot);
  }
});

test('start script fails when legacy ports are set only via .env.test', async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), 'kalio-playwright-stack-legacy-ports-'));
  const output = [];

  try {
    const { launcherPath, binDir } = await createSandboxRepo(sandboxRoot);
    const legacyBasePort = 3316;
    const legacyApiPort = 5188;
    await writeFile(
      resolve(sandboxRoot, '.env.test'),
      `PLAYWRIGHT_BASE_URL=http://127.0.0.1:${legacyBasePort}\nPLAYWRIGHT_API_ORIGIN=http://127.0.0.1:${legacyApiPort}\n`,
      'utf8',
    );

    const child = spawn(process.execPath, [launcherPath], {
      cwd: sandboxRoot,
      env: {
        ...withoutPlaywrightUrls(process.env),
        CI: 'true',
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stopCollecting = collectOutput(child, output);

    try {
      const [code] = await once(child, 'exit');
      const fullOutput = output.join('');
      assert.notEqual(code, 0, fullOutput);
      assert.match(fullOutput, /cannot use legacy port 3316/i);
    } finally {
      stopCollecting();
    }
  } finally {
    await removeSandbox(sandboxRoot);
  }
});

test('playwright wrapper rejects legacy ports from explicit environment by default', async () => {
  const sandboxRoot = await mkdtemp(join(tmpdir(), 'kalio-playwright-runner-explicit-legacy-'));
  const output = [];

  try {
    const { runnerPath, binDir } = await createSandboxRepo(sandboxRoot);
    const child = spawn(process.execPath, [runnerPath], {
      cwd: sandboxRoot,
      env: {
        ...process.env,
        CI: 'true',
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
        PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:5288',
        PLAYWRIGHT_API_ORIGIN: 'http://127.0.0.1:3316',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stopCollecting = collectOutput(child, output);

    try {
      const [code] = await once(child, 'exit');
      const fullOutput = output.join('');
      assert.notEqual(code, 0, fullOutput);
      assert.match(fullOutput, /cannot use legacy port 5288/i);
    } finally {
      stopCollecting();
    }
  } finally {
    await removeSandbox(sandboxRoot);
  }
});

test('playwright config rejects mismatched explicit API URLs', async () => {
  const output = [];
  const sandboxRoot = await mkdtemp(join(tmpdir(), 'kalio-playwright-config-mismatch-'));

  try {
    await createSandboxRepo(sandboxRoot);
    const child = spawn(process.execPath, ['-e', `import(${JSON.stringify(pathToFileURL(resolve(sandboxRoot, 'apps/e2e/playwright.config.ts')).href)})`], {
      env: {
        ...process.env,
        PLAYWRIGHT_API_ORIGIN: 'http://127.0.0.1:24116',
        TEST_API_URL: 'http://127.0.0.1:9999/api',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stopCollecting = collectOutput(child, output);

    const [code] = await once(child, 'exit');
    try {
      assert.notEqual(code, 0);
      assert.match(output.join(''), /TEST_API_URL must match PLAYWRIGHT_API_ORIGIN/);
    } finally {
      stopCollecting();
    }
  } finally {
    await removeSandbox(sandboxRoot);
  }
});


import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourceScriptPath = resolve(scriptDir, 'start-playwright-stack.mjs');

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

async function createSandboxRepo(rootDir) {
  const launcherDir = resolve(rootDir, 'apps/e2e/scripts');
  const apiDistDir = resolve(rootDir, 'apps/kalio-api/dist');
  const binDir = resolve(rootDir, 'bin');

  await mkdir(launcherDir, { recursive: true });
  await mkdir(apiDistDir, { recursive: true });
  await mkdir(binDir, { recursive: true });

  await copyFile(sourceScriptPath, resolve(launcherDir, 'start-playwright-stack.mjs'));

  await writeFile(
    resolve(apiDistDir, 'main.js'),
    `const http = require('node:http');

const port = Number(process.env.PORT || 3316);
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
  console.log('[fake-backend] listening on', port);
});
`,
    'utf8',
  );

  await writeFile(
    resolve(binDir, 'fake-pnpm.cjs'),
    `const http = require('node:http');

const args = process.argv.slice(2);

if (args.includes('build')) {
  console.log('[fake-pnpm] build', args.join(' '));
  process.exit(0);
}

if (args[0] === '--filter' && args[1] === 'kalio-web' && args[2] === 'exec' && args[3] === 'vite' && args[4] === 'preview') {
  const hostIndex = args.indexOf('--host');
  const portIndex = args.indexOf('--port');
  const host = hostIndex >= 0 ? args[hostIndex + 1] : '127.0.0.1';
  const port = Number(portIndex >= 0 ? args[portIndex + 1] : 5288);
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

console.error('[fake-pnpm] unexpected arguments', args);
process.exit(1);
`,
    'utf8',
  );

  await writeFile(resolve(binDir, 'pnpm'), `#!/usr/bin/env node
require('./fake-pnpm.cjs');
`, 'utf8');
  await chmod(resolve(binDir, 'pnpm'), 0o755);

  await writeFile(
    resolve(binDir, 'pnpm.cmd'),
    '@echo off\r\nnode "%~dp0\\fake-pnpm.cjs" %*\r\n',
    'utf8',
  );

  return {
    launcherPath: resolve(launcherDir, 'start-playwright-stack.mjs'),
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
      await waitForReady(child, output, 20_000);
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
      await waitForReady(child, output, 20_000);
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


import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertControlPlaneAuthentication, assertLoopbackOnly } from './control-plane-package-smoke.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiEntry = join(repoRoot, 'apps', 'kalio-api', 'dist', 'main.js');
const controlPlaneToken = randomBytes(32).toString('hex');
const trustedOrigins = ['http://tauri.localhost', 'tauri://localhost'];

async function findFreePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not allocate a loopback port for the local smoke test.');
  }
  await new Promise((resolvePromise, reject) => {
    server.close((error) => error ? reject(error) : resolvePromise());
  });
  return address.port;
}

function backendEnvironment(root, port, host) {
  const dataRoot = join(root, 'data');
  return {
    ...process.env,
    NODE_ENV: 'production',
    KALIO_INSTALL_PROFILE: 'desktop',
    KALIO_CONTROL_PLANE_TOKEN: controlPlaneToken,
    KALIO_HOST: host,
    KALIO_SERVE_UI: 'false',
    KALIO_HOME: root,
    KALIO_DATA_ROOT: dataRoot,
    PORT: String(port),
    DATABASE_PATH: join(dataRoot, 'kalio.db'),
    WORKSPACE_ROOT: join(dataRoot, 'workspaces'),
    MEMORY_DB_PATH: join(dataRoot, 'memory'),
    EMBEDDING_CACHE_DIR: join(dataRoot, 'embeddings-cache'),
    CREDENTIALS_MASTER_KEY: 'kalio-control-plane-smoke-master-key-32chars',
    CORS_ORIGIN: trustedOrigins.join(','),
    KALIO_SQLITE_DRIVER: 'auto',
    KALIO_ENABLE_TEST_SUPPORT: 'false',
    LLM_PROVIDER: 'mock',
    LLM_API_KEY: 'mock',
    LLM_BASE_URL: 'mock',
    LLM_MODEL: 'mock',
  };
}

function spawnApi(root, port, host) {
  const child = spawn(process.execPath, [apiEntry], {
    cwd: repoRoot,
    env: backendEnvironment(root, port, host),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const output = [];
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));
  return { child, output: () => output.join('').slice(-12_000) };
}

async function waitForReady(child, port, output) {
  const deadline = Date.now() + 45_000;
  let lastError = 'API did not answer yet';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`API exited before ready (code ${child.exitCode})\n${output()}`);
    }
    try {
      const health = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1_500),
      });
      if (!health.ok) throw new Error(`health returned HTTP ${health.status}`);
      const runtimeResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/info`, {
        signal: AbortSignal.timeout(1_500),
      });
      if (!runtimeResponse.ok) throw new Error(`runtime info returned HTTP ${runtimeResponse.status}`);
      const runtimeInfo = await runtimeResponse.json();
      if (runtimeInfo?.host !== '127.0.0.1') {
        throw new Error(`runtime reports unexpected bind host ${String(runtimeInfo?.host)}`);
      }
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`API readiness timed out: ${lastError}\n${output()}`);
}

async function assertInvalidBindRejected(root) {
  const port = await findFreePort();
  const { child, output } = spawnApi(root, port, '0.0.0.0');
  const exitCode = await Promise.race([
    new Promise((resolvePromise) => child.once('close', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(() => resolvePromise(null), 5_000)),
  ]);
  if (exitCode === null) {
    child.kill();
    throw new Error(`API accepted a non-loopback desktop bind request.\n${output()}`);
  }
  if (exitCode === 0 || !output().includes('Packaged Kalio runtime must bind to loopback')) {
    throw new Error(`API did not reject a non-loopback desktop bind as expected.\n${output()}`);
  }
}

async function main() {
  await access(apiEntry);
  const smokeRoot = await mkdtemp(join(tmpdir(), 'kalio-control-plane-smoke-'));
  await mkdir(join(smokeRoot, 'data'), { recursive: true });
  const port = await findFreePort();
  const { child, output } = spawnApi(smokeRoot, port, '127.0.0.1');

  try {
    await waitForReady(child, port, output);
    await assertControlPlaneAuthentication(`http://127.0.0.1:${port}`, controlPlaneToken, trustedOrigins);
    await assertLoopbackOnly(port);
    await assertInvalidBindRejected(smokeRoot);
    console.log('[control-plane-smoke] anonymous denied, bearer accepted, CORS scoped, loopback bind enforced');
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolvePromise) => child.once('close', resolvePromise));
    }
    await rm(smokeRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[control-plane-smoke] failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});

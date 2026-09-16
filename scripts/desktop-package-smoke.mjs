import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resourceRoot = join(repoRoot, 'src-tauri', 'resources');
const serverRoot = join(resourceRoot, 'kalio-server');
const runtimeName = process.platform === 'win32' ? 'kalio-node.exe' : 'kalio-node';
const runtimePath = join(resourceRoot, runtimeName);
const bootstrapPath = join(serverRoot, 'runtime-server-bootstrap.mjs');

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function requireFile(path, label) {
  try {
    const details = await stat(path);
    if (!details.isFile()) {
      throw new Error(`${label} is not a file: ${path}`);
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`${label} is missing: ${path}`);
    }
    throw error;
  }
}

async function findFreePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, resolvePromise);
  });
  const address = server.address();
  await new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve a free local port for the desktop package smoke test.');
  }
  return address.port;
}

function waitForExit(child) {
  if (child.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolvePromise) => {
    child.once('exit', resolvePromise);
  });
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function removeTemporaryTree(path) {
  let lastError = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') {
        throw error;
      }
      lastError = error;
      await delay(500);
    }
  }
  throw lastError ?? new Error(`Unable to remove temporary path: ${path}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) {
    return;
  }
  const exitPromise = waitForExit(child);
  child.kill();
  const stopped = await Promise.race([
    exitPromise.then(() => true),
    delay(5_000).then(() => false),
  ]);
  if (stopped) {
    return;
  }
  child.kill('SIGKILL');
  const forceStopped = await Promise.race([
    exitPromise.then(() => true),
    delay(5_000).then(() => false),
  ]);
  if (!forceStopped) {
    throw new Error('bundled runtime did not exit after the smoke test');
  }
}

async function waitForReady(child, port) {
  const healthUrl = `http://127.0.0.1:${port}/api/health`;
  const runtimeInfoUrl = `http://127.0.0.1:${port}/api/runtime/info`;
  const deadline = Date.now() + 60_000;
  let lastError = 'runtime did not answer yet';

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`bundled runtime exited before becoming healthy with code ${child.exitCode}`);
    }
    try {
      const healthResponse = await fetch(healthUrl);
      if (!healthResponse.ok) {
        throw new Error(`health endpoint returned HTTP ${healthResponse.status}`);
      }
      const health = await healthResponse.json();
      if (health?.status !== 'ok') {
        throw new Error(`health endpoint returned ${JSON.stringify(health)}`);
      }

      const runtimeResponse = await fetch(runtimeInfoUrl);
      if (!runtimeResponse.ok) {
        throw new Error(`runtime info endpoint returned HTTP ${runtimeResponse.status}`);
      }
      const runtimeInfo = await runtimeResponse.json();
      if (runtimeInfo?.status !== 'ok' || runtimeInfo?.runtime !== 'kalio') {
        throw new Error(`runtime info returned ${JSON.stringify(runtimeInfo)}`);
      }
      console.log(
        `[desktop-smoke] healthy runtime=${runtimeInfo.runtime} `
        + `driver=${runtimeInfo.sqliteDriver} profile=${runtimeInfo.profile} port=${runtimeInfo.port}`,
      );
      return;
    } catch (error) {
      lastError = formatError(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }

  throw new Error(`bundled runtime health check timed out: ${lastError}`);
}

async function main() {
  await Promise.all([
    requireFile(runtimePath, `bundled ${runtimeName}`),
    requireFile(bootstrapPath, 'desktop backend bootstrap'),
    requireFile(join(serverRoot, 'dist', 'main.js'), 'desktop backend build'),
    access(join(serverRoot, 'node_modules')),
  ]);

  const port = await findFreePort();
  const smokeRoot = await mkdtemp(join(tmpdir(), 'kalio-desktop-package-smoke-'));
  const dataRoot = join(smokeRoot, 'data');
  const child = spawn(runtimePath, [bootstrapPath], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      KALIO_PORT: String(port),
      KALIO_HOST: '127.0.0.1',
      KALIO_SERVE_UI: 'false',
      KALIO_HOME: smokeRoot,
      KALIO_DATA_ROOT: dataRoot,
      KALIO_INSTALL_PROFILE: 'desktop',
      KALIO_RUNTIME_VERSION: 'ci-smoke',
      KALIO_SQLITE_DRIVER: 'auto',
      DATABASE_PATH: join(dataRoot, 'kalio.db'),
      WORKSPACE_ROOT: join(dataRoot, 'workspaces'),
      MEMORY_DB_PATH: join(dataRoot, 'memory'),
      EMBEDDING_CACHE_DIR: join(dataRoot, 'embeddings-cache'),
      CREDENTIALS_MASTER_KEY: 'kalio-desktop-smoke-master-key-32chars',
      CORS_ORIGIN: `http://127.0.0.1:${port}`,
      LLM_PROVIDER: 'mock',
      LLM_API_KEY: 'mock',
      LLM_BASE_URL: 'mock',
      LLM_MODEL: 'mock',
      KALIO_ENABLE_TEST_SUPPORT: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[desktop-smoke] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[desktop-smoke] ${chunk}`));
  let spawnError = null;
  child.once('error', (error) => {
    spawnError = error;
  });

  try {
    if (spawnError) {
      throw spawnError;
    }
    await waitForReady(child, port);
    await access(join(dataRoot, 'kalio.db'));
    console.log(`[desktop-smoke] fresh SQLite database created in ${dataRoot}`);
  } finally {
    let stopError = null;
    try {
      await stopChild(child);
    } catch (error) {
      stopError = error;
    }
    let cleanupError = null;
    try {
      await removeTemporaryTree(smokeRoot);
    } catch (error) {
      cleanupError = error;
    }
    if (stopError) {
      throw stopError;
    }
    if (cleanupError) {
      throw cleanupError;
    }
  }
}

try {
  await main();
  console.log('[desktop-smoke] packaged desktop backend passed');
} catch (error) {
  console.error(`[desktop-smoke] failed: ${formatError(error)}`);
  process.exitCode = 1;
}

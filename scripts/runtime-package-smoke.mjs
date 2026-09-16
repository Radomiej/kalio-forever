import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const archiveArgumentIndex = process.argv.indexOf('--archive');
const archiveArgument = archiveArgumentIndex >= 0 ? process.argv[archiveArgumentIndex + 1] : null;

if (!archiveArgument) {
  throw new Error('Usage: node scripts/runtime-package-smoke.mjs --archive <runtime-archive>');
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function requireFile(path, label) {
  const details = await stat(path).catch((error) => {
    if (error?.code === 'ENOENT') {
      throw new Error(`${label} is missing: ${path}`);
    }
    throw error;
  });
  if (!details.isFile()) {
    throw new Error(`${label} is not a file: ${path}`);
  }
}

async function findFile(directory, fileName) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return entryPath;
    }
    if (entry.isDirectory()) {
      const nestedPath = await findFile(entryPath, fileName);
      if (nestedPath) {
        return nestedPath;
      }
    }
  }
  return null;
}

async function extractArchive(archivePath, destination) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn('tar', ['-xf', archivePath, '-C', destination], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-8_000);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`runtime archive extraction failed with ${signal ?? `code ${code}`}: ${stderr}`));
    });
  });
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
    throw new Error('Unable to resolve a free local port for the runtime package smoke test.');
  }
  return address.port;
}

function captureTail(stream) {
  let value = '';
  stream.on('data', (chunk) => {
    value = (value + chunk.toString()).slice(-8_000);
  });
  return () => value;
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
  const exitPromise = new Promise((resolvePromise) => child.once('exit', resolvePromise));
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

async function waitForReady(child, port, output) {
  const deadline = Date.now() + 60_000;
  let lastError = 'runtime did not answer yet';
  let spawnError = null;
  child.once('error', (error) => {
    spawnError = error;
  });

  while (Date.now() < deadline) {
    if (spawnError) {
      throw new Error(`bundled runtime failed to start: ${formatError(spawnError)}\n${output()}`);
    }
    if (child.exitCode !== null) {
      throw new Error(`bundled runtime exited before becoming healthy with code ${child.exitCode}\n${output()}`);
    }
    try {
      const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (!healthResponse.ok) {
        throw new Error(`health endpoint returned HTTP ${healthResponse.status}`);
      }
      const health = await healthResponse.json();
      const runtimeResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/info`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (!runtimeResponse.ok) {
        throw new Error(`runtime info endpoint returned HTTP ${runtimeResponse.status}`);
      }
      const runtimeInfo = await runtimeResponse.json();
      const uiResponse = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (!uiResponse.ok) {
        throw new Error(`embedded UI returned HTTP ${uiResponse.status}`);
      }
      if (health?.status !== 'ok' || runtimeInfo?.status !== 'ok' || runtimeInfo?.runtime !== 'kalio') {
        throw new Error(`runtime endpoints returned ${JSON.stringify({ health, runtimeInfo })}`);
      }
      console.log(
        `[runtime-smoke] healthy runtime=${runtimeInfo.runtime} `
          + `driver=${runtimeInfo.sqliteDriver} ui=${uiResponse.status} port=${port}`,
      );
      return runtimeInfo;
    } catch (error) {
      lastError = formatError(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }

  throw new Error(`bundled runtime health check timed out: ${lastError}\n${output()}`);
}

async function main() {
  const archivePath = resolve(repositoryRoot, archiveArgument);
  await requireFile(archivePath, 'runtime archive');
  const smokeRoot = await mkdtemp(join(tmpdir(), 'kalio-runtime-package-smoke-'));
  const extractRoot = join(smokeRoot, 'archive');
  const dataRoot = join(smokeRoot, 'data');
  let child = null;

  try {
    await mkdir(extractRoot, { recursive: true });
    await extractArchive(archivePath, extractRoot);
    const metadataPath = await findFile(extractRoot, 'runtime.json');
    if (!metadataPath) {
      throw new Error('runtime.json is missing from the runtime archive');
    }
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    if (!['node', 'bun'].includes(metadata.runtime)) {
      throw new Error(`unsupported runtime in metadata: ${metadata.runtime}`);
    }
    const expectedPlatform = process.platform === 'win32' ? 'windows' : process.platform === 'linux' ? 'linux' : null;
    if (metadata.platform !== expectedPlatform || metadata.architecture !== 'x64') {
      throw new Error(`archive target does not match the smoke runner: ${metadata.platform}/${metadata.architecture}`);
    }

    const packageRoot = dirname(metadataPath);
    const serverRoot = join(packageRoot, 'server');
    const webRoot = join(packageRoot, 'web');
    const runtimeName = metadata.runtime === 'bun'
      ? process.platform === 'win32' ? 'kalio-bun.exe' : 'kalio-bun'
      : process.platform === 'win32' ? 'kalio-node.exe' : 'kalio-node';
    const runtimePath = join(packageRoot, 'bin', runtimeName);
    const bootstrapPath = join(serverRoot, 'runtime-server-bootstrap.mjs');
    await Promise.all([
      requireFile(runtimePath, `bundled ${runtimeName}`),
      requireFile(bootstrapPath, 'runtime server bootstrap'),
      requireFile(join(serverRoot, 'dist', 'main.js'), 'runtime server build'),
      requireFile(join(webRoot, 'index.html'), 'embedded UI build'),
      access(join(serverRoot, 'node_modules')),
    ]);

    const port = await findFreePort();
    const databasePath = join(dataRoot, 'kalio.db');
    child = spawn(runtimePath, [bootstrapPath], {
      cwd: serverRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        KALIO_PORT: String(port),
        KALIO_HOST: '127.0.0.1',
        KALIO_SERVE_UI: 'true',
        KALIO_HOME: smokeRoot,
        KALIO_DATA_ROOT: dataRoot,
        KALIO_WEB_ROOT: webRoot,
        KALIO_RUNTIME_VERSION: String(metadata.version),
        KALIO_INSTALL_PROFILE: 'runtime',
        KALIO_SQLITE_DRIVER: String(metadata.runtime),
        DATABASE_PATH: databasePath,
        WORKSPACE_ROOT: join(dataRoot, 'workspaces'),
        MEMORY_DB_PATH: join(dataRoot, 'memory'),
        EMBEDDING_CACHE_DIR: join(dataRoot, 'embeddings-cache'),
        CREDENTIALS_MASTER_KEY: 'kalio-runtime-smoke-master-key-32chars',
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
    const stdout = captureTail(child.stdout);
    const stderr = captureTail(child.stderr);
    const output = () => `stdout:\n${stdout()}\nstderr:\n${stderr()}`;
    const runtimeInfo = await waitForReady(child, port, output);
    await access(databasePath);
    console.log(
      `[runtime-smoke] fresh SQLite database created; runtime=${metadata.runtime} `
        + `driver=${runtimeInfo.sqliteDriver}`,
    );
  } finally {
    let stopError = null;
    if (child) {
      try {
        await stopChild(child);
      } catch (error) {
        stopError = error;
      }
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
  console.log('[runtime-smoke] packaged runtime passed');
} catch (error) {
  console.error(`[runtime-smoke] failed: ${formatError(error)}`);
  process.exitCode = 1;
}

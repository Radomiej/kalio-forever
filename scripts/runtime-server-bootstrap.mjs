import { randomBytes } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = dirname(fileURLToPath(import.meta.url));
const dataRoot = resolve(
  process.env.KALIO_DATA_ROOT ?? join(serverRoot, '..', '..', 'data'),
);
const runtimeRoot = resolve(serverRoot, '..');
const envFile = join(dataRoot, '.env');

async function loadEnvFile(path) {
  try {
    const content = await readFile(path, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) {
        continue;
      }
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function ensureDirectory(path) {
  await mkdir(path, { recursive: true });
}

async function getMasterKey() {
  if (process.env.CREDENTIALS_MASTER_KEY) {
    return process.env.CREDENTIALS_MASTER_KEY;
  }

  const keyPath = join(dataRoot, 'credentials-master.key');
  try {
    return (await readFile(keyPath, 'utf8')).trim();
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  const key = randomBytes(32).toString('base64');
  await writeFile(keyPath, key + '\n', { encoding: 'utf8', mode: 0o600 });
  console.warn(
    '[kalio] generated credentials-master.key in the data root; protect this file and back it up securely',
  );
  return key;
}

await ensureDirectory(dataRoot);
await loadEnvFile(envFile);

const workspaceRoot = resolve(process.env.WORKSPACE_ROOT ?? join(dataRoot, 'workspaces'));
const memoryDbPath = resolve(process.env.MEMORY_DB_PATH ?? join(dataRoot, 'memory'));
const embeddingCacheDir = resolve(
  process.env.EMBEDDING_CACHE_DIR ?? join(dataRoot, 'embeddings-cache'),
);
await Promise.all([
  ensureDirectory(workspaceRoot),
  ensureDirectory(memoryDbPath),
  ensureDirectory(embeddingCacheDir),
  ensureDirectory(join(dataRoot, 'logs')),
  ensureDirectory(join(dataRoot, 'cache')),
]);

process.env.NODE_ENV = 'production';
process.env.PORT = process.env.KALIO_PORT ?? process.env.PORT ?? '4016';
process.env.KALIO_HOST = process.env.KALIO_HOST ?? '127.0.0.1';
process.env.KALIO_INSTALL_PROFILE = 'runtime';
process.env.KALIO_SERVE_UI = 'true';
process.env.KALIO_WEB_ROOT = process.env.KALIO_WEB_ROOT ?? join(runtimeRoot, 'web');
process.env.KALIO_HOME = process.env.KALIO_HOME ?? resolve(runtimeRoot, '..', '..', '..');
process.env.KALIO_RUNTIME_VERSION ??= 'development';
process.env.KALIO_SQLITE_DRIVER ??= 'auto';
process.env.KALIO_API_PROTOCOL_VERSION ??= '1';
process.env.KALIO_DATABASE_SCHEMA_VERSION ??= '1';
process.env.CORS_ORIGIN ??= 'http://127.0.0.1:' + process.env.PORT;
process.env.DATABASE_PATH = resolve(process.env.DATABASE_PATH ?? join(dataRoot, 'kalio.db'));
process.env.WORKSPACE_ROOT = workspaceRoot;
process.env.MEMORY_DB_PATH = memoryDbPath;
process.env.EMBEDDING_CACHE_DIR = embeddingCacheDir;
process.env.CREDENTIALS_MASTER_KEY = await getMasterKey();
process.env.LLM_PROVIDER ??= 'mock';
process.env.LLM_API_KEY ??= 'mock';
process.env.LLM_BASE_URL ??= 'mock';
process.env.LLM_MODEL ??= 'mock';
process.env.KALIO_ENABLE_TEST_SUPPORT = 'false';

await stat(join(serverRoot, 'dist', 'main.js'));
await import('./dist/main.js');



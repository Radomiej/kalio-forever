import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dataRoot = process.env.KALIO_DESKTOP_DATA_ROOT;
if (!dataRoot) {
  throw new Error('KALIO_DESKTOP_DATA_ROOT is required for the desktop backend');
}

mkdirSync(dataRoot, { recursive: true });

function readEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }

  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const envFile = join(dataRoot, '.env');
const fileEnv = readEnvFile(envFile);
for (const [key, value] of Object.entries(fileEnv)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

if (!process.env.CREDENTIALS_MASTER_KEY?.trim()) {
  process.env.CREDENTIALS_MASTER_KEY = randomBytes(32).toString('base64');
  appendFileSync(
    envFile,
    `${existsSync(envFile) ? '\n' : ''}CREDENTIALS_MASTER_KEY=${process.env.CREDENTIALS_MASTER_KEY}\n`,
    'utf8',
  );
}

const requiredRuntimeEnv = [
  'DATABASE_PATH',
  'WORKSPACE_ROOT',
  'MEMORY_DB_PATH',
  'EMBEDDING_CACHE_DIR',
  'PORT',
  'CORS_ORIGIN',
];
for (const key of requiredRuntimeEnv) {
  if (!process.env[key]) {
    throw new Error(`${key} is required for the desktop backend`);
  }
}

// Keep a fresh installation usable before the user configures a real provider.
// A saved credential in the database or a value in AppData/.env takes precedence.
const firstRunLlmDefaults = {
  LLM_PROVIDER: 'mock',
  LLM_API_KEY: 'mock',
  LLM_BASE_URL: 'mock',
  LLM_MODEL: 'mock',
};
for (const [key, value] of Object.entries(firstRunLlmDefaults)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

process.env.NODE_ENV = 'production';
process.env.KALIO_INSTALL_PROFILE = 'desktop';
process.env.KALIO_ENABLE_TEST_SUPPORT = 'false';

await import('./dist/main.js');

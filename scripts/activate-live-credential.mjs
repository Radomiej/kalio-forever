#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = resolve(fileURLToPath(import.meta.url), '..');
const repoRoot = resolve(scriptDir, '..');

function getArgValue(args, flag, fallback) {
  const direct = args.find((item) => item === flag || item.startsWith(`${flag}=`));
  if (!direct) {
    return fallback;
  }
  if (direct.includes('=')) {
    return direct.split('=').slice(1).join('=');
  }
  const index = args.indexOf(direct);
  return args[index + 1] ?? fallback;
}

export function readEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const env = {};
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

export function readStackApiUrl(root = repoRoot) {
  const statePath = resolve(root, '.kalio-stack/qa-stack-state.json');
  if (!existsSync(statePath)) {
    return null;
  }
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const port = Number(state?.backendPort);
    return Number.isInteger(port) && port > 0 ? `http://127.0.0.1:${port}/api` : null;
  } catch {
    return null;
  }
}

export function assertLocalApiUrl(value, allowRemoteApiUrl = false) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`[activate-live-credential] invalid API URL: ${value}`);
  }

  const isLocalhost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
  if (!allowRemoteApiUrl && !isLocalhost) {
    throw new Error('[activate-live-credential] refusing to send credentials to a non-local API URL. Pass --allow-remote-api-url only for intentional remote activation.');
  }
}

async function parseJsonResponse(response, label) {
  const body = await response.text();
  let json = {};
  if (body.trim()) {
    try {
      json = JSON.parse(body);
    } catch {
      throw new Error(`${label} returned non-JSON response: HTTP ${response.status}`);
    }
  }
  if (!response.ok) {
    throw new Error(`${label} failed: HTTP ${response.status}`);
  }
  return json;
}

export async function activateLiveCredential(options = {}) {
  const args = options.args ?? [];
  const env = options.env ?? process.env;
  const root = options.repoRoot ?? repoRoot;
  const fetchJson = options.fetchJson ?? fetch;
  const allowRemoteApiUrl = args.includes('--allow-remote-api-url');
  const envFile = getArgValue(args, '--env-file', '.env');
  const testEnvFile = getArgValue(args, '--test-env-file', '.env.test');
  const fileEnv = {
    ...readEnvFile(resolve(root, envFile)),
    ...readEnvFile(resolve(root, testEnvFile)),
  };

  const apiUrl = getArgValue(args, '--api-url', env.TEST_API_URL ?? readStackApiUrl(root));
  if (!apiUrl) {
    throw new Error('[activate-live-credential] no API URL. Start the stack first or pass --api-url http://127.0.0.1:<port>/api');
  }
  assertLocalApiUrl(apiUrl, allowRemoteApiUrl);

  const provider = getArgValue(args, '--provider', env.LLM_PROVIDER ?? fileEnv.LLM_PROVIDER ?? 'xiaomimimo');
  const model = getArgValue(args, '--model', env.LLM_MODEL ?? fileEnv.LLM_MODEL ?? 'mimo-v2.5');
  const baseUrl = getArgValue(args, '--base-url', env.LLM_BASE_URL ?? fileEnv.LLM_BASE_URL ?? 'https://token-plan-ams.xiaomimimo.com/v1');
  const apiKey = env.LLM_API_KEY ?? fileEnv.LLM_API_KEY ?? '';
  const name = getArgValue(args, '--name', `Live ${provider} ${model}`);

  if (!apiKey) {
    throw new Error('[activate-live-credential] LLM_API_KEY is empty. Put the key in ignored .env.test or pass it via the process environment.');
  }

  const normalizedApiUrl = apiUrl.replace(/\/$/, '');
  const createdResponse = await fetchJson(`${normalizedApiUrl}/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, provider, apiKey, baseUrl, model }),
  });
  const created = await parseJsonResponse(createdResponse, 'Credential creation');

  if (typeof created.id !== 'string' || created.id.trim().length === 0) {
    throw new Error('[activate-live-credential] credential creation response did not include an id.');
  }

  const activateResponse = await fetchJson(`${normalizedApiUrl}/credentials/active/${created.id}`, { method: 'PUT' });
  if (!activateResponse.ok) {
    throw new Error(`[activate-live-credential] activation failed: HTTP ${activateResponse.status}`);
  }

  return {
    ok: true,
    credentialId: created.id,
    provider,
    model,
    baseUrl,
    source: 'db',
  };
}

export async function runActivateLiveCredential(options = {}) {
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  try {
    const result = await activateLiveCredential(options);
    stdout(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const exitCode = await runActivateLiveCredential({ args: process.argv.slice(2) });
  process.exitCode = exitCode;
}

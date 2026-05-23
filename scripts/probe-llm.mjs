#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = resolve(fileURLToPath(import.meta.url), '..');
const repoRoot = resolve(scriptDir, '..');
const args = process.argv.slice(2);
const allowRemoteApiUrl = args.includes('--allow-remote-api-url');

function getArgValue(flag, fallback) {
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

function readEnvFile(filePath) {
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

function readStackApiUrl() {
  const statePath = resolve(repoRoot, '.kalio-stack/qa-stack-state.json');
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

function sanitize(value, secret) {
  if (!secret) {
    return value;
  }
  return value.split(secret).join('[redacted]');
}

function assertLocalApiUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`[llm-probe] invalid API URL: ${value}`);
  }

  const isLocalhost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
  if (!allowRemoteApiUrl && !isLocalhost) {
    throw new Error('[llm-probe] refusing to send credentials to a non-local API URL. Pass --allow-remote-api-url only for intentional remote probes.');
  }
}

const envFile = getArgValue('--env-file', '.env');
const testEnvFile = getArgValue('--test-env-file', '.env.test');
const fileEnv = {
  ...readEnvFile(resolve(repoRoot, testEnvFile)),
  ...readEnvFile(resolve(repoRoot, envFile)),
};

const apiUrl = getArgValue('--api-url', process.env.TEST_API_URL ?? readStackApiUrl());
if (!apiUrl) {
  console.error('[llm-probe] no API URL. Start the stack first or pass --api-url http://127.0.0.1:<port>/api');
  process.exit(1);
}
assertLocalApiUrl(apiUrl);

const provider = getArgValue('--provider', process.env.LLM_PROVIDER ?? fileEnv.LLM_PROVIDER ?? 'mock');
const model = getArgValue('--model', process.env.LLM_MODEL ?? fileEnv.LLM_MODEL ?? 'mock');
const baseUrl = getArgValue('--base-url', process.env.LLM_BASE_URL ?? fileEnv.LLM_BASE_URL ?? 'mock');
const apiKey = process.env.LLM_API_KEY ?? fileEnv.LLM_API_KEY ?? '';

const response = await fetch(`${apiUrl.replace(/\/$/, '')}/credentials/test`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ provider, model, baseUrl, apiKey }),
});

const result = await response.json().catch(() => ({
  ok: false,
  latencyMs: 0,
  error: `Probe endpoint returned non-JSON response: ${response.status}`,
}));

const safeError = typeof result.error === 'string' ? sanitize(result.error, apiKey) : undefined;
const summary = {
  ok: Boolean(result.ok),
  provider,
  model,
  baseUrl,
  latencyMs: result.latencyMs ?? 0,
  ...(safeError ? { error: safeError } : {}),
};

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);

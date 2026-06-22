#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultLlmBaseUrlForProvider,
  defaultLlmModelForProvider,
  normalizeProvider,
  providerApiKeyEnvNames,
  resolveProviderApiKey,
  resolveProviderSelection,
} from './llm-provider-config.mjs';
import { readStackApiUrl } from './stack-state.mjs';

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
  ...readEnvFile(resolve(repoRoot, envFile)),
  ...readEnvFile(resolve(repoRoot, testEnvFile)),
};

const apiUrl = getArgValue('--api-url', process.env.TEST_API_URL ?? readStackApiUrl(repoRoot));
if (!apiUrl) {
  console.error('[llm-probe] no API URL. Start the stack first or pass --api-url http://127.0.0.1:<port>/api');
  process.exit(1);
}
assertLocalApiUrl(apiUrl);

const explicitProvider = getArgValue('--provider', undefined);
const configuredProvider = process.env.LLM_PROVIDER ?? fileEnv.LLM_PROVIDER;
const provider = resolveProviderSelection({
  explicitProvider,
  configuredProvider,
  envSources: [process.env, fileEnv],
  fallbackProvider: 'mock',
});
const allowGenericApiKey = !explicitProvider
  || !configuredProvider
  || normalizeProvider(explicitProvider) === normalizeProvider(configuredProvider);
const model = getArgValue('--model', process.env.LLM_MODEL ?? fileEnv.LLM_MODEL ?? defaultLlmModelForProvider(provider));
const baseUrl = getArgValue('--base-url', process.env.LLM_BASE_URL ?? fileEnv.LLM_BASE_URL ?? defaultLlmBaseUrlForProvider(provider));
const apiKey = resolveProviderApiKey(provider, [process.env, fileEnv], { allowGenericApiKey });

if (!apiKey && !['mock', 'ollama', 'bitnet'].includes(provider)) {
  console.log(JSON.stringify({
    ok: false,
    provider,
    model,
    baseUrl,
    latencyMs: 0,
    error: `No API key found. Set one of: ${providerApiKeyEnvNames(provider, { allowGenericApiKey }).join(', ')}`,
  }, null, 2));
  process.exit(1);
}

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

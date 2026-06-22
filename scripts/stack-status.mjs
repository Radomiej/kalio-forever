import { resolveStackPaths, stackApiUrlFromState } from './stack-state.mjs';

function pickOptionalString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function normalizeEffectiveLlmConfig(payload) {
  const provider = pickOptionalString(payload?.provider);
  const model = pickOptionalString(payload?.model);
  const baseUrl = pickOptionalString(payload?.baseUrl);
  const source = pickOptionalString(payload?.source);

  return provider || model || baseUrl || source
    ? {
        provider,
        model,
        baseUrl,
        source,
      }
    : null;
}

export async function fetchEffectiveLlmConfig(configUrl, fetchImpl = globalThis.fetch) {
  if (!configUrl || typeof fetchImpl !== 'function') {
    return null;
  }

  try {
    const response = await fetchImpl(configUrl);
    if (!response?.ok) {
      return null;
    }
    return normalizeEffectiveLlmConfig(await response.json());
  } catch {
    return null;
  }
}

export async function readEffectiveLlmConfig(state, fetchImpl = globalThis.fetch) {
  const apiUrl = stackApiUrlFromState(state);
  return apiUrl ? fetchEffectiveLlmConfig(`${apiUrl}/llm/config`, fetchImpl) : null;
}

export async function buildStackStatusReport({ status, state, repoRoot, isProcessAlive, fetchImpl = globalThis.fetch }) {
  return {
    status,
    backendUp: isProcessAlive(state?.backend?.pid),
    frontendUp: isProcessAlive(state?.frontend?.pid),
    state: state ?? null,
    effectiveLlm: await readEffectiveLlmConfig(state, fetchImpl),
    paths: resolveStackPaths(repoRoot),
  };
}

export function hasAliveChild(state, isProcessAlive) {
  return Boolean(state && (isProcessAlive(state?.backend?.pid) || isProcessAlive(state?.frontend?.pid)));
}

export function renderStateProcesses(state) {
  const lines = [
    `[stack] backend pid ${state?.backend?.pid ?? 'unknown'}  (${state?.backend?.cwd ?? 'unknown cwd'})`,
    `[stack] frontend pid ${state?.frontend?.pid ?? 'unknown'} (${state?.frontend?.cwd ?? 'unknown cwd'})`,
    `[stack] ports: backend=${state?.backendPort ?? 'unknown'}, frontend=${state?.frontendPort ?? 'unknown'}`,
  ];

  if (state?.databasePath) {
    lines.push(`[stack] database=${state.databasePath}`);
  }
  if (state?.workspaceRoot) {
    lines.push(`[stack] workspace=${state.workspaceRoot}`);
  }
  if (state?.dataRoot) {
    lines.push(`[stack] data-root=${state.dataRoot}`);
  }
  if (state?.profile) {
    lines.push(`[stack] profile=${state.profile}`);
  }
  if (state?.installRoot) {
    lines.push(`[stack] install-root=${state.installRoot}`);
  }

  return lines;
}

export function renderEffectiveLlmLine(effectiveLlm) {
  if (!effectiveLlm) {
    return null;
  }

  return `[stack] effective provider=${effectiveLlm.provider ?? 'unknown'} model=${effectiveLlm.model ?? 'unknown'} source=${effectiveLlm.source ?? 'unknown'}`;
}

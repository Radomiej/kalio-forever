import type { Credential } from '@kalio/types';
import {
  PROVIDER_BASE_URLS,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_LABELS,
} from './llm-provider-settings';
import type { ActiveRuntimeConfig, AddForm, LLMConfigWithSource } from './llm-panel.types';

export async function readResponseErrorMessage(res: Response, context: string): Promise<string> {
  const body = await res.text();
  if (!body) {
    return res.statusText ? `HTTP ${res.status}: ${res.statusText}` : `HTTP ${res.status}`;
  }

  const contentType = res.headers.get('content-type') ?? '';
  const looksLikeJson = contentType.toLowerCase().includes('application/json');

  if (!looksLikeJson) {
    return `HTTP ${res.status}: ${body}`;
  }

  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
      return parsed.error;
    }
    if (typeof parsed.message === 'string' && parsed.message.trim().length > 0) {
      return parsed.message;
    }
  } catch (err) {
    console.error(
      `[LLMPanel] Failed to parse ${context} error body`,
      err instanceof Error ? err : new Error(String(err)),
    );
  }

  return `HTTP ${res.status}: ${body}`;
}

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const method = opts?.method?.toUpperCase() ?? 'GET';
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    cache: method === 'GET' ? 'no-store' : undefined,
    ...opts,
  });
  if (!res.ok) {
    throw new Error(await readResponseErrorMessage(res, `apiFetch(${path})`));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function emptyForm(): AddForm {
  return {
    name: PROVIDER_LABELS['openai'] ?? '',
    provider: 'openai',
    apiKey: '',
    baseUrl: PROVIDER_BASE_URLS['openai'] ?? '',
    model: PROVIDER_DEFAULT_MODELS['openai'] ?? '',
    nameEdited: false,
  };
}

export function normalizeOptionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeProviderName(name: string, provider: string): string {
  return normalizeOptionalText(name) ?? PROVIDER_LABELS[provider] ?? provider;
}

export function buildActiveRuntimeConfig(
  activeCredential: Credential | null,
  runtimeConfig: LLMConfigWithSource | null,
): ActiveRuntimeConfig | null {
  if (activeCredential) {
    return {
      source: 'db',
      provider: activeCredential.provider,
      model: activeCredential.model ?? '',
      baseUrl: activeCredential.baseUrl ?? '',
      displayName: activeCredential.name,
      credentialId: activeCredential.id,
    };
  }

  if (!runtimeConfig) {
    return null;
  }

  return {
    source: runtimeConfig.source,
    provider: runtimeConfig.provider,
    model: runtimeConfig.model,
    baseUrl: runtimeConfig.baseUrl,
    displayName: PROVIDER_LABELS[runtimeConfig.provider] ?? runtimeConfig.provider,
  };
}

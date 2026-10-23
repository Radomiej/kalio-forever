import type { ExecutionProfile } from '@kalio/types';
import { apiClient } from './apiClient';

export async function getCodexModels(authProfileId: string, refresh = false): Promise<string[] | null> {
  const url = `/api/runtime/native-cli-integrations/${encodeURIComponent(authProfileId)}/models`;
  const { data } = refresh
    ? await apiClient.post<{ models: string[] }>(`${url}/check`, {})
    : await apiClient.get<{ models: string[] } | null>(url);
  return data?.models ?? null;
}

export async function resolveCodexExecutionProfile(authProfileId: string, model: string): Promise<ExecutionProfile> {
  const { data } = await apiClient.post<ExecutionProfile>('/api/runtime/profiles/codex/resolve', { authProfileId, model });
  return data;
}

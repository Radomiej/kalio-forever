import axios from 'axios';
import type { RAAppSummary, RAAppGroup } from '@kalio/types';

const apiUrl = import.meta.env['VITE_API_URL'] as string ?? 'http://localhost:3016';

export const apiClient = axios.create({
  baseURL: apiUrl,
  headers: { 'Content-Type': 'application/json' },
});

// ── Typed RA-App catalog helpers ─────────────────────────────────────────────

export async function getRAApps(): Promise<RAAppSummary[]> {
  const { data } = await apiClient.get<RAAppSummary[]>('/api/ra-apps');
  return data;
}

export async function getRAAppGroups(): Promise<RAAppGroup[]> {
  const { data } = await apiClient.get<RAAppGroup[]>('/api/ra-apps/groups');
  return data;
}

export async function uploadRAApp(file: File): Promise<RAAppSummary> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await apiClient.post<RAAppSummary>('/api/ra-apps/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function approveRAAppDraft(
  slug: string,
  bumpType: 'patch' | 'minor' | 'major' = 'minor',
): Promise<RAAppGroup> {
  const { data } = await apiClient.post<RAAppGroup>(`/api/ra-apps/groups/${slug}/approve`, { bumpType });
  return data;
}

export async function discardRAAppDraft(slug: string): Promise<RAAppGroup> {
  const { data } = await apiClient.post<RAAppGroup>(`/api/ra-apps/groups/${slug}/discard-draft`);
  return data;
}

export async function rollbackRAApp(slug: string, version: string): Promise<RAAppGroup> {
  const { data } = await apiClient.post<RAAppGroup>(`/api/ra-apps/groups/${slug}/rollback/${version}`);
  return data;
}

export async function deleteRAAppGroup(slug: string): Promise<void> {
  await apiClient.delete(`/api/ra-apps/groups/${slug}`);
}

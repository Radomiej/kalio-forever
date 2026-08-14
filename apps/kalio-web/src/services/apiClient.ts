import axios from 'axios';
import type {
  AssignSessionProjectDto,
  ChatSession,
  CreateProjectDto,
  Project,
  RAAppSummary,
  RAAppGroup,
  RaAppPendingApprovalSnapshot,
  VFSListResult,
} from '@kalio/types';
import { resolvePairedBackendOrigin } from './backendOrigin';
import { readRuntimeConfig } from './runtimeConfig';

function resolveConfiguredApiUrl(): string {
  const pairedBackendOrigin = resolvePairedBackendOrigin(globalThis.location);
  if (pairedBackendOrigin) {
    return pairedBackendOrigin;
  }

  const runtimeApiUrl = readRuntimeConfig()?.apiUrl;
  if (runtimeApiUrl) {
    return runtimeApiUrl;
  }

  const configured = import.meta.env['VITE_API_URL'] as string | undefined;
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim();
  }

  return '/';
}

export function getApiBaseUrl(): string {
  const configured = apiClient.defaults?.baseURL ?? '';
  if (typeof configured === 'string' && configured.trim().length > 0) {
    if (/^https?:\/\//i.test(configured)) {
      return configured.replace(/\/+$/, '');
    }
    if (typeof globalThis !== 'undefined' && globalThis.location?.origin) {
      return new URL(configured, globalThis.location.origin).toString().replace(/\/+$/, '');
    }
  }
  if (typeof globalThis !== 'undefined' && globalThis.location?.origin) {
    return globalThis.location.origin;
  }
  return 'http://localhost:3016';
}

const apiUrl = resolveConfiguredApiUrl();

export const apiClient = axios.create({
  baseURL: apiUrl,
  headers: { 'Content-Type': 'application/json' },
});

export async function getProjects(): Promise<Project[]> {
  const { data } = await apiClient.get<Project[]>('/api/projects');
  return data;
}

export async function createProject(dto: CreateProjectDto): Promise<Project> {
  const { data } = await apiClient.post<Project>('/api/projects', dto);
  return data;
}

export async function assignSessionProject(
  sessionId: string,
  dto: AssignSessionProjectDto,
): Promise<ChatSession> {
  const { data } = await apiClient.patch<ChatSession>(
    `/api/sessions/${encodeURIComponent(sessionId)}/project`,
    dto,
  );
  return data;
}

// ── Typed RA-App catalog helpers ─────────────────────────────────────────────

export async function getRAApps(): Promise<RAAppSummary[]> {
  const { data } = await apiClient.get<RAAppSummary[]>('/api/ra-apps');
  return data;
}

export async function getRAAppGroups(): Promise<RAAppGroup[]> {
  const { data } = await apiClient.get<RAAppGroup[]>('/api/ra-apps/groups');
  return data;
}

export async function getPendingRAAppApprovals(): Promise<RaAppPendingApprovalSnapshot[]> {
  const { data } = await apiClient.get<RaAppPendingApprovalSnapshot[]>('/api/ra-apps/pending-approvals');
  return data;
}

export async function getSessionVfsFiles(sessionId: string): Promise<VFSListResult> {
  const { data } = await apiClient.get<VFSListResult>(`/api/sessions/${sessionId}/vfs`);
  return data;
}

export function getSessionVfsServeUrl(sessionId: string, filePath: string): string {
  const baseUrl = getApiBaseUrl();
  const encodedPath = filePath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/vfs/serve-path/${encodedPath}`;
}

export function getRAAppGroupDownloadUrl(slug: string, version: string): string {
  const baseUrl = getApiBaseUrl();
  return `${baseUrl}/api/ra-apps/groups/${encodeURIComponent(slug)}/download/${encodeURIComponent(version)}`;
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

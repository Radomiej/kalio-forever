import { controlPlaneFetch } from '../../services/controlPlaneFetch';

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await controlPlaneFetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

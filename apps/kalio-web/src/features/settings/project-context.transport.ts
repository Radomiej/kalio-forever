import type { EmbeddingSpace, Project, ProjectContextSettings, ProjectResourceIndexResult, ProjectResourceSearchResult } from '@kalio/types';

export type { ProjectContextSettings } from '@kalio/types';
export interface ProjectContextIndexStatus {
  projectId: string;
  space: EmbeddingSpace;
  indexedChunks: number;
  indexedAt: number | null;
}

async function check(response: Response): Promise<Response> {
  if (response.ok) return response;
  let code = 'PROJECT_CONTEXT_REQUEST_FAILED';
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string') code = body.code;
  } catch { code = 'PROJECT_CONTEXT_REQUEST_FAILED'; }
  if (code === 'EMBEDDING_INPUT_TOO_LONG') throw new Error('Search text is too long for this model. Use a shorter query.');
  throw new Error(`Project context unavailable (${response.status}: ${code}).`);
}

export function createProjectContextRequest(fetcher: typeof fetch = (...args) => fetch(...args)) {
  let bootstrap: Promise<void> | undefined;
  return async (path: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? 'GET';
    const allowed = (path === '/api/projects' && method === 'GET')
      || (path === '/api/memory/project-context/settings' && ['GET', 'PUT'].includes(method))
      || (/^\/api\/memory\/project-resources\/[A-Za-z0-9_-]{1,128}\/status$/.test(path) && method === 'GET')
      || (/^\/api\/memory\/project-resources\/[A-Za-z0-9_-]{1,128}\/(index|search)$/.test(path) && method === 'PUT');
    if (!allowed) throw new Error('Unsupported project context route or method.');
    const headers = new Headers(init.headers);
    headers.delete('Authorization');
    if (method === 'PUT') headers.set('Content-Type', 'application/json');
    const options: RequestInit = { ...init, method, headers, credentials: 'same-origin', redirect: 'error', cache: 'no-store' };
    const response = await fetcher(path, options);
    // Only an explicit 401 is safe to replay; a network/5xx failure may follow a completed PUT.
    if (response.status !== 401) return check(response);
    if (!bootstrap) {
      bootstrap = fetcher('/api/decision/auth', {
        method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: '{}',
      }).then(check).then(() => undefined).finally(() => { bootstrap = undefined; });
    }
    await bootstrap;
    return check(await fetcher(path, options));
  };
}

export function createProjectContextTransport(fetcher?: typeof fetch) {
  const request = createProjectContextRequest(fetcher);
  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await request(path, init)).json() as Promise<T>;
  }
  const resource = (id: string, action: string) => `/api/memory/project-resources/${encodeURIComponent(id)}/${action}`;
  const consent = (allow: boolean) => allow ? { allowRemoteProcessing: true } : {};
  return {
    getSettings: () => json<ProjectContextSettings>('/api/memory/project-context/settings'),
    saveSettings: (settings: Pick<ProjectContextSettings, 'enabled'>) => json<ProjectContextSettings>('/api/memory/project-context/settings', {
      method: 'PUT', body: JSON.stringify({ enabled: settings.enabled }),
    }),
    getProjects: () => json<Project[]>('/api/projects'),
    getStatus: (id: string) => json<ProjectContextIndexStatus>(resource(id, 'status')),
    refresh: (id: string, allowRemote = false) => json<ProjectResourceIndexResult>(resource(id, 'index'), {
      method: 'PUT', body: JSON.stringify(consent(allowRemote)),
    }),
    search: (id: string, query: string, allowRemote = false) => json<ProjectResourceSearchResult[]>(resource(id, 'search'), {
      method: 'PUT', body: JSON.stringify({ query, mode: 'hybrid', ...consent(allowRemote) }),
    }),
  };
}

export const projectContextTransport = createProjectContextTransport();

import type { CodexAppServerConnection } from './codex-app-server.host';

/** Read only picker-visible models from this connection, not persisted profile guesses. */
export async function readCodexModels(connection: Pick<CodexAppServerConnection, 'request'>): Promise<string[]> {
  const models = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const response = await requestPage(connection, {
      limit: 100,
      includeHidden: false,
      ...(cursor ? { cursor } : {}),
    });
    if (!isRecord(response) || !Array.isArray(response.data)) {
      throw new Error('Codex model catalog response has no model array.');
    }
    for (const entry of response.data) {
      if (!isRecord(entry) || typeof entry.model !== 'string' || !entry.model.trim()) {
        throw new Error('Codex model catalog contains an invalid model.');
      }
      if (entry.hidden !== true) models.add(entry.model.trim());
    }
    const next = response.nextCursor;
    if (next === undefined || next === null) return [...models];
    if (typeof next !== 'string' || !next.trim()) {
      throw new Error('Codex model catalog contains an invalid cursor.');
    }
    if (cursors.has(next)) throw new Error('Codex model catalog returned a repeated cursor.');
    cursors.add(next);
    cursor = next;
  }
  throw new Error('Codex model catalog exceeded the pagination limit.');
}

async function requestPage(connection: Pick<CodexAppServerConnection, 'request'>, params: Record<string, unknown>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Codex model catalog request timed out.')), 15_000);
  try {
    return await connection.request('model/list', params, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

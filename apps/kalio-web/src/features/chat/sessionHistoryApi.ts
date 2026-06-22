import type { ChatMessage } from '@kalio/types';
import { apiClient } from '../../services/apiClient';

export const DEFAULT_SESSION_HISTORY_LIMIT = 40;
export const DEFAULT_CHILD_SESSION_HISTORY_LIMIT = 24;

export interface SessionHistoryMeta {
  totalCount: number;
  hasMoreBefore: boolean;
  oldestLoadedMessageId: string | null;
}

export interface SessionHistoryWindow {
  messages: ChatMessage[];
  meta: SessionHistoryMeta;
}

export type SessionHistoryFetchResult = ChatMessage[] | SessionHistoryWindow;

export function toSessionHistoryWindow(result: SessionHistoryFetchResult): SessionHistoryWindow {
  if (Array.isArray(result)) {
    return {
      messages: result,
      meta: {
        totalCount: result.length,
        hasMoreBefore: false,
        oldestLoadedMessageId: result[0]?.id ?? null,
      },
    };
  }

  return result;
}

function parsePositiveInt(value: string | null | undefined): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export async function fetchSessionHistoryWindow(
  sessionId: string,
  options: {
    limit?: number;
    beforeMessageId?: string | null;
    signal?: AbortSignal;
  } = {},
): Promise<SessionHistoryWindow> {
  const response = await apiClient.get<ChatMessage[]>(`/api/sessions/${sessionId}/messages`, {
    signal: options.signal,
    params: {
      ...(typeof options.limit === 'number' ? { limit: options.limit } : {}),
      ...(typeof options.beforeMessageId === 'string' && options.beforeMessageId.trim().length > 0
        ? { beforeMessageId: options.beforeMessageId }
        : {}),
    },
  });
  const headers = response.headers ?? {};
  return {
    messages: response.data,
    meta: {
      totalCount: parsePositiveInt(headers['x-kalio-history-total-count']) || response.data.length,
      hasMoreBefore: headers['x-kalio-history-has-more-before'] === '1',
      oldestLoadedMessageId: typeof headers['x-kalio-history-oldest-loaded-id'] === 'string'
        && headers['x-kalio-history-oldest-loaded-id'].trim().length > 0
        ? headers['x-kalio-history-oldest-loaded-id']
        : null,
    },
  };
}

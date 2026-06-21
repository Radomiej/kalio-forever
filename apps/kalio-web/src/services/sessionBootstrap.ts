import type { ChatSession } from '@kalio/types';
import { apiClient } from './apiClient';

export interface RuntimeWatchTarget {
  sessionId: string;
  reasons: string[];
}

let sessionsRequest: Promise<ChatSession[]> | null = null;
let runtimeWatchlistRequest: Promise<RuntimeWatchTarget[]> | null = null;

export function loadConversationSessions(options: { force?: boolean } = {}): Promise<ChatSession[]> {
  if (!options.force && sessionsRequest) {
    return sessionsRequest;
  }

  const request = apiClient
    .get<ChatSession[]>('/api/sessions')
    .then((response) => response.data)
    .finally(() => {
      if (sessionsRequest === request) {
        sessionsRequest = null;
      }
    });

  sessionsRequest = request;
  return request;
}

export function loadRuntimeWatchlist(options: { force?: boolean } = {}): Promise<RuntimeWatchTarget[]> {
  if (!options.force && runtimeWatchlistRequest) {
    return runtimeWatchlistRequest;
  }

  const request = apiClient
    .get<RuntimeWatchTarget[]>('/api/sessions/runtime-watchlist')
    .then((response) => response.data)
    .finally(() => {
      if (runtimeWatchlistRequest === request) {
        runtimeWatchlistRequest = null;
      }
    });

  runtimeWatchlistRequest = request;
  return request;
}

import type { ChatMessage, ChatSession, RuntimeActivitySnapshot } from '@kalio/types';
import type { RuntimeAttentionItem } from './agentRuntimeSelectors';
import { extractLatestVisibleRuntimeEvidence } from './agentRuntimeEvidence';

export const RUNTIME_ATTENTION_NOTICE_LIMIT = 3;
export const RUNTIME_ATTENTION_NOTICE_WINDOW_MS = 5 * 60 * 1000;

export interface RuntimeAttentionNotice {
  items: RuntimeAttentionItem[];
  totalRecentCount: number;
  hiddenRecentCount: number;
  maxUpdatedAt: number;
  nextExpiresInMs: number;
}

function itemUpdatedAt(params: {
  item: RuntimeAttentionItem;
  sessionMessages?: Record<string, ChatMessage[]> | null;
  runtimeActivitySnapshots?: Record<string, RuntimeActivitySnapshot> | null;
  sessionsById: Map<string, ChatSession>;
}): number {
  const evidence = extractLatestVisibleRuntimeEvidence(
    params.sessionMessages?.[params.item.sessionId],
    params.runtimeActivitySnapshots?.[params.item.sessionId],
  );
  return Math.max(
    evidence?.updatedAt ?? 0,
    params.runtimeActivitySnapshots?.[params.item.sessionId]?.updatedAt ?? 0,
    params.sessionsById.get(params.item.sessionId)?.updatedAt ?? 0,
  );
}

export function selectRuntimeAttentionNotice(params: {
  items: RuntimeAttentionItem[];
  sessionMessages?: Record<string, ChatMessage[]> | null;
  runtimeActivitySnapshots?: Record<string, RuntimeActivitySnapshot> | null;
  sessions?: ChatSession[] | null;
  nowMs: number;
  dismissedThroughUpdatedAt?: number | null;
  limit?: number;
  windowMs?: number;
}): RuntimeAttentionNotice | null {
  const limit = params.limit ?? RUNTIME_ATTENTION_NOTICE_LIMIT;
  const windowMs = params.windowMs ?? RUNTIME_ATTENTION_NOTICE_WINDOW_MS;
  const dismissedThroughUpdatedAt = params.dismissedThroughUpdatedAt ?? 0;
  const sessionsById = new Map((params.sessions ?? []).map((session) => [session.id, session]));
  const recentItems = params.items
    .filter((item) => !item.actionable)
    .map((item) => ({
      item,
      updatedAt: itemUpdatedAt({
        item,
        sessionMessages: params.sessionMessages,
        runtimeActivitySnapshots: params.runtimeActivitySnapshots,
        sessionsById,
      }),
    }))
    .filter(({ updatedAt }) => (
      updatedAt > dismissedThroughUpdatedAt
      && updatedAt > 0
      && params.nowMs - updatedAt <= windowMs
    ))
    .sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) {
        return right.updatedAt - left.updatedAt;
      }
      if (left.item.priority !== right.item.priority) {
        return left.item.priority - right.item.priority;
      }
      return left.item.label.localeCompare(right.item.label);
    });

  if (recentItems.length === 0) {
    return null;
  }

  const visibleItems = recentItems.slice(0, limit);
  const oldestVisibleUpdatedAt = visibleItems[visibleItems.length - 1]?.updatedAt ?? params.nowMs;
  const nextExpiresInMs = Math.max(1, windowMs - (params.nowMs - oldestVisibleUpdatedAt) + 1);

  return {
    items: visibleItems.map(({ item }) => item),
    totalRecentCount: recentItems.length,
    hiddenRecentCount: Math.max(0, recentItems.length - visibleItems.length),
    maxUpdatedAt: recentItems[0]?.updatedAt ?? params.nowMs,
    nextExpiresInMs,
  };
}

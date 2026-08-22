import type { ChatMessage, ChatSession, RuntimeActivitySnapshot } from '@kalio/types';
import type { RuntimeAttentionItem } from './agentRuntimeSelectors';

export const RUNTIME_ATTENTION_NOTICE_LIMIT = 3;
export const RUNTIME_ATTENTION_NOTICE_WINDOW_MS = 5 * 60 * 1000;
export const RUNTIME_ATTENTION_REVIEWED_KEYS_STORAGE = 'kalio:runtime-attention-reviewed-keys';
export const RUNTIME_ATTENTION_REVIEWED_EVENT = 'kalio:runtime-attention-reviewed';

export interface RuntimeAttentionNotice {
  items: RuntimeAttentionItem[];
  reviewKeys: string[];
  totalRecentCount: number;
  hiddenRecentCount: number;
  maxUpdatedAt: number;
  nextExpiresInMs: number;
}

export function runtimeAttentionReviewKey(item: RuntimeAttentionItem, updatedAt: number): string {
  return `${item.id}:${updatedAt}`;
}

export function readReviewedRuntimeAttentionKeys(): Set<string> {
  if (typeof window === 'undefined') {
    return new Set();
  }
  try {
    const raw = window.localStorage.getItem(RUNTIME_ATTENTION_REVIEWED_KEYS_STORAGE);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch (err) {
    console.warn('[runtimeAttentionNotice] failed to read runtime attention review state', err);
    return new Set();
  }
}

export function writeReviewedRuntimeAttentionKeys(keys: ReadonlySet<string>): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(
      RUNTIME_ATTENTION_REVIEWED_KEYS_STORAGE,
      JSON.stringify(Array.from(keys).slice(-200)),
    );
    window.dispatchEvent(new Event(RUNTIME_ATTENTION_REVIEWED_EVENT));
  } catch (err) {
    console.warn('[runtimeAttentionNotice] failed to persist runtime attention review state', err);
  }
}

export function selectRuntimeAttentionNotice(params: {
  items: RuntimeAttentionItem[];
  sessionMessages?: Record<string, ChatMessage[]> | null;
  runtimeActivitySnapshots?: Record<string, RuntimeActivitySnapshot> | null;
  sessions?: ChatSession[] | null;
  nowMs: number;
  dismissedThroughUpdatedAt?: number | null;
  reviewedItemKeys?: ReadonlySet<string> | null;
  limit?: number;
  windowMs?: number;
}): RuntimeAttentionNotice | null {
  const limit = params.limit ?? RUNTIME_ATTENTION_NOTICE_LIMIT;
  const windowMs = params.windowMs ?? RUNTIME_ATTENTION_NOTICE_WINDOW_MS;
  const dismissedThroughUpdatedAt = params.dismissedThroughUpdatedAt ?? 0;
  const recentItems = params.items
    .filter((item) => !item.actionable)
    .map((item) => ({
      item,
      updatedAt: item.occurredAt,
    }))
    .filter(({ item, updatedAt }) => (
      updatedAt > dismissedThroughUpdatedAt
      && updatedAt > 0
      && params.nowMs - updatedAt <= windowMs
      && !params.reviewedItemKeys?.has(runtimeAttentionReviewKey(item, updatedAt))
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
    reviewKeys: recentItems.map(({ item, updatedAt }) => runtimeAttentionReviewKey(item, updatedAt)),
    totalRecentCount: recentItems.length,
    hiddenRecentCount: Math.max(0, recentItems.length - visibleItems.length),
    maxUpdatedAt: recentItems[0]?.updatedAt ?? params.nowMs,
    nextExpiresInMs,
  };
}

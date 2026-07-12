import { describe, expect, it } from 'vitest';
import type { ChatSession, RuntimeActivitySnapshot } from '@kalio/types';
import type { RuntimeAttentionItem } from './agentRuntimeSelectors';
import { runtimeAttentionReviewKey, selectRuntimeAttentionNotice } from './agentRuntimeAttentionNotice';

function makeSession(id: string, title: string, updatedAt: number): ChatSession {
  return {
    id,
    personaId: 'default',
    title,
    createdAt: updatedAt,
    updatedAt,
  };
}

function makeAttentionItem(
  sessionId: string,
  overrides: Partial<RuntimeAttentionItem> = {},
): RuntimeAttentionItem {
  return {
    id: `attention-${sessionId}`,
    sessionId,
    kind: 'runtime_error',
    label: `Session ${sessionId}`,
    detail: 'Runtime error',
    actionable: false,
    priority: 10,
    occurredAt: 4_000,
    navigationSessionId: sessionId,
    sourceSessionIds: [sessionId],
    ...overrides,
  };
}

function makeRuntimeSnapshot(sessionId: string, updatedAt: number): RuntimeActivitySnapshot {
  return {
    sessionId,
    active: false,
    turnId: 'turn-1',
    queueLength: 0,
    pendingConfirmations: [],
    pendingBudgetApprovals: [],
    toolActivities: [],
    childExecutions: [],
    updatedAt,
  };
}

describe('selectRuntimeAttentionNotice', () => {
  it('uses the durable item occurrence time instead of snapshot delivery time', () => {
    const nowMs = 5_000;
    const notice = selectRuntimeAttentionNotice({
      items: [
        makeAttentionItem('new-incident', { occurredAt: 4_000 }),
        makeAttentionItem('old-replayed-incident', { occurredAt: 100 }),
      ],
      runtimeActivitySnapshots: {
        'old-replayed-incident': makeRuntimeSnapshot('old-replayed-incident', 4_900),
      },
      nowMs,
      windowMs: 1_000,
    });

    expect(notice).toEqual({
      items: [expect.objectContaining({ sessionId: 'new-incident' })],
      totalRecentCount: 1,
      hiddenRecentCount: 0,
      maxUpdatedAt: 4_000,
      nextExpiresInMs: 1,
      reviewKeys: ['attention-new-incident:4000'],
    });
  });

  it('keeps only items newer than the dismissed cutoff', () => {
    const notice = selectRuntimeAttentionNotice({
      items: [
        makeAttentionItem('newest', { occurredAt: 4_500 }),
        makeAttentionItem('dismissed-edge', { occurredAt: 3_500 }),
        makeAttentionItem('older', { occurredAt: 3_000 }),
      ],
      sessions: [
        makeSession('newest', 'Newest', 4_500),
        makeSession('dismissed-edge', 'Dismissed edge', 3_500),
        makeSession('older', 'Older', 3_000),
      ],
      nowMs: 5_000,
      windowMs: 5_000,
      dismissedThroughUpdatedAt: 3_500,
    });

    expect(notice).toEqual({
      items: [expect.objectContaining({ sessionId: 'newest' })],
      totalRecentCount: 1,
      hiddenRecentCount: 0,
      maxUpdatedAt: 4_500,
      nextExpiresInMs: 4_501,
      reviewKeys: ['attention-newest:4500'],
    });
  });

  it('filters only the reviewed item version keyed by id and updatedAt', () => {
    const reviewed = makeAttentionItem('reviewed', { occurredAt: 4_500 });
    const notice = selectRuntimeAttentionNotice({
      items: [
        reviewed,
        makeAttentionItem('fresh', { occurredAt: 4_400 }),
      ],
      sessions: [
        makeSession('reviewed', 'Reviewed', 4_500),
        makeSession('fresh', 'Fresh', 4_400),
      ],
      nowMs: 5_000,
      windowMs: 5_000,
      reviewedItemKeys: new Set([runtimeAttentionReviewKey(reviewed, 4_500)]),
    });

    expect(notice).toEqual(expect.objectContaining({
      items: [expect.objectContaining({ sessionId: 'fresh' })],
      reviewKeys: ['attention-fresh:4400'],
      totalRecentCount: 1,
    }));
  });

  it('ignores actionable and stale items while capping visible rows and reporting hidden recent count', () => {
    const notice = selectRuntimeAttentionNotice({
      items: [
        makeAttentionItem('newest', { priority: 20, occurredAt: 4_800 }),
        makeAttentionItem('same-time-high-priority', { priority: 5, occurredAt: 4_800 }),
        makeAttentionItem('mid', { occurredAt: 4_700 }),
        makeAttentionItem('old-visible', { occurredAt: 4_600 }),
        makeAttentionItem('actionable', { actionable: true, occurredAt: 4_900 }),
        makeAttentionItem('stale', { occurredAt: -100 }),
      ],
      sessions: [
        makeSession('newest', 'Newest', 4_800),
        makeSession('same-time-high-priority', 'Higher priority', 4_800),
        makeSession('mid', 'Mid', 4_700),
        makeSession('old-visible', 'Old visible', 4_600),
        makeSession('actionable', 'Actionable', 4_900),
        makeSession('stale', 'Stale', -100),
      ],
      nowMs: 5_000,
      windowMs: 500,
      limit: 2,
    });

    expect(notice).toEqual({
      items: [
        expect.objectContaining({ sessionId: 'same-time-high-priority' }),
        expect.objectContaining({ sessionId: 'newest' }),
      ],
      totalRecentCount: 4,
      hiddenRecentCount: 2,
      maxUpdatedAt: 4_800,
      nextExpiresInMs: 301,
      reviewKeys: [
        'attention-same-time-high-priority:4800',
        'attention-newest:4800',
        'attention-mid:4700',
        'attention-old-visible:4600',
      ],
    });
  });
});

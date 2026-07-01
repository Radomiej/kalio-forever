import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSession, RuntimeActivitySnapshot } from '@kalio/types';
import type { RuntimeAttentionItem } from './agentRuntimeSelectors';
import { selectRuntimeAttentionNotice } from './agentRuntimeAttentionNotice';

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
    ...overrides,
  };
}

function makeToolResultMessage(sessionId: string, createdAt: number, detail: string): ChatMessage {
  return {
    id: `message-${sessionId}`,
    sessionId,
    role: 'tool_result',
    content: JSON.stringify({
      toolResultErrorCode: 'TOOL_RUNTIME_ERROR',
      toolResultErrorMessage: detail,
    }),
    createdAt,
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
  it('uses message evidence first, then runtime snapshot, then session updatedAt to order recent items', () => {
    const nowMs = 5_000;
    const notice = selectRuntimeAttentionNotice({
      items: [
        makeAttentionItem('message-backed'),
        makeAttentionItem('snapshot-backed'),
        makeAttentionItem('session-backed'),
      ],
      sessionMessages: {
        'message-backed': [makeToolResultMessage('message-backed', 4_000, 'Newest typed error')],
      },
      runtimeActivitySnapshots: {
        'message-backed': makeRuntimeSnapshot('message-backed', 1_000),
        'snapshot-backed': makeRuntimeSnapshot('snapshot-backed', 3_500),
      },
      sessions: [
        makeSession('message-backed', 'Message backed', 500),
        makeSession('snapshot-backed', 'Snapshot backed', 800),
        makeSession('session-backed', 'Session backed', 3_000),
      ],
      nowMs,
      windowMs: 5_000,
    });

    expect(notice).toEqual({
      items: [
        expect.objectContaining({ sessionId: 'message-backed' }),
        expect.objectContaining({ sessionId: 'snapshot-backed' }),
        expect.objectContaining({ sessionId: 'session-backed' }),
      ],
      totalRecentCount: 3,
      hiddenRecentCount: 0,
      maxUpdatedAt: 4_000,
      nextExpiresInMs: 3_001,
    });
  });

  it('keeps only items newer than the dismissed cutoff', () => {
    const notice = selectRuntimeAttentionNotice({
      items: [
        makeAttentionItem('newest'),
        makeAttentionItem('dismissed-edge'),
        makeAttentionItem('older'),
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
    });
  });

  it('ignores actionable and stale items while capping visible rows and reporting hidden recent count', () => {
    const notice = selectRuntimeAttentionNotice({
      items: [
        makeAttentionItem('newest', { priority: 20 }),
        makeAttentionItem('same-time-high-priority', { priority: 5 }),
        makeAttentionItem('mid'),
        makeAttentionItem('old-visible'),
        makeAttentionItem('actionable', { actionable: true }),
        makeAttentionItem('stale'),
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
    });
  });
});

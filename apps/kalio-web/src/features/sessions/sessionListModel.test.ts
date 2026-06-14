import { describe, expect, it, vi, afterEach } from 'vitest';
import type { ChatSession } from '@kalio/types';
import { buildSessionListEntries, isVisibleSidebarSession, sortSessionsForSidebar } from './sessionListModel';

function makeSession(overrides: Partial<ChatSession>): ChatSession {
  return {
    id: 'session-1',
    personaId: 'default',
    title: 'Session',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('sessionListModel', () => {
  it('shows only agent-started sessions in archived filter', () => {
    const root = makeSession({ id: 'root' });
    const subagent = makeSession({ id: 'sub', kind: 'subagent', parentSessionId: 'root' });

    expect(isVisibleSidebarSession(root, null, 'archived')).toBe(false);
    expect(isVisibleSidebarSession(subagent, null, 'archived')).toBe(true);
  });

  it('keeps active agent session visible even when outside the recency window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-27T12:00:00.000Z'));

    const staleSubagent = makeSession({
      id: 'sub-stale',
      kind: 'subagent',
      parentSessionId: 'root',
      updatedAt: Date.now() - (25 * 60 * 60 * 1000),
    });

    expect(isVisibleSidebarSession(staleSubagent, null, 'agent')).toBe(false);
    expect(isVisibleSidebarSession(staleSubagent, 'sub-stale', 'agent')).toBe(true);
  });

  it('builds only session entries for archived filter (without synthetic root rows)', () => {
    const sessions: ChatSession[] = [
      makeSession({ id: 'root', title: 'Root', updatedAt: 10 }),
      makeSession({
        id: 'sub-1',
        title: 'Sub 1',
        kind: 'subagent',
        parentSessionId: 'root',
        createdAt: 11,
        updatedAt: 11,
      }),
      makeSession({
        id: 'sub-2',
        title: 'Sub 2',
        kind: 'subagent',
        parentSessionId: 'root',
        createdAt: 12,
        updatedAt: 12,
      }),
    ];

    const ordered = sortSessionsForSidebar(sessions);
    const entries = buildSessionListEntries(ordered, null, 'archived');

    expect(entries.every((entry) => entry.type === 'session')).toBe(true);
    expect(entries.map((entry) => entry.session.id)).toEqual(['sub-1', 'sub-2']);
  });

  it('hides orphaned workflow container sessions from the conversation list', () => {
    const sessions: ChatSession[] = [
      makeSession({
        id: 'arch-run-root',
        title: 'Architecture: Live proof',
        kind: 'agent-flow',
        parentSessionId: 'architect-ui',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureContext: {
            architectureRunId: 'run-live',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
          },
        },
        createdAt: 20,
        updatedAt: 20,
      }),
      makeSession({
        id: 'arch-run-implementer',
        title: 'Implementer branch',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        createdAt: 21,
        updatedAt: 21,
      }),
    ];

    const ordered = sortSessionsForSidebar(sessions);
    const entries = buildSessionListEntries(ordered, null, 'all');

    expect(entries).toEqual([]);
  });

  it('keeps the user host visible while hiding workflow containers in the default list', () => {
    const sessions: ChatSession[] = [
      makeSession({ id: 'host', title: 'Workflow host', updatedAt: 30 }),
      makeSession({
        id: 'arch-run-root',
        title: 'Architecture: Live proof',
        kind: 'agent-flow',
        parentSessionId: 'host',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureContext: {
            architectureRunId: 'run-live',
            schemaName: 'Strategic Decision Council',
            displayLabel: 'Strategic Decision Council',
          },
        },
        createdAt: 31,
        updatedAt: 31,
      }),
      makeSession({
        id: 'arch-run-analyst',
        title: 'Strategic Decision Council: Analyst',
        kind: 'subagent',
        parentSessionId: 'arch-run-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureSlotId: 'analyst',
          architectureContext: { roleSlotId: 'analyst', displayLabel: 'Analyst' },
        },
        createdAt: 32,
        updatedAt: 32,
      }),
    ];

    const ordered = sortSessionsForSidebar(sessions);
    const entries = buildSessionListEntries(ordered, null, 'all');

    expect(entries.map((entry) => entry.session.id)).toEqual(['host']);
  });

  it('keeps a loaded child conversation out of the flat list even when it is active', () => {
    const sessions: ChatSession[] = [
      makeSession({ id: 'root', title: 'Root chat', updatedAt: 10 }),
      makeSession({
        id: 'child',
        title: 'Child chat',
        kind: 'subagent',
        parentSessionId: 'root',
        createdAt: 11,
        updatedAt: 11,
      }),
    ];

    const ordered = sortSessionsForSidebar(sessions);

    expect(buildSessionListEntries(ordered, null, 'all').map((entry) => entry.session.id)).toEqual(['root']);

    const activeEntries = buildSessionListEntries(ordered, 'child', 'all');
    expect(activeEntries.map((entry) => entry.session.id)).toEqual(['root']);
  });

  it('keeps workflow branch conversations attached to the visible host instead of flattening them', () => {
    const sessions: ChatSession[] = [
      makeSession({ id: 'host', title: 'Workflow host', updatedAt: 10 }),
      makeSession({
        id: 'arch-root',
        title: 'Architecture: Workflow root',
        kind: 'agent-flow',
        parentSessionId: 'host',
        runtimeContext: {
          runtimeKind: 'agent-flow-root',
          architectureContext: {
            architectureRunId: 'run-1',
            sessionSurface: 'technical-node',
          },
        },
        createdAt: 11,
        updatedAt: 11,
      }),
      makeSession({
        id: 'branch',
        title: 'Strategic Decision Council: Analyst',
        kind: 'subagent',
        parentSessionId: 'arch-root',
        runtimeContext: {
          runtimeKind: 'agent-flow-branch',
          architectureSlotId: 'analyst',
          architectureContext: {
            architectureRunId: 'run-1',
            sessionSurface: 'conversation-branch',
          },
        },
        createdAt: 12,
        updatedAt: 12,
      }),
    ];

    const ordered = sortSessionsForSidebar(sessions);

    expect(buildSessionListEntries(ordered, 'branch', 'all').map((entry) => entry.session.id)).toEqual(['host']);
  });
});

import { describe, expect, it } from 'vitest';
import type { ChatSession } from '@kalio/types';
import { sessionRuntimeState } from './sessionRowRuntimeState';

function createSession(overrides: Partial<ChatSession>): ChatSession {
  return {
    id: 'session-1',
    personaId: 'default',
    title: 'Session',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('sessionRuntimeState', () => {
  it('returns pending for a real non-technical architecture branch with no stronger live signal', () => {
    const branch = createSession({
      id: 'arch-run-analyst',
      title: 'Strategic Decision Council: Analyst',
      kind: 'subagent',
      parentSessionId: 'arch-run-root',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureSlotId: 'analyst',
        architectureContext: {
          architectureRunId: 'run-live',
          roleSlotId: 'analyst',
          displayLabel: 'Analyst',
          sessionSurface: 'conversation-branch',
        },
      },
    });

    expect(sessionRuntimeState(
      branch,
      branch.id,
      {},
      {},
      new Set(),
      {},
      {},
      {},
      {},
      new Map(),
    )).toBe('pending');
  });

  it('prefers a live session snapshot over the pending architecture fallback', () => {
    const branch = createSession({
      id: 'arch-run-analyst',
      title: 'Strategic Decision Council: Analyst',
      kind: 'subagent',
      parentSessionId: 'arch-run-root',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureSlotId: 'analyst',
        architectureContext: {
          architectureRunId: 'run-live',
          roleSlotId: 'analyst',
          displayLabel: 'Analyst',
          sessionSurface: 'conversation-branch',
        },
      },
    });

    expect(sessionRuntimeState(
      branch,
      branch.id,
      {},
      {},
      new Set(),
      {},
      {
        [branch.id]: {
          sessionId: branch.id,
          active: true,
          turnId: 'turn-1',
          queueLength: 0,
          run: {
            id: 'run-1',
            sessionId: branch.id,
            turnId: 'turn-1',
            phase: 'tool_running',
            status: 'active',
            retryCount: 0,
            safeResume: true,
            startedAt: 1,
            updatedAt: 1,
            lastHeartbeatAt: 1,
          },
        },
      },
      {},
      {},
      new Map(),
    )).toBe('running');
  });

  it('treats interrupted_needs_retry as stopped when there is no live HITL request', () => {
    const session = createSession({ id: 'session-retry', title: 'Retry needed' });

    expect(sessionRuntimeState(
      session,
      session.id,
      {},
      {},
      new Set(),
      {},
      {
        [session.id]: {
          sessionId: session.id,
          active: false,
          queueLength: 0,
          run: {
            id: 'run-1',
            sessionId: session.id,
            turnId: 'turn-1',
            phase: 'llm_streaming',
            status: 'interrupted_needs_retry',
            retryCount: 0,
            safeResume: true,
            startedAt: 1,
            updatedAt: 2,
            lastHeartbeatAt: 3,
          },
        },
      },
      {},
      {},
      new Map(),
    )).toBe('stopped');
  });
});

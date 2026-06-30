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
  it('does not infer pending for an architecture branch without typed runtime state', () => {
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
    )).toBeNull();
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

  it('lets a terminal architecture state override a stale active session snapshot after reconnect', () => {
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
      new Map([[branch.id, 'done']]),
    )).toBe('done');
  });

  it('lets a completed turn override stale queued state after reconnect', () => {
    const session = createSession({ id: 'session-queued', title: 'Queued stale' });

    expect(sessionRuntimeState(
      session,
      session.id,
      {},
      {},
      new Set([session.id]),
      { [session.id]: 1 },
      {},
      {
        [session.id]: [{
          id: 'turn-1',
          sessionId: session.id,
          items: [],
          done: true,
        }],
      },
      {},
      new Map(),
    )).toBe('done');
  });

  it('keeps a workflow envelope running even when the rebuilt host turn is already marked done', () => {
    const session = createSession({ id: 'session-host', title: 'Workflow host' });

    expect(sessionRuntimeState(
      session,
      session.id,
      {},
      {},
      new Set(),
      {},
      {},
      {
        [session.id]: [{
          id: 'turn-1',
          sessionId: session.id,
          turnKind: 'workflow-envelope',
          items: [],
          done: true,
        }],
      },
      {
        [session.id]: [{
          id: 'workflow-live',
          sessionId: session.id,
          role: 'assistant',
          content: '',
          createdAt: 1,
          architectureRun: {
            runId: 'run-live',
            schemaId: 'Strategic Decision Council',
            status: 'running',
            hostProjectionKind: 'workflow-envelope',
            trace: [],
            routeHops: [],
          },
        }],
      },
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

import { describe, expect, it } from 'vitest';
import type { ChatSession } from '@kalio/types';
import {
  displayTitleForSession,
  isPendingArchitecturePlaceholderSession,
  normalizeConversationSessionId,
  visibleConversationParentId,
} from './sessionTreeDisplay';

function createSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'session-abcdef',
    personaId: 'default',
    title: 'New Chat',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('displayTitleForSession', () => {
  it('falls back to the session id when title is blank whitespace', () => {
    const session = createSession({ title: '   ' });

    expect(displayTitleForSession(session, new Map())).toBe('Session sessio');
  });

  it('trims surrounding whitespace from the displayed title', () => {
    const session = createSession({ title: '  New Chat  ' });

    expect(displayTitleForSession(session, new Map())).toBe('New Chat');
  });

  it('keeps the parent New Chat title instead of inheriting an architecture child title', () => {
    const session = createSession({ id: 'host-123456', title: 'New Chat' });
    const childSessionsByParent = new Map<string, ChatSession[]>([
      [
        session.id,
        [createSession({ id: 'child-123456', title: 'Architecture: Runtime MVP proof', kind: 'agent-flow', parentSessionId: session.id })],
      ],
    ]);

    expect(displayTitleForSession(session, childSessionsByParent)).toBe('New Chat');
  });

  it('uses the workflow display label for architecture envelope sessions', () => {
    const session = createSession({
      id: 'arch-run-root',
      title: 'Architecture: What can you do?',
      parentSessionId: 'missing-host',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureContext: {
          architectureRunId: 'run-live',
          schemaName: 'Strategic Decision Council',
          displayLabel: 'Strategic Decision Council',
        },
      },
    });

    expect(displayTitleForSession(session, new Map())).toBe('Strategic Decision Council');
  });

  it('normalizes architecture envelope selections back to the host session', () => {
    const host = createSession({ id: 'host', title: 'Workflow host' });
    const envelope = createSession({
      id: 'arch-run-root',
      title: 'Architecture: What can you do?',
      parentSessionId: host.id,
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureContext: {
          architectureRunId: 'run-live',
          schemaName: 'Strategic Decision Council',
        },
      },
    });
    const branch = createSession({
      id: 'arch-run-analyst',
      title: 'Strategic Decision Council: Analyst',
      parentSessionId: envelope.id,
      kind: 'subagent',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureSlotId: 'analyst',
      },
    });

    expect(normalizeConversationSessionId(envelope.id, [host, envelope, branch])).toBe(host.id);
    expect(normalizeConversationSessionId(branch.id, [host, envelope, branch])).toBe(branch.id);
  });

  it('skips workflow containers and technical nodes when resolving a visible parent', () => {
    const host = createSession({ id: 'host', title: 'Workflow host' });
    const container = createSession({
      id: 'arch-root',
      title: 'Architecture: Strategic Decision Council',
      parentSessionId: host.id,
      runtimeContext: {
        runtimeKind: 'chat',
        architectureContext: {
          architectureRunId: 'run-live',
          schemaName: 'Strategic Decision Council',
          displayLabel: 'Strategic Decision Council',
          sessionSurface: 'technical-node',
        },
      },
    });
    const router = createSession({
      id: 'arch-router',
      title: 'Strategic Decision Council: Router',
      parentSessionId: container.id,
      kind: 'subagent',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureSlotId: 'router',
        architectureContext: {
          architectureRunId: 'run-live',
          roleSlotId: 'router',
          roleSlotType: 'router',
          displayLabel: 'Router',
          sessionSurface: 'technical-node',
        },
      },
    });
    const branch = createSession({
      id: 'arch-analyst',
      title: 'Strategic Decision Council: Analyst',
      parentSessionId: router.id,
      kind: 'subagent',
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

    expect(visibleConversationParentId(branch, new Map([
      [host.id, host],
      [container.id, container],
      [router.id, router],
      [branch.id, branch],
    ]))).toBe(host.id);
  });

  it('treats untouched pending architecture branches as sidebar placeholders', () => {
    const branch = createSession({
      id: 'arch-run-innovator',
      title: 'Strategic Decision Council: Innovator',
      kind: 'subagent',
      parentSessionId: 'arch-run-root',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        parentToolCallId: 'architecture:run-live:innovator',
        architectureSlotId: 'innovator',
      },
      createdAt: 10,
      updatedAt: 10,
    });

    expect(isPendingArchitecturePlaceholderSession(branch, new Map([[branch.id, 'pending']]), {})).toBe(true);
  });

  it('keeps started architecture branches visible once they have activity or a non-pending state', () => {
    const branch = createSession({
      id: 'arch-run-pragmatist',
      title: 'Strategic Decision Council: Pragmatist',
      kind: 'subagent',
      parentSessionId: 'arch-run-root',
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        parentToolCallId: 'architecture:run-live:pragmatist',
        architectureSlotId: 'pragmatist',
      },
      createdAt: 10,
      updatedAt: 10,
    });

    expect(isPendingArchitecturePlaceholderSession(branch, new Map([[branch.id, 'running']]), {})).toBe(false);
    expect(isPendingArchitecturePlaceholderSession(branch, new Map([[branch.id, 'pending']]), {
      [branch.id]: [{ id: 'm1', sessionId: branch.id, role: 'assistant', content: 'Started', createdAt: 11 }],
    })).toBe(false);
  });
});

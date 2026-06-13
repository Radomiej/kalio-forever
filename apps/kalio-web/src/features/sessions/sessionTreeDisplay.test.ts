import { describe, expect, it } from 'vitest';
import type { ChatSession } from '@kalio/types';
import { displayTitleForSession } from './sessionTreeDisplay';

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
});

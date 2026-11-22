import { describe, it, expect } from 'vitest';
import type { ChatSession } from '@kalio/types';
import { mergeSessionsPreservingLocal } from './mergeSessionsPreservingLocal';

describe('mergeSessionsPreservingLocal', () => {
  const session: ChatSession = {
    id: 's1', personaId: 'p1', title: 'Project chat', kind: 'chat', createdAt: 1, updatedAt: 20,
    executionProfileId: 'devin-fixture',
    runtimeContext: {
      runtimeKind: 'chat', explicitToolNames: ['fs_read', 'terminal_exec'],
      architectureSlotPolicy: { allowedToolNames: ['fs_read'], stripRequiresConfirmation: false },
      architectureContext: { executionCwd: '/synthetic', extra: { entries: [1, null, { enabled: true }] } },
    },
  };

  it('preserves equal session identity across fresh nested response objects', () => {
    const incoming: ChatSession = structuredClone(session);
    expect(mergeSessionsPreservingLocal([session], [incoming])[0]).toBe(session);
  });

  it('ignores object-key order without ignoring array order or nested extension values', () => {
    const incoming: ChatSession = { ...session, runtimeContext: {
      architectureContext: { extra: { entries: [1, null, { enabled: true }] }, executionCwd: '/synthetic' },
      architectureSlotPolicy: { stripRequiresConfirmation: false, allowedToolNames: ['fs_read'] },
      explicitToolNames: ['fs_read', 'terminal_exec'], runtimeKind: 'chat',
    } };
    expect(mergeSessionsPreservingLocal([session], [incoming])[0]).toBe(session);
  });

  it.each([
    { executionProfileId: 'other-profile' },
    { personaId: 'other-persona' },
    { title: 'Renamed' },
    { updatedAt: 21 },
    { projectId: 'other-project' },
    { parentTurnId: 'parent-turn' },
    { externalThreadId: 'new-thread' },
  ])('accepts changed session fields even when the activity timestamp is unchanged: %j', (patch) => {
    const incoming = { ...session, ...patch };
    const [merged] = mergeSessionsPreservingLocal([session], [incoming]);
    expect(merged).not.toBe(session);
    expect(merged).toEqual(incoming);
  });

  it.each([
    { runtimeKind: 'agent-flow-root' as const },
    { modelOverride: 'other-model' },
    { explicitToolNames: ['terminal_exec', 'fs_read'] },
    { architectureSlotPolicy: { allowedToolNames: ['terminal_exec'], stripRequiresConfirmation: true } },
    { architectureContext: { executionCwd: '/other-synthetic', extra: { entries: [1, null, { enabled: false }] } } },
    { architectureContext: { executionCwd: '/synthetic', extra: { entries: [1, null, { enabled: false }] } } },
    { architectureContext: { executionCwd: '/synthetic', extra: { entries: [null, 1, { enabled: true }] } } },
    { architectureContext: { executionCwd: '/synthetic' } },
  ])('preserves changes to the complete runtime context: %j', (patch) => {
    const incoming: ChatSession = { ...session, runtimeContext: { ...session.runtimeContext!, ...patch } };
    expect(mergeSessionsPreservingLocal([session], [incoming])[0]).toEqual(incoming);
    expect(mergeSessionsPreservingLocal([session], [incoming])[0]).not.toBe(session);
  });

  it('preserves local pending host sessions that are not present in the server response', () => {
    const pendingSession: ChatSession = {
      id: 'pending-host-session:temp-1',
      personaId: 'p1',
      title: 'New Chat',
      runtimeContext: {
        runtimeKind: 'chat',
        pendingHostSession: true,
      },
      createdAt: 10,
      updatedAt: 10,
    };
    const currentServerSession: ChatSession = {
      id: 'session-1',
      personaId: 'p1',
      title: 'Existing chat',
      createdAt: 1,
      updatedAt: 1,
    };
    const incomingServerSession: ChatSession = {
      ...currentServerSession,
      title: 'Existing chat refreshed',
      updatedAt: 20,
    };

    expect(mergeSessionsPreservingLocal(
      [pendingSession, currentServerSession],
      [incomingServerSession],
    )).toEqual([
      pendingSession,
      incomingServerSession,
    ]);
  });

  it('preserves typed local pending host sessions without relying on id prefixes', () => {
    const pendingSession: ChatSession = {
      id: 'local-temp-1',
      personaId: 'p1',
      title: 'New Chat',
      runtimeContext: {
        runtimeKind: 'chat',
        pendingHostSession: true,
      },
      createdAt: 10,
      updatedAt: 10,
    };
    const incomingServerSession: ChatSession = {
      id: 'session-1',
      personaId: 'p1',
      title: 'Existing chat',
      createdAt: 1,
      updatedAt: 20,
    };

    expect(mergeSessionsPreservingLocal([pendingSession], [incomingServerSession])).toEqual([
      pendingSession,
      incomingServerSession,
    ]);
  });

  it('keeps newer local session fields when the server response is stale', () => {
    const newerLocalSession: ChatSession = {
      id: 'session-1',
      personaId: 'p1',
      title: 'Renamed locally',
      createdAt: 1,
      updatedAt: 200,
    };
    const staleIncomingSession: ChatSession = {
      id: 'session-1',
      personaId: 'p1',
      title: 'Old server title',
      createdAt: 1,
      updatedAt: 100,
    };

    expect(mergeSessionsPreservingLocal(
      [newerLocalSession],
      [staleIncomingSession],
    )).toEqual([newerLocalSession]);
  });
});

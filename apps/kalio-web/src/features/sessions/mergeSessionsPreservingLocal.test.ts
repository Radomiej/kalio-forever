import { describe, it, expect } from 'vitest';
import type { ChatSession } from '@kalio/types';
import { mergeSessionsPreservingLocal } from './mergeSessionsPreservingLocal';

describe('mergeSessionsPreservingLocal', () => {
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

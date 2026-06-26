import { describe, expect, it } from 'vitest';
import type { SocketEvents } from '@kalio/types';
import { getSocketEventSessionId, isActionableSessionEvent } from './chat.gateway.event-routing';

describe('chat.gateway.event-routing', () => {
  describe('getSocketEventSessionId', () => {
    it('returns the session id only when payload.sessionId is a string', () => {
      expect(getSocketEventSessionId({ sessionId: 'session-1' })).toBe('session-1');
    });

    it('returns undefined for malformed or unrelated payloads', () => {
      const cases: unknown[] = [
        null,
        undefined,
        'session-1',
        42,
        [],
        {},
        { sessionId: 42 },
        { sessionId: null },
        { sessionId: { id: 'session-1' } },
        { requestId: 'req-1' },
      ];

      for (const payload of cases) {
        expect(getSocketEventSessionId(payload)).toBeUndefined();
      }
    });
  });

  describe('isActionableSessionEvent', () => {
    it('marks only immediate HITL approval events as actionable', () => {
      expect(isActionableSessionEvent('tool:confirmation_required')).toBe(true);
      expect(isActionableSessionEvent('agent:budget_required')).toBe(true);
    });

    it('does not mark normal lifecycle or tool events as actionable', () => {
      const nonActionable: Array<keyof SocketEvents> = [
        'session:updated',
        'tool:start',
        'tool:confirmation_invalidated',
        'agent:budget_invalidated',
      ];

      for (const event of nonActionable) {
        expect(isActionableSessionEvent(event)).toBe(false);
      }
    });
  });
});

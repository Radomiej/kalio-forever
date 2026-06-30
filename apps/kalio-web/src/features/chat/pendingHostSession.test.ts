import { describe, expect, it } from 'vitest';
import {
  createPendingHostSession,
  isPendingHostSession,
  isPendingHostSessionId,
} from './pendingHostSession';

describe('pendingHostSession', () => {
  it('does not infer pending host status from an arbitrary session id prefix', () => {
    expect(isPendingHostSessionId('pending-host-session:legacy-looking-id')).toBe(false);
  });

  it('recognizes locally created pending host placeholders without parsing the id', () => {
    const session = createPendingHostSession({
      personaId: 'default',
      now: 1,
    });

    expect(isPendingHostSessionId(session.id)).toBe(true);
    expect(isPendingHostSession(session)).toBe(true);
  });
});

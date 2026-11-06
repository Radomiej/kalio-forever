import { expect, it, vi } from 'vitest';
import { SessionEventsService } from './session-events.service';

it('publishes exact runtime payload once and unsubscribes without using lifecycle channels', () => {
  const bus = new SessionEventsService();
  const listener = vi.fn();
  const lifecycle = vi.fn();
  bus.onSessionCreated(lifecycle);
  const off = bus.onRuntimeEvent(listener);
  const payload = { sessionId: 'child', requestId: 'request', toolCallId: 'call',
    toolName: 'fs_write', args: { path: 'index.html', content: 'content' }, timeoutMs: 0 };
  bus.emitRuntimeEvent('tool:confirmation_required', payload);
  expect(listener).toHaveBeenCalledExactlyOnceWith('tool:confirmation_required', payload);
  expect(listener.mock.calls[0][1]).toBe(payload);
  expect(lifecycle).not.toHaveBeenCalled();
  off();
  bus.emitRuntimeEvent('tool:confirmation_required', payload);
  expect(listener).toHaveBeenCalledTimes(1);
});

import { describe, expect, it } from 'vitest';
import { KalioMcpBridgeContextRegistry } from './kalio-mcp-bridge-context';

describe('KalioMcpBridgeContextRegistry', () => {
  it('stores the current turn by Kalio session', () => {
    const registry = new KalioMcpBridgeContextRegistry();
    const context = { sessionId: 'session-1', turnId: 'turn-1' };
    registry.activate(context);
    expect(registry.get('session-1')).toEqual(context);
  });

  it('does not release a newer turn when an older prompt finishes late', () => {
    const registry = new KalioMcpBridgeContextRegistry();
    const releaseFirst = registry.activate({ sessionId: 'session-1', turnId: 'turn-1' });
    registry.activate({ sessionId: 'session-1', turnId: 'turn-2' });
    releaseFirst();
    expect(registry.get('session-1')?.turnId).toBe('turn-2');
  });

  it('clears the current turn without a stale context leak', () => {
    const registry = new KalioMcpBridgeContextRegistry();
    const release = registry.activate({ sessionId: 'session-1', turnId: 'turn-1' });
    release();
    expect(registry.get('session-1')).toBeUndefined();
  });
});

import type { ArchitectureExecutionEvent } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import { createArchitectureRuntimeAutoRoutingHooks } from './architecture-runtime-auto-routing-hooks';

describe('auto-route persistence during Stop', () => {
  it('keeps the persisted event identity and sequence unchanged after a late write', async () => {
    let stopped = false;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const event: ArchitectureExecutionEvent = {
      id: 'checkpoint:event', runId: 'run', sequence: 3, type: 'router_decision',
      message: 'Continue', createdAt: 3,
      data: { kind: 'auto_routing_decision', autoRoutingVisit: 1 },
    };
    let stored: ArchitectureExecutionEvent | undefined;
    const retained: ArchitectureExecutionEvent[] = [];
    const hooks = createArchitectureRuntimeAutoRoutingHooks({
      emittedEvents: [], getEvents: () => stopped ? [{
        id: 'stop-event', runId: 'run', sequence: 4, type: 'run_stopped', message: 'Stop', createdAt: 4,
      }] : [],
      isStopped: () => stopped,
      persistDecision: async (decision) => { stored = structuredClone(decision); await barrier; },
      persistStoppedEvent: (decision) => { retained.push(decision); },
      onLiveEvent: () => { throw new Error('No live event after Stop'); },
    });
    const writing = hooks.persistAutoRouteDecision(event, 'checkpoint');
    stopped = true;
    release();
    await writing;
    hooks.onEvent(event);
    expect(retained[0]).toEqual(stored);
    expect(() => hooks.onEvent({ ...event, id: 'next', type: 'node_started', data: {} })).toThrow('stopped');
  });
});

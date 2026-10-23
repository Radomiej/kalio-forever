import type { ArchitectureExecutionEvent } from '@kalio/types';
import type { ArchitectureAutoRoutingInput, ArchitectureAutoRoutingService } from './architecture-auto-routing.service';

export function createArchitectureRuntimeAutoRoutingHooks(input: {
  signal?: AbortSignal;
  autoRouting?: ArchitectureAutoRoutingService;
  emittedEvents: ArchitectureExecutionEvent[];
  getEvents: () => ArchitectureExecutionEvent[];
  isStopped: () => boolean;
  persistDecision: (event: ArchitectureExecutionEvent, checkpointId: string) => Promise<void>;
  reserveDecisionSequence?: (sequence: number) => void;
  persistStoppedEvent: (event: ArchitectureExecutionEvent) => void;
  onLiveEvent: (event: ArchitectureExecutionEvent) => void;
}) {
  return {
    chooseAutoRoute: input.autoRouting
      ? (choice: ArchitectureAutoRoutingInput) => {
        input.signal?.throwIfAborted();
        return input.autoRouting!.choose({ ...choice, signal: input.signal });
      } : undefined,
    persistAutoRouteDecision: async (event: ArchitectureExecutionEvent, checkpointId: string) => {
      input.signal?.throwIfAborted();
      input.reserveDecisionSequence?.(event.sequence);
      await input.persistDecision(event, checkpointId);
      // A write already in progress can finish after Stop; its persisted identity is immutable.
    },
    onEvent: (event: ArchitectureExecutionEvent) => {
      const stopped = input.isStopped();
      const decision = event.data?.['kind'] === 'auto_routing_decision';
      if (stopped && !decision) throw new Error('Architecture run was stopped by the user.');
      input.emittedEvents.push(event);
      if (stopped) input.persistStoppedEvent(event);
      else input.onLiveEvent(event);
    },
  };
}

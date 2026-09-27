import type { ArchitectureExecutionEvent, ArchitectureRun } from '@kalio/types';
import type {
  ArchitectureAutoRoutingChoice,
  ArchitectureAutoRoutingInput,
  ArchitectureAutoRoutingService,
} from './architecture-auto-routing.service';
import { assignNextArchitectureEventSequence } from './architecture-runtime-auto-routing-recovery.utils';

export function createArchitectureRuntimeAutoRoutingHooks(input: {
  run: ArchitectureRun;
  signal?: AbortSignal;
  autoRouting?: ArchitectureAutoRoutingService;
  emittedEvents: ArchitectureExecutionEvent[];
  liveEvents?: ArchitectureExecutionEvent[];
  getEvents: () => ArchitectureExecutionEvent[];
  isStopped: () => boolean;
  persistDecision: (event: ArchitectureExecutionEvent, checkpointId: string) => Promise<void>;
  persistStoppedEvent: (event: ArchitectureExecutionEvent) => void;
  updateRun: () => void;
  logEvent: (event: ArchitectureExecutionEvent) => void;
}): {
  chooseAutoRoute?: (choice: ArchitectureAutoRoutingInput) => Promise<ArchitectureAutoRoutingChoice>;
  persistAutoRouteDecision: (event: ArchitectureExecutionEvent, checkpointId: string) => Promise<void>;
  onEvent: (event: ArchitectureExecutionEvent) => void;
} {
  let reservedRouteSequence = Math.max(0, ...input.getEvents().map((event) => event.sequence));
  return {
    chooseAutoRoute: input.autoRouting
      ? (choice) => input.autoRouting!.choose({ ...choice, signal: input.signal })
      : undefined,
    persistAutoRouteDecision: async (event, checkpointId) => {
      if (input.isStopped()) {
        reservedRouteSequence = assignNextArchitectureEventSequence(
          event,
          input.getEvents(),
          reservedRouteSequence,
        );
      }
      await input.persistDecision(event, checkpointId);
    },
    onEvent: (event) => {
      const stopped = input.isStopped();
      const isRouteDecision = typeof event.data?.['autoRoutingVisit'] === 'number';
      if (stopped && !isRouteDecision) {
        throw new Error(`Architecture run ${input.run.id} was stopped by the user.`);
      }
      input.emittedEvents.push(event);
      if (!input.liveEvents) return;
      if (stopped) {
        input.persistStoppedEvent(event);
        return;
      }
      input.updateRun();
      if (!isRouteDecision) input.logEvent(event);
    },
  };
}

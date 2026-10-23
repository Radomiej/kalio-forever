import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import type { ArchitectureExecutionEvent, ArchitectureRun, ArchitectureSchema } from '@kalio/types';
import { architectureActionSummaryForEvent } from './architecture-action-summary';

export function requiresGoalStopAck(run: ArchitectureRun): boolean {
  return run.goalPacket !== undefined || !!run.context && Object.hasOwn(run.context, 'goalProtocol');
}

/** Durable cancellation inside the run barrier. The caller signals live Stop
 * synchronously before entering this operation and drains only after it exits. */
export async function persistArchitectureStop(id: string, host: {
  findRun: () => Promise<ArchitectureRun | null>;
  getEvents: () => Promise<ArchitectureExecutionEvent[]>;
  reservedSequence: () => number;
  markStopped: () => void;
  recordRun: (run: ArchitectureRun) => void;
  recordEvents: (events: ArchitectureExecutionEvent[]) => void;
  findSchema: (run: ArchitectureRun) => ArchitectureSchema | undefined;
  persist: (schema: ArchitectureSchema, run: ArchitectureRun, event: ArchitectureExecutionEvent,
    events: ArchitectureExecutionEvent[], replayed?: boolean) => Promise<void>;
}): Promise<ArchitectureRun> {
  const run = await host.findRun();
  if (!run) throw new NotFoundException(`Architecture run ${id} not found`);
  if (run.status === 'cancelled' && run.reasonCode === 'user_stop') {
    if (requiresGoalStopAck(run)) {
      const events = await host.getEvents();
      const event = [...events].reverse().find(row => row.type === 'run_stopped' && row.runId === id);
      const schema = host.findSchema(run);
      if (!event || !schema) throw new Error('GOAL_STOP_ACK_UNAVAILABLE');
      await host.persist(schema, run, event, events, true);
    }
    return run;
  }
  const now = Date.now();
  const stoppedRun: ArchitectureRun = { ...run, status: 'cancelled', reasonCode: 'user_stop',
    updatedAt: now, completedAt: now };
  host.markStopped();
  host.recordRun(stoppedRun);
  const events = await host.getEvents();
  const stopEvent: ArchitectureExecutionEvent = {
    id: `${id}:stop:${randomUUID()}`, runId: id,
    sequence: Math.max(host.reservedSequence(), ...events.map(event => event.sequence)) + 1,
    type: 'run_stopped', message: 'Architecture run stopped by user.',
    actionSummary: architectureActionSummaryForEvent('run_stopped'), reasonCode: 'user_stop',
    data: { reasonCode: 'user_stop', stoppedByUser: true, previousStatus: run.status, source: 'user' },
    createdAt: now,
  };
  const nextEvents = [...events, stopEvent];
  host.recordEvents(nextEvents);
  const schema = host.findSchema(stoppedRun);
  if (!schema && requiresGoalStopAck(stoppedRun)) throw new Error('GOAL_STOP_ACK_UNAVAILABLE');
  if (schema) await host.persist(schema, stoppedRun, stopEvent, nextEvents);
  return stoppedRun;
}

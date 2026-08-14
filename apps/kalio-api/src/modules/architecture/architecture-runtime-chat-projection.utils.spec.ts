import type { ArchitectureExecutionEvent } from '@kalio/types';
import { describe, expect, it } from 'vitest';

import { buildArchitectureRuntimeChatProjection } from './architecture-runtime-chat-projection.utils';

function event(partial: Partial<ArchitectureExecutionEvent>): ArchitectureExecutionEvent {
  return {
    id: partial.id ?? 'event-1',
    runId: partial.runId ?? 'run-1',
    sequence: partial.sequence ?? 1,
    type: partial.type ?? 'participant_output',
    message: partial.message ?? 'message',
    createdAt: partial.createdAt ?? 1,
    ...partial,
  };
}

describe('buildArchitectureRuntimeChatProjection', () => {
  it('projects only chat-visible events with typed speakers and action fields', () => {
    const projection = buildArchitectureRuntimeChatProjection('run-1', [
      event({ id: 'created', type: 'run_created', message: 'Run created', createdAt: 1 }),
      event({ id: 'node-started', type: 'node_started', message: 'Node started', createdAt: 2 }),
      event({
        id: 'participant',
        type: 'participant_output',
        message: 'Participant answer',
        roleSlotId: 'researcher',
        data: { incompleteReason: '  partial evidence  ' },
        createdAt: 3,
      }),
      event({
        id: 'router',
        type: 'router_decision',
        message: 'Router chose finalizer',
        route: {
          source: 'router',
          fromNodeId: 'router',
          nextNodeId: 'finalizer',
          selectedNodeIds: ['finalizer'],
        },
        createdAt: 4,
      }),
      event({
        id: 'final',
        type: 'final_artifact',
        message: 'Final answer',
        action: 'finalizer_completed',
        detail: 'done',
        actionSummary: 'Final answer produced',
        createdAt: 5,
      }),
      event({ id: 'stopped', type: 'run_stopped', message: 'Stopped by user', createdAt: 6 }),
    ]);

    expect(projection.runId).toBe('run-1');
    expect(projection.messages).toHaveLength(5);
    expect(projection.messages.map((message) => message.eventId)).toEqual([
      'created',
      'participant',
      'router',
      'final',
      'stopped',
    ]);
    expect(projection.messages.map((message) => message.speaker)).toEqual([
      'system',
      'participant',
      'router',
      'finalizer',
      'system',
    ]);
    expect(projection.messages[1]).toMatchObject({
      id: 'participant:message',
      roleSlotId: 'researcher',
      incompleteReason: '  partial evidence  ',
    });
    expect(projection.messages[2]?.route).toEqual({
      source: 'router',
      fromNodeId: 'router',
      nextNodeId: 'finalizer',
      selectedNodeIds: ['finalizer'],
    });
    expect(projection.messages[3]).toMatchObject({
      action: 'finalizer_completed',
      detail: 'done',
      actionSummary: 'Final answer produced',
    });
  });

  it('does not project blank or non-string incomplete reasons', () => {
    const projection = buildArchitectureRuntimeChatProjection('run-1', [
      event({ id: 'blank', data: { incompleteReason: '   ' } }),
      event({ id: 'non-string', data: { incompleteReason: 123 } }),
    ]);

    expect(projection.messages.map((message) => message.incompleteReason)).toEqual([undefined, undefined]);
  });
});

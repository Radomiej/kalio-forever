import { describe, expect, it } from 'vitest';
import type { ArchitectureExecutionEvent } from '@kalio/types';
import {
  budgetApprovalFromArchitectureEvent,
  budgetApprovalsBySessionFromArchitectureEvents,
} from './architectureBudgetApprovalProjection';

describe('architectureBudgetApprovalProjection', () => {
  it('projects typed budget HITL events without reading display text', () => {
    const event: ArchitectureExecutionEvent = {
      id: 'event-budget',
      runId: 'run-1',
      sequence: 3,
      type: 'human_gate',
      message: 'Any display text can change.',
      nodeId: 'pragmatist',
      roleSlotId: 'pragmatist',
      createdAt: 3,
      data: {
        kind: 'branch_stream',
        event: 'agent:budget_required',
        sessionId: 'arch-pragmatist',
        requestId: 'budget-1',
        usedIterations: 1,
        currentLimit: 1,
        suggestedNextLimit: 11,
        requestedBy: 'pragmatist',
      },
    };

    expect(budgetApprovalFromArchitectureEvent(event, 'arch-pragmatist')).toEqual({
      requestId: 'budget-1',
      sessionId: 'arch-pragmatist',
      scope: 'agent-flow-branch',
      usedIterations: 1,
      currentLimit: 1,
      suggestedNextLimit: 11,
      requestedBy: 'pragmatist',
      nodeId: 'pragmatist',
      roleSlotId: 'pragmatist',
    });
  });

  it('groups projected approvals by their owning child session', () => {
    const events: ArchitectureExecutionEvent[] = [
      {
        id: 'event-a',
        runId: 'run-1',
        sequence: 1,
        type: 'human_gate',
        message: '',
        createdAt: 1,
        data: {
          event: 'agent:budget_required',
          sessionId: 'child-a',
          requestId: 'budget-a',
          usedIterations: 30,
          currentLimit: 30,
        },
      },
      {
        id: 'event-b',
        runId: 'run-1',
        sequence: 2,
        type: 'human_gate',
        message: '',
        createdAt: 2,
        data: {
          event: 'agent:budget_required',
          sessionId: 'child-b',
          requestId: 'budget-b',
          usedIterations: 30,
          currentLimit: 30,
        },
      },
    ];

    expect([...budgetApprovalsBySessionFromArchitectureEvents(events).keys()]).toEqual(['child-a', 'child-b']);
  });
});

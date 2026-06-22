import { describe, expect, it } from 'vitest';
import type { ArchitectureExecutionEvent } from '@kalio/types';
import { summarizeArchitectureIncomingEvent } from './architecture-incoming-event-summary';

function event(overrides: Partial<ArchitectureExecutionEvent>): ArchitectureExecutionEvent {
  return {
    id: 'run:event:1',
    runId: 'run',
    sequence: 1,
    type: 'participant_output',
    message: 'Participant output.',
    createdAt: 1,
    ...overrides,
  };
}

describe('summarizeArchitectureIncomingEvent', () => {
  it('compacts recursive prompt echoes before they reach the finalizer', () => {
    const summary = summarizeArchitectureIncomingEvent(
      event({
        message: [
          '[MockLLM] Echo: Architecture: Strategic Decision Council v0.1.0',
          'Slot: Router (router)',
          'Node: Router (router)',
          'Task: Oceń architekturę projektu',
          '',
          'Incoming graph outputs:',
          '- analyst: very long previous prompt that should not be repeated',
          '',
          'Available next nodes: final-artifact',
          '',
          'Context: {"hostSessionId":"host"}',
        ].join('\n'),
      }),
      'finalizer',
    );

    expect(summary).toContain('Slot: Router');
    expect(summary).not.toContain('very long previous prompt');
    expect(summary).not.toContain('Available next nodes');
    expect(summary.length).toBeLessThanOrEqual(360);
  });

  it('uses routerOutput as the durable compact decision summary', () => {
    const summary = summarizeArchitectureIncomingEvent(
      event({
        type: 'router_output',
        message: 'Huge router prose that should be secondary.',
        routerOutput: {
          selectedStrategy: 'final-artifact',
          mergedDecision: 'Use the accepted implementation path and finalize.',
          acceptedInputs: [
            { fromSlot: 'pragmatist', insight: 'small step', whyAccepted: 'lowest risk' },
            { fromSlot: 'analyst', insight: 'evidence', whyAccepted: 'specific proof' },
          ],
          rejectedInputs: [],
          unresolvedConflicts: [],
          risks: [],
          confidence: 0.75,
          nextAction: 'finalize',
        },
      }),
      'finalizer',
    );

    expect(summary).toBe('final-artifact: Use the accepted implementation path and finalize. [accepted=2, rejected=0 confidence=75% next=finalize]');
  });
});

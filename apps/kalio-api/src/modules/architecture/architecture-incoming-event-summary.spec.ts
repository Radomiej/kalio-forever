import { describe, expect, it } from 'vitest';
import type { ArchitectureExecutionEvent } from '@kalio/types';
import {
  summarizeArchitectureIncomingEvent,
  summarizeArchitectureIncomingHandoffPacket,
} from './architecture-incoming-event-summary';

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
    expect(summary.length).toBeLessThanOrEqual(700);
  });

  it('uses routerOutput as the durable downstream handoff summary', () => {
    const summary = summarizeArchitectureIncomingEvent(
      event({
        type: 'router_output',
        message: 'Huge router prose that should be secondary.',
        routerOutput: {
          selectedStrategy: 'final-artifact',
          mergedDecision: 'Use the accepted implementation path and finalize.',
          acceptedInputs: [
            { fromSlot: 'pragmatist', insight: 'Backend modularity is strong.', whyAccepted: 'lowest risk' },
            { fromSlot: 'analyst', insight: 'Frontend uses localStorage auth and behaves like SPA.', whyAccepted: 'specific proof' },
          ],
          rejectedInputs: [
            { fromSlot: 'shadow', insight: 'Rewrite everything now.', whyRejected: 'too disruptive' },
          ],
          unresolvedConflicts: ['Need exact release scope before implementation.'],
          risks: [{ risk: 'Weak frontend auth guidance', mitigation: 'Call out Next.js server-side boundary', sourceSlot: 'analyst' }],
          confidence: 0.75,
          nextAction: 'route_to',
          targetNodeId: 'final-artifact',
          response: 'Finalize in Polish with recommendation, evidence, risks, and next step.',
        },
      }),
      'finalizer',
    );

    expect(summary).toContain('final-artifact: Use the accepted implementation path and finalize.');
    expect(summary).toContain('[accepted=2, rejected=1 confidence=75% next=route_to:final-artifact]');
    expect(summary).toContain('accepted=pragmatist: Backend modularity is strong.');
    expect(summary).toContain('analyst: Frontend uses localStorage auth');
    expect(summary).toContain('rejected=shadow: Rewrite everything now.');
    expect(summary).toContain('conflicts=Need exact release scope');
    expect(summary).toContain('risks=Weak frontend auth guidance -> Call out Next.js server-side boundary');
    expect(summary).toContain('handoff=Finalize in Polish with recommendation');
  });

  it('builds a downstream handoff packet from nested routerOutput and route fallback target', () => {
    const packet = summarizeArchitectureIncomingHandoffPacket(event({
      type: 'router_decision',
      message: 'Router selected the implementer path.',
      nodeId: 'router-node',
      roleSlotId: 'router',
      route: { nextNodeId: 'implementer' } as ArchitectureExecutionEvent['route'],
      data: {
        routerOutput: {
          mergedDecision: 'Route implementation to the implementer branch.',
          acceptedInputs: [
            { fromSlot: 'backend', insight: 'API contract already exists.', whyAccepted: 'ready for implementation' },
          ],
          rejectedInputs: [],
          unresolvedConflicts: ['Need to keep the release scope narrow.'],
          risks: [{ risk: 'UI copy may drift.', mitigation: 'Mirror backend labels.', sourceSlot: 'frontend' }],
          confidence: 0.6,
          nextAction: 'route_to',
          response: 'Implement the runtime patch and keep the diff minimal.',
        },
      },
    }));

    expect(packet).toContain('from=router target=implementer action=route_to confidence=60%');
    expect(packet).toContain('response=Implement the runtime patch and keep the diff minimal.');
    expect(packet).toContain('accepted=backend: API contract already exists. (ready for implementation)');
    expect(packet).toContain('conflicts=Need to keep the release scope narrow.');
    expect(packet).toContain('risks=frontend: UI copy may drift. -> Mirror backend labels.');
  });
});

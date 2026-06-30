import { describe, expect, it } from 'vitest';
import { routerOutputFromStructuredOutput, structuredRouteToCall } from './architecture-structured-output';

describe('architecture structured output', () => {
  it('preserves typed non-routing router decisions from provider structured output', () => {
    const output = {
      selectedStrategy: 'final-artifact',
      mergedDecision: 'Merge accepted implementation evidence.',
      acceptedInputs: [
        {
          fromSlot: 'implementer',
          insight: 'Build passed after the fix.',
          whyAccepted: 'Typed build evidence was present.',
          whyRejected: null,
        },
      ],
      rejectedInputs: [
        {
          fromSlot: 'critic',
          insight: 'Request another broad rewrite.',
          whyAccepted: null,
          whyRejected: 'No typed blocker was present.',
        },
      ],
      unresolvedConflicts: ['QA notes are advisory, not blocking.'],
      risks: [
        {
          risk: 'Regression may reappear.',
          mitigation: 'Keep the runtime contract test.',
          sourceSlot: 'critic',
        },
      ],
      confidence: 0.87,
      nextAction: 'finalize',
      targetNodeId: null,
      response: 'Finalize the typed evidence.',
    };

    expect(routerOutputFromStructuredOutput(output)).toEqual({
      selectedStrategy: 'final-artifact',
      mergedDecision: 'Merge accepted implementation evidence.',
      acceptedInputs: [
        {
          fromSlot: 'implementer',
          insight: 'Build passed after the fix.',
          whyAccepted: 'Typed build evidence was present.',
        },
      ],
      rejectedInputs: [
        {
          fromSlot: 'critic',
          insight: 'Request another broad rewrite.',
          whyRejected: 'No typed blocker was present.',
        },
      ],
      unresolvedConflicts: ['QA notes are advisory, not blocking.'],
      risks: output.risks,
      confidence: 0.87,
      nextAction: 'finalize',
      response: 'Finalize the typed evidence.',
    });
    expect(structuredRouteToCall(output)).toBeNull();
  });
});

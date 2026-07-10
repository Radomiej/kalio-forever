import { describe, expect, it } from 'vitest';
import {
  finalArtifactContractFromStructuredOutput,
  routerOutputFromStructuredOutput,
  structuredRouteToCall,
} from './architecture-structured-output';

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

  it('does not convert ask-human targets into route calls', () => {
    const output = {
      selectedStrategy: 'reviewer',
      mergedDecision: 'Human approval is required before Reviewer runs.',
      acceptedInputs: [],
      rejectedInputs: [],
      unresolvedConflicts: ['Router cannot safely choose the next node.'],
      risks: [],
      confidence: 0.2,
      nextAction: 'ask_human',
      targetNodeId: 'reviewer',
      response: 'Human approval is required before Reviewer runs.',
    };

    expect(routerOutputFromStructuredOutput(output)).toMatchObject({
      nextAction: 'ask_human',
      targetNodeId: 'reviewer',
    });
    expect(structuredRouteToCall(output)).toBeNull();
  });

  it('rejects malformed router and finalizer control objects', () => {
    expect(routerOutputFromStructuredOutput({
      nextAction: 'route_to',
      targetNodeId: 123,
      response: 'bad route root',
    })).toEqual({
      selectedStrategy: 'route_to',
      mergedDecision: 'bad route root',
      acceptedInputs: [],
      rejectedInputs: [],
      unresolvedConflicts: [],
      risks: [],
      confidence: 1,
      nextAction: 'route_to',
      response: 'bad route root',
    });
    expect(structuredRouteToCall({
      nextAction: 'route_to',
      targetNodeId: 123,
      response: 'bad route root',
    })).toBeNull();
    expect(finalArtifactContractFromStructuredOutput({
      answer: 'missing status',
    })).toBeNull();
  });
});

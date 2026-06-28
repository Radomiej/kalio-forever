import type { ArchitectureRoleSlot, LLMStructuredOutputRequest } from '@kalio/types';

const insightSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    fromSlot: { type: 'string' },
    insight: { type: 'string' },
    whyAccepted: { type: ['string', 'null'] },
    whyRejected: { type: ['string', 'null'] },
  },
  required: ['fromSlot', 'insight', 'whyAccepted', 'whyRejected'],
} satisfies Record<string, unknown>;

const riskSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    risk: { type: 'string' },
    mitigation: { type: 'string' },
    sourceSlot: { type: 'string' },
  },
  required: ['risk', 'mitigation', 'sourceSlot'],
} satisfies Record<string, unknown>;

const routerStructuredOutput: LLMStructuredOutputRequest = {
  name: 'architecture_router_output',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      selectedStrategy: { type: 'string' },
      mergedDecision: { type: 'string' },
      acceptedInputs: { type: 'array', items: insightSchema },
      rejectedInputs: { type: 'array', items: insightSchema },
      unresolvedConflicts: { type: 'array', items: { type: 'string' } },
      risks: { type: 'array', items: riskSchema },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      nextAction: {
        type: 'string',
        enum: ['finalize', 'ask_human', 'route_to', 'run_more_research', 'rerun_with_different_personas'],
      },
      targetNodeId: { type: ['string', 'null'] },
      response: { type: ['string', 'null'] },
    },
    required: [
      'selectedStrategy',
      'mergedDecision',
      'acceptedInputs',
      'rejectedInputs',
      'unresolvedConflicts',
      'risks',
      'confidence',
      'nextAction',
      'targetNodeId',
      'response',
    ],
  },
};

const finalArtifactStructuredOutput: LLMStructuredOutputRequest = {
  name: 'architecture_final_artifact',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', enum: ['accepted', 'blocked', 'rejected', 'incomplete'] },
      blockingReason: { type: ['string', 'null'] },
      evidence: { type: 'array', items: { type: 'string' } },
      answer: { type: 'string' },
    },
    required: ['status', 'blockingReason', 'evidence', 'answer'],
  },
};

export function structuredOutputForArchitectureSlot(
  slot: ArchitectureRoleSlot,
): LLMStructuredOutputRequest | undefined {
  if (slot.slotType === 'router' || slot.slotType === 'judge') {
    return routerStructuredOutput;
  }
  if (slot.slotType === 'finalizer') {
    return finalArtifactStructuredOutput;
  }
  return undefined;
}

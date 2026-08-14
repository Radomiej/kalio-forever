import { describe, expect, it } from 'vitest';
import { parseStructuredOutputResponse } from './structured-output.parser';
import type { LLMStructuredOutputRequest } from '@kalio/types';

const routerOutputRequest: LLMStructuredOutputRequest = {
  name: 'architecture_router_output',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      nextAction: { const: 'route_to' },
      targetNodeId: { type: 'string' },
    },
    required: ['nextAction', 'targetNodeId'],
  },
};

const fullRouterOutputRequest: LLMStructuredOutputRequest = {
  name: 'architecture_router_output',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      selectedStrategy: { type: 'string' },
      mergedDecision: { type: 'string' },
      acceptedInputs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            fromSlot: { type: 'string' },
            insight: { type: 'string' },
            whyAccepted: { type: ['string', 'null'] },
            whyRejected: { type: ['string', 'null'] },
          },
          required: ['fromSlot', 'insight', 'whyAccepted', 'whyRejected'],
        },
      },
      rejectedInputs: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      nextAction: { type: 'string', enum: ['finalize', 'route_to'] },
      targetNodeId: { type: ['string', 'null'] },
    },
    required: [
      'selectedStrategy',
      'mergedDecision',
      'acceptedInputs',
      'rejectedInputs',
      'confidence',
      'nextAction',
      'targetNodeId',
    ],
  },
};

describe('parseStructuredOutputResponse', () => {
  it('parses strict JSON that matches the requested schema', () => {
    expect(parseStructuredOutputResponse(
      '{"nextAction":"route_to","targetNodeId":"researcher"}',
      routerOutputRequest,
    )).toEqual({
      value: { nextAction: 'route_to', targetNodeId: 'researcher' },
      mode: 'strict',
    });
  });

  it('extracts fenced JSON from prose when it matches the requested schema', () => {
    expect(parseStructuredOutputResponse(
      'Sure.\n```json\n{"nextAction":"route_to","targetNodeId":"implementer"}\n```',
      routerOutputRequest,
    )).toEqual({
      value: { nextAction: 'route_to', targetNodeId: 'implementer' },
      mode: 'extracted',
    });
  });

  it('unwraps known root objects only when their nested value matches the schema', () => {
    expect(parseStructuredOutputResponse(
      '{"routerOutput":{"nextAction":"route_to","targetNodeId":"finalizer"}}',
      routerOutputRequest,
    )).toEqual({
      value: { nextAction: 'route_to', targetNodeId: 'finalizer' },
      mode: 'unwrapped',
    });
  });

  it('rejects wrapper roots with conflicting sibling fields', () => {
    expect(parseStructuredOutputResponse(
      '{"routerOutput":{"nextAction":"route_to","targetNodeId":"finalizer"},"error":"do not route"}',
      routerOutputRequest,
    )).toMatchObject({
      reason: 'schema_mismatch',
    });
  });

  it('rejects extracted output when multiple schema-valid JSON candidates are present', () => {
    expect(parseStructuredOutputResponse(
      [
        'Example: {"nextAction":"route_to","targetNodeId":"example"}',
        'Answer: {"nextAction":"route_to","targetNodeId":"actual"}',
      ].join('\n'),
      routerOutputRequest,
    )).toMatchObject({
      reason: 'schema_mismatch',
      details: expect.stringContaining('multiple schema-valid JSON candidates'),
    });
  });

  it('rejects parseable JSON that does not match the schema', () => {
    expect(parseStructuredOutputResponse(
      '{"nextAction":"route_to"}',
      routerOutputRequest,
    )).toMatchObject({
      reason: 'schema_mismatch',
      preview: '{"nextAction":"route_to"}',
    });
  });

  it('accepts the nested router contract used by architecture workflow nodes', () => {
    expect(parseStructuredOutputResponse(
      JSON.stringify({
        selectedStrategy: 'direct',
        mergedDecision: 'Route with enough evidence.',
        acceptedInputs: [{
          fromSlot: 'analyst',
          insight: 'The backend exposes a typed graph projection.',
          whyAccepted: 'Typed evidence',
          whyRejected: null,
        }],
        rejectedInputs: [],
        confidence: 0.82,
        nextAction: 'route_to',
        targetNodeId: 'finalizer',
      }),
      fullRouterOutputRequest,
    )).toMatchObject({
      mode: 'strict',
      value: expect.objectContaining({
        nextAction: 'route_to',
        targetNodeId: 'finalizer',
      }),
    });
  });

  it('rejects nested router evidence with unexpected fields', () => {
    expect(parseStructuredOutputResponse(
      JSON.stringify({
        selectedStrategy: 'direct',
        mergedDecision: 'Route with enough evidence.',
        acceptedInputs: [{
          fromSlot: 'analyst',
          insight: 'The backend exposes a typed graph projection.',
          whyAccepted: 'Typed evidence',
          whyRejected: null,
          displayOnlyStatus: 'completed',
        }],
        rejectedInputs: [],
        confidence: 0.82,
        nextAction: 'route_to',
        targetNodeId: 'finalizer',
      }),
      fullRouterOutputRequest,
    )).toMatchObject({
      reason: 'schema_mismatch',
      details: expect.stringContaining('displayOnlyStatus'),
    });
  });

  it('rejects router confidence outside the typed contract range', () => {
    expect(parseStructuredOutputResponse(
      JSON.stringify({
        selectedStrategy: 'direct',
        mergedDecision: 'Route with enough evidence.',
        acceptedInputs: [],
        rejectedInputs: [],
        confidence: 1.5,
        nextAction: 'route_to',
        targetNodeId: 'finalizer',
      }),
      fullRouterOutputRequest,
    )).toMatchObject({
      reason: 'schema_mismatch',
      details: expect.stringContaining('/confidence'),
    });
  });

  it('rejects text without a balanced JSON candidate', () => {
    expect(parseStructuredOutputResponse(
      'I cannot produce the requested object.',
      routerOutputRequest,
    )).toEqual({
      reason: 'invalid_json',
      preview: 'I cannot produce the requested object.',
    });
  });
});

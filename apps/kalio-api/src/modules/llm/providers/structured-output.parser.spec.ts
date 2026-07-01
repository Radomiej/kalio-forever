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

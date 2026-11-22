import { describe, expect, it } from 'vitest';
import type { LLMStructuredOutputRequest } from '@kalio/types';
import { DevinStructuredOutput, DEVIN_FINAL_JSON_MAX_CHARS } from './devin-structured-output';

function create(schema: Record<string, unknown>): DevinStructuredOutput {
  return new DevinStructuredOutput({ name: 'fixture', strict: true, schema });
}

describe('Devin strict host-validated JSON', () => {
  it('supports full schema constraints and local references', () => {
    const output = create({ type: 'object', additionalProperties: false,
      definitions: { label: { type: 'string', minLength: 3, pattern: '^ok-' } },
      properties: { label: { $ref: '#/definitions/label' } }, required: ['label'] });
    output.onText('{"label":"ok-reviewed"}');
    expect(output.result()).toEqual({ label: 'ok-reviewed' });
  });

  it.each([
    [{ type: 'string', minLength: 3 }, '"x"'],
    [{ type: 'array', minItems: 2, items: { type: 'integer' } }, '[1]'],
    [{ oneOf: [{ type: 'string' }, { type: 'number' }] }, 'true'],
    [{ type: 'integer' }, '"2"'],
    [{ type: 'object', required: ['x'], properties: { x: { type: 'string', default: 'x' } } }, '{}'],
    [{ type: 'object', additionalProperties: false, properties: {} }, '{"extra":1}'],
  ] satisfies [Record<string, unknown>, string][])('rejects schema mismatch without mutation: %j', (schema, text) => {
    const output = create(schema);
    output.onText(text);
    expect(() => output.result()).toThrow(expect.objectContaining({ code: 'LLM_BAD_STRUCTURED_OUTPUT' }));
  });

  it.each(['prefix {}', '```json\n{}\n```', '{} {}', '{"output":{}}'])('never extracts or unwraps %s', text => {
    const output = create({ type: 'object', properties: {}, additionalProperties: false });
    output.onText(text);
    expect(() => output.result()).toThrow();
  });

  it('accepts the exact size limit and rejects one extra raw character', () => {
    const text = JSON.stringify('x'.repeat(DEVIN_FINAL_JSON_MAX_CHARS - 2));
    const output = create({ type: 'string' });
    output.onText(text);
    expect(output.result()).toHaveLength(DEVIN_FINAL_JSON_MAX_CHARS - 2);
    const oversized = create({ type: 'string' });
    oversized.onText(text + ' ');
    expect(() => oversized.result()).toThrow();
  });

  it('snapshots schema before an external mutation', () => {
    const schema = { type: 'string', enum: ['allowed'] };
    const output = create(schema);
    schema.enum.push('injected');
    output.onText('"injected"');
    expect(() => output.result()).toThrow();
  });

  it('invalidates a sealed result on late text, without leaking the raw value in errors', () => {
    const output = create({ type: 'string' });
    output.onText('"private-sentinel"');
    expect(output.result()).toBe('private-sentinel');
    output.onText(' ');
    expect(() => output.result()).toThrow(expect.not.objectContaining({ message: expect.stringContaining('private-sentinel') }));
  });

  // Snapshot of the architecture router schema (no cross-module imports).
  const insight = { type: 'object', additionalProperties: false,
    properties: { fromSlot: { type: 'string' }, insight: { type: 'string' },
      whyAccepted: { type: ['string', 'null'] }, whyRejected: { type: ['string', 'null'] } },
    required: ['fromSlot', 'insight', 'whyAccepted', 'whyRejected'] };
  const risk = { type: 'object', additionalProperties: false,
    properties: { risk: { type: 'string' }, mitigation: { type: 'string' }, sourceSlot: { type: 'string' } },
    required: ['risk', 'mitigation', 'sourceSlot'] };
  const router: LLMStructuredOutputRequest = { name: 'architecture_router_output', strict: true, schema: {
    type: 'object', additionalProperties: false, properties: {
      selectedStrategy: { type: 'string' }, mergedDecision: { type: 'string' },
      acceptedInputs: { type: 'array', items: insight }, rejectedInputs: { type: 'array', items: insight },
      unresolvedConflicts: { type: 'array', items: { type: 'string' } }, risks: { type: 'array', items: risk },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      nextAction: { type: 'string', enum: ['finalize', 'ask_human', 'route_to', 'run_more_research', 'rerun_with_different_personas'] },
      targetNodeId: { type: ['string', 'null'] }, response: { type: ['string', 'null'] },
    }, required: ['selectedStrategy', 'mergedDecision', 'acceptedInputs', 'rejectedInputs', 'unresolvedConflicts',
      'risks', 'confidence', 'nextAction', 'targetNodeId', 'response'],
  } };
  const route = { selectedStrategy: 'review', mergedDecision: 'Review implementation',
    acceptedInputs: [{ fromSlot: 'dev', insight: 'Local test passed', whyAccepted: 'Fixture evidence', whyRejected: null }],
    rejectedInputs: [], unresolvedConflicts: [], risks: [{ risk: 'Live unverified', mitigation: 'Parent QA', sourceSlot: 'dev' }],
    confidence: 0.8, nextAction: 'route_to', targetNodeId: 'review', response: null };

  it('validates actual architecture router with nested evidence and nullable fields', () => {
    const output = new DevinStructuredOutput(router);
    output.onText(JSON.stringify(route));
    expect(output.result()).toEqual(route);
  });

  it.each([{ ...route, confidence: 1.1 }, { ...route, nextAction: 'invented' },
    { ...route, acceptedInputs: [{ fromSlot: 'dev', insight: 'Missing required nullable fields' }] }])('rejects malformed architecture route', value => {
    const output = new DevinStructuredOutput(router);
    output.onText(JSON.stringify(value));
    expect(() => output.result()).toThrow();
  });
});

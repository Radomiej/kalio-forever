import { describe, expect, it } from 'vitest';
import { toolArgumentValidationError } from './tool-argument-validation';

describe('canonical tool argument validator', () => {
  const schema = { type: 'object', required: ['command'], additionalProperties: false,
    properties: { command: { type: 'string', minLength: 1, pattern: '\\S' }, count: { type: 'integer', default: 2 } } };
  it.each([{}, { command: 1 }, { command: '' }, { command: ' \n' }, { command: 'node', extra: true }, null, []])(
    'rejects invalid arguments %j', args => { expect(toolArgumentValidationError(schema, args)).toBeTypeOf('string'); });
  it('does not coerce, insert defaults, remove properties or mutate schema/args', () => {
    const args = { command: 'node', count: '2', extra: true };
    const before = structuredClone({ schema, args });
    expect(toolArgumentValidationError(schema, args)).toBeTypeOf('string');
    expect({ schema, args }).toEqual(before);
    const valid = { command: 'node' };
    expect(toolArgumentValidationError(schema, valid)).toBeUndefined(); expect(valid).toEqual({ command: 'node' });
  });
  it('does not treat inherited required properties as arguments', () => {
    expect(toolArgumentValidationError(schema, Object.create({ command: 'node' }))).toBeTypeOf('string');
  });
  it.each([undefined, { type: 'not-a-json-type' }, { $ref: 'https://example.invalid/schema' },
    { $async: true, type: 'object' }])('fails closed for unavailable, invalid or asynchronous schema %j', input => {
    expect(toolArgumentValidationError(input, {})).toMatch(/canonical tool argument schema/i);
  });
  it('supports local references and rejects stale schema reuse after a definition changes', () => {
    const input = { type: 'object', properties: { count: { $ref: '#/$defs/count' } }, $defs: { count: { type: 'integer' } } };
    expect(toolArgumentValidationError(input, { count: 1 })).toBeUndefined();
    input.$defs.count.type = 'string';
    expect(toolArgumentValidationError(input, { count: 1 })).toBeTypeOf('string');
  });
});

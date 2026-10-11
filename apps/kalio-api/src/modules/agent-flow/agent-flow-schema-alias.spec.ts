import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { publishSchemaAliasFlow, schemaIdForFlow } from './agent-flow-schema-alias';

const digest = 'a'.repeat(64);
it.each(['__proto__', 'constructor', 'toString'])('returns inherited-property unknown ID verbatim: %s', id => {
  expect(schemaIdForFlow(id)).toBe(id);
  expect(publishSchemaAliasFlow(id, id, digest).publication).toMatchObject({ flowDefinitionId: id, schemaId: id });
});
it('preserves the actual alias and direct-ID fallback', () => {
  expect(schemaIdForFlow('goal_guard_delivery_loop')).toBe('goal-master-delivery-loop');
  expect(schemaIdForFlow('direct')).toBe('direct');
  expect(schemaIdForFlow('')).toBe('');
});
it('publishes exact alias roles and an independent canonical/hash golden', () => {
  const result = publishSchemaAliasFlow('goal_guard_delivery_loop', 'goal-master-delivery-loop', digest);
  const golden = '{"flowDefinitionId":"goal_guard_delivery_loop","kind":"schema_alias","schemaDefinitionSha256":"'+digest+'","schemaId":"goal-master-delivery-loop","schemaVersion":1}';
  expect(result.publication).toEqual({schemaVersion:1,kind:'schema_alias',flowDefinitionId:'goal_guard_delivery_loop',schemaId:'goal-master-delivery-loop',schemaDefinitionSha256:digest});
  expect(result.canonicalJson).toBe(golden);
  expect(result.sha256).toBe(createHash('sha256').update(golden, 'utf8').digest('hex'));
});
it('permits direct equal IDs without claiming registration and binds every role', () => {
  const first = publishSchemaAliasFlow('direct', 'direct', digest);
  expect(first.publication.flowDefinitionId).toBe(first.publication.schemaId);
  expect(publishSchemaAliasFlow('other', 'other', digest).sha256).not.toBe(first.sha256);
  expect(publishSchemaAliasFlow('direct', 'direct', 'b'.repeat(64)).sha256).not.toBe(first.sha256);
  expect(publishSchemaAliasFlow('goal_guard_delivery_loop', 'goal-master-delivery-loop', digest).sha256)
    .not.toBe(publishSchemaAliasFlow('goal-master-delivery-loop', 'goal-master-delivery-loop', digest).sha256);
});
it.each(['', ' ', ' direct', 'direct ', '\u00a0direct', 'direct\u2003', 'x'.repeat(513), '\ud800', '\udfff'])('rejects invalid IDs without normalization: %j', id => {
  expect(() => publishSchemaAliasFlow(id, id, digest)).toThrow(/^GOAL_SCHEMA_ALIAS_PUBLICATION_INVALID$/);
  expect(() => publishSchemaAliasFlow('direct', id, digest)).toThrow(/^GOAL_SCHEMA_ALIAS_PUBLICATION_INVALID$/);
});
it('counts Unicode code points and preserves valid Unicode exactly', () => {
  const id = '😀'.repeat(512);
  expect(publishSchemaAliasFlow(id, id, digest).publication.flowDefinitionId).toBe(id);
  expect(() => publishSchemaAliasFlow(id+'😀', id+'😀', digest)).toThrow(/^GOAL_SCHEMA_ALIAS_PUBLICATION_INVALID$/);
});
it.each(['', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), ' '+digest, digest+'\n'])('rejects malformed lowercase digests: %j', hash => {
  expect(() => publishSchemaAliasFlow('direct', 'direct', hash)).toThrow(/^GOAL_SCHEMA_ALIAS_PUBLICATION_INVALID$/);
});
it('rejects schema mismatch including bypassing the actual alias', () => {
  expect(() => publishSchemaAliasFlow('goal_guard_delivery_loop', 'goal_guard_delivery_loop', digest)).toThrow(/^GOAL_SCHEMA_ALIAS_PUBLICATION_INVALID$/);
  expect(() => publishSchemaAliasFlow('direct', 'other', digest)).toThrow(/^GOAL_SCHEMA_ALIAS_PUBLICATION_INVALID$/);
});
it('rejects non-string runtime inputs without invoking conversion hooks', () => {
  const bad = { toString: () => { throw new Error('SECRET'); } } as unknown as string;
  expect(() => publishSchemaAliasFlow(bad, 'direct', digest)).toThrow(/^GOAL_SCHEMA_ALIAS_PUBLICATION_INVALID$/);
  expect(() => publishSchemaAliasFlow('direct', bad, digest)).toThrow(/^GOAL_SCHEMA_ALIAS_PUBLICATION_INVALID$/);
  expect(() => publishSchemaAliasFlow('direct', 'direct', bad)).toThrow(/^GOAL_SCHEMA_ALIAS_PUBLICATION_INVALID$/);
});

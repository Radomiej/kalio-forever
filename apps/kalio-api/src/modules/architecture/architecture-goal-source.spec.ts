import { createHash } from 'node:crypto';
import type { ArchitectureGoalPacketV1, ChatMessage } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import { appendGoalSource, createGoalPacket, resolveGoalSource } from './architecture-goal-source';

const message: ChatMessage = { id: 'message-1', sessionId: 'host', turnId: 'turn-1', role: 'user', content: '  Original\nsecret goal  ', createdAt: 123 };
const locator = { sessionId: 'host', messageId: 'message-1', turnId: 'turn-1' };
const source = () => resolveGoalSource(message, locator);
const update = () => resolveGoalSource({ ...message, id: 'message-2', turnId: 'turn-2', content: ' Update exactly\n', createdAt: 124 }, { ...locator, messageId: 'message-2', turnId: 'turn-2' });

describe('architecture goal source lifecycle', () => {
  it('resolves only exact persisted user fields, with no trimming or model extras', () => {
    const result = resolveGoalSource({ ...message, thinking: 'model secret', promptMessageId: 'other' }, locator);
    expect(result).toEqual({ messageId: message.id, sessionId: message.sessionId, turnId: message.turnId, content: message.content, createdAt: 123 });
    expect(result).not.toBe(message);
  });

  it.each([
    { role: 'assistant' }, { role: 'system' }, { role: 'tool_result' },
    { id: 'wrong' }, { sessionId: 'child' }, { turnId: 'wrong' }, { turnId: undefined },
    { content: '' }, { content: ' \n ' }, { createdAt: NaN }, { createdAt: Infinity },
  ])('rejects a forged or malformed message (%j) without raw content in errors', (patch) => {
    expect(() => resolveGoalSource({ ...message, ...patch } as ChatMessage, locator)).toThrow(/^Invalid goal source\.$/);
  });

  it('rejects missing messages and empty locator IDs', () => {
    expect(() => resolveGoalSource(undefined, locator)).toThrow('Invalid goal source.');
    for (const key of ['sessionId', 'messageId', 'turnId'] as const) {
      expect(() => resolveGoalSource(message, { ...locator, [key]: '' })).toThrow('Invalid goal source.');
    }
  });

  it('creates deterministic version 1 with empty host policy and a fixed-key host hash', () => {
    const original = source();
    const packet = createGoalPacket(original);
    const canonical = JSON.stringify({ original: { messageId: 'message-1', sessionId: 'host', turnId: 'turn-1', content: message.content, createdAt: 123 }, updates: [] });
    expect(packet).toEqual({ schemaVersion: 1, version: 1, original, updates: [], sourceFingerprint: createHash('sha256').update(canonical).digest('hex'), projection: { status: 'pending', base: null }, completionPolicy: { requiredEvidenceKindsByCriterion: {} } });
    expect(packet.original).not.toBe(original);
    expect(createGoalPacket({ createdAt: 123, content: message.content, turnId: 'turn-1', sessionId: 'host', messageId: 'message-1' }).sourceFingerprint).toBe(packet.sourceFingerprint);
  });

  it('appends in arrival order exactly once and keeps the original byte-for-byte', () => {
    const packet = createGoalPacket(source());
    const second = appendGoalSource(packet, update());
    const repeated = appendGoalSource(second, update());
    expect(second.version).toBe(2);
    expect(second.original).toEqual(packet.original);
    expect(second.updates).toEqual([update()]);
    expect(repeated).toEqual(second);
    expect(repeated).not.toBe(second);
    expect(second.sourceFingerprint).not.toBe(packet.sourceFingerprint);
    const thirdSource = { ...update(), messageId: 'message-3', turnId: 'turn-3', createdAt: 100 };
    const third = appendGoalSource(second, thirdSource);
    expect(third.version).toBe(3);
    expect(third.updates).toEqual([update(), thirdSource]);
    expect(appendGoalSource(third, source())).toEqual(third);
    expect(packet.updates).toEqual([]);
  });

  it.each([{ content: 'secret changed' }, { createdAt: 999 }, { turnId: 'secret changed' }])('rejects conflicting message ID reuse (%j)', (patch) => {
    const packet = appendGoalSource(createGoalPacket(source()), update());
    expect(() => appendGoalSource(packet, { ...source(), ...patch })).toThrow(/^Conflicting goal source message\.$/);
    expect(() => appendGoalSource(packet, { ...update(), ...patch })).toThrow(/^Conflicting goal source message\.$/);
  });

  it('rejects another host session even with distinct message/turn IDs', () => {
    expect(() => appendGoalSource(createGoalPacket(source()), { ...update(), sessionId: 'child' })).toThrow('Invalid goal source.');
  });

  it('preserves accepted criteria/policy deeply and makes the snapshot pending on update', () => {
    const packet: ArchitectureGoalPacketV1 = {
      ...createGoalPacket(source()),
      projection: { status: 'accepted', snapshot: { sourceVersion: 1, goalFingerprint: 'accepted-hash', criteria: [{ id: 'c1', text: 'Secret criterion', sourceQuotes: [{ messageId: 'message-1', quote: 'Original' }], supersedes: [] }] } },
      completionPolicy: { requiredEvidenceKindsByCriterion: { c1: ['FINAL_ARTIFACT'] } },
    };
    const before = structuredClone(packet);
    const next = appendGoalSource(packet, update());
    expect(next.projection).toEqual({ status: 'pending', base: packet.projection.status === 'accepted' ? packet.projection.snapshot : null });
    expect(next.completionPolicy).toEqual(packet.completionPolicy);
    expect(packet).toEqual(before);
    Reflect.set(next.completionPolicy.requiredEvidenceKindsByCriterion, 'c1', []);
    if (next.projection.status === 'pending' && next.projection.base) next.projection.base.criteria[0]!.sourceQuotes[0]!.quote = 'mutated';
    next.original.content = 'mutated';
    next.updates[0]!.content = 'mutated';
    expect(packet).toEqual(before);
    expect(update().content).toBe(' Update exactly\n');
  });

  it('drops stale proposals only for a distinct source, retaining the previous accepted base', () => {
    const packet = createGoalPacket(source());
    packet.projection = { status: 'pending', base: { sourceVersion: 1, goalFingerprint: 'prior', criteria: [] }, proposal: { sourceVersion: 1, proposalFingerprint: 'proposal', criteria: [] } };
    expect(appendGoalSource(packet, source())).toEqual(packet);
    const next = appendGoalSource(packet, update());
    expect(next.projection).toEqual({ status: 'pending', base: { sourceVersion: 1, goalFingerprint: 'prior', criteria: [] } });
    expect(next.projection).not.toBe(packet.projection);
    expect(packet.projection).toHaveProperty('proposal');
  });

  it('isolates all nested input references, including an idempotent pending retry', () => {
    const original = source();
    const incoming = update();
    const packet = createGoalPacket(original);
    packet.projection = {
      status: 'pending',
      base: { sourceVersion: 1, goalFingerprint: 'base', criteria: [{ id: 'c1', text: 'criterion', sourceQuotes: [{ messageId: 'message-1', quote: 'Original' }], supersedes: ['old'] }] },
      proposal: { sourceVersion: 1, proposalFingerprint: 'proposal', criteria: [{ text: 'proposal', sourceQuotes: [{ messageId: 'message-1', quote: 'Original' }], supersedes: [] }] },
    };
    packet.completionPolicy.requiredEvidenceKindsByCriterion = { c1: ['FINAL_ARTIFACT'] };
    const repeated = appendGoalSource(packet, original);
    expect(repeated.original).not.toBe(packet.original);
    expect(repeated.updates).not.toBe(packet.updates);
    expect(repeated.projection).not.toBe(packet.projection);
    expect(repeated.completionPolicy.requiredEvidenceKindsByCriterion).not.toBe(packet.completionPolicy.requiredEvidenceKindsByCriterion);
    if (repeated.projection.status === 'pending') {
      expect(repeated.projection.base).not.toBe(packet.projection.base);
      expect(repeated.projection.base!.criteria[0]!.sourceQuotes).not.toBe(packet.projection.base!.criteria[0]!.sourceQuotes);
      expect(repeated.projection.base!.criteria[0]!.supersedes).not.toBe(packet.projection.base!.criteria[0]!.supersedes);
      expect(repeated.projection.proposal!.criteria).not.toBe(packet.projection.proposal!.criteria);
    }
    const next = appendGoalSource(packet, incoming);
    original.content = 'changed caller original';
    incoming.content = 'changed caller update';
    expect(next.original.content).toBe(message.content);
    expect(next.updates[0]!.content).toBe(' Update exactly\n');
  });

  it('rejects malformed direct sources, mixed-session and duplicate packet histories', () => {
    expect(() => createGoalPacket({ ...source(), content: '' })).toThrow('Invalid goal source.');
    const packet = createGoalPacket(source());
    expect(() => appendGoalSource(packet, { ...update(), createdAt: Infinity })).toThrow('Invalid goal source.');
    expect(() => appendGoalSource({ ...packet, version: 2, updates: [source()] }, update())).toThrow('Invalid goal packet.');
    expect(() => appendGoalSource({ ...packet, version: 2, updates: [{ ...update(), sessionId: 'child' }] }, update())).toThrow('Invalid goal packet.');
    expect(() => appendGoalSource({ ...packet, projection: { status: 'accepted', snapshot: { sourceVersion: 2, goalFingerprint: 'bad', criteria: [] } } }, update())).toThrow('Invalid goal packet.');
  });

  it.each([{ schemaVersion: 2 }, { version: 0 }, { version: 2 }, { version: NaN }, { sourceFingerprint: 'forged' }])('rejects invalid packet invariants (%j)', (patch) => {
    expect(() => appendGoalSource({ ...createGoalPacket(source()), ...patch } as ArchitectureGoalPacketV1, update())).toThrow(/^Invalid goal packet\.$/);
  });
});

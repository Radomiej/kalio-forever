import { createHash } from 'node:crypto';
import type { ArchitectureGoalPacketV1, ArchitectureGoalSourceV1, ChatMessage } from '@kalio/types';

export type GoalSourceLocator = Pick<ArchitectureGoalSourceV1, 'sessionId' | 'messageId' | 'turnId'>;

/** The caller supplies a persisted message and the explicitly approved host-session locator. */
export function resolveGoalSource(message: ChatMessage | undefined, locator: GoalSourceLocator): ArchitectureGoalSourceV1 {
  if (!message || !locator || message.role !== 'user'
    || message.id !== locator.messageId || message.sessionId !== locator.sessionId
    || message.turnId !== locator.turnId) {
    throw new Error('Invalid goal source.');
  }
  const source = {
    messageId: message.id, sessionId: message.sessionId, turnId: locator.turnId,
    content: message.content, createdAt: message.createdAt,
  };
  assertSource(source);
  return canonicalSource(source);
}

export function createGoalPacket(source: ArchitectureGoalSourceV1): ArchitectureGoalPacketV1 {
  assertSource(source);
  const original = canonicalSource(source);
  return {
    schemaVersion: 1, version: 1, original, updates: [],
    sourceFingerprint: fingerprint(original, []),
    projection: { status: 'pending', base: null },
    completionPolicy: { requiredEvidenceKindsByCriterion: {} },
  };
}

export function appendGoalSource(packet: ArchitectureGoalPacketV1, source: ArchitectureGoalSourceV1): ArchitectureGoalPacketV1 {
  assertPacket(packet);
  assertSource(source);
  if (source.sessionId !== packet.original.sessionId) throw new Error('Invalid goal source.');
  const existing = [packet.original, ...packet.updates].find((item) => item.messageId === source.messageId);
  if (existing && JSON.stringify(canonicalSource(existing)) !== JSON.stringify(canonicalSource(source))) {
    throw new Error('Conflicting goal source message.');
  }
  let next: ArchitectureGoalPacketV1;
  try {
    next = structuredClone(packet);
  } catch {
    throw new Error('Invalid goal packet.');
  }
  if (existing) return next;
  next.updates = [...next.updates, canonicalSource(source)];
  next.version += 1;
  next.sourceFingerprint = fingerprint(next.original, next.updates);
  next.projection = {
    status: 'pending',
    base: next.projection.status === 'accepted' ? next.projection.snapshot : next.projection.base,
  };
  return next;
}

function canonicalSource(source: ArchitectureGoalSourceV1): ArchitectureGoalSourceV1 {
  return {
    messageId: source.messageId, sessionId: source.sessionId, turnId: source.turnId,
    content: source.content, createdAt: source.createdAt,
  };
}

function fingerprint(original: ArchitectureGoalSourceV1, updates: readonly ArchitectureGoalSourceV1[]): string {
  return createHash('sha256').update(JSON.stringify({
    original: canonicalSource(original), updates: updates.map(canonicalSource),
  })).digest('hex');
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertSource(source: ArchitectureGoalSourceV1): void {
  if (!source || !nonempty(source.messageId) || !nonempty(source.sessionId) || !nonempty(source.turnId)
    || !nonempty(source.content) || typeof source.createdAt !== 'number' || !Number.isFinite(source.createdAt)) {
    throw new Error('Invalid goal source.');
  }
}

function assertPacket(packet: ArchitectureGoalPacketV1): void {
  if (!packet || packet.schemaVersion !== 1 || !Array.isArray(packet.updates)
    || !Number.isSafeInteger(packet.version) || packet.version !== 1 + packet.updates.length
    || !packet.projection || !['accepted', 'pending'].includes(packet.projection.status)
    || !packet.completionPolicy || !packet.completionPolicy.requiredEvidenceKindsByCriterion) {
    throw new Error('Invalid goal packet.');
  }
  const sources = [packet.original, ...packet.updates];
  try {
    sources.forEach(assertSource);
  } catch {
    throw new Error('Invalid goal packet.');
  }
  if (sources.some((source) => source.sessionId !== packet.original.sessionId)
    || new Set(sources.map((source) => source.messageId)).size !== sources.length
    || packet.sourceFingerprint !== fingerprint(packet.original, packet.updates)) {
    throw new Error('Invalid goal packet.');
  }
  const base = packet.projection.status === 'accepted' ? packet.projection.snapshot : packet.projection.base;
  if (base !== null && (!base || !Number.isSafeInteger(base.sourceVersion) || base.sourceVersion < 1
    || base.sourceVersion > packet.version
    || (packet.projection.status === 'accepted' && base.sourceVersion !== packet.version))) {
    throw new Error('Invalid goal packet.');
  }
}

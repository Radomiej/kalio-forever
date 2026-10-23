import { and, eq, sql } from 'drizzle-orm';
import { types } from 'node:util';
import type { ChatRunSnapshot } from '@kalio/types';
import { chatRuns, type ChatRunRow } from '../../database/schema';
import type { KalioDrizzleDatabase } from '../../database/sqlite-runtime';

const INVALID = 'RUN_COMPLETION_INVALID';
const CONFLICT = 'RUN_COMPLETION_CONFLICT';
const STORAGE = 'RUN_COMPLETION_STORAGE_ERROR';

/** Inspect descriptors, never original property values. No getters, toJSON or proxy traps. */
function clonePlainJson(value: unknown, active = new WeakSet<object>(), root = false): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || !value || types.isProxy(value) || active.has(value)) throw new Error(INVALID);
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error(INVALID);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  for (const key of keys) {
    if (typeof key !== 'string') throw new Error(INVALID);
    const descriptor = descriptors[key]!;
    if (!Object.hasOwn(descriptor, 'value') || (!descriptor.enumerable && !(array && key === 'length'))) throw new Error(INVALID);
  }
  active.add(value);
  try {
    if (array) {
      const length: unknown = descriptors['length']?.value;
      if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1
        || keys.some(key => key !== 'length' && (typeof key !== 'string' || String(Number(key)) !== key || Number(key) < 0 || Number(key) >= length || !Number.isInteger(Number(key))))) throw new Error(INVALID);
      const result: unknown[] = [];
      // Prevent serializer hooks inherited from a polluted Array.prototype as well.
      Object.setPrototypeOf(result, null);
      for (let index = 0; index < length; index++) result[index] = clonePlainJson(descriptors[String(index)]!.value, active);
      return result;
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (typeof key !== 'string') throw new Error(INVALID);
      const child: unknown = descriptors[key]!.value;
      // Existing optional fields may be explicitly undefined; nested JSON may not silently lose data.
      if (root && child === undefined && (key === 'messageId' || key === 'structuredOutput')) continue;
      result[key] = clonePlainJson(child, active);
    }
    return result;
  } finally {
    active.delete(value);
  }
}

function validOutcome(value: unknown): value is NonNullable<ChatRunSnapshot['outcome']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row['finalText'] === 'string' && Object.hasOwn(row, 'finalText')
    && Reflect.ownKeys(row).every(key => key === 'finalText' || key === 'structuredOutput' || key === 'messageId')
    && (row['messageId'] === undefined || typeof row['messageId'] === 'string' && row['messageId'].trim().length > 0);
}

/** No await inside the SQLite transaction. The caller receives a row only after commit succeeds. */
export function completeRunRequired(db: KalioDrizzleDatabase, id: string, expectedRevision: number,
  outcome: NonNullable<ChatRunSnapshot['outcome']>): ChatRunRow {
  let detached: NonNullable<ChatRunSnapshot['outcome']>;
  try {
    if (typeof id !== 'string' || !id.trim() || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error(INVALID);
    const parsed = clonePlainJson(outcome, new WeakSet(), true);
    if (!validOutcome(parsed)) throw new Error(INVALID);
    detached = parsed;
  } catch {
    throw new Error(INVALID);
  }
  let conflict = false;
  try {
    return db.transaction(tx => {
      const now = new Date();
      const result = tx.update(chatRuns).set({
        phase: 'completed', status: 'completed', revision: sql`${chatRuns.revision} + 1`,
        // Bound JSON text avoids Drizzle entity inspection of the null-prototype safe clone.
        safeResume: false, errorCode: null, errorMessage: null, outcome: sql`${JSON.stringify(detached)}`,
        updatedAt: now, lastHeartbeatAt: now, completedAt: now,
      }).where(and(eq(chatRuns.id, id), eq(chatRuns.revision, expectedRevision), eq(chatRuns.status, 'active'))).run();
      if (result.changes !== 1) {
        conflict = true;
        throw new Error(CONFLICT);
      }
      const row = tx.select().from(chatRuns).where(eq(chatRuns.id, id)).get();
      if (!row || row.status !== 'completed' || row.phase !== 'completed' || row.revision !== expectedRevision + 1) {
        throw new Error(STORAGE);
      }
      return row;
    });
  } catch {
    throw new Error(conflict ? CONFLICT : STORAGE);
  }
}

/** Same non-awaited listener notification policy as legacy complete; never a durable ACK. */
export function notifyRequiredCompletion(listeners: ReadonlySet<(run: ChatRunSnapshot) => void | Promise<void>>,
  completed: ChatRunSnapshot, logger: { error(message: string): void }): void {
  for (const listener of listeners) {
    try {
      void Promise.resolve(listener(structuredClone(completed))).catch(() => {
        logger.error('Required completed-run listener failed.');
      });
    } catch {
      logger.error('Required completed-run listener failed.');
    }
  }
}

import { createHash } from 'node:crypto';
import { types } from 'node:util';

type Json = null | boolean | string | number | Json[] | { [key: string]: Json };
const invalid = (): never => { throw new Error('GOAL_LAUNCH_JSON_INVALID'); };
const ordinal = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function validString(value: string): string {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return invalid();
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return invalid();
  }
  return value;
}

function ordered(value: unknown, ancestors: Set<object>): Json {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return validString(value);
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0) ? value : invalid();
  // Proxy rejection precedes reflection, Array.isArray, or any property read.
  if (!value || typeof value !== 'object' || types.isProxy(value) || ancestors.has(value)) return invalid();
  const array = Array.isArray(value); const proto = Object.getPrototypeOf(value);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) return invalid();
  const descriptors = new Map<string, PropertyDescriptor>();
  for (const key of keys) {
    if (typeof key !== 'string') return invalid();
    validString(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable && !(array && key === 'length')) return invalid();
    descriptors.set(key, descriptor);
  }
  ancestors.add(value);
  try {
    if (array) {
      const length: unknown = descriptors.get('length')?.value;
      if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) return invalid();
      for (const key of descriptors.keys()) {
        if (key === 'length') continue;
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) return invalid();
      }
      const result: Json[] = [];
      // Detached null prototypes prevent inherited toJSON hooks during stringify.
      Object.setPrototypeOf(result, null);
      for (let i = 0; i < length; i++) {
        const descriptor = descriptors.get(String(i));
        if (!descriptor) return invalid();
        result[i] = ordered(descriptor.value, ancestors);
      }
      return result;
    }
    const result: { [key: string]: Json } = Object.create(null);
    for (const key of [...descriptors.keys()].sort(ordinal)) result[key] = ordered(descriptors.get(key)!.value, ancestors);
    return result;
  } finally { ancestors.delete(value); }
}

/** Goal-launch-only pipeline: validate/detach, recursively insert keys in ordinal
 * UTF-16 order, then JSON.stringify. Stringify still emits integer-index object
 * keys in numeric order (e.g. "2" before "10"). This is not raw lexical JSON
 * ordering and must NEVER replace legacy completion/receipt/reservation hashes. */
export function canonicalGoalLaunchJson(value: unknown): string {
  try { return JSON.stringify(ordered(value, new Set<object>())); }
  catch { return invalid(); }
}

export function hashGoalLaunchJson(value: unknown): string {
  try { return createHash('sha256').update(canonicalGoalLaunchJson(value), 'utf8').digest('hex'); }
  catch { return invalid(); }
}

import type { ArchitectureSchema } from '@kalio/types';
import type { GoalGraphAdapterConfig } from './architecture-goal-graph-adapter.service';
import type { HostGoalPolicyFactory } from './architecture-goal-projection.service';
import { DEVIN_JEV_GOAL_LOOP } from './architecture-seed-schemas.devin-jev';

function orderedJson(value: unknown, ancestors = new Set<object>(), path = ''): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || ancestors.has(value)) throw new Error('Invalid preset snapshot.');
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new Error('Preset snapshot must contain plain JSON objects.');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  for (const key of keys) {
    if (typeof key !== 'string') throw new Error('Preset snapshot cannot contain symbols.');
    const descriptor = descriptors[key]!;
    if (!('value' in descriptor) || (!descriptor.enumerable && !(isArray && key === 'length'))) {
      throw new Error('Preset snapshot must contain enumerable data properties.');
    }
    if (descriptor.value === undefined && !(
      /^nodes\.\d+$/.test(path) && (key === 'autoRouting' || key === 'toolOverride')
      || path === 'contextPolicy' && key === 'perSlotOverrides'
    )) throw new Error('Preset snapshot contains an unsupported undefined property.');
  }
  ancestors.add(value);
  try {
    if (isArray) {
      const length: unknown = descriptors.length?.value;
      if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) {
        throw new Error('Preset snapshot arrays must be dense and have no extra properties.');
      }
      const items: string[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(descriptors, String(index))?.value as PropertyDescriptor | undefined;
        if (!descriptor) throw new Error('Preset snapshot arrays cannot contain holes.');
        items.push(orderedJson(descriptor.value, ancestors, `${path}.${index}`));
      }
      return `[${items.join(',')}]`;
    }
    // Existing schema clone helpers materialize optional fields as undefined.
    return `{${Object.keys(descriptors).sort().filter(key => descriptors[key]!.value !== undefined)
      .map(key => `${JSON.stringify(key)}:${orderedJson(descriptors[key]!.value, ancestors, path ? `${path}.${key}` : key)}`).join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

// Capture once so mutating the exported seed cannot redefine admitted snapshots.
const CANONICAL_SNAPSHOT = orderedJson(DEVIN_JEV_GOAL_LOOP);

/** Server-only lookup. The host supplies policy; run/model context is never read. */
export function lookupGoalGraphAdapterConfig(
  schema: ArchitectureSchema,
  hostPolicyFactory: HostGoalPolicyFactory,
): GoalGraphAdapterConfig | null {
  if (typeof hostPolicyFactory !== 'function') return null;
  try {
    if (orderedJson(schema) !== CANONICAL_SNAPSHOT) return null;
  } catch {
    // Invalid or cyclic snapshots are explicitly unsupported, never activated.
    return null;
  }
  return Object.freeze({
    workerNodeId: 'devin-worker', judgeNodeId: 'jev-judge',
    completionNodeIds: Object.freeze(['goal-artifact']), hostPolicyFactory,
  });
}

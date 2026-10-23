import { types } from 'node:util';

/** Detach before reads/serialization; reject getters, proxies and non-JSON shapes. */
export function detachHostReceiptArgs(args: Record<string, unknown>): Record<string, unknown> {
  function clone(value: unknown, active = new Set<object>()): unknown {
    if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean'
      || typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || types.isProxy(value) || active.has(value)) throw new Error('Invalid host receipt args.');
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error('Invalid host receipt args prototype.');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    for (const key of keys) {
      if (typeof key !== 'string') throw new Error('Host receipt args cannot contain symbols.');
      const descriptor = descriptors[key]!;
      if (!('value' in descriptor) || !descriptor.enumerable && !(array && key === 'length')) throw new Error('Host receipt args require enumerable data properties.');
    }
    active.add(value);
    try {
      if (array) {
        const length: unknown = descriptors.length?.value;
        if (typeof length !== 'number' || !Number.isSafeInteger(length) || keys.length !== length + 1) throw new Error('Invalid host receipt args array.');
        const items: unknown[] = [];
        for (let index = 0; index < length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(descriptors, String(index))?.value as PropertyDescriptor | undefined;
          if (!descriptor) throw new Error('Host receipt args cannot contain holes.');
          items.push(clone(descriptor.value, active));
        }
        return Object.freeze(items);
      }
      const detached: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      // Goal receipt producer uses recursively sorted JSON for argument identity.
      for (const key of Object.keys(descriptors).sort()) {
        Object.defineProperty(detached, key, { value: clone(descriptors[key]!.value, active), enumerable: true });
      }
      return Object.freeze(detached);
    } finally { active.delete(value); }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Host receipt args must be an object.');
  return clone(args) as Record<string, unknown>;
}

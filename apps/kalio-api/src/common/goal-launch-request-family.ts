import { types } from 'node:util';

const object = (value: unknown): value is object => value !== null && typeof value === 'object';
const own = (value: object, key: string): PropertyDescriptor | undefined => Object.getOwnPropertyDescriptor(value, key);

/** Family classification only: neither approval validity nor cancellation authority.
 * Unreadable relevant paths fail closed; unrelated payloads are never traversed. */
export function isProtectedGoalRequest(row: unknown): boolean {
  try {
    if (!object(row)) return false;
    if (types.isProxy(row)) return true;
    const continuation = own(row, 'continuation');
    if (!continuation) return false;
    if (!('value' in continuation)) return true;
    const cursor: unknown = continuation.value;
    if (!object(cursor)) return false;
    if (types.isProxy(cursor)) return true;
    const marker = own(cursor, 'hostConfirmationRequirement');
    if (!marker) return false;
    if (!('value' in marker)) return true;
    const payload = own(row, 'payload');
    if (payload && !('value' in payload)) return true;
    const data: unknown = payload?.value;
    if (object(data)) {
      if (types.isProxy(data)) return true;
      const name = own(data, 'toolName');
      if (name && (!('value' in name) || name.value === 'run_sub_agentflow')) return true;
    }
    const requirement: unknown = marker.value;
    if (!object(requirement)) return false;
    if (types.isProxy(requirement)) return true;
    if (Array.isArray(requirement)) return false;
    if (own(requirement, 'goalLaunch')) return true;
    const name = own(requirement, 'toolName');
    return Boolean(name && (!('value' in name) || name.value === 'run_sub_agentflow'));
  } catch {
    return true;
  }
}

import type { LLMToolCall } from '@kalio/types';
import { detachHostReceiptArgs } from './host-receipt-json';

const fail = (): never => { throw new Error('GOAL_LAUNCH_PERSISTED_CALL_INVALID'); };
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

/** Exact persisted bytes and call shape only: no journal predicate, tool-name
 * filtering, uniqueness, revision or launch authority. Legacy argument cloning
 * and JSON serialization intentionally differ from goal-launch canonical JSON. */
export function readPersistedGoalLaunchCalls(toolCalls: unknown, toolCallsBytes: unknown): readonly LLMToolCall[] {
  if (toolCalls === null) return [];
  try {
    if (typeof toolCalls !== 'string' || !(toolCallsBytes instanceof Uint8Array)
      || !Buffer.from(toolCallsBytes).equals(Buffer.from(toolCalls, 'utf8'))) return fail();
    const parsed: unknown = JSON.parse(toolCalls);
    if (!Array.isArray(parsed)) return fail();
    return parsed.map((item: unknown) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return fail();
      const call = item as Record<string, unknown>;
      if (Object.keys(call).length !== 3 || !['id', 'name', 'args'].every(key => Object.hasOwn(call, key))
        || !nonempty(call.id) || !nonempty(call.name)) return fail();
      const args = detachHostReceiptArgs(call.args as Record<string, unknown>);
      JSON.stringify(args, (_key, value: unknown) => {
        if (value === undefined) return fail();
        return value;
      });
      return Object.freeze({ id: call.id, name: call.name, args });
    });
  } catch { return fail(); }
}

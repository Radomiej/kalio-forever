import type { ToolRegistryEntry } from './interfaces/tool-registry-entry.interface';
import type { HostDispatchReceiptRecorderPorts, HostDispatchReceiptV1 } from './host-dispatch-receipts';

type RegisteredTarget = Extract<NonNullable<HostDispatchReceiptV1['enteredTarget']>, { kind: 'kalio_registry' }>;

function metadata(entry: ToolRegistryEntry): RegisteredTarget | null {
  const { catalogEntryId, executorImplementationId, executorImplementationVersion } = entry;
  if (typeof catalogEntryId !== 'string' || !catalogEntryId.trim()
    || typeof executorImplementationId !== 'string' || !executorImplementationId.trim()
    || typeof executorImplementationVersion !== 'number' || !Number.isSafeInteger(executorImplementationVersion)
    || executorImplementationVersion < 1 || typeof entry.meta.requiresConfirmation !== 'boolean') return null;
  return Object.freeze({ kind: 'kalio_registry', catalogEntryId, executorImplementationId,
    executorImplementationVersion, requiresConfirmation: entry.meta.requiresConfirmation });
}
function abort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('HOST_DISPATCH_REGISTRY_ABORTED');
}
function sameIdentity(left: RegisteredTarget, right: RegisteredTarget): boolean {
  return left.catalogEntryId === right.catalogEntryId && left.executorImplementationId === right.executorImplementationId
    && left.executorImplementationVersion === right.executorImplementationVersion;
}

/** Native registry authority only. External MCP needs its own concrete resolver;
 * it must never be promoted to native BUILD proof through name matching.
 * Read the live registry on every call: no cached executor or policy snapshot. */
export function createHostDispatchRegistryAuthority(readEntries: () => readonly ToolRegistryEntry[]):
Pick<HostDispatchReceiptRecorderPorts, 'captureRegisteredTarget' | 'readRegisteredTargetExact'> {
  return {
    async captureRegisteredTarget(receipt, signal) {
      abort(signal);
      const target = receipt.target;
      if (target.kind !== 'kalio_registry') return null;
      const entries = readEntries();
      const matches = entries.filter(entry => entry === target.entryIdentity
        && entry.execute === target.executorIdentity && entry.meta.name === receipt.canonicalName
        && entry.meta.requiresConfirmation === target.requiresConfirmation);
      if (matches.length !== 1) return null;
      const captured = metadata(matches[0]!);
      if (!captured || entries.filter(entry => {
        const current = metadata(entry); return current && sameIdentity(current, captured);
      }).length !== 1) return null;
      return captured;
    },
    async readRegisteredTargetExact(target, signal) {
      abort(signal);
      if (target.kind !== 'kalio_registry') return null;
      const matches = readEntries().flatMap(entry => {
        const current = metadata(entry);
        if (!current || !sameIdentity(current, target)) return [];
        return [{ canonicalName: entry.meta.name, target: current }];
      });
      return matches.length === 1 && matches[0]!.target.requiresConfirmation === target.requiresConfirmation ? matches[0]! : null;
    },
  };
}

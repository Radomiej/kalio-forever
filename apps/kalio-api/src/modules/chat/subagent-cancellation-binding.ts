import type { HostRuntimeReceiptIdentity } from '@kalio/types';
import { createHostCancellationRecordingScope } from './host-cancellation-recording-scope';
import type { ActiveSubagentRunRegistry } from './subagent-runtime.support';

const CANCELLATION_RECORDING_LIMIT_MS = 5000;

/** Called only by the host after the observed child's actual journal/prompt exists. */
export function bindObservedSubagentCancellation(registry: ActiveSubagentRunRegistry, childSessionId: string,
  controller: AbortController, identity: HostRuntimeReceiptIdentity) {
  const active = registry.getStatus(childSessionId);
  if (!active || identity.sessionId !== childSessionId || active.turnId !== identity.turnId
    || active.promptMessageId !== identity.promptMessageId) throw new Error('HOST_CANCELLATION_BINDING_INVALID');
  const handle = registry.bindCancellationRecording(childSessionId, controller, (executionIdentity, executionSignal) =>
    createHostCancellationRecordingScope({ executionIdentity, executionSignal, identity,
      maxPersistenceLeaseMs: CANCELLATION_RECORDING_LIMIT_MS,
      acquirePersistenceLease: (stoppedAt) => ({ signal: AbortSignal.timeout(CANCELLATION_RECORDING_LIMIT_MS),
        expiresAt: stoppedAt + CANCELLATION_RECORDING_LIMIT_MS }) }));
  if (!handle) throw new Error('HOST_CANCELLATION_BINDING_INVALID');
  return handle;
}

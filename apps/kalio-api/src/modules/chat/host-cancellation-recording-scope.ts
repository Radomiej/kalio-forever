import { types } from 'node:util';
import type { HostRuntimeReceiptIdentity, HostRuntimeToolAdmission } from '@kalio/types';

export interface HostCancellationPersistenceLease {
  readonly signal: AbortSignal;
  readonly expiresAt: number;
}
export type HostCancellationRecordingPermit = object;
export interface HostCancellationLifecycleHandle {
  registerAdmission(admission: HostRuntimeToolAdmission, recorder: object, admissionAck: Promise<void>): Promise<void>;
  stop(): void;
  permitFor(callId: string, recorder: object): HostCancellationRecordingPermit | null;
  close(): void;
}
export interface HostCancellationRecordingScopeInput {
  readonly executionIdentity: object;
  readonly executionSignal: AbortSignal;
  readonly identity: HostRuntimeReceiptIdentity;
  readonly maxPersistenceLeaseMs: number;
  readonly acquirePersistenceLease: (stoppedAt: number) => HostCancellationPersistenceLease;
}

const fail = (code: string): never => { throw new Error(`HOST_CANCELLATION_RECORDING_${code}`); };
const object = (value: unknown): value is object => typeof value === 'object' && value !== null && !types.isProxy(value);
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!object(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail('INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const own = Reflect.ownKeys(descriptors);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) return fail('INVALID');
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return fail('INVALID');
    result[key] = descriptor.value;
  }
  return result;
}
const identityKeys = ['runId', 'sessionId', 'turnId', 'promptMessageId'] as const;
function identitySnapshot(value: unknown): HostRuntimeReceiptIdentity {
  const snapshot = record(value, identityKeys);
  for (const key of identityKeys) if (typeof snapshot[key] !== 'string' || !snapshot[key]) return fail('INVALID');
  return Object.freeze(snapshot) as unknown as HostRuntimeReceiptIdentity;
}
function sameIdentity(left: HostRuntimeReceiptIdentity, right: HostRuntimeReceiptIdentity): boolean {
  return identityKeys.every(key => left[key] === right[key]);
}
const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
function signalAborted(value: unknown): boolean {
  if (!object(value)) return fail('INVALID');
  try { return abortedGetter.call(value) as boolean; } catch { return fail('INVALID'); }
}
interface Binding {
  identity: HostRuntimeReceiptIdentity;
  callId: string;
  recorder: object;
  read(): HostCancellationPersistenceLease;
}
const bindings = new WeakMap<object, Binding>();

export function readHostCancellationRecordingPermit(
  permit: HostCancellationRecordingPermit, identity: HostRuntimeReceiptIdentity, callId: string, recorder: object,
): HostCancellationPersistenceLease {
  if (!object(permit)) return fail('INVALID');
  const binding = bindings.get(permit);
  if (!binding || binding.callId !== callId || binding.recorder !== recorder
    || !sameIdentity(binding.identity, identitySnapshot(identity))) return fail('INVALID');
  return binding.read();
}

/** Host-only capability. The existing reservation/registry owner authenticates explicit Stop;
 * neither this lease, an abort reason, nor model input authenticates it. No execution or completion authority.
 * ACK is the actual parent-owned admission promise, not a worker assertion.
 */
export function createHostCancellationRecordingScope(input: HostCancellationRecordingScopeInput): {
  lookup(executionIdentity: object, executionSignal: AbortSignal): HostCancellationLifecycleHandle | null;
} {
  const fields = record(input, ['executionIdentity', 'executionSignal', 'identity', 'maxPersistenceLeaseMs', 'acquirePersistenceLease']);
  const { executionIdentity, executionSignal, maxPersistenceLeaseMs, acquirePersistenceLease } = fields;
  if (!object(executionIdentity) || typeof acquirePersistenceLease !== 'function'
    || typeof maxPersistenceLeaseMs !== 'number' || !Number.isSafeInteger(maxPersistenceLeaseMs)
    || maxPersistenceLeaseMs <= 0 || maxPersistenceLeaseMs > 2_147_483_647) return fail('INVALID');
  signalAborted(executionSignal);
  const identity = identitySnapshot(fields.identity);
  const calls = new Map<string, { recorder: object; accepted: boolean; permit?: HostCancellationRecordingPermit }>();
  let stopped = false;
  let closed = false;
  let expired = false;
  let lease: HostCancellationPersistenceLease | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const revocation = new AbortController();
  function expire(): void {
    expired = true;
    revocation.abort(new Error('HOST_CANCELLATION_RECORDING_EXPIRED'));
  }
  function read(): HostCancellationPersistenceLease {
    if (closed) return fail('CLOSED');
    if (!lease) return fail('LEASE');
    // The fixed elapsed timer bounds backward clock shifts; forward shifts fail on read too.
    if (!expired && Date.now() >= lease.expiresAt) expire();
    if (expired) return fail('EXPIRED');
    if (signalAborted(lease.signal)) return fail('ABORTED');
    return lease;
  }
  const handle: HostCancellationLifecycleHandle = Object.freeze({
    async registerAdmission(admission: HostRuntimeToolAdmission, recorder: object, admissionAck: Promise<void>): Promise<void> {
      // Observe rejection even when the registration is synchronously fenced or invalid.
      const ack = new Promise<void>((resolve, reject) => {
        try { Promise.prototype.then.call(admissionAck, resolve, reject); } catch { reject(new Error('HOST_CANCELLATION_RECORDING_ADMISSION')); }
      });
      void ack.then(() => undefined, () => undefined);
      if (closed || stopped) return fail('CLOSED');
      const supplied = record(admission, ['identity', 'callId', 'toolName', 'args']);
      if (!sameIdentity(identity, identitySnapshot(supplied.identity)) || !object(recorder)
        || typeof supplied.callId !== 'string' || !supplied.callId
        || typeof supplied.toolName !== 'string' || !supplied.toolName || !object(supplied.args)) return fail('INVALID');
      const callId = supplied.callId;
      if (calls.has(callId)) return fail('ADMISSION');
      const call = { recorder, accepted: false };
      calls.set(callId, call);
      try { await ack; } catch { return fail('ADMISSION'); }
      if (closed || stopped) return fail('ADMISSION');
      call.accepted = true;
    },
    stop(): void {
      if (closed || stopped) return;
      stopped = true; // Fence before any host callback; never retry or renew this episode.
      try {
        const now = Date.now();
        // The host and validator share the Stop timestamp; acquisition must not extend the deadline.
        const supplied = record(acquirePersistenceLease(now), ['signal', 'expiresAt']);
        if (supplied.signal === executionSignal || signalAborted(supplied.signal)
          || typeof supplied.expiresAt !== 'number' || !Number.isFinite(supplied.expiresAt)
          || supplied.expiresAt <= now || supplied.expiresAt > now + maxPersistenceLeaseMs) return fail('LEASE');
        // Mandatory host signal plus local revocation; never substitute an unbounded default signal.
        lease = Object.freeze({ signal: AbortSignal.any([supplied.signal as AbortSignal, revocation.signal]), expiresAt: supplied.expiresAt });
        deadline = setTimeout(expire, supplied.expiresAt - now);
        deadline.unref?.();
      } catch { return fail('LEASE'); }
    },
    permitFor(callId: string, recorder: object): HostCancellationRecordingPermit | null {
      const call = calls.get(callId);
      if (!stopped || !call?.accepted || call.recorder !== recorder) return null;
      try { read(); } catch { return null; }
      if (!call.permit) {
        call.permit = Object.freeze({});
        bindings.set(call.permit, { identity, callId, recorder, read });
      }
      return call.permit;
    },
    close(): void {
      if (closed) return;
      closed = true;
      if (deadline !== undefined) clearTimeout(deadline);
      revocation.abort(new Error('HOST_CANCELLATION_RECORDING_CLOSED'));
      calls.clear();
    },
  });
  return Object.freeze({ lookup: (owner: object, signal: AbortSignal) => !closed && owner === executionIdentity && signal === executionSignal ? handle : null });
}

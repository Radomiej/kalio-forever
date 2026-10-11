import type { ChatDurableEvidenceReaderPort, HostDispatchApproval, HostHitlExecutionCommit,
  HostRuntimeReceiptIdentity, HostRuntimeToolAdmission, HostResolvedToolDispatch, HostRuntimeToolCommit, ToolResult } from '@kalio/types';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { and, eq, sql } from 'drizzle-orm';
import { hostDispatchReceipts } from '../../database/schema';
import type { KalioDrizzleDatabase } from '../../database/sqlite-runtime';
import { detachHostReceiptArgs } from './llm-turn-runtime-dispatch';
import { readHostCancellationRecordingPermit, type HostCancellationRecordingPermit } from './host-cancellation-recording-scope';

export type HostDispatchReceiptKey = HostRuntimeReceiptIdentity & { readonly callId: string };
export interface HostDispatchReceiptV1 {
  readonly version: 1;
  readonly requestedName: string;
  readonly canonicalName: string | null;
  readonly argsSha256: string;
  readonly enteredTarget:
    | { readonly kind: 'kalio_registry'; readonly catalogEntryId: string; readonly executorImplementationId: string;
        readonly executorImplementationVersion: number; readonly requiresConfirmation: boolean }
    | { readonly kind: 'external_mcp'; readonly serverKey: string; readonly originalName: string }
    | null;
  readonly approval: HostDispatchApproval | null;
  readonly hitlCommit: HostHitlExecutionCommit | null;
  readonly registeredCommitAck: 'acknowledged' | 'not_registered';
  readonly result: { readonly messageId: string; readonly contentSha256: string;
    readonly contentUtf8Bytes: number; readonly status: ToolResult['status'] };
  readonly trustedBuildPlanRef?: { readonly id: string; readonly revision: number; readonly sha256: string };
}
export interface StoredHostDispatchReceipt {
  readonly key: HostDispatchReceiptKey;
  readonly payload: HostDispatchReceiptV1;
  readonly recordJson: string;
  readonly recordSha256: string;
  readonly createdAt: number;
}
/** These are trusted host composition boundaries, NOT model-accessible verifiers.
 * Dispatcher keeps capabilities in an identity map and mints only after actual
 * executor entry/result durability. Registry IDs must be explicitly registered;
 * names, function source, audit JSON and boolean approval are not authority.
 * Fixture adapters may implement these ports; production owners must bind real
 * registry/journal/HITL services. No default or synthetic fallback is provided. */
export interface HostDispatchReceiptPorts {
  readCapability(capability: object): { readonly key: HostDispatchReceiptKey; readonly payload: HostDispatchReceiptV1 } | null;
  readRegisteredTargetExact(target: NonNullable<HostDispatchReceiptV1['enteredTarget']>, signal?: AbortSignal): Promise<{
    readonly canonicalName: string; readonly target: NonNullable<HostDispatchReceiptV1['enteredTarget']>;
  } | null>;
  readHitlExact(key: HostDispatchReceiptKey, approval: Extract<HostDispatchApproval, { kind: 'durable_confirmation' }>,
    commit: HostHitlExecutionCommit, signal?: AbortSignal): Promise<{
      readonly identity: HostRuntimeReceiptIdentity; readonly callId: string; readonly toolName: string;
      readonly approval: Extract<HostDispatchApproval, { kind: 'durable_confirmation' }>;
      readonly commit: HostHitlExecutionCommit;
    } | null>;
  readJournalScopeExact(identity: HostRuntimeReceiptIdentity, signal?: AbortSignal): Promise<(HostRuntimeReceiptIdentity & { readonly revision: number }) | null>;
  readonly durableReader: ChatDurableEvidenceReaderPort;
}

const failure = (kind: string): never => { throw new Error(`HOST_DISPATCH_RECEIPT_${kind}`); };
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const bytesCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const keyFields = ['runId', 'sessionId', 'turnId', 'promptMessageId', 'callId'];
const identityFields = keyFields.slice(0, 4);

/** Read own data descriptors only; no accessors, proxies, symbols, hidden extras,
 * custom prototypes or coercion. Payload contains no arrays or raw arguments. */
function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) return failure('INVALID');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return failure('INVALID');
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || !required.includes(key) && !optional.includes(key))
    || required.some(key => !keys.includes(key))) return failure('INVALID');
  const detached: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return failure('INVALID');
    Object.defineProperty(detached, key, { enumerable: true, value: descriptor.value });
  }
  return detached;
}
function assert(condition: unknown): asserts condition { if (!condition) failure('INVALID'); }
/** Fail the wait even if a host port ignores the signal; no side-effect retry.
 * Late resolution/rejection is observed but never resumes receipt insertion. */
function abortWait<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => { cleanup(); reject(new Error('HOST_DISPATCH_RECEIPT_ABORTED')); };
    const cleanup = () => signal?.removeEventListener('abort', aborted);
    if (signal?.aborted) { aborted(); return; }
    signal?.addEventListener('abort', aborted, { once: true });
    Promise.resolve().then(() => {
      if (signal?.aborted) return failure('ABORTED');
      return task();
    }).then(value => { cleanup(); if (signal?.aborted) aborted(); else resolve(value); }, error => { cleanup(); reject(error); });
  });
}
function checkedKey(value: unknown): HostDispatchReceiptKey {
  const r = record(value, keyFields); assert(keyFields.every(key => text(r[key])));
  return Object.freeze({ runId: r.runId as string, sessionId: r.sessionId as string, turnId: r.turnId as string,
    promptMessageId: r.promptMessageId as string, callId: r.callId as string });
}
function checkedApproval(value: unknown): HostDispatchApproval | null {
  if (value === null) return null;
  const a = record(value, ['kind'], ['requestId', 'claimedRevision', 'reason']);
  if (a.kind === 'durable_confirmation') {
    record(value, ['kind', 'requestId', 'claimedRevision']); assert(text(a.requestId) && positive(a.claimedRevision));
    return Object.freeze({ kind: 'durable_confirmation', requestId: a.requestId, claimedRevision: a.claimedRevision });
  }
  record(value, ['kind', 'reason']);
  assert(a.kind === 'non_durable' && typeof a.reason === 'string'
    && ['not_required', 'policy', 'representative', 'subagent_auto', 'explicit_bypass', 'legacy_confirmation'].includes(a.reason));
  return Object.freeze({ kind: 'non_durable', reason: a.reason as Extract<HostDispatchApproval, { kind: 'non_durable' }>['reason'] });
}
function checkedPayload(value: unknown): HostDispatchReceiptV1 {
  const r = record(value, ['version', 'requestedName', 'canonicalName', 'argsSha256', 'enteredTarget', 'approval', 'hitlCommit', 'registeredCommitAck', 'result'], ['trustedBuildPlanRef']);
  assert(r.version === 1 && text(r.requestedName) && (r.canonicalName === null || text(r.canonicalName)) && digest(r.argsSha256));
  let target: HostDispatchReceiptV1['enteredTarget'] = null;
  if (r.enteredTarget !== null) {
    // Inspect discriminator descriptor before selecting its exact field set.
    const descriptor = r.enteredTarget && typeof r.enteredTarget === 'object' && !types.isProxy(r.enteredTarget)
      ? Object.getOwnPropertyDescriptor(r.enteredTarget, 'kind') : undefined;
    assert(descriptor && Object.hasOwn(descriptor, 'value'));
    if (descriptor.value === 'kalio_registry') {
      const t = record(r.enteredTarget, ['kind', 'catalogEntryId', 'executorImplementationId', 'executorImplementationVersion', 'requiresConfirmation']);
      assert(text(t.catalogEntryId) && text(t.executorImplementationId) && positive(t.executorImplementationVersion) && typeof t.requiresConfirmation === 'boolean');
      target = Object.freeze({ kind: 'kalio_registry', catalogEntryId: t.catalogEntryId,
        executorImplementationId: t.executorImplementationId, executorImplementationVersion: t.executorImplementationVersion, requiresConfirmation: t.requiresConfirmation });
    } else {
      const t = record(r.enteredTarget, ['kind', 'serverKey', 'originalName']);
      assert(t.kind === 'external_mcp' && text(t.serverKey) && text(t.originalName));
      target = Object.freeze({ kind: 'external_mcp', serverKey: t.serverKey, originalName: t.originalName });
    }
    assert(text(r.canonicalName));
  }
  let approval: HostDispatchApproval | null = null;
  if (r.approval !== null) {
    const a = record(r.approval, ['kind'], ['requestId', 'claimedRevision', 'reason']);
    if (a.kind === 'durable_confirmation') {
      record(r.approval, ['kind', 'requestId', 'claimedRevision']); assert(text(a.requestId) && positive(a.claimedRevision));
      approval = Object.freeze({ kind: 'durable_confirmation', requestId: a.requestId, claimedRevision: a.claimedRevision });
    } else {
      record(r.approval, ['kind', 'reason']);
      assert(a.kind === 'non_durable' && typeof a.reason === 'string'
        && ['not_required', 'policy', 'representative', 'subagent_auto', 'explicit_bypass', 'legacy_confirmation'].includes(a.reason));
      approval = Object.freeze({ kind: 'non_durable', reason: a.reason as Extract<HostDispatchApproval, { kind: 'non_durable' }>['reason'] });
    }
  }
  const result = record(r.result, ['messageId', 'contentSha256', 'contentUtf8Bytes', 'status']);
  assert(text(result.messageId) && digest(result.contentSha256) && bytesCount(result.contentUtf8Bytes)
    && typeof result.status === 'string' && ['success', 'error', 'cancelled'].includes(result.status));
  assert(r.registeredCommitAck === 'acknowledged' || r.registeredCommitAck === 'not_registered');
  let hitlCommit: HostHitlExecutionCommit | null = null;
  if (r.hitlCommit !== null) {
    const h = record(r.hitlCommit, ['requestId', 'claimedRevision', 'committedRevision', 'status', 'executionState', 'resultStatus']);
    assert(text(h.requestId) && positive(h.claimedRevision) && positive(h.committedRevision) && h.committedRevision > h.claimedRevision
      && h.status === 'approved' && h.executionState === 'tool_result_committed' && h.resultStatus === result.status
      && ((approval?.kind === 'durable_confirmation' && approval.requestId === h.requestId && approval.claimedRevision === h.claimedRevision)
        || (approval === null && target === null && r.canonicalName === null && result.status === 'cancelled'))
      && r.registeredCommitAck === 'acknowledged');
    hitlCommit = Object.freeze({ requestId: h.requestId, claimedRevision: h.claimedRevision, committedRevision: h.committedRevision,
      status: 'approved', executionState: 'tool_result_committed', resultStatus: h.resultStatus as ToolResult['status'] });
  }
  assert(approval?.kind !== 'durable_confirmation' || hitlCommit !== null);
  assert(target === null || approval !== null);
  assert(target !== null || result.status === 'cancelled');
  let build: HostDispatchReceiptV1['trustedBuildPlanRef'];
  if (Object.hasOwn(r, 'trustedBuildPlanRef')) {
    const b = record(r.trustedBuildPlanRef, ['id', 'revision', 'sha256']); assert(text(b.id) && positive(b.revision) && digest(b.sha256));
    build = Object.freeze({ id: b.id, revision: b.revision, sha256: b.sha256 });
  }
  return Object.freeze({ version: 1, requestedName: r.requestedName, canonicalName: r.canonicalName, argsSha256: r.argsSha256,
    enteredTarget: target, approval, hitlCommit, registeredCommitAck: r.registeredCommitAck,
    result: Object.freeze({ messageId: result.messageId, contentSha256: result.contentSha256,
      contentUtf8Bytes: result.contentUtf8Bytes, status: result.status as ToolResult['status'] }), ...(build ? { trustedBuildPlanRef: build } : {}) });
}

/** Single-local-DB threat model: insert-only application API, no signatures and
 * no claim to resist arbitrary SQL writers. Audits are corroboration only.
 * Status is host-minted: successful result content may be bare data, not an
 * authoritative ToolResult envelope. Neither native nor external execution
 * becomes BUILD-eligible merely by being recorded here. */
export function createHostDispatchReceiptStore(db: KalioDrizzleDatabase, ports: HostDispatchReceiptPorts) {
  const attempts = new WeakMap<object, Promise<StoredHostDispatchReceipt>>();
  const abort = (signal?: AbortSignal) => { if (signal?.aborted) failure('ABORTED'); };
  const where = (key: HostDispatchReceiptKey) => and(eq(hostDispatchReceipts.runId, key.runId),
    eq(hostDispatchReceipts.sessionId, key.sessionId), eq(hostDispatchReceipts.turnId, key.turnId),
    eq(hostDispatchReceipts.promptMessageId, key.promptMessageId), eq(hostDispatchReceipts.callId, key.callId));
  function rawRead(database: KalioDrizzleDatabase, key: HostDispatchReceiptKey) {
    return database.select({ runId: hostDispatchReceipts.runId, sessionId: hostDispatchReceipts.sessionId,
      turnId: hostDispatchReceipts.turnId, promptMessageId: hostDispatchReceipts.promptMessageId, callId: hostDispatchReceipts.callId,
      recordJson: hostDispatchReceipts.recordJson, recordSha256: hostDispatchReceipts.recordSha256,
      recordBytes: sql<unknown>`cast(${hostDispatchReceipts.recordJson} as blob)`, createdAt: sql<unknown>`${hostDispatchReceipts.createdAt}`,
    }).from(hostDispatchReceipts).where(where(key)).get();
  }
  function decode(row: NonNullable<ReturnType<typeof rawRead>>, key: HostDispatchReceiptKey): StoredHostDispatchReceipt {
    try {
      assert(keyFields.every(field => row[field as keyof typeof row] === key[field as keyof HostDispatchReceiptKey]));
      assert(typeof row.recordJson === 'string' && digest(row.recordSha256) && row.recordBytes instanceof Uint8Array);
      assert(Buffer.from(row.recordBytes).equals(Buffer.from(row.recordJson, 'utf8')) && hash(row.recordBytes) === row.recordSha256);
      assert(bytesCount(row.createdAt) && row.createdAt <= 8_640_000_000_000_000);
      const payload = checkedPayload(JSON.parse(row.recordJson) as unknown);
      // Our only writer emits this exact encoding; reject duplicate JSON keys,
      // unexpected fields or alternate encodings rather than silently normalize.
      assert(JSON.stringify(payload) === row.recordJson);
      return Object.freeze({ key, payload, recordJson: row.recordJson, recordSha256: row.recordSha256, createdAt: row.createdAt });
    } catch { return failure('CORRUPT'); }
  }
  async function verify(key: HostDispatchReceiptKey, payload: HostDispatchReceiptV1, signal?: AbortSignal) {
    abort(signal);
    const identity = Object.freeze({ runId: key.runId, sessionId: key.sessionId, turnId: key.turnId, promptMessageId: key.promptMessageId });
    const scope = await abortWait(() => ports.readJournalScopeExact(identity, signal), signal); abort(signal);
    if (!scope) failure('AUTHORITY');
    const s = record(scope, [...identityFields, 'revision']);
    if (!positive(s.revision) || identityFields.some(field => s[field] !== identity[field as keyof typeof identity])) failure('AUTHORITY');
    if (payload.enteredTarget) {
      const registered = await abortWait(() => ports.readRegisteredTargetExact(payload.enteredTarget!, signal), signal); abort(signal);
      if (!registered) failure('AUTHORITY');
      const r = record(registered, ['canonicalName', 'target']);
      const checked = checkedPayload({ ...payload, enteredTarget: r.target });
      if (r.canonicalName !== payload.canonicalName || JSON.stringify(checked.enteredTarget) !== JSON.stringify(payload.enteredTarget)) failure('AUTHORITY');
    }
    const locator = { messageId: payload.result.messageId, sessionId: key.sessionId, turnId: key.turnId,
      promptMessageId: key.promptMessageId, toolCallId: key.callId, role: 'tool_result' as const };
    // Existing shared SQLite reader is fast/synchronous internally; its protected
    // contract stays unchanged. Race its wait without claiming underlying cancellation.
    const result = await abortWait(() => ports.durableReader.readToolResultExact(locator), signal); abort(signal);
    if (!result || Object.entries(locator).some(([field, value]) => result[field as keyof typeof result] !== value)
      || result.contentSha256 !== payload.result.contentSha256 || result.contentUtf8Bytes !== payload.result.contentUtf8Bytes
      || typeof result.content !== 'string' || hash(result.content) !== result.contentSha256
      || Buffer.byteLength(result.content, 'utf8') !== result.contentUtf8Bytes) failure('AUTHORITY');
    if (payload.hitlCommit) {
      const commit = payload.hitlCommit;
      // Lookup candidate only: a cancellation before resolution has no approval
      // authority. The exact durable claim and six-field commit must be read back.
      const approval = payload.approval?.kind === 'durable_confirmation' ? payload.approval
        : Object.freeze({ kind: 'durable_confirmation' as const, requestId: commit.requestId, claimedRevision: commit.claimedRevision });
      const hitl = await abortWait(() => ports.readHitlExact(key, approval, commit, signal), signal); abort(signal);
      if (!hitl) failure('AUTHORITY');
      const h = record(hitl, ['identity', 'callId', 'toolName', 'approval', 'commit']);
      const i = record(h.identity, identityFields);
      const checked = checkedPayload({ ...payload, approval: h.approval, hitlCommit: h.commit });
      if (identityFields.some(field => i[field] !== identity[field as keyof typeof identity]) || h.callId !== key.callId
        || h.toolName !== (payload.canonicalName ?? payload.requestedName)
        || JSON.stringify(checked.approval) !== JSON.stringify(approval)
        || JSON.stringify(checked.hitlCommit) !== JSON.stringify(payload.hitlCommit)) failure('AUTHORITY');
    }
    abort(signal);
  }
  return {
    async readExact(locator: HostDispatchReceiptKey, signal?: AbortSignal): Promise<StoredHostDispatchReceipt | null> {
      abort(signal); const key = checkedKey(locator);
      let row;
      try { row = rawRead(db, key); } catch { return failure('STORAGE'); }
      if (!row) return null;
      const receipt = decode(row, key); await verify(key, receipt.payload, signal);
      // Recheck exact bytes after asynchronous authority reads; never substitute
      // a new row/version or return a snapshot that disappeared during awaits.
      let fresh;
      try { fresh = rawRead(db, key); } catch { return failure('STORAGE'); }
      if (!fresh) return failure('CONFLICT');
      const current = decode(fresh, key);
      if (current.recordJson !== receipt.recordJson || current.recordSha256 !== receipt.recordSha256 || current.createdAt !== receipt.createdAt) failure('CONFLICT');
      return current;
    },
    append(capability: object, signal?: AbortSignal, recheck?: () => void): Promise<StoredHostDispatchReceipt> {
      if (!capability || typeof capability !== 'object' || types.isProxy(capability)) return Promise.reject(new Error('HOST_DISPATCH_RECEIPT_CAPABILITY'));
      const prior = attempts.get(capability);
      if (prior) return signal?.aborted ? Promise.reject(new Error('HOST_DISPATCH_RECEIPT_ABORTED')) : prior;
      const attempt = Promise.resolve().then(async () => {
        abort(signal);
        const bound = ports.readCapability(capability);
        if (!bound) return failure('CAPABILITY');
        const b = record(bound, ['key', 'payload']); const key = checkedKey(b.key); const payload = checkedPayload(b.payload);
        await verify(key, payload, signal);
        recheck?.();
        const recordJson = JSON.stringify(payload); const recordSha256 = hash(recordJson);
        abort(signal);
        try {
          return db.transaction(tx => {
            recheck?.(); abort(signal);
            const existing = rawRead(tx, key);
            if (existing) {
              const decoded = decode(existing, key);
              if (decoded.recordJson !== recordJson || decoded.recordSha256 !== recordSha256) return failure('CONFLICT');
              return decoded;
            }
            recheck?.(); abort(signal);
            tx.insert(hostDispatchReceipts).values({ ...key, recordJson, recordSha256, createdAt: new Date() }).run();
            const saved = rawRead(tx, key);
            if (!saved) return failure('STORAGE');
            const decoded = decode(saved, key);
            if (decoded.recordJson !== recordJson || decoded.recordSha256 !== recordSha256) return failure('CONFLICT');
            return decoded;
          });
        } catch (error) {
          if (error instanceof Error && /^(HOST_DISPATCH_RECEIPT_(CONFLICT|CORRUPT|STORAGE|ABORTED)|HOST_CANCELLATION_RECORDING_[A-Z]+)$/.test(error.message)) throw error;
          return failure('STORAGE');
        }
      });
      // Retain rejection: no implicit side-effect retry after failed waits.
      attempts.set(capability, attempt); return attempt;
    },
  };
}

export interface HostDispatchReceiptRecorderPorts extends Omit<HostDispatchReceiptPorts, 'readCapability'> {
  /** Must compare captured entryIdentity/executorIdentity with the actual host
   * registry objects, then return their registered stable metadata. No name-only
   * resolution, invented version or missing-field fallback is permitted. */
  captureRegisteredTarget(receipt: HostResolvedToolDispatch, signal?: AbortSignal): Promise<
    Extract<NonNullable<HostDispatchReceiptV1['enteredTarget']>, { kind: 'kalio_registry' }> | null>;
}

/** Host-only per-call factory. resolved is a pre-entry gate; entered is a
 * synchronous hook invoked immediately before the captured executor is called.
 * Parent owns hooking these callbacks into dispatch; this helper activates none.
 * Capabilities are private identities, never JSON input or audit-derived proof. */
export function createHostDispatchReceiptRecorder(db: KalioDrizzleDatabase, ports: HostDispatchReceiptRecorderPorts) {
  const capabilities = new WeakMap<object, { key: HostDispatchReceiptKey; payload: HostDispatchReceiptV1 }>();
  const store = createHostDispatchReceiptStore(db, { ...ports, readCapability: capability => capabilities.get(capability) ?? null });
  return {
    readExact: store.readExact,
    createCallRecorder(admission: HostRuntimeToolAdmission, signal?: AbortSignal) {
      const a = record(admission, ['identity', 'callId', 'toolName', 'args']);
      const identity = record(a.identity, identityFields);
      const key = checkedKey({ ...identity, callId: a.callId }); assert(text(a.toolName));
      const args = detachHostReceiptArgs(a.args as Record<string, unknown>);
      const argsJson = JSON.stringify(args, (_key, value: unknown) => {
        // JSON dropping undefined would silently merge distinct descriptors.
        if (value === undefined) return failure('INVALID'); return value;
      });
      const argsSha256 = hash(argsJson); const requestedName = a.toolName;
      let resolved: HostResolvedToolDispatch | null = null;
      let captured: HostDispatchReceiptV1['enteredTarget'] = null;
      let entered = false; let poisoned = false; let resolving = false;
      let commitAttempt: Promise<StoredHostDispatchReceipt> | undefined;
      let originalCommit: HostRuntimeToolCommit | undefined;
      let originalResolved: HostResolvedToolDispatch | null = null;
      let originalPermit: HostCancellationRecordingPermit | undefined;
      let cancellationAttempt = false;
      function checkIdentity(value: unknown) {
        const r = record(value, identityFields);
        assert(identityFields.every(field => r[field] === key[field as keyof HostDispatchReceiptKey]));
      }
      function guard() { if (poisoned || commitAttempt || signal?.aborted) failure(signal?.aborted ? 'ABORTED' : 'CAPABILITY'); }
      function commit(receipt: HostRuntimeToolCommit, permit?: HostCancellationRecordingPermit, cancelled = false): Promise<StoredHostDispatchReceipt> {
        if (commitAttempt) return receipt === originalCommit && cancelled === cancellationAttempt && permit === originalPermit
          ? commitAttempt : Promise.reject(new Error('HOST_DISPATCH_RECEIPT_CONFLICT'));
        originalCommit = receipt; originalPermit = permit; cancellationAttempt = cancelled;
        commitAttempt = Promise.resolve().then(async () => {
          if (poisoned || resolving) return failure('CAPABILITY');
          const recheck = cancelled ? () => {
            assert(signal?.aborted);
            return readHostCancellationRecordingPermit(permit!, { runId: key.runId, sessionId: key.sessionId,
              turnId: key.turnId, promptMessageId: key.promptMessageId }, key.callId, recorder);
          } : undefined;
          const persistenceSignal = recheck ? recheck().signal : signal;
          const r = record(receipt, ['identity', 'callId', 'toolName', 'persistedMessageId', 'contentSha256', 'status', 'registeredCommitAck', 'resolvedDispatch', 'hitlCommit']);
          checkIdentity(r.identity); assert(r.callId === key.callId && r.toolName === requestedName
            && r.resolvedDispatch === (entered ? originalResolved : null) && (!cancelled || r.status === 'cancelled'));
          const result = await abortWait(() => ports.durableReader.readToolResultExact({ messageId: r.persistedMessageId as string,
            sessionId: key.sessionId, turnId: key.turnId, promptMessageId: key.promptMessageId, toolCallId: key.callId, role: 'tool_result' }), persistenceSignal);
          recheck?.();
          if (!result) return failure('AUTHORITY');
          const payload = checkedPayload({ version: 1, requestedName, canonicalName: resolved?.canonicalName ?? null, argsSha256,
            enteredTarget: entered ? captured : null, approval: resolved?.approval ?? null, hitlCommit: r.hitlCommit,
            registeredCommitAck: r.registeredCommitAck, result: { messageId: r.persistedMessageId, contentSha256: r.contentSha256,
              contentUtf8Bytes: result.contentUtf8Bytes, status: r.status } });
          const capability = {}; capabilities.set(capability, { key, payload });
          const saved = await store.append(capability, persistenceSignal, recheck);
          recheck?.(); return saved;
        });
        return commitAttempt;
      }
      const recorder = {
        async resolved(receipt: HostResolvedToolDispatch): Promise<void> {
          try {
            guard(); assert(!resolved && !resolving); resolving = true;
            const r = record(receipt, ['identity', 'callId', 'requestedName', 'canonicalName', 'args', 'target', 'approval']);
            checkIdentity(r.identity); assert(r.callId === key.callId && r.requestedName === requestedName && text(r.canonicalName));
            const detached = detachHostReceiptArgs(r.args as Record<string, unknown>);
            assert(JSON.stringify(detached) === argsJson);
            const t = record(r.target, ['kind'], ['entryIdentity', 'executorIdentity', 'requiresConfirmation', 'serverKey', 'originalName']);
            if (t.kind === 'kalio_registry') {
              record(r.target, ['kind', 'entryIdentity', 'executorIdentity', 'requiresConfirmation']);
              const current = await abortWait(() => ports.captureRegisteredTarget(receipt, signal), signal);
              if (!current) failure('AUTHORITY');
              const c = record(current, ['kind', 'catalogEntryId', 'executorImplementationId', 'executorImplementationVersion', 'requiresConfirmation']);
              assert(c.kind === 'kalio_registry' && text(c.catalogEntryId) && text(c.executorImplementationId)
                && positive(c.executorImplementationVersion) && typeof c.requiresConfirmation === 'boolean' && c.requiresConfirmation === t.requiresConfirmation);
              captured = Object.freeze({ kind: 'kalio_registry', catalogEntryId: c.catalogEntryId, executorImplementationId: c.executorImplementationId,
                executorImplementationVersion: c.executorImplementationVersion, requiresConfirmation: c.requiresConfirmation });
            } else {
              const external = record(r.target, ['kind', 'serverKey', 'originalName']);
              assert(external.kind === 'external_mcp' && text(external.serverKey) && text(external.originalName));
              captured = { kind: 'external_mcp', serverKey: external.serverKey, originalName: external.originalName };
            }
            const approval = checkedApproval(r.approval); assert(approval);
            resolved = Object.freeze({ identity: Object.freeze({ runId: key.runId, sessionId: key.sessionId, turnId: key.turnId, promptMessageId: key.promptMessageId }),
              callId: key.callId, requestedName, canonicalName: r.canonicalName, args: detached,
              target: receipt.target, approval });
            // Original receipt identity is tracked separately for entry matching.
            originalResolved = receipt;
          } catch (error) { poisoned = true; throw error; } finally { resolving = false; }
        },
        entered(receipt: HostResolvedToolDispatch): void {
          try { guard(); assert(!resolving && resolved && receipt === originalResolved && !entered); entered = true; }
          catch (error) { poisoned = true; throw error; }
        },
        commit(receipt: HostRuntimeToolCommit): Promise<StoredHostDispatchReceipt> {
          return commit(receipt);
        },
        recordCancelled(receipt: HostRuntimeToolCommit, permit: HostCancellationRecordingPermit): Promise<StoredHostDispatchReceipt> {
          return commit(receipt, permit, true);
        },
      };
      return recorder;
    },
  };
}

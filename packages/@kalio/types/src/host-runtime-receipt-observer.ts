import type { ChatRunSnapshot, ToolResult } from './index';

export interface HostRuntimeReceiptIdentity {
  readonly runId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly promptMessageId: string;
}

export interface HostRuntimeToolAdmission {
  readonly identity: HostRuntimeReceiptIdentity;
  readonly callId: string;
  readonly toolName: string;
  readonly args: Readonly<Record<string, unknown>>;
}

/** In-memory resolved authority, never serialized as proof. Durable confirmation is NOT human-origin proof. */
export type HostDispatchApproval =
  | { readonly kind: 'durable_confirmation'; readonly requestId: string; readonly claimedRevision: number }
  | { readonly kind: 'non_durable'; readonly reason: 'not_required' | 'policy' | 'representative' | 'subagent_auto' | 'explicit_bypass' | 'legacy_confirmation' };

export interface HostResolvedToolDispatch {
  readonly identity: HostRuntimeReceiptIdentity;
  readonly callId: string;
  readonly requestedName: string;
  readonly canonicalName: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly target:
    | { readonly kind: 'kalio_registry'; readonly entryIdentity: object; readonly executorIdentity: object; readonly requiresConfirmation: boolean }
    | { readonly kind: 'external_mcp'; readonly serverKey: string; readonly originalName: string };
  readonly approval: HostDispatchApproval;
}

export interface HostHitlExecutionCommit {
  readonly requestId: string;
  readonly claimedRevision: number;
  readonly committedRevision: number;
  readonly status: 'approved';
  readonly executionState: 'tool_result_committed';
  readonly resultStatus: ToolResult['status'];
}

export interface HostRuntimeToolCommit {
  readonly identity: HostRuntimeReceiptIdentity;
  readonly callId: string;
  readonly toolName: string;
  readonly persistedMessageId: string;
  /** SHA-256 of the exact saved result string encoded as UTF-8. */
  readonly contentSha256: string;
  readonly status: ToolResult['status'];
  readonly registeredCommitAck: 'acknowledged' | 'not_registered';
  /** Null when resolution/approval/abort prevented entry into the executor. */
  readonly resolvedDispatch: HostResolvedToolDispatch | null;
  /** Actual transactional HITL read-back; boolean ACKs never imply this receipt. */
  readonly hitlCommit: HostHitlExecutionCommit | null;
}

/**
 * Host-created object capability, passed only in memory. Never serialize into
 * model/provider context, tool arguments, audit metadata or replay records.
 * The host closure owns producer/verifier, policy and approved project scope.
 * Admission must verify metadata/resolved tool identity: args alone are not a
 * trusted execution descriptor. Every rejected wait fails closed, without retry.
 */
export interface HostRuntimeReceiptObserver {
  admit(call: HostRuntimeToolAdmission): Promise<void>;
  /** Optional host gate at actual dispatch, before the captured executor is entered. */
  resolvedDispatch?(receipt: HostResolvedToolDispatch): Promise<void>;
  commit(receipt: HostRuntimeToolCommit): Promise<void>;
  drain(identity: HostRuntimeReceiptIdentity): Promise<void>;
  journalComplete(identity: HostRuntimeReceiptIdentity, completed: ChatRunSnapshot & {
    revision: number;
    status: 'completed';
    phase: 'completed';
  }): Promise<void>;
}

/** Backend-only persistence evidence. These records do NOT prove trusted dispatch
 * origin, architecture goal scope, build approval or completion authorization.
 * Shared contract requires parent/PR review before merge. */
import type { ChatRunPhase, ChatRunStatus } from './index';

export const CHAT_DURABLE_EVIDENCE_READER = 'CHAT_DURABLE_EVIDENCE_READER';

export interface DurableToolResultLocator {
  messageId: string;
  sessionId: string;
  turnId: string;
  promptMessageId: string;
  toolCallId: string;
  role: 'tool_result';
}
export interface DurableToolResultRecord extends DurableToolResultLocator {
  /** Exact persisted text, never parsed/reserialized, trimmed or truncated. */
  content: string;
  contentUtf8Bytes: number;
  /** Lowercase SHA-256 of content encoded as UTF-8. */
  contentSha256: string;
  createdAt: number;
}
export interface CompletedChatRunLocator {
  /** Chat journal primary key, NOT architecture runId. */
  chatRunId: string;
  sessionId: string;
  turnId: string;
  revision: number;
  promptMessageId: string;
  terminalMessageId: string;
}
export interface CompletedChatRunRecord {
  chatRunId: string;
  sessionId: string;
  turnId: string;
  revision: number;
  phase: 'completed';
  status: 'completed';
  completedAt: number;
  updatedAt: number;
  terminalMessageId: string;
  promptMessageId: string;
}
export interface ChatDurableEvidenceReaderPort {
  /** Null means no exact eligible persisted match. Invalid input/corruption/driver
   * failure throws a static error; no legacy identity or chronological fallback. */
  readToolResultExact(locator: DurableToolResultLocator): Promise<DurableToolResultRecord | null>;
  readCompletedRunExact(locator: CompletedChatRunLocator): Promise<CompletedChatRunRecord | null>;
}

export type NonCompletedTerminalChatRunStatus = Extract<ChatRunStatus, 'failed' | 'cancelled' | 'interrupted'>;
export interface TerminalChatRunLocator {
  readonly chatRunId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly promptMessageId: string;
  readonly revision: number;
  readonly status: NonCompletedTerminalChatRunStatus;
  /** Actual persisted phase; cancellation has no synthetic cancelled phase. */
  readonly phase: ChatRunPhase;
  /** Exact expected outcome linkage, or explicit absence of linkage. */
  readonly outcomeMessageId: string | null;
}
export interface TerminalChatRunRecord extends TerminalChatRunLocator {
  readonly updatedAt: number;
  readonly completedAt: number | null;
  /** Null means SQL-null outcome, not an outcome object missing messageId. */
  readonly outcome: {
    readonly messageId: string | null;
    readonly outcomeUtf8Bytes: number;
    readonly outcomeSha256: string;
  } | null;
}
/** Additive persistence-only extension; does not prove drain or BUILD eligibility. */
export interface ChatTerminalJournalEvidenceReaderPort extends ChatDurableEvidenceReaderPort {
  readTerminalRunExact(locator: TerminalChatRunLocator): Promise<TerminalChatRunRecord | null>;
}

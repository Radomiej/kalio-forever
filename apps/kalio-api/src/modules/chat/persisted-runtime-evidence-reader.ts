import { Injectable } from '@nestjs/common';
import type { ChatTerminalJournalEvidenceReaderPort, TerminalChatRunLocator, TerminalChatRunRecord, DurableToolResultLocator, DurableToolResultRecord, CompletedChatRunLocator, CompletedChatRunRecord } from '@kalio/types';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { and, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { DrizzleService } from '../../database/drizzle.service';
import { messages, chatRuns } from '../../database/schema';

const fail = (code: string): never => { throw new Error(code); };
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Flat exact locators: inspect descriptors before reading values, reject proxies
 * before invoking reflection traps, and never coerce/trim opaque identities. */
function checkedLocator<T>(raw: T, keys: readonly string[], revision = false, terminal = false): T {
  const invalid = (): never => fail('DURABLE_EVIDENCE_INVALID_INPUT');
  if (!raw || typeof raw !== 'object' || types.isProxy(raw) || Array.isArray(raw)) return invalid();
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const own = Reflect.ownKeys(raw);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) return invalid();
  const entries = keys.map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return invalid();
    const value: unknown = descriptor.value;
    if (revision && key === 'revision') {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return invalid();
    } else if (!(terminal && key === 'outcomeMessageId' && value === null) && !nonempty(value)) return invalid();
    if (terminal && key === 'status' && !['failed', 'cancelled', 'interrupted'].includes(String(value))) return invalid();
    if (terminal && key === 'phase' && !['queued', 'started', 'llm_streaming', 'tool_pending', 'tool_running', 'completed', 'interrupted', 'failed'].includes(String(value))) return invalid();
    if (key === 'role' && value !== 'tool_result') return invalid();
    return [key, value];
  });
  return Object.fromEntries(entries) as T;
}
function timestamp(value: unknown): number {
  const ms = value instanceof Date ? value.getTime() : value;
  if (typeof ms !== 'number' || !Number.isSafeInteger(ms) || ms < 0 || ms > 8_640_000_000_000_000) return fail('DURABLE_EVIDENCE_CORRUPT');
  return ms;
}

@Injectable()
export class PersistedRuntimeEvidenceReader implements ChatTerminalJournalEvidenceReaderPort {
  constructor(private readonly drizzle: DrizzleService) {}
  async readToolResultExact(locator: DurableToolResultLocator): Promise<DurableToolResultRecord | null> {
    const key = checkedLocator(locator, ['messageId', 'sessionId', 'turnId', 'promptMessageId', 'toolCallId', 'role']);
    let row;
    try {
      row = this.drizzle.db.select({ messageId: messages.id, sessionId: messages.sessionId, turnId: messages.turnId,
        promptMessageId: messages.promptMessageId, toolCallId: messages.toolCallId, role: messages.role,
        content: messages.content, contentBytes: sql<unknown>`cast(${messages.content} as blob)`,
        createdAt: sql<unknown>`${messages.createdAt}` }).from(messages).where(and(
        eq(messages.id, key.messageId), eq(messages.sessionId, key.sessionId), eq(messages.turnId, key.turnId),
        eq(messages.promptMessageId, key.promptMessageId), eq(messages.toolCallId, key.toolCallId), eq(messages.role, 'tool_result'),
      )).get();
    } catch { return fail('DURABLE_EVIDENCE_STORAGE_ERROR'); }
    if (!row) return null;
    if (typeof row.content !== 'string' || row.role !== 'tool_result' || row.messageId !== key.messageId
      || row.sessionId !== key.sessionId || row.turnId !== key.turnId || row.promptMessageId !== key.promptMessageId
      || row.toolCallId !== key.toolCallId) return fail('DURABLE_EVIDENCE_CORRUPT');
    if (!(row.contentBytes instanceof Uint8Array)) return fail('DURABLE_EVIDENCE_CORRUPT');
    const bytes = Buffer.from(row.contentBytes);
    if (!bytes.equals(Buffer.from(row.content, 'utf8'))) return fail('DURABLE_EVIDENCE_CORRUPT');
    return { messageId: row.messageId, sessionId: row.sessionId, turnId: row.turnId,
      promptMessageId: row.promptMessageId, toolCallId: row.toolCallId, role: 'tool_result', content: row.content,
      contentUtf8Bytes: bytes.length, contentSha256: createHash('sha256').update(bytes).digest('hex'), createdAt: timestamp(row.createdAt) };
  }

  async readTerminalRunExact(locator: TerminalChatRunLocator): Promise<TerminalChatRunRecord | null> {
    const key = checkedLocator(locator, ['chatRunId', 'sessionId', 'turnId', 'promptMessageId', 'revision', 'status', 'phase', 'outcomeMessageId'], true, true);
    const prompt = alias(messages, 'exact_prompt');
    const terminal = alias(messages, 'exact_terminal');
    let row;
    try {
      // One snapshot with exact local prompt and optional exact outcome assistant.
      row = this.drizzle.db.select({ outcomeJson: sql<unknown>`${chatRuns.outcome}`,
        outcomeBytes: sql<unknown>`cast(${chatRuns.outcome} as blob)`,
        updatedAt: sql<unknown>`${chatRuns.updatedAt}`, completedAt: sql<unknown>`${chatRuns.completedAt}`,
        promptCreatedAt: sql<unknown>`${prompt.createdAt}`, terminalMessageId: terminal.id,
        terminalCreatedAt: sql<unknown>`${terminal.createdAt}`,
      }).from(chatRuns).innerJoin(prompt, and(eq(prompt.id, key.promptMessageId),
        eq(prompt.sessionId, chatRuns.sessionId), eq(prompt.turnId, chatRuns.turnId),
        eq(prompt.promptMessageId, prompt.id), eq(prompt.role, 'user')))
        .leftJoin(terminal, and(key.outcomeMessageId === null ? sql`0` : eq(terminal.id, key.outcomeMessageId),
          eq(terminal.sessionId, chatRuns.sessionId), eq(terminal.turnId, chatRuns.turnId),
          eq(terminal.promptMessageId, key.promptMessageId), eq(terminal.role, 'assistant')))
        .where(and(eq(chatRuns.id, key.chatRunId), eq(chatRuns.sessionId, key.sessionId), eq(chatRuns.turnId, key.turnId),
          eq(chatRuns.revision, key.revision), eq(chatRuns.status, key.status), eq(chatRuns.phase, key.phase))).get();
    } catch { return fail('DURABLE_EVIDENCE_STORAGE_ERROR'); }
    if (!row) return null;
    let outcome: TerminalChatRunRecord['outcome'] = null;
    if (row.outcomeJson !== null) {
      if (typeof row.outcomeJson !== 'string' || !(row.outcomeBytes instanceof Uint8Array)) return fail('DURABLE_EVIDENCE_CORRUPT');
      const bytes = Buffer.from(row.outcomeBytes);
      if (!bytes.equals(Buffer.from(row.outcomeJson, 'utf8'))) return fail('DURABLE_EVIDENCE_CORRUPT');
      let parsed: unknown;
      try { parsed = JSON.parse(row.outcomeJson) as unknown; } catch { return fail('DURABLE_EVIDENCE_CORRUPT'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('DURABLE_EVIDENCE_CORRUPT');
      const messageId: unknown = Object.hasOwn(parsed, 'messageId') ? (parsed as Record<string, unknown>).messageId : null;
      if (Object.hasOwn(parsed, 'messageId') && !nonempty(messageId)) return fail('DURABLE_EVIDENCE_CORRUPT');
      if (messageId !== key.outcomeMessageId) return null;
      outcome = { messageId: key.outcomeMessageId, outcomeUtf8Bytes: bytes.length,
        outcomeSha256: createHash('sha256').update(bytes).digest('hex') };
    } else if (key.outcomeMessageId !== null) return null;
    if (key.outcomeMessageId !== null) {
      if (row.terminalMessageId !== key.outcomeMessageId) return null;
      timestamp(row.terminalCreatedAt);
    }
    timestamp(row.promptCreatedAt);
    return { ...key, updatedAt: timestamp(row.updatedAt), completedAt: row.completedAt === null ? null : timestamp(row.completedAt), outcome };
  }

  async readCompletedRunExact(locator: CompletedChatRunLocator): Promise<CompletedChatRunRecord | null> {
    const key = checkedLocator(locator, ['chatRunId', 'sessionId', 'turnId', 'revision', 'promptMessageId', 'terminalMessageId'], true);
    let row;
    try {
      // One exact joined SQLite read, not separate/latest/chronological lookups.
      row = this.drizzle.db.select({ chatRunId: chatRuns.id, sessionId: chatRuns.sessionId, turnId: chatRuns.turnId,
        revision: chatRuns.revision, phase: chatRuns.phase, status: chatRuns.status,
        outcomeJson: sql<unknown>`${chatRuns.outcome}`, completedAt: sql<unknown>`${chatRuns.completedAt}`,
        updatedAt: sql<unknown>`${chatRuns.updatedAt}`, terminalMessageId: messages.id,
        promptMessageId: messages.promptMessageId, terminalCreatedAt: sql<unknown>`${messages.createdAt}`,
      }).from(chatRuns).innerJoin(messages, and(
        eq(messages.id, key.terminalMessageId), eq(messages.sessionId, chatRuns.sessionId), eq(messages.turnId, chatRuns.turnId),
        eq(messages.promptMessageId, key.promptMessageId), eq(messages.role, 'assistant'),
      )).where(and(eq(chatRuns.id, key.chatRunId), eq(chatRuns.sessionId, key.sessionId), eq(chatRuns.turnId, key.turnId),
        eq(chatRuns.revision, key.revision), eq(chatRuns.phase, 'completed'), eq(chatRuns.status, 'completed'))).get();
    } catch { return fail('DURABLE_EVIDENCE_STORAGE_ERROR'); }
    if (!row) return null;
    if (row.outcomeJson === null) return null;
    let outcome: unknown;
    try {
      if (typeof row.outcomeJson !== 'string') return fail('DURABLE_EVIDENCE_CORRUPT');
      outcome = JSON.parse(row.outcomeJson) as unknown;
    } catch { return fail('DURABLE_EVIDENCE_CORRUPT'); }
    if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) return fail('DURABLE_EVIDENCE_CORRUPT');
    if (!Object.hasOwn(outcome, 'messageId') || (outcome as Record<string, unknown>).messageId !== key.terminalMessageId) return null;
    if (row.chatRunId !== key.chatRunId || row.sessionId !== key.sessionId || row.turnId !== key.turnId
      || row.revision !== key.revision || row.phase !== 'completed' || row.status !== 'completed'
      || row.terminalMessageId !== key.terminalMessageId || row.promptMessageId !== key.promptMessageId) return fail('DURABLE_EVIDENCE_CORRUPT');
    timestamp(row.terminalCreatedAt);
    return { chatRunId: row.chatRunId, sessionId: row.sessionId, turnId: row.turnId, revision: row.revision,
      phase: 'completed', status: 'completed', completedAt: timestamp(row.completedAt), updatedAt: timestamp(row.updatedAt),
      terminalMessageId: row.terminalMessageId, promptMessageId: row.promptMessageId };
  }
}

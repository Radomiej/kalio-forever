import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql, type SQLWrapper } from 'drizzle-orm';
import type { ToolApprovalContextBinding, ToolApprovalContextPort, ToolApprovalContextSnapshot } from '../common/tool-approval-context.port';
import { DrizzleService } from './drizzle.service';
import { auditLog, chatRuns, messages, projects, sessions } from './schema';
import type { KalioDrizzleDatabase } from './sqlite-runtime';

const MAX_BYTES = 48 * 1024;
const SESSION_KINDS = new Set(['chat', 'subagent', 'cli-agent', 'agent-flow']);
const PROJECT_KINDS = new Set(['workspace', 'none', 'external', 'audit', 'other']);
type Snapshot = ToolApprovalContextSnapshot;
type ReadTransaction = Parameters<Parameters<KalioDrizzleDatabase['transaction']>[0]>[0];

// Bound returned values before materializing text; NULL means overflow, never truncation.
function boundedText(value: SQLWrapper) {
  return sql<string | null>`CASE WHEN length(CAST(${value} AS BLOB)) <= ${MAX_BYTES} THEN ${value} ELSE NULL END`;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

@Injectable()
export class ToolApprovalContextService implements ToolApprovalContextPort {
  constructor(private readonly drizzle: DrizzleService) {}

  read(binding: ToolApprovalContextBinding): Snapshot | null {
    // Copy only host coordinates, in canonical property order. No caller extra properties enter the hash.
    const selected = { sessionId: binding.sessionId, runId: binding.runId,
      turnId: binding.turnId, promptMessageId: binding.promptMessageId };
    if (!Object.values(selected).every(nonempty) || Buffer.byteLength(JSON.stringify(selected), 'utf8') > MAX_BYTES) return null;
    try {
      // Deferred SQLite transaction: SELECT only, works with PRAGMA query_only / a read-only connection.
      return this.drizzle.db.transaction(tx => this.select(tx, selected), { behavior: 'deferred' });
    } catch {
      // Deliberately omit the driver error and cause: both may contain private SQL or prompt data.
      throw new Error('Tool approval context database read failed.');
    }
  }

  isCurrent(binding: ToolApprovalContextBinding, fingerprint: string): boolean {
    return this.read(binding)?.fingerprint === fingerprint;
  }

  private select(tx: ReadTransaction, binding: ToolApprovalContextBinding): Snapshot | null {
    const currentAdmission = sql`NOT EXISTS (
      SELECT 1 FROM chat_runs AS newer WHERE newer.session_id = chat_runs.session_id
        AND (newer.queued_at IS NULL OR newer.queue_claimed_at IS NOT NULL)
        AND (COALESCE(newer.queue_claimed_at, newer.started_at) > COALESCE(chat_runs.queue_claimed_at, chat_runs.started_at)
          OR (COALESCE(newer.queue_claimed_at, newer.started_at) = COALESCE(chat_runs.queue_claimed_at, chat_runs.started_at)
            AND newer.rowid > chat_runs.rowid)))`;
    const run = tx.select({ id: chatRuns.id }).from(chatRuns).where(and(
      eq(chatRuns.id, binding.runId), eq(chatRuns.sessionId, binding.sessionId), eq(chatRuns.turnId, binding.turnId),
      inArray(chatRuns.status, ['active', 'waiting_for_human']),
      sql`(${chatRuns.queuedAt} IS NULL OR ${chatRuns.queueClaimedAt} IS NOT NULL)`, currentAdmission,
    )).get();
    if (!run) return null;

    const chain: { sessionId: string; parentSessionId: string | null; kind: string; title: string; projectId: string }[] = [];
    const seen = new Set<string>();
    let sessionId: string | null = binding.sessionId;
    while (sessionId !== null) {
      if (chain.length >= 8 || seen.has(sessionId)) return null;
      seen.add(sessionId);
      const row = tx.select({ id: sessions.id, parentSessionId: sessions.parentSessionId, projectId: sessions.projectId,
        kind: sessions.kind, title: boundedText(sessions.title), archivedAt: sessions.archivedAt,
      }).from(sessions).where(eq(sessions.id, sessionId)).get();
      if (!row || row.archivedAt !== null || row.title === null || !SESSION_KINDS.has(row.kind)
        || (chain[0] && row.projectId !== chain[0].projectId)) return null;
      chain.push({ sessionId: row.id, parentSessionId: row.parentSessionId, kind: row.kind,
        title: row.title, projectId: row.projectId });
      sessionId = row.parentSessionId;
    }
    chain.reverse();
    const root = chain[0];
    if (!root || root.kind !== 'chat' || root.parentSessionId !== null) return null;
    const project = tx.select({ id: projects.id, kind: projects.kind, path: boundedText(projects.path),
      pathBytes: sql<number | null>`length(CAST(${projects.path} AS BLOB))`,
    }).from(projects).where(eq(projects.id, root.projectId)).get();
    if (!project || !PROJECT_KINDS.has(project.kind) || (project.pathBytes !== null && project.pathBytes > MAX_BYTES)) return null;

    const prompt = tx.select({ id: messages.id, sessionId: messages.sessionId, turnId: messages.turnId,
      text: boundedText(messages.content),
    }).from(messages).where(and(eq(messages.id, binding.promptMessageId), eq(messages.sessionId, binding.sessionId),
      eq(messages.turnId, binding.turnId), eq(messages.role, 'user'))).get();
    if (!prompt || prompt.text === null) return null;
    const latest = tx.select({ id: messages.id }).from(messages)
      .where(and(eq(messages.sessionId, binding.sessionId), eq(messages.role, 'user')))
      .orderBy(desc(messages.createdAt), sql`messages.rowid DESC`).limit(1).get();
    if (latest?.id !== prompt.id) return null;

    const inputs: Snapshot['inputs'][number][] = [];
    for (const session of chain) {
      const isRoot = session.sessionId === root.sessionId;
      const isCurrent = session.sessionId === binding.sessionId;
      const selected = isCurrent && !isRoot ? [prompt] : tx.select({ id: messages.id,
        sessionId: messages.sessionId, turnId: messages.turnId, text: boundedText(messages.content),
      }).from(messages).where(and(eq(messages.sessionId, session.sessionId), eq(messages.role, 'user')))
        .orderBy(asc(messages.createdAt), sql`messages.rowid ASC`).limit(isRoot ? 33 : 2).all();
      if (isRoot ? selected.length === 0 || selected.length > 32 || (!isCurrent && selected.length !== 1)
        : !isCurrent && selected.length > 1) return null;
      for (const input of selected) {
        if (input.text === null) return null;
        inputs.push({ messageId: input.id, sessionId: input.sessionId, turnId: input.turnId,
          origin: isRoot ? 'host_recorded_input' : 'delegated_objective', text: input.text });
      }
    }

    // Match host audit structure, not worker text or labels. Invalid JSON is never treated as a denial.
    const data = sql`CASE WHEN json_valid(${auditLog.data}) THEN ${auditLog.data} ELSE '{}' END`;
    const rows = tx.select({ id: auditLog.id, sessionId: auditLog.sessionId, data: boundedText(auditLog.data) })
      .from(auditLog).where(and(inArray(auditLog.sessionId, chain.map(session => session.sessionId)),
        eq(auditLog.type, 'external_hitl'), sql`json_extract(${data}, '$.domain') = 'hitl'`,
        sql`json_extract(${data}, '$.source') = 'manual'`,
        sql`json_extract(${data}, '$.eventType') = 'hitl_approval_cancelled'`,
        sql`json_extract(${data}, '$.request.sessionId') = ${auditLog.sessionId}`,
        sql`json_extract(${data}, '$.request.kind') = 'tool'`,
      )).orderBy(asc(auditLog.createdAt), sql`audit_log.rowid ASC`).limit(17).all();
    if (rows.length > 16) return null;
    const denials: Snapshot['denials'][number][] = [];
    for (const row of rows) {
      if (row.data === null || row.sessionId === null) return null;
      const denial: unknown = JSON.parse(row.data);
      if (!record(denial) || !nonempty(denial['requestId']) || !record(denial['request'])
        || !nonempty(denial['request']['name']) || (denial['reason'] !== undefined && typeof denial['reason'] !== 'string')) return null;
      denials.push({ requestId: denial['requestId'], sessionId: row.sessionId, toolName: denial['request']['name'],
        ...(typeof denial['reason'] === 'string' ? { reason: denial['reason'] } : {}) });
    }
    const context = { version: 1 as const, binding, project: { id: project.id, kind: project.kind, path: project.path },
      lineage: chain.map(({ sessionId: id, parentSessionId, kind, title }) => ({ sessionId: id, parentSessionId, kind, title })),
      inputs, denials };
    // Include audit membership as well as the visible selected fields. Never hash volatile run timestamps/revision.
    const fingerprint = createHash('sha256').update(JSON.stringify({ context, denialIds: rows.map(row => row.id) }), 'utf8').digest('hex');
    const snapshot = { ...context, fingerprint };
    return Buffer.byteLength(JSON.stringify(snapshot), 'utf8') <= MAX_BYTES ? snapshot : null;
  }
}

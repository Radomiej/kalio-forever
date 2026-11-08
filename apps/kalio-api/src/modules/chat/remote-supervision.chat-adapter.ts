import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  ChatRemoteSupervisionPort, RemoteSupervisionApproval, RemoteSupervisionDecision,
  RemoteSupervisionDecisionResult, RemoteSupervisionSessionSummary, ChatRemoteSupervisionSession,
} from '@kalio/types';
import { SessionsService } from './sessions.service';
import { ActiveSessionRegistry } from './active-session-registry.service';
import { ToolDispatchService } from './tool-dispatch.service';
import { HitlRequestService } from '../hitl/hitl-request.service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!isRecord(value)) return JSON.stringify(value) ?? 'null';
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function sha256(value: unknown): string {
  return createHash('sha256').update(stable(value), 'utf8').digest('hex');
}
function requestRevision(row: { id: string; sessionId: string; turnId: string | null; toolCallId: string | null;
  payload: Record<string, unknown> | null; createdAt: Date }): string {
  const payload = row.payload ?? {};
  return sha256({
    id: row.id, sessionId: row.sessionId, turnId: row.turnId, toolCallId: row.toolCallId,
    toolName: payload['toolName'], args: payload['args'], requestedAt: row.createdAt.getTime(),
  });
}
function summary(session: Awaited<ReturnType<SessionsService['list']>>[number], active: ActiveSessionRegistry): RemoteSupervisionSessionSummary {
  return {
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    ...(session.projectId ? { projectId: session.projectId } : {}),
    personaId: session.personaId,
    active: active.isActive(session.id),
    ...(session.parentSessionId ? { parentSessionId: session.parentSessionId } : {}),
  };
}
function architectureRunIds(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const architecture = value['architectureContext'];
  if (!isRecord(architecture)) return [];
  const ids = [architecture['architectureRunId']];
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))];
}

@Injectable()
export class RemoteSupervisionChatAdapter implements ChatRemoteSupervisionPort {
  constructor(
    private readonly sessions: SessionsService,
    private readonly active: ActiveSessionRegistry,
    private readonly hitl: HitlRequestService,
    private readonly dispatch: ToolDispatchService,
  ) {}

  async snapshot(): Promise<{ sessions: RemoteSupervisionSessionSummary[]; approvals: RemoteSupervisionApproval[] }> {
    const sessions = await this.sessions.list({ limit: 500 });
    const projected = sessions.map((session) => summary(session, this.active));
    const pending = await Promise.all(sessions.map((session) => this.hitl.listPending(session.id)));
    const approvals = pending.flatMap((rows) => rows.flatMap((row) => this.approval(row)));
    return { sessions: projected, approvals };
  }

  async session(sessionId: string): Promise<ChatRemoteSupervisionSession | null> {
    const session = await this.sessions.get(sessionId).catch((error: unknown) => {
      if (error instanceof Error && 'status' in error && error.status === 404) return null;
      throw error;
    });
    if (!session) return null;
    const messages = await this.sessions.getMessages(sessionId);
    const safeMessages = messages.map((message) => ({
      id: message.id,
      sessionId: message.sessionId,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      ...(message.turnId ? { turnId: message.turnId } : {}),
    }));
    return {
      session: summary(session, this.active),
      messages: safeMessages,
      architectureRunIds: architectureRunIds(session.runtimeContext),
    };
  }

  async decide(input: RemoteSupervisionDecision): Promise<RemoteSupervisionDecisionResult> {
    const row = await this.hitl.getById(input.approvalId);
    const approval = row ? this.approval(row)[0] : undefined;
    if (!row || !approval || row.status !== 'pending'
      || approval.revision !== input.revision || approval.argsSha256 !== input.argsSha256) {
      return { status: 'stale' };
    }
    if (input.decision === 'approve' && isRecord(row.continuation)
      && Object.hasOwn(row.continuation, 'hostConfirmationRequirement')) {
      return { status: 'rejected' };
    }
    const status = input.decision === 'approve'
      ? await this.dispatch.resolveConfirmation(row.id, row.sessionId)
      : await this.dispatch.cancelConfirmation(row.id, row.sessionId);
    return status === 'resolved' || status === 'rejected'
      ? { status: 'settled' }
      : { status: 'stale' };
  }

  private approval(row: Awaited<ReturnType<HitlRequestService['getById']>> extends infer R ? Exclude<R, null> : never): RemoteSupervisionApproval[] {
    if (row.status !== 'pending' || row.kind !== 'tool_confirmation' || !isRecord(row.payload)) return [];
    if (isRecord(row.continuation) && Object.hasOwn(row.continuation, 'hostConfirmationRequirement')) return [];
    const toolName = row.payload['toolName'];
    const args = row.payload['args'];
    if (typeof toolName !== 'string' || !isRecord(args)) return [];
    return [{
      id: row.id, sessionId: row.sessionId, toolName, args, requestedAt: row.createdAt.getTime(),
      revision: requestRevision(row), argsSha256: sha256(args),
    }];
  }
}

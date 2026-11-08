import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  ChatRemoteSupervisionPort, RemoteSupervisionApproval, RemoteSupervisionDecision,
  RemoteSupervisionDecisionResult, RemoteSupervisionSessionSummary, ChatRemoteSupervisionSession,
} from '@kalio/types';
import { SessionsService } from './sessions.service';
import { ActiveSessionRegistry } from './active-session-registry.service';
import { ToolDispatchService } from './tool-dispatch.service';
import { HitlRequestService } from '../hitl/hitl-request.service';
import { NativeApprovalService } from '../agent-runtime/native-approval.service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!isRecord(value)) return JSON.stringify(value) ?? 'null';
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function sanitized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitized);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key, /(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential)/i.test(key) ? '[redacted]' : sanitized(entry),
  ]));
}
function sha256(value: unknown): string {
  return createHash('sha256').update(stable(value), 'utf8').digest('hex');
}
function requestRevision(row: { id: string; sessionId: string; turnId: string | null; toolCallId: string | null;
  runId: string | null; revision: number; continuation: Record<string, unknown> | null;
  payload: Record<string, unknown> | null; createdAt: Date }): string {
  const payload = row.payload ?? {};
  return sha256({ ...row, payload, requestedAt: row.createdAt.getTime() });
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
    private readonly nativeApprovals: NativeApprovalService,
  ) {}

  async snapshot(): Promise<{ sessions: RemoteSupervisionSessionSummary[]; approvals: RemoteSupervisionApproval[] }> {
    const sessions = await this.sessions.list({ limit: 500 });
    const projected = sessions.map((session) => summary(session, this.active));
    const pending = await this.hitl.listPendingForSessions(sessions.map((session) => session.id));
    const approvals = pending.flatMap((row) => this.approval(row));
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
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.deviceId)) return { status: 'rejected' };
    const row = await this.hitl.getById(input.approvalId);
    const approval = row ? this.approval(row)[0] : undefined;
    if (!row || !approval || !approval.decisionAvailable || row.status !== 'pending'
      || approval.revision !== input.revision || approval.argsSha256 !== input.argsSha256) {
      return { status: 'stale' };
    }
    if (input.decision === 'approve' && isRecord(row.continuation)
      && Object.hasOwn(row.continuation, 'hostConfirmationRequirement')) {
      return { status: 'rejected' };
    }
    const remoteReason = `Remote device ${input.deviceId}`;
    if (isRecord(row.payload) && row.payload['nativeApproval'] === true && row.kind === 'raapp_native') {
      const settled = await this.nativeApprovals.resolve(row.id, row.sessionId,
        input.decision === 'approve' ? 'accept' : 'decline', remoteReason);
      return { status: settled ? 'settled' : 'stale' };
    }
    const status = input.decision === 'approve'
      ? await this.dispatch.resolveConfirmation(row.id, row.sessionId, remoteReason)
      : await this.dispatch.cancelConfirmation(row.id, row.sessionId, remoteReason);
    return status === 'resolved' || status === 'rejected' ? { status: 'settled' } : { status: 'stale' };
  }

  private approval(row: Awaited<ReturnType<HitlRequestService['getById']>> extends infer R ? Exclude<R, null> : never): RemoteSupervisionApproval[] {
    if (row.status !== 'pending' || !['tool_confirmation', 'raapp_native', 'tool_budget'].includes(row.kind)) return [];
    const payload = isRecord(row.payload) ? row.payload : {};
    const args = isRecord(payload['args']) ? payload['args'] : {};
    const toolName = typeof payload['toolName'] === 'string' ? payload['toolName'] : row.kind;
    const hostOnly = isRecord(row.continuation) && Object.hasOwn(row.continuation, 'hostConfirmationRequirement');
    const nativeCodex = row.kind === 'raapp_native' && payload['nativeApproval'] === true;
    const decisionAvailable = (row.kind === 'tool_confirmation' && !hostOnly) || nativeCodex;
    return [{
      id: row.id, sessionId: row.sessionId, toolName, args: sanitized(args) as Record<string, unknown>, requestedAt: row.createdAt.getTime(),
      revision: requestRevision(row), argsSha256: sha256(args), kind: nativeCodex ? 'native_approval' : row.kind,
      decisionAvailable, ...(decisionAvailable ? {} : { availabilityReason: 'desktop_only' as const }),
    }];
  }
}

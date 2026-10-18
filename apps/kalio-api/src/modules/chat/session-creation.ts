import type { ChatSession, CreateSessionDto, SessionRuntimeContext } from '@kalio/types';
import { sessions } from '../../database/schema';
import type { KalioDrizzleDatabase } from '../../database/sqlite-runtime';
import { sessionTreeStopAdmission } from '../../database/session-tree-stop-admission';
import { toChatSession } from './session-row';

export const DEFAULT_SESSION_TITLE = 'New Chat';

export function insertSessionRecord(
  db: KalioDrizzleDatabase,
  id: string,
  dto: CreateSessionDto,
  scope: Pick<typeof sessions.$inferInsert, 'projectId' | 'executionProfileId' | 'runtimeContext'>,
): ChatSession {
  const now = new Date();
  const row = {
    id, personaId: dto.personaId ?? 'default', title: dto.title ?? DEFAULT_SESSION_TITLE, kind: dto.kind ?? 'chat',
    parentSessionId: dto.parentSessionId ?? null, parentTurnId: dto.parentTurnId ?? null,
    parentToolCallId: dto.parentToolCallId ?? null, projectId: scope.projectId,
    executionProfileId: scope.executionProfileId, runtimeContext: scope.runtimeContext ?? null,
    createdAt: now, updatedAt: now,
  };
  const parent = dto.parentSessionId ?? dto.runtimeContext?.architectureContext?.hostSessionId;
  sessionTreeStopAdmission(db).runIfAdmitted(parent, () => db.insert(sessions).values(row).run());
  return toChatSession(row);
}

export function runtimeProjectPath(runtimeContext: SessionRuntimeContext | undefined): string | undefined {
  const projectPathValue = runtimeContext?.architectureContext?.['projectPath'];
  const executionCwd = runtimeContext?.architectureContext?.['executionCwd'];
  return typeof projectPathValue === 'string' && projectPathValue.trim().length > 0
    ? projectPathValue.trim()
    : typeof executionCwd === 'string' && executionCwd.trim().length > 0 ? executionCwd.trim() : undefined;
}

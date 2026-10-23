import type { ChatSession, ChatSessionKind, SessionRuntimeContext } from '@kalio/types';

export function toChatSession(row: {
  id: string;
  personaId: string;
  title: string;
  kind?: ChatSessionKind;
  parentSessionId?: string | null;
  parentTurnId?: string | null;
  parentToolCallId?: string | null;
  projectId?: string | null;
  executionProfileId?: string | null;
  externalThreadId?: string | null;
  runtimeContext?: SessionRuntimeContext | null;
  createdAt: number | Date;
  updatedAt: number | Date;
}): ChatSession {
  return {
    id: row.id,
    personaId: row.personaId,
    title: row.title,
    kind: row.kind ?? 'chat',
    parentSessionId: row.parentSessionId ?? undefined,
    parentTurnId: row.parentTurnId ?? undefined,
    parentToolCallId: row.parentToolCallId ?? undefined,
    ...(row.projectId ? { projectId: row.projectId } : {}),
    ...(row.executionProfileId ? { executionProfileId: row.executionProfileId } : {}),
    ...(row.externalThreadId ? { externalThreadId: row.externalThreadId } : {}),
    runtimeContext: row.runtimeContext ?? undefined,
    createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.getTime() : row.updatedAt,
  };
}

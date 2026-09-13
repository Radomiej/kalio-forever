import type { ChatSession, SessionRuntimeContext } from '@kalio/types';
import type { SessionsService } from './sessions.service';

export async function ensureSubagentSession(input: {
  sessions: SessionsService;
  requestedChildSessionId?: string;
  childSessionId: string;
  personaId: string;
  objective: string;
  parentSessionId: string;
  parentTurnId?: string;
  parentToolCallId?: string;
  runtimeContext: SessionRuntimeContext;
}): Promise<ChatSession> {
  const childSession = input.requestedChildSessionId
    ? await input.sessions.get(input.requestedChildSessionId)
    : await input.sessions.createWithId(input.childSessionId, {
        personaId: input.personaId,
        title: `Sub-agent: ${input.objective.slice(0, 54)}`,
        kind: 'subagent',
        parentSessionId: input.parentSessionId,
        parentTurnId: input.parentTurnId,
        parentToolCallId: input.parentToolCallId,
        runtimeContext: input.runtimeContext,
      }, { registerRuntimeProjectPath: true });

  if (childSession.kind !== 'subagent') {
    throw new Error(`Session ${childSession.id} is not a sub-agent session`);
  }
  if (childSession.parentSessionId !== input.parentSessionId) {
    throw new Error(`Sub-agent session ${childSession.id} does not belong to parent session ${input.parentSessionId}`);
  }
  if (
    input.requestedChildSessionId
    && (!childSession.runtimeContext || JSON.stringify(childSession.runtimeContext) !== JSON.stringify(input.runtimeContext))
  ) {
    await input.sessions.updateRuntimeContext(childSession.id, input.runtimeContext, {
      registerRuntimeProjectPath: true,
    });
  }
  return childSession;
}

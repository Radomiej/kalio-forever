import type { ChatSession, SessionRuntimeContext } from '@kalio/types';
import type { SessionsService } from './sessions.service';

function preserveExistingBranchPaths(previous: SessionRuntimeContext | undefined, next: SessionRuntimeContext): SessionRuntimeContext {
  const saved = previous?.architectureContext;
  const incoming = next.architectureContext;
  // TODO: legacy fallback. A reconstructed run may omit project metadata from its prompt context.
  if (previous?.runtimeKind !== 'agent-flow-branch' || next.runtimeKind !== 'agent-flow-branch'
    || !saved?.architectureRunId || saved.architectureRunId !== incoming?.architectureRunId
    || !previous.architectureSlotId || previous.architectureSlotId !== next.architectureSlotId
    || typeof saved.projectPath !== 'string' || !saved.projectPath
    || typeof saved.executionCwd !== 'string' || !saved.executionCwd
    || incoming.projectPath !== undefined || incoming.executionCwd !== undefined) return next;
  return { ...next, architectureContext: { ...incoming, projectPath: saved.projectPath, executionCwd: saved.executionCwd } };
}

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
  reloadAfterUpdate?: boolean;
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
  const runtimeContext = input.requestedChildSessionId
    ? preserveExistingBranchPaths(childSession.runtimeContext, input.runtimeContext) : input.runtimeContext;
  if (
    (input.requestedChildSessionId || input.reloadAfterUpdate)
    && (!childSession.runtimeContext || JSON.stringify(childSession.runtimeContext) !== JSON.stringify(runtimeContext))
  ) {
    await input.sessions.updateRuntimeContext(childSession.id, runtimeContext, {
      registerRuntimeProjectPath: runtimeContext === input.runtimeContext,
    });
    if (input.reloadAfterUpdate) return input.sessions.get(childSession.id);
  }
  return childSession;
}

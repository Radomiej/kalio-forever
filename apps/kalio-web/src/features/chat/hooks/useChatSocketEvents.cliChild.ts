import type { ChatMessage, ChatSession, ToolResult } from '@kalio/types';
import type { CLIChildProjection } from '../cliChildProjection.model';
import {
  isCliChildToolName,
  projectionFromSession,
  projectionFromToolResult,
  rebuildCLIChildProjectionsFromMessages,
  terminalProjectionStatus,
} from '../cliChildProjection.model';
import { buildCallIdToNameFromMessages } from '../chatUtils';

export { isCliChildToolName } from '../cliChildProjection.model';

export interface CliChildSocketDeps {
  upsertCLIChildProjection: (projection: CLIChildProjection) => void;
  updateCLIChildProjection: (childSessionId: string, patch: Partial<CLIChildProjection>) => void;
  rebuildCLIChildProjections: (parentSessionId: string, projections: CLIChildProjection[]) => void;
  appendCLIAgentChunk: (callId: string, chunk: string) => void;
  registerCallId: (callId: string, toolName: string) => void;
  getAgentState: () => {
    callIdToName: Record<string, string>;
    toolActivities: Array<{ callId: string; toolName: string }>;
    cliChildProjections: Record<string, CLIChildProjection>;
    cliAgentOutput: Record<string, string>;
  };
  getSessionState: () => {
    activeSessionId: string | null;
    sessions: ChatSession[];
  };
  identifySession: (sessionId: string) => void;
}

export function resolveCliToolName(
  result: ToolResult,
  callIdToName: Record<string, string>,
  toolActivities: Array<{ callId: string; toolName: string }>,
): string | undefined {
  return result.toolName
    ?? callIdToName[result.callId]
    ?? toolActivities.find((activity) => activity.callId === result.callId)?.toolName;
}

export function handleCliChildToolResult(
  deps: CliChildSocketDeps,
  result: ToolResult,
  resultSessionId: string | null | undefined,
): void {
  if (!resultSessionId) return;

  const { callIdToName, toolActivities, cliChildProjections } = deps.getAgentState();
  const toolName = resolveCliToolName(result, callIdToName, toolActivities);

  if (toolName && result.data !== undefined) {
    const projection = projectionFromToolResult(toolName, result.callId, resultSessionId, result.data, result.status);
    if (projection) {
      deps.upsertCLIChildProjection(projection);
    }
    return;
  }

  if (!toolName || !isCliChildToolName(toolName)) return;

  const terminalStatus = terminalProjectionStatus(result.status);
  if (!terminalStatus) return;

  const existing = cliChildProjections[resultSessionId]
    ?? Object.values(cliChildProjections).find(
      (item) => item.parentCallId === result.callId || item.childSessionId === resultSessionId,
    );
  if (!existing) return;

  deps.updateCLIChildProjection(existing.childSessionId, {
    status: terminalStatus,
    lastOutput: result.errorMessage ?? existing.lastOutput,
  });
}

export function handleCliChildProgress(deps: CliChildSocketDeps, payload: {
  callId: string;
  sessionId?: string;
  agentId: string;
  chunk: string;
}): void {
  deps.appendCLIAgentChunk(payload.callId, payload.chunk);

  const { cliChildProjections, cliAgentOutput, callIdToName } = deps.getAgentState();
  const existing = payload.sessionId
    ? cliChildProjections[payload.sessionId]
    : Object.values(cliChildProjections).find((item) => item.parentCallId === payload.callId);

  if (existing) {
    deps.updateCLIChildProjection(existing.childSessionId, {
      status: 'running',
      lastOutput: cliAgentOutput[payload.callId] ?? '',
    });
    return;
  }

  if (!payload.sessionId) return;

  const childSession = deps.getSessionState().sessions.find((item) => item.id === payload.sessionId);
  if (!childSession?.parentSessionId || !childSession.parentToolCallId) return;

  deps.upsertCLIChildProjection({
    childSessionId: payload.sessionId,
    parentSessionId: childSession.parentSessionId,
    parentCallId: childSession.parentToolCallId,
    agentId: payload.agentId,
    status: 'running',
    lastOutput: payload.chunk,
    childTitle: childSession.title,
    toolName: callIdToName[childSession.parentToolCallId] ?? 'run_cli_agent',
  });
}

export function handleCliChildSessionCreated(deps: CliChildSocketDeps, session: ChatSession): void {
  if (session.kind !== 'cli-agent') return;

  const projection = projectionFromSession(session);
  if (projection) {
    deps.upsertCLIChildProjection(projection);
  }

  const activeSessionId = deps.getSessionState().activeSessionId;
  if (session.parentSessionId === activeSessionId || activeSessionId === session.id) {
    deps.identifySession(session.id);
  }
}

export function rebuildCliChildProjectionsFromHistory(
  deps: CliChildSocketDeps,
  parentSessionId: string,
  messages: ChatMessage[],
): CLIChildProjection[] {
  const persistedCallIdToName = deps.getAgentState().callIdToName;
  const callIdToName = buildCallIdToNameFromMessages(messages, persistedCallIdToName);
  for (const [callId, name] of Object.entries(callIdToName)) {
    if (!persistedCallIdToName[callId]) {
      deps.registerCallId(callId, name);
    }
  }
  const projections = rebuildCLIChildProjectionsFromMessages(parentSessionId, messages, callIdToName);
  deps.rebuildCLIChildProjections(
    parentSessionId,
    projections,
  );
  return projections;
}

export function identifyCliChildrenOnReconnect(
  deps: CliChildSocketDeps,
  parentSessionId: string,
): void {
  deps.identifySession(parentSessionId);
  deps.getSessionState().sessions
    .filter((session) => session.kind === 'cli-agent' && session.parentSessionId === parentSessionId)
    .forEach((child) => deps.identifySession(child.id));
}

export function identifyCliChildProjections(
  deps: CliChildSocketDeps,
  projections: CLIChildProjection[],
  activeSessionId: string | null,
): void {
  const knownSessionIds = new Set(deps.getSessionState().sessions.map((session) => session.id));
  projections.forEach((projection) => {
    if (projection.childSessionId === activeSessionId) {
      return;
    }
    if (!knownSessionIds.has(projection.childSessionId)) {
      deps.identifySession(projection.childSessionId);
    }
  });
}

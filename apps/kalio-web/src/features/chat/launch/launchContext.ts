import type { ChatSession, SessionRuntimeContext, VFSFile } from '@kalio/types';
import { apiClient } from '../../../services/apiClient';

type ArchitectureSessionLabel = {
  schemaId: string;
  schemaName: string;
  displayLabel?: string;
};

function normalizedProjectPath(projectPath: string): string {
  return projectPath.trim();
}

export function getLaunchProjectPath(runtimeContext: SessionRuntimeContext | undefined): string {
  const projectPath = runtimeContext?.architectureContext?.['projectPath'];
  if (typeof projectPath === 'string' && projectPath.trim().length > 0) {
    return projectPath.trim();
  }

  const executionCwd = runtimeContext?.architectureContext?.['executionCwd'];
  if (typeof executionCwd === 'string' && executionCwd.trim().length > 0) {
    return executionCwd.trim();
  }

  return '';
}

export function buildLaunchProjectScope(projectPath: string): Record<string, string> | undefined {
  const normalized = normalizedProjectPath(projectPath);
  if (!normalized) {
    return undefined;
  }

  return {
    projectPath: normalized,
    executionCwd: normalized,
  };
}

export function buildSessionLaunchRuntimeContext(
  runtimeContext: SessionRuntimeContext | undefined,
  projectPath: string,
): SessionRuntimeContext | undefined {
  const projectScope = buildLaunchProjectScope(projectPath);
  if (!projectScope) {
    if (!runtimeContext) {
      return undefined;
    }
    const { architectureContext, ...rest } = runtimeContext;
    if (!architectureContext) {
      return runtimeContext;
    }

    const { projectPath: _projectPath, executionCwd: _executionCwd, ...nextArchitectureContext } = architectureContext;
    return Object.keys(nextArchitectureContext).length > 0
      ? { ...rest, architectureContext: nextArchitectureContext }
      : rest;
  }

  return {
    ...(runtimeContext ?? { runtimeKind: 'chat' }),
    architectureContext: {
      ...(runtimeContext?.architectureContext ?? {}),
      ...projectScope,
    },
  };
}

export function buildArchitectureSessionRuntimeContext(
  runtimeContext: SessionRuntimeContext | undefined,
  projectPath: string,
  architecture: ArchitectureSessionLabel,
): SessionRuntimeContext {
  const nextRuntimeContext = buildSessionLaunchRuntimeContext(runtimeContext, projectPath)
    ?? runtimeContext
    ?? { runtimeKind: 'chat' as const };

  return {
    ...nextRuntimeContext,
    architectureContext: {
      ...(nextRuntimeContext.architectureContext ?? {}),
      schemaId: architecture.schemaId,
      schemaName: architecture.schemaName,
      displayLabel: architecture.displayLabel ?? architecture.schemaName,
    },
  };
}

async function persistSessionRuntimeContext(
  sessionId: string,
  runtimeContext: SessionRuntimeContext | undefined,
  nextRuntimeContext: SessionRuntimeContext | undefined,
  updateSession: (sessionId: string, patch: Partial<ChatSession>) => void,
): Promise<SessionRuntimeContext | undefined> {
  if (!nextRuntimeContext) {
    return runtimeContext;
  }

  if (JSON.stringify(runtimeContext ?? null) === JSON.stringify(nextRuntimeContext)) {
    return runtimeContext;
  }

  await apiClient.patch(`/api/sessions/${sessionId}`, { runtimeContext: nextRuntimeContext });
  updateSession(sessionId, { runtimeContext: nextRuntimeContext });
  return nextRuntimeContext;
}

export async function persistSessionLaunchRuntimeContext(
  sessionId: string,
  projectPath: string,
  runtimeContext: SessionRuntimeContext | undefined,
  updateSession: (sessionId: string, patch: Partial<ChatSession>) => void,
): Promise<SessionRuntimeContext | undefined> {
  const nextRuntimeContext = buildSessionLaunchRuntimeContext(runtimeContext, projectPath);
  return persistSessionRuntimeContext(sessionId, runtimeContext, nextRuntimeContext, updateSession);
}

export async function persistArchitectureSessionRuntimeContext(
  sessionId: string,
  projectPath: string,
  runtimeContext: SessionRuntimeContext | undefined,
  architecture: ArchitectureSessionLabel,
  updateSession: (sessionId: string, patch: Partial<ChatSession>) => void,
): Promise<SessionRuntimeContext | undefined> {
  const nextRuntimeContext = buildArchitectureSessionRuntimeContext(runtimeContext, projectPath, architecture);
  return persistSessionRuntimeContext(sessionId, runtimeContext, nextRuntimeContext, updateSession);
}

export async function persistSessionLaunchPersona(
  session: ChatSession,
  personaId: string,
  updateSession: (sessionId: string, patch: Partial<ChatSession>) => void,
): Promise<ChatSession> {
  if (session.personaId === personaId) {
    return session;
  }

  await apiClient.patch(`/api/sessions/${session.id}`, { personaId });
  updateSession(session.id, { personaId });
  return {
    ...session,
    personaId,
  };
}

export function buildArchitectureRunContext(
  sessionId: string,
  files: VFSFile[],
  activeToolNames: string[] = [],
  projectPath = '',
): Record<string, unknown> {
  const projectScope = buildLaunchProjectScope(projectPath);
  const context: Record<string, unknown> = { parentSessionId: sessionId };
  if (projectScope) {
    Object.assign(context, projectScope);
  }
  if (activeToolNames.length > 0) {
    context['launchAllowedToolNames'] = activeToolNames;
  }
  if (files.length > 0) {
    context['hydrateFromSessionId'] = sessionId;
    context['hydrateTargetPrefix'] = 'project';
    context['hydrateFilePaths'] = files.map((file) => file.path);
  }
  return context;
}

export function buildGoalGuardRunContext(
  sessionId: string,
  files: VFSFile[],
  activeToolNames: string[] = [],
  projectPath = '',
): Record<string, unknown> {
  return {
    ...buildArchitectureRunContext(sessionId, files, activeToolNames, projectPath),
    requireGoalMasterLoopProof: true,
    requireImplementerWriteProof: true,
  };
}

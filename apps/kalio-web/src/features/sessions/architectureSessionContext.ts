import type { ArchitectureRuntimeContext, ChatSession, WorkflowSessionSurface } from '@kalio/types';

export function architectureContextForSession(
  session: ChatSession,
): ArchitectureRuntimeContext | undefined {
  const context = session.runtimeContext?.architectureContext;
  return context && typeof context === 'object' && !Array.isArray(context)
    ? context
    : undefined;
}

export function architectureSessionSurfaceForSession(
  session: ChatSession,
): WorkflowSessionSurface | undefined {
  const value = architectureContextForSession(session)?.sessionSurface;
  return value === 'host-envelope' || value === 'conversation-branch' || value === 'technical-node'
    ? value
    : undefined;
}

export function architectureContextStringField(
  session: ChatSession,
  key: keyof ArchitectureRuntimeContext,
): string | undefined {
  const value = architectureContextForSession(session)?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

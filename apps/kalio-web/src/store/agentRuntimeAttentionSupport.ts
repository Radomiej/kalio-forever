import type { ChatSession, RuntimeActivitySnapshot } from '@kalio/types';

const RECENT_RUNTIME_ATTENTION_WINDOW_MS = 24 * 60 * 60 * 1000;

export function sessionAttentionLabel(
  sessionId: string,
  sessionsById: Map<string, ChatSession>,
): string {
  const title = sessionsById.get(sessionId)?.title?.trim();
  return title && title.length > 0 ? title : `Session ${sessionId.slice(0, 8)}`;
}

export function canProjectPersistedRuntimeEvidence(session: ChatSession | undefined): boolean {
  if (!session) {
    return false;
  }

  if (Date.now() - session.updatedAt > RECENT_RUNTIME_ATTENTION_WINDOW_MS) {
    return false;
  }

  if (session.parentSessionId) {
    return true;
  }

  if (session.kind === 'subagent' || session.kind === 'cli-agent' || session.kind === 'agent-flow') {
    return true;
  }

  return session.runtimeContext?.runtimeKind === 'agent-flow-branch'
    || session.runtimeContext?.runtimeKind === 'agent-flow-root'
    || session.runtimeContext?.runtimeKind === 'cli-agent';
}

export function waitingDetail(
  snapshot: RuntimeActivitySnapshot | undefined,
  waitingLabel?: string | null,
): string {
  const runStatus = snapshot?.run?.status as string | undefined;
  if (runStatus === 'waiting_on_orchestrator') {
    return 'Waiting on orchestrator';
  }
  if (waitingLabel && waitingLabel.trim().length > 0) {
    return `Waiting on ${waitingLabel.trim()}`;
  }
  return 'Runtime waiting';
}

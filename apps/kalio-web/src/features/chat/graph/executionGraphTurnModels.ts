import type { AuditLogEntry } from '@kalio/types';
import type { ChatSession, Persona } from '@kalio/types';
import type { ExecutionGraphModel } from './executionGraphModel.types';
import { buildTurnIdentity } from './executionGraphModel.helpers';

export function recordedTurnModel(entries: AuditLogEntry[], sessionId: string, turnId: string): string | null {
  const models = new Set<string>();
  const scoped = entries.filter((entry) => entry.sessionId === sessionId
    && entry.type === 'runtime_event' && entry.label === 'llm.turn.started'
    && entry.data?.['turnId'] === turnId).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  for (const entry of scoped) {
    const model = entry.data?.['model'];
    if (typeof model === 'string' && model.trim()) models.add(model.trim());
  }
  return models.size > 0 ? [...models].join(' → ') : null;
}

export function withRecordedTurnModels(model: ExecutionGraphModel, entries: AuditLogEntry[], sessions: ChatSession[], personas: Persona[]): ExecutionGraphModel {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const personaById = new Map(personas.map((persona) => [persona.id, persona]));
  return { ...model, nodes: model.nodes.map((node) => {
    if (node.payload.kind !== 'turn') return node;
    const turn = node.payload.turn;
    const identity = buildTurnIdentity(turn, sessionById, personaById, recordedTurnModel(entries, turn.sessionId, turn.id));
    const detail = turn.done && node.status === 'error'
      ? turn.error?.code === 'CANCELLED' || turn.error?.code === 'INTERRUPTED'
        ? 'Turn interrupted' : 'Turn ended with errors'
      : identity.detail;
    return { ...node, subtitle: identity.subtitle, detail: identity.modelLabel ? detail : `${detail ?? ''} · Runtime model unavailable`,
      payload: { ...node.payload, actorLabel: identity.actorLabel, modelLabel: identity.modelLabel } };
  }) };
}

export function withWaitingGraphSessions(model: ExecutionGraphModel, waitingSessionIds: Set<string>): ExecutionGraphModel {
  if (waitingSessionIds.size === 0) return model;
  return { ...model, nodes: model.nodes.map((node) => waitingSessionIds.has(node.sessionId ?? '')
    ? { ...node, status: 'waiting' as const } : node) };
}

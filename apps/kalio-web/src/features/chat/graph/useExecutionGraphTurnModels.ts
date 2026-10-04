import { useEffect, useState } from 'react';
import type { AuditLogEntry } from '@kalio/types';
import { apiClient } from '../../../services/apiClient';

export function useExecutionGraphTurnModels(sessionId: string | null, lifecycleKey: string) {
  const [snapshot, setSnapshot] = useState<{ sessionId: string | null; entries: AuditLogEntry[]; error: string | null }>(
    { sessionId: null, entries: [], error: null });
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const query = new URLSearchParams({ sessionId, type: 'runtime_event', label: 'llm.turn.started', source: 'all', limit: '2000' });
    void apiClient.get<AuditLogEntry[]>(`/api/audit-log?${query}`).then(({ data }) => {
      if (!Array.isArray(data)) throw new Error('Invalid graph runtime audit response');
      if (!cancelled) setSnapshot({ sessionId, entries: data, error: data.length >= 2000 ? 'Runtime audit limit reached; older models may be unavailable.' : null });
    }).catch((cause: unknown) => {
      if (!cancelled) setSnapshot({ sessionId, entries: [], error: cause instanceof Error ? cause.message : 'Could not load runtime identity' });
    });
    return () => { cancelled = true; };
  }, [sessionId, lifecycleKey]);
  return snapshot.sessionId === sessionId ? snapshot : { sessionId, entries: [], error: null };
}

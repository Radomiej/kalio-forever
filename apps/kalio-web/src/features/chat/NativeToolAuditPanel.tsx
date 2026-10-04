import { useState } from 'react';
import type { AuditLogEntry } from '@kalio/types';
import { apiClient } from '../../services/apiClient';
import { projectNativeToolAudit } from './nativeToolAudit.model';

export function NativeToolAuditPanel({ sessionId, turnId }: { sessionId: string; turnId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ sessionId, turnId, type: 'runtime_event', source: 'all', limit: '2000' });
      const response = await apiClient.get<AuditLogEntry[]>(`/api/audit-log?${query}`);
      if (!Array.isArray(response.data)) throw new Error('Invalid native audit response');
      setEntries(response.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load native audit');
    } finally {
      setLoading(false);
    }
  };
  const rows = loading || error ? [] : projectNativeToolAudit(entries ?? [], sessionId, turnId);
  return (
    <div className="text-xs" data-testid="native-tool-audit-panel">
      <button type="button" className="text-sky-300" aria-expanded={open} onClick={() => {
        setOpen(!open);
        if (!open && entries === null && !loading) void load();
      }}>Devin native tool audit</button>
      {open && (
        <div className="mt-2 space-y-2 rounded border border-base-content/15 p-2">
          <p>Persisted Devin audit snapshot. This panel does not report native tools from other providers. Approval does not prove execution.</p>
          <button className="btn btn-xs" disabled={loading} onClick={() => void load()}>Refresh native audit</button>
          {loading && <p role="status">Loading native audit…</p>}
          {error && <p role="alert">{error}</p>}
          {!loading && !error && rows.length === 0 && <p>No correlated native evidence for this turn. Older unscoped events cannot be assigned reliably.</p>}
          {!loading && !error && (entries?.length ?? 0) >= 2000 && <p role="alert">Audit limit reached; this snapshot may be incomplete.</p>}
          {rows.map((row) => (
            <div key={row.key} className="break-words border-l-2 border-amber-400/40 pl-2">
              <span className="font-mono">{row.name}</span> · Native Devin · {row.status.replaceAll('_', ' ')}
              <div className="text-base-content/60">Call: {row.callId}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

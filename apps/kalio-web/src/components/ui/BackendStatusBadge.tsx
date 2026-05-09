import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { backendHealth, type BackendHealthState } from '../../services/backendHealth';

/**
 * Floating banner shown only while the backend is offline.
 * Mirrors the `backendHealth` service state — disappears silently on recovery.
 */
export function BackendStatusBadge(): React.ReactElement | null {
  const [state, setState] = useState<BackendHealthState>(backendHealth.getState());

  useEffect(() => backendHealth.subscribe(setState), []);

  if (state !== 'offline') return null;

  return (
    <div
      className="fixed top-2 left-1/2 -translate-x-1/2 z-50 alert alert-warning shadow-lg py-2 px-3 flex items-center gap-2 text-xs"
      data-testid="backend-status-badge"
      role="status"
    >
      <AlertTriangle size={14} />
      <span>Backend offline — retrying…</span>
    </div>
  );
}

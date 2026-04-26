import { useEffect, useState } from 'react';
import { Folder, FolderOpen, FileText, RefreshCw, AlertCircle } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { apiClient } from '../../services/apiClient';
import type { VFSListResult } from '@kalio/types';

interface SessionEntry {
  sessionId: string;
  title: string;
  files: VFSListResult['files'];
  loading: boolean;
  expanded: boolean;
  error?: string;
}

export function WorkspacePanel() {
  const sessions = useSessionStore((s) => s.sessions);
  const [entries, setEntries] = useState<SessionEntry[]>([]);

  useEffect(() => {
    setEntries((prev) =>
      sessions.map((s) => {
        const existing = prev.find((e) => e.sessionId === s.id);
        return existing ?? { sessionId: s.id, title: s.title || 'Untitled', files: [], loading: false, expanded: false };
      }),
    );
  }, [sessions]);

  const toggleExpand = async (sessionId: string) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.sessionId !== sessionId) return e;
        if (e.expanded) return { ...e, expanded: false };
        return { ...e, expanded: true, loading: true };
      }),
    );

    try {
      const { data } = await apiClient.get<VFSListResult>(`/api/sessions/${sessionId}/vfs`);
      setEntries((prev) =>
        prev.map((e) =>
          e.sessionId === sessionId
            ? { ...e, files: data.files ?? [], loading: false }
            : e,
        ),
      );
    } catch {
      setEntries((prev) =>
        prev.map((e) =>
          e.sessionId === sessionId
            ? { ...e, loading: false, error: 'Failed to load files' }
            : e,
        ),
      );
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  return (
    <div className="p-3 flex flex-col gap-1 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold text-base-content/60 uppercase tracking-wider">
          Session Files ({entries.length})
        </h2>
      </div>

      {entries.length === 0 && (
        <p className="text-sm text-base-content/40 text-center py-8">No sessions yet</p>
      )}

      {entries.map((entry) => (
        <div key={entry.sessionId} className="rounded border border-base-300 overflow-hidden">
          <button
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-base-200 transition-colors text-left"
            onClick={() => void toggleExpand(entry.sessionId)}
          >
            {entry.expanded ? (
              <FolderOpen size={14} className="text-warning shrink-0" />
            ) : (
              <Folder size={14} className="text-base-content/50 shrink-0" />
            )}
            <span className="text-sm font-medium flex-1 truncate">{entry.title}</span>
            {entry.loading && <RefreshCw size={12} className="animate-spin text-base-content/40" />}
          </button>

          {entry.expanded && !entry.loading && (
            <div className="border-t border-base-300 bg-base-50">
              {entry.error && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-error">
                  <AlertCircle size={12} />
                  {entry.error}
                </div>
              )}
              {!entry.error && entry.files.length === 0 && (
                <p className="px-3 py-2 text-xs text-base-content/40 italic">No files in session</p>
              )}
              {entry.files.map((file) => (
                <div key={file.path} className="flex items-center gap-2 px-4 py-1.5 hover:bg-base-200 text-xs">
                  <FileText size={12} className="text-base-content/40 shrink-0" />
                  <span className="flex-1 truncate font-mono">{file.path}</span>
                  <span className="text-base-content/40 shrink-0">{formatSize(file.sizeBytes)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}


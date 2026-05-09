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

  // Eagerly fetch VFS for every session so we can hide empty ones.
  useEffect(() => {
    sessions.forEach((s) => {
      setEntries((prev) => {
        if (prev.find((e) => e.sessionId === s.id)) return prev;
        return [
          ...prev,
          { sessionId: s.id, title: s.title || 'Untitled', files: [], loading: true, expanded: false },
        ];
      });

      apiClient
        .get<VFSListResult>(`/api/sessions/${s.id}/vfs`)
        .then(({ data }) => {
          setEntries((prev) =>
            prev.map((e) =>
              e.sessionId === s.id ? { ...e, files: data.files ?? [], loading: false } : e,
            ),
          );
        })
        .catch(() => {
          setEntries((prev) =>
            prev.map((e) =>
              e.sessionId === s.id ? { ...e, loading: false, error: 'Failed to load files' } : e,
            ),
          );
        });
    });
  }, [sessions]);

  // Files already fetched on mount — just toggle expanded state.
  const toggleExpand = (sessionId: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.sessionId !== sessionId ? e : { ...e, expanded: !e.expanded })),
    );
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const visibleEntries = entries.filter((e) => e.loading || e.files.length > 0);

  return (
    <div className="p-3 flex flex-col gap-1 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold text-base-content/60 uppercase tracking-wider">
          Session Files ({entries.filter((e) => e.files.length > 0).length})
        </h2>
      </div>

      {entries.length > 0 && visibleEntries.length === 0 && (
        <p className="text-sm text-base-content/40 text-center py-8">No files in any session</p>
      )}
      {entries.length === 0 && (
        <p className="text-sm text-base-content/40 text-center py-8">No sessions yet</p>
      )}

      {visibleEntries.map((entry) => (
        <div key={entry.sessionId} className="rounded border border-base-300 overflow-hidden">
          <button
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-base-200 transition-colors text-left"
            onClick={() => toggleExpand(entry.sessionId)}
          >
            {entry.expanded ? (
              <FolderOpen size={14} className="text-warning shrink-0" />
            ) : (
              <Folder size={14} className="text-base-content/50 shrink-0" />
            )}
            <span className="text-sm font-medium flex-1 truncate">{entry.title}</span>
            {entry.loading && <RefreshCw size={12} className="animate-spin text-base-content/40" />}
            {!entry.loading && (
              <span className="text-xs text-base-content/40 shrink-0">{entry.files.length}</span>
            )}
          </button>

          {entry.expanded && !entry.loading && (
            <div className="border-t border-base-300 bg-base-50">
              {entry.error && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-error">
                  <AlertCircle size={12} />
                  {entry.error}
                </div>
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


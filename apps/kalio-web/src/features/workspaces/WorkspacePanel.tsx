import { useEffect, useState } from 'react';
import { Folder, FolderOpen, FileText, RefreshCw, AlertCircle } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { apiClient } from '../../services/apiClient';
import type { VFSListResult } from '@kalio/types';

interface SessionEntry {
  sessionId: string;
  title: string;
  files: VFSListResult['files'];
  expanded: boolean;
  error?: string;
}

const FILE_SCAN_CONCURRENCY = 8;

export function WorkspacePanel() {
  const sessions = useSessionStore((s) => s.sessions);
  const [entries, setEntries] = useState<SessionEntry[]>([]);
  const [loadedCount, setLoadedCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setEntries([]);
    setLoadedCount(0);

    const scanSession = async (session: (typeof sessions)[number]) => {
      try {
        const { data } = await apiClient.get<VFSListResult>(`/api/sessions/${session.id}/vfs`);
        if (cancelled) return;
        const files = data.files ?? [];
        if (files.length > 0) {
          setEntries((prev) => [
            ...prev,
            { sessionId: session.id, title: session.title || 'Untitled', files, expanded: false },
          ]);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          console.warn(`[WorkspacePanel] Failed to load VFS for session ${session.id}`, err);
          setEntries((prev) => [
            ...prev,
            { sessionId: session.id, title: session.title || 'Untitled', files: [], expanded: false, error: 'Failed to load files' },
          ]);
        }
      } finally {
        if (!cancelled) setLoadedCount((count) => count + 1);
      }
    };

    const run = async () => {
      for (let index = 0; index < sessions.length; index += FILE_SCAN_CONCURRENCY) {
        if (cancelled) return;
        await Promise.all(sessions.slice(index, index + FILE_SCAN_CONCURRENCY).map(scanSession));
      }
    };

    void run();
    return () => { cancelled = true; };
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

  const scanning = loadedCount < sessions.length;
  const visibleEntries = entries.filter((e) => e.error || e.files.length > 0);

  return (
    <div className="p-4 flex flex-col gap-2 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold text-base-content/60 uppercase tracking-wider">
          Session Files ({entries.filter((e) => e.files.length > 0).length})
        </h2>
        {scanning && (
          <span className="flex items-center gap-2 text-xs text-base-content/45">
            <RefreshCw size={12} className="animate-spin" />
            {loadedCount}/{sessions.length}
          </span>
        )}
      </div>

      {sessions.length > 0 && visibleEntries.length === 0 && (
        <div className="rounded-lg border border-base-300 bg-base-200/30 p-8 text-center text-sm text-base-content/45">
          {scanning ? 'Scanning session files...' : 'No files in any session'}
        </div>
      )}
      {sessions.length === 0 && (
        <div className="rounded-lg border border-base-300 bg-base-200/30 p-8 text-center text-sm text-base-content/45">
          No sessions yet
        </div>
      )}

      {visibleEntries.map((entry) => (
        <div key={entry.sessionId} className="rounded-lg border border-base-300 bg-base-200/25 overflow-hidden">
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
            <span className="text-xs text-base-content/70 shrink-0">{entry.error ? 'error' : entry.files.length}</span>
          </button>

          {entry.expanded && (
            <div className="border-t border-base-300 bg-base-100/40">
              {entry.error && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-error">
                  <AlertCircle size={12} />
                  {entry.error}
                </div>
              )}
              {entry.files.map((file) => (
                <div key={file.path} className="flex items-center gap-2 px-4 py-1.5 hover:bg-base-200 text-xs">
                  <FileText size={12} className="text-base-content/60 shrink-0" />
                  <span className="flex-1 truncate font-mono">{file.path}</span>
                  <span className="text-base-content/65 shrink-0">{formatSize(file.sizeBytes)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}


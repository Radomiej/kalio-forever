import { useEffect, useState } from 'react';
import { Folder, FolderOpen, FileText, RefreshCw, AlertCircle } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { apiClient } from '../../services/apiClient';
import type { ChatSession } from '@kalio/types';

interface VFSFile {
  path: string;
  sizeBytes: number;
  updatedAt: number;
}

interface WorkspaceEntry {
  session: ChatSession;
  files: VFSFile[];
  loading: boolean;
  expanded: boolean;
  error?: string;
}

export function WorkspacePanel() {
  const { setSessions } = useSessionStore();
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  useEffect(() => {
    setLoadingSessions(true);
    apiClient
      .get<ChatSession[]>('/api/sessions')
      .then((r) => {
        setSessions(r.data);
        setEntries(
          r.data.map((s) => ({ session: s, files: [], loading: false, expanded: false })),
        );
      })
      .catch((err: unknown) => console.error('[WorkspacePanel] load sessions failed', err))
      .finally(() => setLoadingSessions(false));
  }, [setSessions]);

  const toggleExpand = async (sessionId: string) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.session.id !== sessionId) return e;
        if (e.expanded) return { ...e, expanded: false };
        return { ...e, expanded: true, loading: true };
      }),
    );

    try {
      // VFS list via tool dispatch — use vfs_list endpoint indirectly by calling session tools
      // Since there's no direct VFS REST endpoint, we read the filesystem path
      const { data } = await apiClient.get<{ files: VFSFile[] }>(
        `/api/sessions/${sessionId}/vfs`,
      ).catch(() => ({ data: { files: [] } }));

      setEntries((prev) =>
        prev.map((e) =>
          e.session.id === sessionId
            ? { ...e, files: data.files ?? [], loading: false }
            : e,
        ),
      );
    } catch {
      setEntries((prev) =>
        prev.map((e) =>
          e.session.id === sessionId
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

  const formatDate = (ms: number): string =>
    new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  if (loadingSessions) {
    return (
      <div className="p-4 flex items-center gap-2 text-sm text-base-content/60">
        <RefreshCw size={14} className="animate-spin" />
        Loading workspaces…
      </div>
    );
  }

  return (
    <div className="p-3 flex flex-col gap-1 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold text-base-content/60 uppercase tracking-wider">
          Workspaces ({entries.length})
        </h2>
      </div>

      {entries.length === 0 && (
        <p className="text-sm text-base-content/40 text-center py-8">No sessions yet</p>
      )}

      {entries.map((entry) => (
        <div key={entry.session.id} className="rounded border border-base-300 overflow-hidden">
          <button
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-base-200 transition-colors text-left"
            onClick={() => toggleExpand(entry.session.id)}
          >
            {entry.expanded ? (
              <FolderOpen size={14} className="text-warning shrink-0" />
            ) : (
              <Folder size={14} className="text-base-content/50 shrink-0" />
            )}
            <span className="text-sm font-medium flex-1 truncate">{entry.session.title}</span>
            {entry.loading && <RefreshCw size={12} className="animate-spin text-base-content/40" />}
            <span className="text-xs text-base-content/40 shrink-0">
              {formatDate(entry.session.createdAt)}
            </span>
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
                <p className="px-3 py-2 text-xs text-base-content/40 italic">No files in workspace</p>
              )}
              {entry.files.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center gap-2 px-4 py-1.5 hover:bg-base-200 text-xs"
                >
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


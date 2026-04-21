import { useEffect, useState } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { apiClient } from '../../services/apiClient';
import type { VFSListResult } from '@kalio/types';

export function VFSExplorer() {
  const { activeSessionId } = useSessionStore();
  const [files, setFiles] = useState<VFSListResult['files']>([]);

  useEffect(() => {
    if (!activeSessionId) return;
    apiClient
      .get<VFSListResult>(`/api/vfs/${activeSessionId}`)
      .then((r) => setFiles(r.data.files))
      .catch((err: unknown) => console.error('[VFSExplorer] load failed', err));
  }, [activeSessionId]);

  if (!activeSessionId) {
    return <div data-testid="vfs-explorer" className="p-3 text-xs text-base-content/50">No active session</div>;
  }

  return (
    <div data-testid="vfs-explorer" className="flex flex-col gap-1 p-2">
      <div className="text-xs font-semibold text-base-content/60">Files</div>
      {files.length === 0 && (
        <div data-testid="vfs-empty" className="text-xs text-base-content/40">No files yet</div>
      )}
      {files.map((f) => (
        <div key={f.path} data-testid="vfs-file" className="rounded px-2 py-1 text-xs hover:bg-base-300">
          {f.path}
          <span className="ml-auto text-base-content/40"> {(f.sizeBytes / 1024).toFixed(1)}kb</span>
        </div>
      ))}
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Loader2, AlertCircle, Folder, Trash2 } from 'lucide-react';
import type { AllowedPath, CreateAllowedPathDto } from '@kalio/types';

interface DirectoryPickerHandle {
  name: string;
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<DirectoryPickerHandle>;
};

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function AllowedPathsPanel() {
  const [paths, setPaths] = useState<AllowedPath[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inputPath, setInputPath] = useState('');
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<AllowedPath[]>('/allowed-paths');
      setPaths(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load allowed paths');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleAdd = async () => {
    const path = inputPath.trim();
    if (!path) return;
    setAdding(true);
    setError(null);
    try {
      const dto: CreateAllowedPathDto = { path };
      const created = await apiFetch<AllowedPath>('/allowed-paths', {
        method: 'POST',
        body: JSON.stringify(dto),
      });
      setPaths((prev) => [...prev, created]);
      setInputPath('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add path');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: string) => {
    setError(null);
    try {
      await apiFetch(`/allowed-paths/${id}`, { method: 'DELETE' });
      setPaths((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove path');
    }
  };

  const handlePickFolder = async () => {
    const pickerWindow = window as DirectoryPickerWindow;
    if (!pickerWindow.showDirectoryPicker) {
      setError('Native folder picker is not available in this browser. Please type the path manually.');
      inputRef.current?.focus();
      return;
    }
    try {
      const dirHandle = await pickerWindow.showDirectoryPicker();
      // We can't get the absolute path from File System Access API for privacy reasons,
      // so we ask the user to type or paste it after selecting a folder name as a hint
      setInputPath(dirHandle.name);
      inputRef.current?.focus();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to open directory picker');
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="allowed-paths-panel">
      <div>
        <h2 className="text-base font-semibold mb-1">Allowed Paths</h2>
        <p className="text-xs text-base-content/60">
          Directories the agent is allowed to access via filesystem and terminal tools.
          Only absolute paths to existing directories are accepted.
        </p>
      </div>

      {error && (
        <div className="alert alert-warning py-2 text-xs gap-2">
          <AlertCircle size={14} />
          {error}
          <button className="btn btn-ghost btn-xs ml-auto" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Add form */}
      <div className="flex flex-col gap-2 border border-base-300 rounded-lg p-4 bg-base-200/40">
        <h3 className="text-sm font-semibold">Add Directory</h3>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            className="input input-bordered input-sm flex-1 font-mono"
            placeholder="e.g. C:\\Projekty\\ra-kingdom-stack"
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(); }}
            data-testid="allowed-path-input"
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm gap-1"
            onClick={() => void handlePickFolder()}
            title="Pick folder (if browser supports it)"
          >
            <Folder size={14} />
          </button>
          <button
            className="btn btn-primary btn-sm gap-1"
            onClick={() => void handleAdd()}
            disabled={!inputPath.trim() || adding}
            data-testid="allowed-path-add-btn"
          >
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add
          </button>
        </div>
        <p className="text-[10px] text-base-content/40">
          Tip: On Windows use double backslashes (C:\\Users\\...) or forward slashes (C:/Users/...).
        </p>
      </div>

      {/* List */}
      <div className="flex flex-col gap-1">
        {paths.length === 0 && !loading && (
          <p className="text-xs text-base-content/40 italic text-center py-4">
            No allowed paths configured. The agent cannot access any directories outside the VFS.
          </p>
        )}
        {loading && (
          <div className="flex items-center justify-center py-4 text-base-content/40">
            <Loader2 size={16} className="animate-spin" />
          </div>
        )}
        {paths.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between rounded border border-base-300 px-3 py-2 text-xs"
            data-testid={`allowed-path-row-${p.id}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Folder size={14} className="text-base-content/40 shrink-0" />
              <span className="font-mono truncate">{p.path}</span>
            </div>
            <button
              className="btn btn-ghost btn-xs text-error shrink-0"
              onClick={() => void handleRemove(p.id)}
              data-testid={`allowed-path-remove-${p.id}`}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

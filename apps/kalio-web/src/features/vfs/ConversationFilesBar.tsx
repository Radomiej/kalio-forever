import { useState, useEffect, useCallback, useRef } from 'react';
import { FolderOpen, File, Download, Archive, RefreshCw, X, Loader, Eye, FileText, FileJson, FileCode, FileImage } from 'lucide-react';
import { apiClient } from '../../services/apiClient';
import type { VFSFile, VFSListResult, VFSReadResult } from '@kalio/types';

interface ConversationFilesBarProps {
  sessionId: string;
  refreshSignal?: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fileIcon(mimeType: string | undefined) {
  if (!mimeType) return <File size={16} className="text-base-content/50" />;
  if (mimeType === 'text/markdown') return <FileText size={16} className="text-info" />;
  if (mimeType === 'application/json') return <FileJson size={16} className="text-success" />;
  if (mimeType.startsWith('image/')) return <FileImage size={16} className="text-warning" />;
  if (mimeType === 'text/html' || mimeType === 'text/css') return <FileCode size={16} className="text-error" />;
  if (mimeType.includes('javascript') || mimeType.includes('typescript')) return <FileCode size={16} className="text-accent" />;
  return <File size={16} className="text-base-content/50" />;
}

const API_BASE = apiClient.defaults.baseURL ?? '';

export function ConversationFilesBar({ sessionId, refreshSignal }: ConversationFilesBarProps) {
  const [files, setFiles] = useState<VFSFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<VFSListResult>(`/api/sessions/${sessionId}/vfs`);
      setFiles(res.data.files);
    } catch (err: unknown) {
      console.error('[ConversationFilesBar] load failed', err);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (refreshSignal) void refresh(); }, [refreshSignal, refresh]);

  const openModal = useCallback(() => {
    void refresh();
    dialogRef.current?.showModal();
  }, [refresh]);

  const openPreview = useCallback(async (path: string) => {
    setSelected(path);
    setLoadingPreview(true);
    try {
      const res = await apiClient.get<VFSReadResult>(`/api/sessions/${sessionId}/vfs/read`, { params: { path } });
      setPreview(res.data.content);
    } catch {
      setPreview('Failed to load file.');
    } finally {
      setLoadingPreview(false);
    }
  }, [sessionId]);

  const downloadFile = (path: string) => {
    window.open(`${API_BASE}/api/sessions/${sessionId}/vfs/download?path=${encodeURIComponent(path)}`, '_blank');
  };

  const downloadZip = () => {
    window.open(`${API_BASE}/api/sessions/${sessionId}/vfs/zip`, '_blank');
  };

  return (
    <>
      <button
        className="flex items-center gap-1.5 px-2 py-0.5 text-xs rounded hover:bg-base-300 transition-colors shrink-0"
        onClick={openModal}
        data-testid="conversation-files-toggle"
        title="Session files"
      >
        <FolderOpen size={12} className={files.length > 0 ? 'text-primary shrink-0' : 'text-base-content/30 shrink-0'} />
        <span className={files.length > 0 ? 'font-medium text-base-content/70' : 'font-medium text-base-content/35'}>Files</span>
        {files.length > 0
          ? <span className="badge badge-xs badge-primary">{files.length}</span>
          : <span className="text-[10px] text-base-content/30">empty</span>
        }
        {loading && <Loader size={10} className="animate-spin text-base-content/30 ml-1" />}
      </button>

      <dialog ref={dialogRef} className="modal" data-testid="conversation-files-modal">
        <div className="modal-box w-11/12 max-w-4xl h-[70vh] flex flex-col p-0 bg-base-100">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-base-300 shrink-0">
            <FolderOpen size={18} className="text-primary" />
            <h3 className="font-semibold text-base flex-1">Session Files</h3>
            <span className="text-xs text-base-content/40 font-mono">{files.length} file{files.length !== 1 ? 's' : ''}</span>
            <div className="flex items-center gap-1">
              {files.length > 0 && (
                <button
                  className="btn btn-ghost btn-sm gap-1"
                  onClick={downloadZip}
                  data-testid="conversation-files-zip"
                  title="Download all as ZIP"
                >
                  <Archive size={14} />
                  <span className="text-xs">ZIP</span>
                </button>
              )}
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void refresh()}
                disabled={loading}
                data-testid="conversation-files-refresh"
                title="Refresh"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
              <form method="dialog">
                <button className="btn btn-ghost btn-sm btn-square" aria-label="Close">
                  <X size={16} />
                </button>
              </form>
            </div>
          </div>

          <div className="flex flex-1 overflow-hidden">
            <div className="w-64 shrink-0 border-r border-base-300 overflow-y-auto bg-base-200/30">
              {files.map((f) => (
                <button
                  key={f.path}
                  className={`flex items-center gap-2 w-full px-3 py-2.5 text-left transition-colors hover:bg-base-200 ${
                    selected === f.path ? 'bg-primary/10 border-r-2 border-primary' : ''
                  }`}
                  onClick={() => void openPreview(f.path)}
                  data-testid={`conv-file-${f.path.replace(/\//g, '-')}`}
                >
                  {fileIcon(f.mimeType)}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate font-medium">{f.path.split('/').pop()}</div>
                    {f.path.includes('/') && (
                      <div className="text-[10px] text-base-content/40 truncate">{f.path}</div>
                    )}
                    <div className="text-[10px] text-base-content/35 mt-0.5">
                      {formatSize(f.sizeBytes)} · {formatDate(f.updatedAt)}
                    </div>
                  </div>
                </button>
              ))}
              {files.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center h-full p-4 gap-2">
                  <File size={24} className="text-base-content/20" />
                  <p className="text-xs text-base-content/40 text-center">No files yet</p>
                  <p className="text-[10px] text-base-content/30 text-center max-w-[160px]">
                    Ask the agent to create files — they'll appear here.
                  </p>
                </div>
              )}
              {loading && files.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <Loader size={20} className="animate-spin text-base-content/30" />
                </div>
              )}
            </div>

            <div className="flex-1 flex flex-col overflow-hidden">
              {selected ? (
                <>
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-base-300 bg-base-200/20 shrink-0">
                    <span className="text-xs font-mono text-base-content/60 truncate flex-1">{selected}</span>
                    <button
                      className="btn btn-ghost btn-xs gap-1"
                      onClick={() => downloadFile(selected)}
                      title="Download file"
                    >
                      <Download size={12} />
                      <span className="text-[10px]">Download</span>
                    </button>
                  </div>
                  {loadingPreview ? (
                    <div className="flex-1 flex items-center justify-center">
                      <Loader size={20} className="animate-spin text-base-content/30" />
                    </div>
                  ) : (
                    <pre
                      className="flex-1 overflow-auto p-4 text-xs font-mono leading-relaxed text-base-content/80 whitespace-pre-wrap break-words"
                      data-testid="conversation-files-preview"
                    >
                      {preview}
                    </pre>
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-base-content/30">
                  <Eye size={32} />
                  <p className="text-sm">Select a file to preview</p>
                </div>
              )}
            </div>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </>
  );
}

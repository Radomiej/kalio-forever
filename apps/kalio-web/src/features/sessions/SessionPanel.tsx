import { useEffect, useState, useRef } from 'react';
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { apiClient } from '../../services/apiClient';
import type { ChatSession, ChatMessage } from '@kalio/types';

export function SessionPanel() {
  const { sessions, activeSessionId, setSessions, setActiveSession, addSession, setMessages, removeSession, updateSession } = useSessionStore();
  const [loading, setLoading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get<ChatSession[]>('/api/sessions')
      .then((r) => setSessions(r.data))
      .catch((err: unknown) => console.error('[SessionPanel] load failed', err))
      .finally(() => setLoading(false));
  }, [setSessions]);

  const createSession = async () => {
    try {
      const { data } = await apiClient.post<ChatSession>('/api/sessions', {
        personaId: 'default',
        title: `Chat ${new Date().toLocaleTimeString()}`,
      });
      addSession(data);
      setActiveSession(data.id);
    } catch (err) {
      console.error('[SessionPanel] create failed', err);
    }
  };

  const selectSession = async (id: string) => {
    setActiveSession(id);
    try {
      const { data } = await apiClient.get<ChatMessage[]>(`/api/sessions/${id}/messages`);
      setMessages(data);
    } catch (err) {
      console.error('[SessionPanel] load messages failed', err);
    }
  };

  const deleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await apiClient.delete(`/api/sessions/${id}`);
      removeSession(id);
    } catch (err) {
      console.error('[SessionPanel] delete failed', err);
    }
  };

  const startRename = (e: React.MouseEvent, session: ChatSession) => {
    e.stopPropagation();
    setRenamingId(session.id);
    setRenameValue(session.title);
    setTimeout(() => renameRef.current?.focus(), 0);
  };

  const commitRename = async (id: string) => {
    const title = renameValue.trim();
    if (!title) { setRenamingId(null); return; }
    try {
      await apiClient.patch(`/api/sessions/${id}`, { title });
      updateSession(id, { title });
    } catch (err) {
      console.error('[SessionPanel] rename failed', err);
    } finally {
      setRenamingId(null);
    }
  };

  return (
    <div data-testid="session-panel" className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-base-300 shrink-0">
        <span className="text-xs text-base-content/50">{sessions.length} conversation{sessions.length !== 1 ? 's' : ''}</span>
        <button
          className="btn btn-ghost btn-xs gap-1"
          onClick={() => void createSession()}
          disabled={loading}
          title="New conversation"
          data-testid="new-session-btn"
        >
          <Plus size={12} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 && !loading && (
          <div className="text-xs text-base-content/40 text-center py-6">No conversations yet</div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`group flex items-center gap-1 px-3 py-2 cursor-pointer border-b border-base-300/40 last:border-0 hover:bg-base-200/50 transition-colors ${
              activeSessionId === s.id ? 'bg-sky-500/10 border-l-2 border-l-sky-500' : ''
            }`}
            onClick={() => void selectSession(s.id)}
            data-testid="session-item"
          >
            {renamingId === s.id ? (
              <form
                className="flex flex-1 items-center gap-1"
                onSubmit={(e) => { e.preventDefault(); void commitRename(s.id); }}
              >
                <input
                  ref={renameRef}
                  className="input input-bordered input-xs flex-1 min-w-0"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
                <button type="submit" className="btn btn-ghost btn-xs p-0 w-5 h-5" onClick={(e) => e.stopPropagation()}>
                  <Check size={10} className="text-success" />
                </button>
                <button type="button" className="btn btn-ghost btn-xs p-0 w-5 h-5" onClick={(e) => { e.stopPropagation(); setRenamingId(null); }}>
                  <X size={10} />
                </button>
              </form>
            ) : (
              <>
                <span className="flex-1 text-xs truncate">
                  {s.title || `Session ${s.id.slice(0, 6)}`}
                </span>
                <button
                  className="btn btn-ghost btn-xs p-0 w-5 h-5 opacity-0 group-hover:opacity-100 text-base-content/40 hover:text-sky-400"
                  onClick={(e) => startRename(e, s)}
                  title="Rename"
                >
                  <Pencil size={10} />
                </button>
                <button
                  className="btn btn-ghost btn-xs p-0 w-5 h-5 opacity-0 group-hover:opacity-100 text-base-content/40 hover:text-error"
                  onClick={(e) => void deleteSession(e, s.id)}
                  title="Delete"
                >
                  <Trash2 size={10} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


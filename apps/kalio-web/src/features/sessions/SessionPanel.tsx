import { useEffect, useState, useRef } from 'react';
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { apiClient } from '../../services/apiClient';
import type { ChatSession, ChatMessage, Persona } from '@kalio/types';
import { formatRelativeTime } from './session.utils';

export function SessionPanel({ onSelect }: { onSelect?: () => void } = {}) {
  const { sessions, activeSessionId, setSessions, setActiveSession, addSession, setMessages, removeSession, updateSession } = useSessionStore();
  const [loading, setLoading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaFilter, setPersonaFilter] = useState<string>('all');
  const [newPersonaId, setNewPersonaId] = useState<string>('default');

  useEffect(() => {
    setLoading(true);
    apiClient
      .get<ChatSession[]>('/api/sessions')
      .then((r) => {
        setSessions(r.data);
        // Auto-select the most recent session on initial load (API returns updatedAt DESC)
        if (!useSessionStore.getState().activeSessionId && r.data.length > 0) {
          void selectSession(r.data[0].id);
        }
      })
      .catch((err: unknown) => console.error('[SessionPanel] load failed', err))
      .finally(() => setLoading(false));
  }, [setSessions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    apiClient
      .get<Persona[]>('/api/personas')
      .then((r) => setPersonas(r.data))
      .catch(() => { /* non-critical */ });
  }, []);

  const createSession = async () => {
    try {
      const { data } = await apiClient.post<ChatSession>('/api/sessions', {
        personaId: newPersonaId,
        title: 'New Chat',
      });
      addSession(data);
      setActiveSession(data.id);
      setMessages([]);
      onSelect?.();
    } catch (err) {
      console.error('[SessionPanel] create failed', err);
    }
  };

  const selectSession = async (id: string) => {
    setActiveSession(id);
    onSelect?.();
    try {
      const { data } = await apiClient.get<ChatMessage[]>(`/api/sessions/${id}/messages`);
      // Discard stale result if user switched to another session while this fetch was in-flight
      if (useSessionStore.getState().activeSessionId !== id) return;
      setMessages(data);
    } catch (err) {
      console.error('[SessionPanel] load messages failed', err);
    }
  };

  const visibleSessions = (personaFilter === 'all'
    ? sessions
    : sessions.filter((s) => s.personaId === personaFilter)
  ).slice().sort((a, b) => b.updatedAt - a.updatedAt);

  const getPersonaName = (personaId: string): string | null => {
    const p = personas.find((p) => p.id === personaId);
    return p?.name ?? (personaId === 'default' ? null : personaId);
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
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-base-300 shrink-0">
        <span className="text-xs text-base-content/50 flex-1">{sessions.length} chat{sessions.length !== 1 ? 's' : ''}</span>
        <button
          className="btn btn-success btn-xs gap-1 px-2.5 min-h-0 h-6 font-medium"
          onClick={() => void createSession()}
          disabled={loading}
          title={`New ${personas.find((p) => p.id === newPersonaId)?.name ?? ''} chat`}
          data-testid="new-session-btn"
        >
          <Plus size={11} />
          <span className="text-[10px]">New</span>
        </button>
      </div>

      {/* Persona filter pills — always visible, shows all personas */}
      {personas.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 py-1.5 border-b border-base-300/60 bg-base-200/30 shrink-0">
          <button
            className={`btn btn-xs rounded-full h-5 min-h-0 px-2 text-[10px] ${
              personaFilter === 'all' ? 'btn-primary' : 'btn-ghost border border-base-300/60'
            }`}
            onClick={() => { setPersonaFilter('all'); setNewPersonaId('default'); }}
          >
            All
          </button>
          {personas.map((p) => (
            <button
              key={p.id}
              className={`btn btn-xs rounded-full h-5 min-h-0 px-2 text-[10px] ${
                personaFilter === p.id ? 'btn-primary' : 'btn-ghost border border-base-300/60'
              }`}
              onClick={() => { setPersonaFilter(p.id); setNewPersonaId(p.id); }}
            >
              {p.name}
            </button>
          ))}
          {personaFilter !== 'all' && (
            <button
              className="btn btn-ghost btn-xs p-0 w-4 h-4 min-h-0 ml-auto text-base-content/30 hover:text-base-content/60"
              onClick={() => { setPersonaFilter('all'); setNewPersonaId('default'); }}
            >
              <X size={10} />
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {visibleSessions.length === 0 && !loading && (
          <div className="text-xs text-base-content/40 text-center py-6">
            {personaFilter !== 'all' ? 'No chats for this persona' : 'No conversations yet'}
          </div>
        )}
        {visibleSessions.map((s) => {
          const personaName = getPersonaName(s.personaId);
          return (
            <div
              key={s.id}
              className={`group flex items-start gap-1 px-3 py-2 cursor-pointer border-b border-base-300/40 last:border-0 hover:bg-base-200/50 transition-colors ${
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
                <div className="flex flex-1 min-w-0 flex-col gap-0.5">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="flex-1 text-xs truncate">
                      {s.title || `Session ${s.id.slice(0, 6)}`}
                    </span>
                    <button
                      className="btn btn-ghost btn-xs p-0 w-5 h-5 shrink-0 opacity-0 group-hover:opacity-100 text-base-content/40 hover:text-sky-400"
                      onClick={(e) => startRename(e, s)}
                      title="Rename"
                    >
                      <Pencil size={10} />
                    </button>
                    <button
                      className="btn btn-ghost btn-xs p-0 w-5 h-5 shrink-0 opacity-0 group-hover:opacity-100 text-base-content/40 hover:text-error"
                      onClick={(e) => void deleteSession(e, s.id)}
                      title="Delete"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {personaName && (
                      <span className="text-[10px] text-base-content/40 bg-base-300/50 rounded px-1 py-0.5 leading-none truncate max-w-[6rem]">
                        {personaName}
                      </span>
                    )}
                    <span className="text-[10px] text-base-content/30 leading-none ml-auto shrink-0">
                      {formatRelativeTime(s.updatedAt)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


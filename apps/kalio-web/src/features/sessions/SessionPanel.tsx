import { useEffect, useState } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { apiClient } from '../../services/apiClient';
import type { ChatSession, ChatMessage } from '@kalio/types';

export function SessionPanel() {
  const { sessions, activeSessionId, setSessions, setActiveSession, addSession, setMessages } = useSessionStore();
  const [loading, setLoading] = useState(false);

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

  return (
    <div data-testid="session-panel" className="flex flex-col gap-1 p-2">
      <button
        data-testid="new-session-btn"
        className="btn btn-primary btn-xs w-full"
        onClick={createSession}
        disabled={loading}
      >
        + New Session
      </button>

      {sessions.map((s) => (
        <button
          key={s.id}
          data-testid="session-item"
          className={`btn btn-ghost btn-xs w-full justify-start truncate ${
            activeSessionId === s.id ? 'btn-active' : ''
          }`}
          onClick={() => selectSession(s.id)}
        >
          {s.title || `Session ${s.id.slice(0, 6)}`}
        </button>
      ))}
    </div>
  );
}

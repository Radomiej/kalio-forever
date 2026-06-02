import { useEffect, useState, useRef, type ReactNode } from 'react';
import { Plus, Trash2, Pencil, Check, X, AlertTriangle, Archive, RotateCcw, ChevronRight } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { useAgentStore } from '../../store/agentStore';
import { apiClient } from '../../services/apiClient';
import type { ChatSession, ChatMessage, Persona } from '@kalio/types';
import { formatRelativeTime } from './session.utils';
import {
  SESSION_ORIGIN_FILTERS,
  buildSessionListEntries,
  isVisibleSidebarSession,
  sortSessionsForSidebar,
  type SessionOriginFilter,
} from './sessionListModel';
import {
  buildChildSessionsByParent,
  countSessionDescendants,
  displayTitleForSession,
  hasExpandedAncestor,
} from './sessionTreeDisplay';

const LAST_ACTIVE_SESSION_STORAGE_KEY = 'kalio:last-active-session-id';

function loadStoredActiveSessionId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.sessionStorage.getItem(LAST_ACTIVE_SESSION_STORAGE_KEY);
}

function persistActiveSessionId(sessionId: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (sessionId) {
    window.sessionStorage.setItem(LAST_ACTIVE_SESSION_STORAGE_KEY, sessionId);
    return;
  }

  window.sessionStorage.removeItem(LAST_ACTIVE_SESSION_STORAGE_KEY);
}

export function SessionPanel({ onSelect, viewSwitcher }: { onSelect?: () => void; viewSwitcher?: ReactNode } = {}) {
  const { sessions, activeSessionId, setSessions, setActiveSession, addSession, setMessages, removeSession, updateSession } = useSessionStore();
  const pendingConfirmations = useAgentStore((s) => s.pendingConfirmations);
  const [loading, setLoading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [originFilter, setOriginFilter] = useState<SessionOriginFilter>('all');
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(() => new Set());
  const renameRef = useRef<HTMLInputElement>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [newPersonaId] = useState<string>('default');
  const [archivedSessions, setArchivedSessions] = useState<ChatSession[]>([]);

  useEffect(() => {
    if (activeSessionId) {
      persistActiveSessionId(activeSessionId);
    }
  }, [activeSessionId]);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get<ChatSession[]>('/api/sessions')
      .then((r) => {
        setSessions(r.data);
        const orderedSessions = sortSessionsForSidebar(r.data);
        const sessionById = new Map(orderedSessions.map((session) => [session.id, session]));
        const selectableSessions = orderedSessions.filter((session) => isVisibleSidebarSession(session, null, 'all', sessionById));
        if (!useSessionStore.getState().activeSessionId && selectableSessions.length > 0) {
          const storedSessionId = loadStoredActiveSessionId();
          const initialSessionId = storedSessionId && selectableSessions.some((session) => session.id === storedSessionId)
            ? storedSessionId
            : selectableSessions[0].id;
          void selectSession(initialSessionId);
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

  useEffect(() => {
    if (originFilter !== 'archived') return;
    apiClient
      .get<ChatSession[]>('/api/sessions?includeArchived=true')
      .then((r) => {
        const visibleIds = new Set(useSessionStore.getState().sessions.map((session) => session.id));
        setArchivedSessions(r.data.filter((session) => !visibleIds.has(session.id)));
      })
      .catch((err: unknown) => console.error('[SessionPanel] load archived sessions failed', err));
  }, [originFilter, sessions]);

  const createSession = async () => {
    try {
      const { data } = await apiClient.post<ChatSession>('/api/sessions', {
        personaId: newPersonaId,
        title: 'New Chat',
      });
      addSession(data);
      setActiveSession(data.id);
      persistActiveSessionId(data.id);
      setMessages([]);
      onSelect?.();
    } catch (err) {
      console.error('[SessionPanel] create failed', err);
    }
  };

  const selectSession = async (id: string) => {
    setActiveSession(id);
    persistActiveSessionId(id);
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

  const sidebarSessions = originFilter === 'archived' ? archivedSessions : sessions;
  const orderedSessions = sortSessionsForSidebar(sidebarSessions);
  const sessionById = new Map(orderedSessions.map((session) => [session.id, session]));
  const visibleSessions = orderedSessions
    .filter((session) => isVisibleSidebarSession(session, activeSessionId, originFilter, sessionById));
  const sessionListEntries = buildSessionListEntries(orderedSessions, activeSessionId, originFilter);
  const childSessionsByParent = buildChildSessionsByParent(orderedSessions);
  const descendantCountByParent = new Map<string, number>();

  const getPersonaName = (personaId: string): string | null => {
    const p = personas.find((p) => p.id === personaId);
    return p?.name ?? (personaId === 'default' ? null : personaId);
  };

  const deleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await apiClient.delete(`/api/sessions/${id}`);
      removeSession(id);
      useAgentStore.getState().setPendingConfirmation(id, null);
    } catch (err) {
      console.error('[SessionPanel] delete failed', err);
    }
  };

  const archiveSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await apiClient.post(`/api/sessions/${id}/archive`);
      removeSession(id);
      useAgentStore.getState().setPendingConfirmation(id, null);
    } catch (err) {
      console.error('[SessionPanel] archive failed', err);
    }
  };

  const restoreSession = async (e: React.MouseEvent, session: ChatSession) => {
    e.stopPropagation();
    try {
      await apiClient.post(`/api/sessions/${session.id}/restore`);
      setArchivedSessions((items) => items.filter((item) => item.id !== session.id));
      addSession(session);
    } catch (err) {
      console.error('[SessionPanel] restore failed', err);
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

  const toggleRootExpansion = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    setExpandedRoots((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const formatChildCount = (count: number): string => count > 99 ? '99+' : String(count);

  const renderSessionItem = (
    s: ChatSession,
    depth: number,
    options?: {
      compactChild?: boolean;
      childToggle?: {
        count: number;
        expanded: boolean;
      };
    },
  ) => {
    const personaName = getPersonaName(s.personaId);
    const isChildSession = Boolean(s.parentSessionId);
    const treeDepth = Math.min(depth, 4);
    const displayTitle = displayTitleForSession(s, childSessionsByParent);
    const sessionKindBadge = s.kind === 'subagent'
      ? {
          label: 'Sub-agent',
          className: 'text-sky-300 bg-sky-500/10 border border-sky-500/20',
          testId: `subagent-session-badge-${s.id}`,
        }
      : s.kind === 'cli-agent'
        ? {
            label: 'CLI agent',
            className: 'text-amber-300 bg-amber-500/10 border border-amber-500/20',
            testId: `cli-agent-session-badge-${s.id}`,
          }
        : null;

    return (
      <div
        key={s.id}
        className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer border-b border-base-300/40 last:border-0 hover:bg-base-200/50 transition-colors ${isChildSession ? 'border-l border-l-sky-500/20' : ''} ${
          activeSessionId === s.id ? 'bg-sky-500/10 border-l-2 border-l-sky-500' : ''
        }`}
        style={{ paddingLeft: (originFilter === 'agent' || options?.compactChild) ? `${12 + treeDepth * 14}px` : undefined }}
        onClick={() => void selectSession(s.id)}
        data-testid="session-item"
        data-session-id={s.id}
      >
        {(originFilter === 'agent' || options?.compactChild) && isChildSession && (
          <span className="mt-1.5 h-3 w-3 shrink-0 rounded-bl-md border-b border-l border-sky-500/30" aria-hidden="true" />
        )}
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
          <div className="flex flex-1 min-w-0 items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="min-w-0 flex-1 break-words text-xs font-medium leading-snug">
                  {displayTitle}
                </span>
                {pendingConfirmations[s.id] && (
                  <AlertTriangle
                    size={10}
                    className="text-warning shrink-0"
                    aria-label="Awaiting confirmation"
                    data-testid={`session-pending-confirmation-${s.id}`}
                  />
                )}
              </div>
              <div className="flex items-center gap-1.5 min-w-0">
                {sessionKindBadge && (
                  <span
                    className={`text-[9px] rounded px-1 py-0.5 leading-none shrink-0 ${sessionKindBadge.className}`}
                    data-testid={sessionKindBadge.testId}
                  >
                    {sessionKindBadge.label}
                  </span>
                )}
                {personaName && (
                  <span className="text-[10px] text-base-content/65 bg-base-300/50 rounded px-1 py-0.5 leading-none truncate max-w-[7rem]">
                    {personaName}
                  </span>
                )}
                <span className="text-[10px] text-base-content/60 leading-none ml-auto shrink-0">
                  {formatRelativeTime(s.updatedAt)}
                </span>
              </div>
            </div>
            <div className="flex min-w-0 shrink-0 items-start justify-end gap-1 pt-0.5">
              <button
                className="btn btn-ghost btn-xs p-0 w-7 h-7 shrink-0 opacity-0 group-hover:opacity-100 text-base-content/40 hover:text-sky-400"
                onClick={(e) => startRename(e, s)}
                title="Rename"
                aria-label={`Rename session ${displayTitle}`}
              >
                <Pencil size={12} />
              </button>
              {originFilter === 'agent' && (
                <button
                  className="btn btn-ghost btn-xs p-0 w-7 h-7 shrink-0 opacity-0 group-hover:opacity-100 text-base-content/40 hover:text-warning"
                  onClick={(e) => void archiveSession(e, s.id)}
                  title="Archive"
                  aria-label={`Archive session ${displayTitle}`}
                  data-testid={`archive-session-${s.id}`}
                >
                  <Archive size={12} />
                </button>
              )}
              {originFilter === 'archived' && (
                <button
                  className="btn btn-ghost btn-xs p-0 w-7 h-7 shrink-0 opacity-0 group-hover:opacity-100 text-base-content/40 hover:text-success"
                  onClick={(e) => void restoreSession(e, s)}
                  title="Restore"
                  aria-label={`Restore session ${displayTitle}`}
                  data-testid={`restore-session-${s.id}`}
                >
                  <RotateCcw size={12} />
                </button>
              )}
              <button
                className="btn btn-ghost btn-xs p-0 w-7 h-7 shrink-0 opacity-0 group-hover:opacity-100 text-base-content/40 hover:text-error"
                onClick={(e) => void deleteSession(e, s.id)}
                title="Delete"
                aria-label={`Delete session ${displayTitle}`}
              >
                <Trash2 size={12} />
              </button>
              {options?.childToggle && (
                <button
                  type="button"
                  className="grid h-6 min-w-7 shrink-0 place-items-center rounded border border-sky-500/20 bg-sky-500/10 px-1 text-[10px] font-mono text-sky-300 hover:bg-sky-500/15"
                  aria-label={`${options.childToggle.expanded ? 'Collapse' : 'Expand'} child conversations for ${displayTitle}`}
                  data-testid={`toggle-session-children-${s.id}`}
                  onClick={(event) => toggleRootExpansion(event, s.id)}
                  title={`${options.childToggle.count} child conversation${options.childToggle.count === 1 ? '' : 's'}`}
                >
                  <span className="flex min-w-0 items-center gap-0.5">
                    <ChevronRight size={10} className={`transition-transform ${options.childToggle.expanded ? 'rotate-90' : ''}`} />
                    <span className="min-w-[1rem] text-center leading-none">{formatChildCount(options.childToggle.count)}</span>
                  </span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderChildTree = (parentId: string, depth: number): ReactNode[] => (
    (childSessionsByParent.get(parentId) ?? []).flatMap((child) => [
      renderSessionItem(child, depth, { compactChild: true }),
      ...renderChildTree(child.id, depth + 1),
    ])
  );

  return (
    <div data-testid="session-panel" className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-base-300 shrink-0">
        <span className="rounded-md border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-[10px] font-medium text-sky-300">
          {visibleSessions.length} chat{visibleSessions.length !== 1 ? 's' : ''}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {viewSwitcher}
        </div>
        {originFilter !== 'agent' && originFilter !== 'archived' && (
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
        )}
      </div>
      <div className="flex gap-1 border-b border-base-300 px-3 py-1.5 shrink-0" data-testid="session-origin-filter">
        {SESSION_ORIGIN_FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            className={`btn btn-ghost btn-xs h-6 min-h-0 flex-1 px-2 text-[10px] ${
              originFilter === filter.id
                ? 'bg-sky-500/15 text-sky-300'
                : 'text-base-content/45 hover:text-base-content/80'
            }`}
            onClick={() => setOriginFilter(filter.id)}
            data-testid={`session-origin-filter-${filter.id}`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {visibleSessions.length === 0 && !loading && (
          <div className="text-xs text-base-content/40 text-center py-6">
            {originFilter === 'archived' ? 'No archived agent runs' : 'No conversations yet'}
          </div>
        )}
        {sessionListEntries.map((entry) => {
          if (entry.type === 'root') {
            const root = entry.session;
            return (
              <div
                key={`root-${root.id}`}
                className={`sticky top-0 z-10 cursor-pointer border-b border-base-300/60 bg-base-100/95 px-3 py-2 transition-colors hover:bg-base-200/70 ${
                  activeSessionId === root.id ? 'border-l-2 border-l-sky-500 bg-sky-500/10' : ''
                }`}
                onClick={() => void selectSession(root.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    void selectSession(root.id);
                  }
                }}
                role="button"
                tabIndex={0}
                data-testid="session-tree-root"
                data-session-id={root.id}
              >
                <p className="break-words text-[10px] font-semibold uppercase tracking-[0.12em] text-base-content/60">
                  {root.title || `Session ${root.id.slice(0, 6)}`}
                </p>
                <p className="mt-0.5 text-[10px] text-base-content/60">{entry.childCount} child run{entry.childCount === 1 ? '' : 's'}</p>
              </div>
            );
          }

          const s = entry.session;
          if ((originFilter === 'all' || originFilter === 'user') && s.parentSessionId && hasExpandedAncestor(s, sessionById, expandedRoots)) {
            return null;
          }
          const children = childSessionsByParent.get(s.id) ?? [];
          const isExpanded = expandedRoots.has(s.id);
          const childCount = countSessionDescendants(s.id, childSessionsByParent, descendantCountByParent);
          if ((originFilter === 'all' || originFilter === 'user') && !s.parentSessionId && children.length > 0) {
            return (
              <div key={s.id}>
                {renderSessionItem(s, entry.depth, { childToggle: { count: childCount, expanded: isExpanded } })}
                {isExpanded && renderChildTree(s.id, entry.depth + 1)}
              </div>
            );
          }
          return renderSessionItem(s, entry.depth);
        })}
      </div>
    </div>
  );
}


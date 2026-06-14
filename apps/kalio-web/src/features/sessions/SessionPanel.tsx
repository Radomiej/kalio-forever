import { useCallback, useEffect, useState, useRef, type ReactNode } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { useAgentStore } from '../../store/agentStore';
import { apiClient } from '../../services/apiClient';
import type { ChatSession, ChatMessage, Persona } from '@kalio/types';
import { buildTurnsFromHistory } from '../chat/chatUtils';
import { reloadSessionHistoryWithArchitectureProjection } from '../chat/architectureReloadHydration';
import { hasWorkflowEnvelopeHistory, needsWorkflowEnvelopeRecovery } from '../chat/workflowEnvelopeRecovery';
import {
  SESSION_ORIGIN_FILTERS,
  buildSessionListEntries,
  isVisibleSidebarSession,
  sortSessionsForSidebar,
  type SessionOriginFilter,
} from './sessionListModel';
import {
  buildChildSessionsByParent,
  countVisibleConversationTreeDescendants,
  displayTitleForSession,
  hasExpandedAncestor,
  normalizeConversationSessionId,
} from './sessionTreeDisplay';
import { filterRenderableSessions } from './sessionRenderableFilter';
import { renderSessionChildRows, SessionPanelSessionItem } from './SessionPanelRow';

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
  const {
    sessions,
    activeSessionId,
    setSessions,
    setActiveSession,
    addSession,
    setMessages,
    setAgentTurns,
    getSessionActiveTurnId,
    removeSession,
    updateSession,
  } = useSessionStore();
  const pendingConfirmations = useAgentStore((s) => s.pendingConfirmations);
  const pendingBudgetApprovals = useAgentStore((s) => s.pendingBudgetApprovals);
  const activeAgentLoops = useAgentStore((s) => s.activeAgentLoops);
  const queuedDepthBySession = useAgentStore((s) => s.queuedDepthBySession);
  const sessionStatusSnapshots = useAgentStore((s) => s.sessionStatusSnapshots);
  const sessionAgentTurns = useSessionStore((s) => s.sessionAgentTurns);
  const sessionMessages = useSessionStore((s) => s.sessionMessages);
  const [loading, setLoading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [originFilter, setOriginFilter] = useState<SessionOriginFilter>('all');
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(() => new Set());
  const architectureSessionRefreshRef = useRef<{ key: string; requestedAt: number } | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<ChatSession[]>([]);
  const newPersonaId = personas[0]?.id ?? 'default';

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    persistActiveSessionId(normalizeConversationSessionId(activeSessionId, sessions));
  }, [activeSessionId, sessions]);

  useEffect(() => {
    setLoading(true);
    apiClient
      .get<ChatSession[]>('/api/sessions')
      .then((r) => {
        setSessions(r.data);
        const orderedSessions = sortSessionsForSidebar(r.data);
        const { renderableSessions } = filterRenderableSessions(
          orderedSessions,
          {},
          {},
        );
        const sessionById = new Map(renderableSessions.map((session) => [session.id, session]));
        const selectableSessions = renderableSessions.filter((session) => isVisibleSidebarSession(session, null, 'all', sessionById));
        if (!useSessionStore.getState().activeSessionId && selectableSessions.length > 0) {
          const storedSessionId = normalizeConversationSessionId(loadStoredActiveSessionId(), orderedSessions);
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
      .catch((err: unknown) => {
        console.warn('[SessionPanel] load personas failed', err);
      });
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

  const reloadSessionHistory = useCallback(async (sessionId: string) => {
    try {
      const hydratedMessages = await reloadSessionHistoryWithArchitectureProjection({
        sessionId,
        getActiveSessionId: () => useSessionStore.getState().activeSessionId,
        getSessionMessages: (targetSessionId) => useSessionStore.getState().getSessionMessages(targetSessionId),
        setMessages,
        setAgentTurns,
        fetchMessages: async (targetSessionId) => {
          const response = await apiClient.get<ChatMessage[]>(`/api/sessions/${targetSessionId}/messages`);
          return response.data;
        },
      });
      if (!hydratedMessages) {
        return null;
      }

      const hasActiveLoop = useAgentStore.getState().hasActiveLoopForSession?.(sessionId) ?? false;
      const hasActiveTurn = Boolean(getSessionActiveTurnId(sessionId));
      if (hasWorkflowEnvelopeHistory(hydratedMessages) || !hasActiveLoop || !hasActiveTurn) {
        setAgentTurns(buildTurnsFromHistory(hydratedMessages, sessionId), sessionId);
      }

      return hydratedMessages;
    } catch (err) {
      console.error('[SessionPanel] load messages failed', err);
      return null;
    }
  }, [getSessionActiveTurnId, setAgentTurns, setMessages]);

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

  const selectSession = useCallback(async (id: string) => {
    const targetSessionId = normalizeConversationSessionId(id, useSessionStore.getState().sessions) ?? id;
    setActiveSession(targetSessionId);
    persistActiveSessionId(targetSessionId);
    onSelect?.();
    await reloadSessionHistory(targetSessionId);
  }, [onSelect, reloadSessionHistory, setActiveSession]);

  useEffect(() => {
    const normalizedActiveSessionId = normalizeConversationSessionId(activeSessionId, sessions);
    if (!activeSessionId || !normalizedActiveSessionId || normalizedActiveSessionId === activeSessionId) {
      return;
    }

    void selectSession(normalizedActiveSessionId);
  }, [activeSessionId, selectSession, sessions]);

  const sidebarSessions = originFilter === 'archived' ? archivedSessions : sessions;
  const orderedSessions = sortSessionsForSidebar(sidebarSessions);
  const activeLoopSessionIds = new Set(Object.values(activeAgentLoops ?? {}).map((loop) => loop.sessionId));
  const { renderableSessions, architectureSessionRuntimeStates } = filterRenderableSessions(
    orderedSessions,
    sessionMessages ?? {},
    {
      pendingConfirmations,
      pendingBudgetApprovals,
      activeLoopSessionIds,
      queuedDepthBySession: queuedDepthBySession ?? {},
      sessionStatusSnapshots: sessionStatusSnapshots ?? {},
    },
  );
  const sessionById = new Map(renderableSessions.map((session) => [session.id, session]));
  const visibleSessions = renderableSessions
    .filter((session) => isVisibleSidebarSession(session, activeSessionId, originFilter, sessionById));
  const sessionListEntries = buildSessionListEntries(renderableSessions, activeSessionId, originFilter);
  const childSessionsByParent = buildChildSessionsByParent(renderableSessions);
  const descendantCountByParent = new Map<string, number>();
  const activeOriginFilter = SESSION_ORIGIN_FILTERS.find((filter) => filter.id === originFilter) ?? SESSION_ORIGIN_FILTERS[0];
  const activeSession = activeSessionId
    ? sessions.find((session) => session.id === activeSessionId) ?? null
    : null;
  const activeSessionMessages = activeSessionId ? (sessionMessages[activeSessionId] ?? []) : [];
  const activeRenderableDescendantCount = activeSessionId
    ? countVisibleConversationTreeDescendants(activeSessionId, childSessionsByParent, descendantCountByParent)
    : 0;
  const activeWorkflowRecoveryNeeded = needsWorkflowEnvelopeRecovery({
    session: activeSession,
    messages: activeSessionMessages,
    visibleDescendantCount: activeRenderableDescendantCount,
  });

  const getPersonaName = (personaId: string): string | null => {
    const p = personas.find((p) => p.id === personaId);
    return p?.name ?? (personaId === 'default' ? null : personaId);
  };

  useEffect(() => {
    if (!activeSessionId || !activeWorkflowRecoveryNeeded) {
      architectureSessionRefreshRef.current = null;
      return;
    }

    let cancelled = false;
    let inFlight = false;
    const reloadHostArchitecture = () => {
      if (cancelled || inFlight) {
        return;
      }
      inFlight = true;
      const refreshKey = `${activeSessionId}:workflow-envelope`;
      const requestedAt = architectureSessionRefreshRef.current?.key === refreshKey
        ? architectureSessionRefreshRef.current.requestedAt
        : 0;
      if (Date.now() - requestedAt < 1_500) {
        inFlight = false;
        return;
      }
      architectureSessionRefreshRef.current = { key: refreshKey, requestedAt: Date.now() };
      void apiClient
        .get<ChatSession[]>('/api/sessions')
        .then((response) => {
          if (!cancelled) {
            setSessions(response.data);
          }
        })
        .catch((err: unknown) => {
          console.error('[SessionPanel] architecture descendant refresh failed', err);
        })
        .finally(() => {
          void reloadSessionHistory(activeSessionId).finally(() => {
            inFlight = false;
          });
        });
    };
    const timer = window.setTimeout(reloadHostArchitecture, 350);
    const interval = window.setInterval(reloadHostArchitecture, 1_500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [
    activeSessionId,
    activeWorkflowRecoveryNeeded,
    reloadSessionHistory,
    setSessions,
  ]);

  const deleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await apiClient.delete(`/api/sessions/${id}`);
      removeSession(id);
      useAgentStore.getState().setPendingConfirmation(id, null);
      useAgentStore.getState().setPendingBudgetApproval?.(id, null);
      useAgentStore.getState().clearSessionStatusSnapshot(id);
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
      useAgentStore.getState().setPendingBudgetApproval?.(id, null);
      useAgentStore.getState().clearSessionStatusSnapshot(id);
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
      <div className="relative border-b border-base-300 px-3 pb-1 pt-5 shrink-0" data-testid="session-origin-filter">
        <button
          type="button"
          className="flex h-8 w-[210px] max-w-full items-center justify-between rounded-md border border-base-300 bg-base-200/70 px-2 text-[11px] font-semibold text-base-content/75 transition-colors hover:text-base-content focus:border-sky-400 focus:outline-none"
          onClick={() => setFilterMenuOpen((value) => !value)}
          aria-expanded={filterMenuOpen}
          aria-haspopup="menu"
          aria-label="Session filter"
          data-testid="session-origin-filter-trigger"
        >
          <span>{activeOriginFilter.label}</span>
          <ChevronDown size={13} aria-hidden="true" />
        </button>
        {filterMenuOpen && (
          <div
            className="absolute left-3 right-3 top-10 z-30 rounded-md border border-base-300 bg-base-100 p-1 shadow-[0_14px_30px_rgba(2,12,27,0.35)]"
            role="menu"
          >
            {SESSION_ORIGIN_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className={`block h-8 w-full rounded px-2 text-left text-[11px] font-semibold transition-colors ${
                  originFilter === filter.id
                    ? 'bg-sky-500/15 text-sky-300'
                    : 'text-base-content/60 hover:bg-base-200 hover:text-base-content'
                }`}
                onClick={() => {
                  setOriginFilter(filter.id);
                  setFilterMenuOpen(false);
                }}
                role="menuitem"
                data-testid={`session-origin-filter-${filter.id}`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        )}
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
            const rootTitle = displayTitleForSession(root, childSessionsByParent);
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
                  {rootTitle}
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
          const visibleChildConversationCount = countVisibleConversationTreeDescendants(
            s.id,
            childSessionsByParent,
            descendantCountByParent,
          );
          const itemProps = {
            activeSessionId,
            originFilter,
            childSessionsByParent,
            pendingConfirmations,
            pendingBudgetApprovals,
            activeLoopSessionIds,
            queuedDepthBySession: queuedDepthBySession ?? {},
            sessionStatusSnapshots: sessionStatusSnapshots ?? {},
            sessionAgentTurns: sessionAgentTurns ?? {},
            sessionMessages: sessionMessages ?? {},
            architectureSessionRuntimeStates,
            renamingId,
            renameValue,
            renameRef,
            onSelectSession: selectSession,
            onStartRename: startRename,
            onCommitRename: commitRename,
            onCancelRename: () => setRenamingId(null),
            onRenameValueChange: setRenameValue,
            onDeleteSession: deleteSession,
            onArchiveSession: archiveSession,
            onRestoreSession: restoreSession,
            onToggleRootExpansion: toggleRootExpansion,
          };
          if (
            (originFilter === 'all' || originFilter === 'user')
            && !s.parentSessionId
            && children.length > 0
            && visibleChildConversationCount > 0
          ) {
            return (
              <div key={s.id}>
                <SessionPanelSessionItem
                  {...itemProps}
                  session={s}
                  depth={entry.depth}
                  personaName={getPersonaName(s.personaId)}
                  childToggle={{ count: visibleChildConversationCount, expanded: isExpanded }}
                />
                {isExpanded && renderSessionChildRows({
                  ...itemProps,
                  parentId: s.id,
                  depth: entry.depth + 1,
                  getPersonaName,
                })}
              </div>
            );
          }
          return (
            <SessionPanelSessionItem
              key={s.id}
              {...itemProps}
              session={s}
              depth={entry.depth}
              personaName={getPersonaName(s.personaId)}
            />
          );
        })}
      </div>
    </div>
  );
}


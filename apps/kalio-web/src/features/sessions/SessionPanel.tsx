import { useCallback, useEffect, useMemo, useState, useRef, type ReactNode } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { useSessionStore } from '../../store/sessionStore';
import { useAgentStore } from '../../store/agentStore';
import { apiClient } from '../../services/apiClient';
import type { ChatSession, Persona } from '@kalio/types';
import {
  activateConversationSession,
  hydrateActiveConversationSession,
  loadStoredActiveConversationSessionId,
  persistActiveConversationSessionId,
} from '../chat/activeConversationSession';
import { needsWorkflowEnvelopeRecovery } from '../chat/workflowEnvelopeRecovery';
import {
  SESSION_ORIGIN_FILTERS,
  sortSessionsForSidebar,
  type SessionOriginFilter,
} from './sessionListModel';
import {
  countVisibleConversationTreeDescendants,
  hasVisibleWorkflowConversationDescendant,
  normalizeConversationSessionId,
  visibleConversationParentId,
} from './sessionTreeDisplay';
import { buildConversationTreeModel } from './conversationTreeModel';
import { SessionPanelList } from './SessionPanelList';
import {
  mergeRuntimeQueuedDepthBySession,
  mergeRuntimeSessionStatusSnapshots,
} from '../../store/agentRuntimeSelectors';
import { loadConversationSessions } from '../../services/sessionBootstrap';
import { mergeSessionsPreservingLocal } from './mergeSessionsPreservingLocal';
import { startPendingSessionFromPanel } from './sessionPanelCreateSession';

export function SessionPanel({ onSelect, viewSwitcher }: { onSelect?: () => void; viewSwitcher?: ReactNode } = {}) {
  const {
    sessions,
    activeSessionId,
    setSessions,
    setActiveSession,
    addSession,
    getSessionMessages,
    setSessionHistoryMeta,
    getSessionAgentTurns,
    getSessionActiveTurnId,
    setMessages,
    setAgentTurns,
    removeSession,
    updateSession,
  } = useSessionStore();
  const pendingConfirmations = useAgentStore((s) => s.pendingConfirmations);
  const pendingBudgetApprovals = useAgentStore((s) => s.pendingBudgetApprovals);
  const activeAgentLoops = useAgentStore((s) => s.activeAgentLoops);
  const queuedDepthBySession = useAgentStore((s) => s.queuedDepthBySession);
  const sessionStatusSnapshots = useAgentStore((s) => s.sessionStatusSnapshots);
  const runtimeActivitySnapshots = useAgentStore((s) => s.runtimeActivitySnapshots);
  const sessionToolActivities = useAgentStore((s) => s.sessionToolActivities);
  const sessionAgentTurns = useSessionStore((s) => s.sessionAgentTurns);
  const sessionMessages = useSessionStore((s) => s.sessionMessages);
  const [loading, setLoading] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [originFilter, setOriginFilter] = useState<SessionOriginFilter>('all');
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(() => new Set());
  const architectureSessionRefreshRef = useRef<{ key: string; requestedAt: number } | null>(null);
  const collapsedWorkflowCountsRef = useRef(new Map<string, number>());
  const renameRef = useRef<HTMLInputElement>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<ChatSession[]>([]);
  const newPersonaId = personas[0]?.id ?? 'default';

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    persistActiveConversationSessionId(normalizeConversationSessionId(activeSessionId, sessions));
  }, [activeSessionId, sessions]);

  useEffect(() => {
    setLoading(true);
    loadConversationSessions()
      .then((loadedSessions) => {
        const mergedSessions = mergeSessionsPreservingLocal(useSessionStore.getState().sessions, loadedSessions);
        setSessions(mergedSessions);
        const orderedSessions = sortSessionsForSidebar(mergedSessions);
        if (!useSessionStore.getState().activeSessionId) {
          const storedSessionId = normalizeConversationSessionId(loadStoredActiveConversationSessionId(), orderedSessions);
          if (storedSessionId && orderedSessions.some((session) => session.id === storedSessionId)) {
            void selectSession(storedSessionId);
          }
        }
      })
      .catch((err: unknown) => console.warn('[SessionPanel] load failed', err))
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
        const visibleIds = new Set(sessions.map((session) => session.id));
        setArchivedSessions(r.data.filter((session) => !visibleIds.has(session.id)));
      })
      .catch((err: unknown) => console.warn('[SessionPanel] load archived sessions failed', err));
  }, [originFilter, sessions]);

  const reloadSessionHistory = useCallback(async (sessionId: string, activeSessionIdForHydration: string = sessionId) => {
    try {
      const hydratedMessages = await hydrateActiveConversationSession({
        mode: 'reload',
        sessionId,
        getActiveSessionId: () => activeSessionIdForHydration,
        getSessions: () => sessions,
        getSessionMessages,
        setMessages,
        setSessionHistoryMeta,
        setAgentTurns,
        getSessionAgentTurns,
        getSessionActiveTurnId,
        hasActiveLoopForSession: (targetSessionId) => useAgentStore.getState().hasActiveLoopForSession(targetSessionId),
      });
      if (!hydratedMessages) {
        return null;
      }

      return hydratedMessages;
    } catch (err) {
      console.warn('[SessionPanel] load messages failed', err);
      return null;
    }
  }, [getSessionActiveTurnId, getSessionAgentTurns, getSessionMessages, sessions, setAgentTurns, setMessages, setSessionHistoryMeta]);

  const createSession = async () => {
    if (creatingSession) {
      return;
    }
    setCreatingSession(true);
    try {
      await startPendingSessionFromPanel({
        personaId: newPersonaId,
        previousActiveSessionId: activeSessionId,
        addSession,
        setActiveSession,
        setMessages,
        setAgentTurns,
        removeSession,
        onSelect,
      });
    } catch (err) {
      console.error('[SessionPanel] create failed', err);
    } finally {
      setCreatingSession(false);
    }
  };

  const selectSession = useCallback(async (id: string) => {
    await activateConversationSession({
      sessionId: id,
      sessions,
      setActiveSession,
      reason: 'select',
      onActivated: async (targetSessionId) => {
        onSelect?.();
        await reloadSessionHistory(targetSessionId, targetSessionId);
      },
    });
  }, [onSelect, reloadSessionHistory, setActiveSession]);

  useEffect(() => {
    const normalizedActiveSessionId = normalizeConversationSessionId(activeSessionId, sessions);
    if (!activeSessionId || !normalizedActiveSessionId || normalizedActiveSessionId === activeSessionId) {
      return;
    }

    void selectSession(normalizedActiveSessionId);
  }, [activeSessionId, selectSession, sessions]);

  const sidebarSessions = originFilter === 'archived' ? archivedSessions : sessions;
  const effectiveSessionStatusSnapshots = useMemo(
    () => mergeRuntimeSessionStatusSnapshots(sessionStatusSnapshots, runtimeActivitySnapshots),
    [runtimeActivitySnapshots, sessionStatusSnapshots],
  );
  const effectiveQueuedDepthBySession = useMemo(
    () => mergeRuntimeQueuedDepthBySession(queuedDepthBySession, runtimeActivitySnapshots),
    [queuedDepthBySession, runtimeActivitySnapshots],
  );
  const {
    allSessionById,
    activeLoopSessionIds,
    architectureSessionRuntimeStates,
    sessionById,
    visibleSessionById,
    visibleSessions,
    sessionListEntries,
    childSessionsByParent,
    descendantCountByParent,
    activeHostSessionId,
    activeRenderableDescendantCount,
  } = buildConversationTreeModel({
    activeSessionId,
    originFilter,
    pendingBudgetApprovals,
    pendingConfirmations,
    queuedDepthBySession: effectiveQueuedDepthBySession,
    sessionAgentTurns: sessionAgentTurns ?? {},
    sessionMessages: sessionMessages ?? {},
    sessionStatusSnapshots: sessionStatusSnapshots ?? {},
    runtimeActivitySnapshots: runtimeActivitySnapshots ?? {},
    sidebarSessions,
    activeAgentLoops,
  });
  const activeOriginFilter = SESSION_ORIGIN_FILTERS.find((filter) => filter.id === originFilter) ?? SESSION_ORIGIN_FILTERS[0];
  const activeWorkflowHostSessionId = activeHostSessionId ?? activeSessionId;
  const activeWorkflowHostSession = activeWorkflowHostSessionId
    ? sessions.find((session) => session.id === activeWorkflowHostSessionId) ?? null
    : null;
  const activeWorkflowHostMessages = activeWorkflowHostSessionId ? (sessionMessages[activeWorkflowHostSessionId] ?? []) : [];
  const activeWorkflowRecoveryNeeded = needsWorkflowEnvelopeRecovery({
    session: activeWorkflowHostSession,
    messages: activeWorkflowHostMessages,
    visibleDescendantCount: activeRenderableDescendantCount,
  });
  const activeHasWorkflowConversationDescendants = activeHostSessionId
    ? hasVisibleWorkflowConversationDescendant(activeHostSessionId, childSessionsByParent)
    : false;

  const getPersonaName = (personaId: string): string | null => {
    const p = personas.find((p) => p.id === personaId);
    return p?.name ?? (personaId === 'default' ? null : personaId);
  };

  useEffect(() => {
    const shouldAutoExpandActiveHost = (
      (originFilter === 'all' || originFilter === 'user')
      && Boolean(activeHostSessionId)
      && activeRenderableDescendantCount > 0
      && (
        activeHasWorkflowConversationDescendants
        || activeWorkflowRecoveryNeeded
        || (activeSessionId !== null && activeHostSessionId !== activeSessionId)
      )
    );
    if (!shouldAutoExpandActiveHost || !activeHostSessionId) {
      return;
    }

    const collapsedAtCount = collapsedWorkflowCountsRef.current.get(activeHostSessionId);
    if (collapsedAtCount !== undefined && activeRenderableDescendantCount <= collapsedAtCount) {
      return;
    }

    setExpandedRoots((current) => {
      if (current.has(activeHostSessionId)) {
        return current;
      }
      const next = new Set(current);
      next.add(activeHostSessionId);
      return next;
    });
    collapsedWorkflowCountsRef.current.delete(activeHostSessionId);
  }, [
    activeHostSessionId,
    activeHasWorkflowConversationDescendants,
    activeRenderableDescendantCount,
    activeSessionId,
    originFilter,
    activeWorkflowRecoveryNeeded,
  ]);

  useEffect(() => {
    if ((originFilter !== 'all' && originFilter !== 'user') || !activeSessionId) {
      return;
    }

    const activeVisibleSession = visibleSessionById.get(activeSessionId);
    if (!activeVisibleSession) {
      return;
    }

    const parentId = visibleConversationParentId(activeVisibleSession, allSessionById);
    if (!parentId) {
      return;
    }

    setExpandedRoots((current) => {
      if (current.has(parentId)) {
        return current;
      }
      const next = new Set(current);
      next.add(parentId);
      return next;
    });
  }, [activeSessionId, allSessionById, originFilter, visibleSessionById]);

  useEffect(() => {
    const recoverySessionId = activeWorkflowHostSessionId ?? activeSessionId;
    if (!recoverySessionId || !activeWorkflowRecoveryNeeded) {
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
      const refreshKey = `${recoverySessionId}:workflow-envelope`;
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
            setSessions(mergeSessionsPreservingLocal(useSessionStore.getState().sessions, response.data));
          }
        })
        .catch((err: unknown) => {
          console.warn('[SessionPanel] architecture descendant refresh failed', err);
        })
        .finally(() => {
          void reloadSessionHistory(recoverySessionId).finally(() => {
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
    activeWorkflowHostSessionId,
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
        collapsedWorkflowCountsRef.current.set(id, countVisibleConversationTreeDescendants(id, childSessionsByParent));
      } else {
        next.add(id);
        collapsedWorkflowCountsRef.current.delete(id);
      }
      return next;
    });
  };

  const itemProps = {
    activeSessionId,
    originFilter,
    childSessionsByParent,
    pendingConfirmations,
    pendingBudgetApprovals,
    activeLoopSessionIds,
    queuedDepthBySession: effectiveQueuedDepthBySession,
    sessionStatusSnapshots: effectiveSessionStatusSnapshots,
    sessionAgentTurns: sessionAgentTurns ?? {},
    sessionMessages: sessionMessages ?? {},
    sessionToolActivities: sessionToolActivities ?? {},
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
            disabled={creatingSession}
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
      <SessionPanelList
        activeSessionId={activeSessionId}
        childSessionsByParent={childSessionsByParent}
        descendantCountByParent={descendantCountByParent}
        emptyState={(
          <div className="text-xs text-base-content/40 text-center py-6">
            {originFilter === 'archived' ? 'No archived agent runs' : 'No conversations yet'}
          </div>
        )}
        expandedRoots={expandedRoots}
        getPersonaName={getPersonaName}
        itemProps={itemProps}
        loading={loading}
        originFilter={originFilter}
        sessionById={sessionById}
        sessionListEntries={sessionListEntries}
        visibleSessionsCount={visibleSessions.length}
      />
    </div>
  );
}


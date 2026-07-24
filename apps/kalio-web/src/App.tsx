import { useState, useEffect, useRef } from 'react';
import {
  MessageSquare, Gauge, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { ChatInterface } from './features/chat/ChatInterface';
import { CanvasPanel } from './features/chat/CanvasPanel';
import { ExecutionGraphView } from './features/chat/graph/ExecutionGraphView';
import { ConversationPanel } from './features/sessions/ConversationPanel';
import { ConversationManagerPanel } from './features/sessions/ConversationManagerPanel';
import { PersonaPanel } from './features/persona/PersonaPanel';
import { SettingsModal } from './features/settings/SettingsModal';
import { WorkspacePanel } from './features/workspaces/WorkspacePanel';
import { MCPPanel } from './features/mcp/MCPPanel';
import { ToolPanel } from './features/tools/ToolPanel';
import { RAAppManager } from './features/raapp/RAAppManager';
import { SkillListPanel } from './features/skills/SkillListPanel';
import { SkillEditorPanel } from './features/skills/SkillEditorPanel';
import { MemoryPage } from './features/memory/MemoryPage';
import { LandingPage } from './features/landing/LandingPage';
import { BackendStatusBadge } from './components/ui/BackendStatusBadge';
import { AppNavRail } from './AppNavRail';
import { AppSecondarySections } from './AppSecondarySections';
import type { ActiveSection, AppViewState, MindTab, TalkTab, TalkView, ToolsTab } from './App.types';
import {
  APP_VIEW_STATE_STORAGE_KEY,
  LAST_TALK_ACTIVE_STORAGE_KEY,
  loadAppViewState,
  loadTalkViewPreference,
  persistTalkViewPreference,
  loadLastTalkActiveAt,
  recentTalkBadgeCount,
} from './App.viewState';
import type { LLMConfigWithSource } from './features/settings/llm-panel.types';
import { useSessionStore } from './store/sessionStore';
import { useAgentStore } from './store/agentStore';
import { backendHealth } from './services/backendHealth';
import { apiClient } from './services/apiClient';
import { eventBus } from './services/eventBus';
import { loadConversationSessions, loadRuntimeWatchlist } from './services/sessionBootstrap';
import {
  identifyWatchedSession,
  replaceBaselineWatchedSessions,
  resetSessionWatchConnectionEpoch,
} from './services/sessionWatchRegistry';
import { useSettingsStore } from './features/settings/settingsStore';
import { activateConversationSession } from './features/chat/activeConversationSession';
import { preloadRuntimeWatchSessionHistory } from './features/chat/runtimeWatchHistoryBootstrap';
import { selectRuntimeAttentionItems } from './store/agentRuntimeSelectors';
import { mergeSessionsPreservingLocal } from './features/sessions/mergeSessionsPreservingLocal';

export function App() {
  const initialViewState = loadAppViewState();
  const [activeSection, setActiveSection] = useState<ActiveSection>(initialViewState.activeSection);
  const [talkTab, setTalkTab] = useState<TalkTab>(initialViewState.talkTab);
  const [talkView, setTalkView] = useState<TalkView>(() => loadTalkViewPreference());
  const [toolsTab, setToolsTab] = useState<ToolsTab>(initialViewState.toolsTab);
  const [mindTab, setMindTab] = useState<MindTab>(initialViewState.mindTab);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(initialViewState.selectedSkillId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined);
  const [lastTalkActiveAt, setLastTalkActiveAt] = useState<number | null>(() => loadLastTalkActiveAt());
  const [talkSidebarCollapsed, setTalkSidebarCollapsed] = useState(false);

  const openSettings = (tab?: string) => { setSettingsInitialTab(tab); setSettingsOpen(true); };
  const setBackendConfig = useSettingsStore((s) => s.setBackendConfig);
  const { sessions, activeSessionId, sessionMessages, setActiveSession, setSessions } = useSessionStore();
  const recentTalkCount = recentTalkBadgeCount(sessions, lastTalkActiveAt);
  const pendingConfirmations = useAgentStore((s) => s.pendingConfirmations);
  const pendingBudgetApprovals = useAgentStore((s) => s.pendingBudgetApprovals);
  const runtimeActivitySnapshots = useAgentStore((s) => s.runtimeActivitySnapshots);
  const talkAttentionItems = selectRuntimeAttentionItems({
    pendingConfirmations,
    pendingBudgetApprovals,
    runtimeActivitySnapshots,
    sessions,
    sessionMessages,
  });
  const talkAttentionCount = talkAttentionItems.length;
  const approvalAttentionCount = talkAttentionItems.filter((item) => item.kind === 'hitl' || item.kind === 'budget').length;
  const runtimeAttentionCount = talkAttentionCount - approvalAttentionCount;
  const talkAttentionTitle = approvalAttentionCount > 0 && runtimeAttentionCount === 0
    ? `${approvalAttentionCount} approval${approvalAttentionCount === 1 ? '' : 's'} waiting`
    : approvalAttentionCount === 0 && runtimeAttentionCount > 0
      ? `${runtimeAttentionCount} runtime item${runtimeAttentionCount === 1 ? '' : 's'} needs attention`
      : `${talkAttentionCount} attention item${talkAttentionCount === 1 ? '' : 's'} waiting`;
  const hasTalkAttention = talkAttentionCount > 0;
  const setCanvasOpen = useAgentStore((s) => s.setCanvasOpen);
  const bootstrapFetchSeqRef = useRef(0);

  // Initialize on app mount
  useEffect(() => {
    persistTalkViewPreference(talkView);
  }, [talkView]);

  useEffect(() => {
    backendHealth.start();
    void apiClient
      .get<LLMConfigWithSource>('/api/llm/config')
      .then((response) => {
        const cfg = response.data;
        setBackendConfig(cfg);
      })
      .catch((err: unknown) => {
        console.warn('[App] Failed to load backend LLM config', err);
      });
  }, [setBackendConfig]);

  useEffect(() => {
    const requestSeq = bootstrapFetchSeqRef.current + 1;
    bootstrapFetchSeqRef.current = requestSeq;
    const shouldFetchSessions = useSessionStore.getState().sessions.length === 0;

    void Promise.all([
      shouldFetchSessions ? loadConversationSessions() : Promise.resolve(useSessionStore.getState().sessions),
      loadRuntimeWatchlist(),
    ])
      .then(([sessionsFromApi, runtimeWatchTargets]) => {
        if (bootstrapFetchSeqRef.current !== requestSeq) {
          return;
        }
        const mergedSessions = mergeSessionsPreservingLocal(useSessionStore.getState().sessions, sessionsFromApi);
        if (shouldFetchSessions) {
          setSessions(mergedSessions);
        }
        replaceBaselineWatchedSessions(runtimeWatchTargets.map((target) => target.sessionId), 'bootstrap-watchlist');
        void preloadRuntimeWatchSessionHistory({
          sessions: mergedSessions,
          runtimeWatchTargets,
        });
        identifyWatchedSession(useSessionStore.getState().activeSessionId, 'bootstrap-active-session', { sticky: true });
      })
      .catch((err: unknown) => {
        console.warn('[App] Failed to load bootstrap runtime state', err);
      });
  }, [setSessions]);

  useEffect(() => {
    identifyWatchedSession(activeSessionId, 'active-session', { sticky: true });
  }, [activeSessionId]);

  useEffect(() => {
    const offReconnect = eventBus.onReconnect(() => {
      resetSessionWatchConnectionEpoch('socket-reconnect');
      void Promise.all([
        loadConversationSessions({ force: true }),
        loadRuntimeWatchlist({ force: true }),
      ])
        .then(([sessionsFromApi, runtimeWatchTargets]) => {
          const mergedSessions = mergeSessionsPreservingLocal(useSessionStore.getState().sessions, sessionsFromApi);
          setSessions(mergedSessions);
          replaceBaselineWatchedSessions(runtimeWatchTargets.map((target) => target.sessionId), 'reconnect-watchlist');
          void preloadRuntimeWatchSessionHistory({
            sessions: mergedSessions,
            runtimeWatchTargets,
            force: true,
          });
          identifyWatchedSession(useSessionStore.getState().activeSessionId, 'reconnect-active-session', { sticky: true });
        })
        .catch((err: unknown) => {
          console.warn('[App] Failed to refresh sessions after reconnect', err);
        });
    });
    return offReconnect;
  }, [setSessions]);

  // Close canvas when navigating away from talk
  useEffect(() => {
    if (activeSection !== 'talk') {
      setCanvasOpen(false);
    }
  }, [activeSection, setCanvasOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const nextState: AppViewState = {
      activeSection,
      talkTab,
      talkView,
      toolsTab,
      mindTab,
      selectedSkillId,
    };
    window.sessionStorage.setItem(APP_VIEW_STATE_STORAGE_KEY, JSON.stringify(nextState));
  }, [activeSection, mindTab, selectedSkillId, talkTab, talkView, toolsTab]);

  useEffect(() => {
    if (activeSection !== 'talk' || typeof window === 'undefined') {
      return;
    }

    const now = Date.now();
    window.localStorage.setItem(LAST_TALK_ACTIVE_STORAGE_KEY, String(now));
    setLastTalkActiveAt(now);
  }, [activeSection]);

  const goHome = () => {
    setActiveSection('landing');
  };

  const openConversationFromLanding = () => {
    setTalkView('conversation');
    setActiveSection('talk');
  };
  const openSessionInConversation = (sessionId: string, forceChat = false) => {
    void activateConversationSession({
      sessionId,
      sessions,
      setActiveSession,
      reason: 'app-open',
    });
    setTalkTab('conversations');
    if (forceChat) setTalkView('conversation');
    setActiveSection('talk');
  };
  return (
    <div data-testid="app-root" className="flex h-screen w-screen overflow-hidden bg-base-100">
      <div
        className={`flex min-w-0 flex-1 ${settingsOpen ? 'invisible pointer-events-none' : ''}`}
        inert={settingsOpen ? true : undefined}
      >

      {/* ── Icon rail ── */}
      <AppNavRail
        activeSection={activeSection}
        talkAttentionCount={talkAttentionCount}
        talkAttentionTitle={talkAttentionTitle}
        recentTalkCount={recentTalkCount}
        onGoHome={goHome}
        onOpenSettings={() => openSettings()}
        onSelectSection={setActiveSection}
      />
      <main className="flex-1 overflow-hidden min-w-0" data-testid="main-chat">
        {activeSection === 'landing' && (
          <LandingPage onNavigateToChat={openConversationFromLanding} onOpenSessionInChat={openSessionInConversation} />
        )}

        {/* talk section: always mounted so ChatInterface never loses socket listeners
            or in-flight streaming state when the user navigates to the landing page */}
        <div className={`flex h-full flex-col md:flex-row ${activeSection !== 'talk' ? 'hidden' : ''}`}>
            {/* Left sidebar: session list */}
            {talkSidebarCollapsed ? (
              <div
                className="h-12 w-full shrink-0 border-b border-base-300 bg-base-100 md:h-full md:w-12 md:border-b-0 md:border-r"
                data-testid="talk-sidebar-collapsed"
              >
                <div className="flex h-full items-center justify-between gap-2 px-2 md:flex-col md:justify-start md:py-2">
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs h-8 min-h-0 w-8 rounded-md p-0 text-base-content/60 hover:text-base-content"
                    onClick={() => setTalkSidebarCollapsed(false)}
                    aria-label="Show conversations"
                    title="Show conversations"
                    data-testid="talk-sidebar-expand"
                  >
                    <PanelLeftOpen size={15} />
                  </button>
                </div>
              </div>
            ) : (
            <div className="h-64 w-full shrink-0 flex flex-col border-b border-base-300 overflow-hidden md:h-full md:w-80 md:border-b-0 md:border-r">
              <div className="flex h-9 items-center gap-1 border-b border-base-300 px-2 shrink-0" data-testid="talk-sidebar-mode-switcher">
                {[
                  { id: 'conversations' as const, label: 'Conversations', icon: <MessageSquare size={14} /> },
                  { id: 'agents' as const, label: 'Active agent runs', icon: <Gauge size={14} /> },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`btn btn-ghost btn-xs h-7 min-h-0 w-8 rounded-md p-0 ${
                      talkTab === t.id
                        ? 'bg-sky-500/15 text-sky-300'
                        : 'text-base-content/45 hover:text-base-content/80'
                    }`}
                    onClick={() => setTalkTab(t.id)}
                    aria-label={t.label}
                    title={t.label}
                    data-testid={`talk-tab-${t.id}`}
                  >
                    <span className="relative inline-flex items-center">
                      {t.icon}
                      {t.id === 'agents' && hasTalkAttention && (
                        <span
                          className="absolute -right-1 -top-1 inline-block w-1.5 h-1.5 rounded-full bg-warning animate-pulse"
                          data-testid="active-tab-pending-dot"
                          title="Needs attention"
                        />
                      )}
                    </span>
                  </button>
                ))}
                <span className="ml-1 truncate text-[10px] uppercase tracking-wide text-base-content/65">
                  {talkTab === 'conversations' ? 'Chats' : 'Runs'}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs ml-auto h-7 min-h-0 w-7 rounded-md p-0 text-base-content/45 hover:text-base-content/80"
                  onClick={() => setTalkSidebarCollapsed(true)}
                  aria-label="Hide conversations"
                  title="Hide conversations"
                  data-testid="talk-sidebar-collapse"
                >
                  <PanelLeftClose size={14} />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                {talkTab === 'conversations' && (
                  <ConversationPanel
                    onSelect={() => undefined}
                  />
                )}
                {talkTab === 'agents' && (
                  <ConversationManagerPanel
                    onNavigate={() => setTalkTab('conversations')}
                     onOpenSession={(sessionId) => openSessionInConversation(sessionId)}
                  />
                )}
              </div>
            </div>
            )}
            <div className="flex-1 min-w-0 flex overflow-hidden">
              <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-hidden min-h-0">
                  <div className={talkView === 'conversation' ? 'h-full' : 'hidden'}>
                    <ChatInterface talkView={talkView} onTalkViewChange={setTalkView} />
                  </div>
                  {talkView === 'graph' && <ExecutionGraphView onOpenSessionInConversation={(sessionId) => openSessionInConversation(sessionId, true)} talkView={talkView} onTalkViewChange={setTalkView} />}
                </div>
              </div>

              {talkView === 'conversation' && (
                <div className="relative hidden lg:flex">
                  <CanvasPanel />
                </div>
              )}
            </div>
          </div>

        {activeSection === 'tools' && (
          <div className="flex flex-col h-full">
            {/* Tools tabs */}
            <div className="flex border-b border-base-300 shrink-0">
              {[
                { id: 'native' as const, label: 'Native' },
                { id: 'mcp' as const, label: 'MCP' },
                  { id: 'raapps' as const, label: 'RAApp' },
              ].map((t) => (
                <button
                  key={t.id}
                  data-testid={`tools-tab-${t.id}`}
                  className={`flex-1 py-3 text-sm font-medium ${
                    toolsTab === t.id
                      ? 'text-sky-400 border-b-2 border-sky-500 bg-sky-500/10'
                      : 'text-base-content/50 hover:bg-base-200'
                  }`}
                  onClick={() => setToolsTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {/* Tools content */}
            <div className="flex-1 overflow-hidden">
              {toolsTab === 'native' && <ToolPanel />}
              {toolsTab === 'mcp' && <MCPPanel onOpenSettings={() => openSettings('mcp')} />}
              {toolsTab === 'raapps' && (
                <RAAppManager
                  onOpenVFS={() => {
                    setActiveSection('mind');
                    setMindTab('files');
                  }}
                  onRunWithAgent={() => setActiveSection('talk')}
                />
              )}
            </div>
          </div>
        )}

        {activeSection === 'mind' && (
          <div className="flex flex-col h-full">
            {/* Mind tabs */}
            <div className="flex border-b border-base-300 shrink-0">
              {[
                { id: 'memory' as const, label: 'Memory' },
                { id: 'files' as const, label: 'Files' },
                { id: 'skills' as const, label: 'Skills' },
                { id: 'personas' as const, label: 'Personas' },
                ].map((t) => (
                <button
                  key={t.id}
                  data-testid={`mind-tab-${t.id}`}
                  className={`flex-1 py-3 text-sm font-medium ${
                    mindTab === t.id
                      ? 'text-sky-400 border-b-2 border-sky-500 bg-sky-500/10'
                      : 'text-base-content/50 hover:bg-base-200'
                  }`}
                  onClick={() => setMindTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {/* Mind content */}
            <div className="flex-1 overflow-hidden">
              {mindTab === 'memory' && <MemoryPage />}
              {mindTab === 'files' && <WorkspacePanel />}
              {mindTab === 'skills' && (
                <div className="flex h-full">
                  <div className="w-64 shrink-0 border-r border-base-300 overflow-hidden">
                    <SkillListPanel selectedId={selectedSkillId} onSelect={setSelectedSkillId} />
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <SkillEditorPanel skillId={selectedSkillId} />
                  </div>
                </div>
              )}
              {mindTab === 'personas' && <PersonaPanel />}
            </div>
          </div>
        )}

        <AppSecondarySections activeSection={activeSection} />

      </main>
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} initialTab={settingsInitialTab} />}

      {/* Backend offline banner — only visible while the backend is unreachable */}
      <BackendStatusBadge />
    </div>
  );
}

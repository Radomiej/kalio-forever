import { useState, useEffect } from 'react';
import {
  MessageSquare, GitBranch, Gauge, PanelLeftClose, PanelLeftOpen,
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
import { ObservabilityPage } from './features/observability/ObservabilityPage';
import { ArchitectPage } from './features/architect';
import { AppNavRail } from './AppNavRail';
import type { ActiveSection, AppViewState, MindTab, TalkTab, TalkView, ToolsTab } from './App.types';
import {
  APP_VIEW_STATE_STORAGE_KEY,
  LAST_TALK_ACTIVE_STORAGE_KEY,
  loadAppViewState,
  loadLastTalkActiveAt,
  recentTalkBadgeCount,
} from './App.viewState';
import type { LLMConfigWithSource } from './features/settings/llm-panel.types';
import { useSessionStore } from './store/sessionStore';
import { useAgentStore } from './store/agentStore';
import { backendHealth } from './services/backendHealth';
import { useSettingsStore } from './features/settings/settingsStore';

const TALK_VIEW_OPTIONS: ReadonlyArray<{ id: TalkView; label: string; icon: React.ReactNode }> = [
  { id: 'conversation', label: 'Conversation', icon: <MessageSquare size={14} /> },
  { id: 'graph', label: 'Execution graph', icon: <GitBranch size={14} /> },
];

export function App() {
  const initialViewState = loadAppViewState();
  const [activeSection, setActiveSection] = useState<ActiveSection>(initialViewState.activeSection);
  const [talkTab, setTalkTab] = useState<TalkTab>(initialViewState.talkTab);
  const [talkView, setTalkView] = useState<TalkView>(initialViewState.talkView);
  const [toolsTab, setToolsTab] = useState<ToolsTab>(initialViewState.toolsTab);
  const [mindTab, setMindTab] = useState<MindTab>(initialViewState.mindTab);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(initialViewState.selectedSkillId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined);
  const [lastTalkActiveAt, setLastTalkActiveAt] = useState<number | null>(() => loadLastTalkActiveAt());
  const [talkSidebarCollapsed, setTalkSidebarCollapsed] = useState(false);

  const openSettings = (tab?: string) => { setSettingsInitialTab(tab); setSettingsOpen(true); };
  const setBackendConfig = useSettingsStore((s) => s.setBackendConfig);
  const { sessions, setActiveSession } = useSessionStore();
  const recentTalkCount = recentTalkBadgeCount(sessions, lastTalkActiveAt);
  const pendingConfirmations = useAgentStore((s) => s.pendingConfirmations);
  const pendingConfirmationCount = Object.keys(pendingConfirmations).length;
  const hasPendingConfirmation = pendingConfirmationCount > 0;
  const setCanvasOpen = useAgentStore((s) => s.setCanvasOpen);

  // Initialize on app mount
  useEffect(() => {
    backendHealth.start();
    void fetch('/api/llm/config')
      .then((r) => r.json())
      .then((cfg: LLMConfigWithSource) => {
        setBackendConfig(cfg);
      })
      .catch((err: unknown) => {
        console.warn('[App] Failed to load backend LLM config', err);
      });
  }, [setBackendConfig]);

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
  const openSessionInConversation = (sessionId: string) => {
    setActiveSession(sessionId);
    setTalkTab('conversations');
    setTalkView('conversation');
    setActiveSection('talk');
  };
  const talkViewSwitcher = (
    <div className="flex gap-1" data-testid="talk-sidebar-view-switcher" aria-label="Talk view mode">
      {TALK_VIEW_OPTIONS.map((view) => (
        <button
          key={view.id}
          type="button"
          data-testid={`talk-sidebar-${view.id}-entry`}
          className={`btn btn-ghost btn-xs h-7 min-h-0 w-7 p-0 rounded-md ${
            talkView === view.id
              ? 'bg-sky-500/15 text-sky-300'
              : 'text-base-content/45 hover:text-base-content/80'
          }`}
          onClick={() => setTalkView(view.id)}
          aria-label={view.label}
          title={view.label}
        >
          {view.icon}
        </button>
      ))}
    </div>
  );
  const collapsedTalkViewSwitcher = (
    <div className="flex flex-col gap-1" data-testid="talk-sidebar-view-switcher" aria-label="Talk view mode">
      {TALK_VIEW_OPTIONS.map((view) => (
        <button
          key={view.id}
          type="button"
          data-testid={`talk-sidebar-${view.id}-entry`}
          className={`btn btn-ghost btn-xs h-8 min-h-0 w-8 p-0 rounded-md ${
            talkView === view.id
              ? 'bg-sky-500/15 text-sky-300'
              : 'text-base-content/45 hover:text-base-content/80'
          }`}
          onClick={() => setTalkView(view.id)}
          aria-label={view.label}
          title={view.label}
        >
          {view.icon}
        </button>
      ))}
    </div>
  );
  return (
    <div data-testid="app-root" className="flex h-screen w-screen overflow-hidden bg-base-100">
      <div
        className={`flex min-w-0 flex-1 ${settingsOpen ? 'invisible pointer-events-none' : ''}`}
        aria-hidden={settingsOpen ? true : undefined}
        inert={settingsOpen ? true : undefined}
      >

      {/* ── Icon rail ── */}
      <AppNavRail
        activeSection={activeSection}
        pendingConfirmationCount={pendingConfirmationCount}
        recentTalkCount={recentTalkCount}
        onGoHome={goHome}
        onOpenSettings={() => openSettings()}
        onSelectSection={setActiveSection}
      />
      <main className="flex-1 overflow-hidden min-w-0" data-testid="main-chat">
        {activeSection === 'landing' && (
          <LandingPage onNavigateToChat={openConversationFromLanding} />
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
                  {collapsedTalkViewSwitcher}
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
                      {t.id === 'agents' && hasPendingConfirmation && (
                        <span
                          className="absolute -right-1 -top-1 inline-block w-1.5 h-1.5 rounded-full bg-warning animate-pulse"
                          data-testid="active-tab-pending-dot"
                          title="Awaiting confirmation"
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
                  <ConversationPanel onSelect={() => {}} viewSwitcher={talkViewSwitcher} />
                )}
                {talkTab === 'agents' && (
                  <ConversationManagerPanel onNavigate={() => setTalkTab('conversations')} />
                )}
              </div>
            </div>
            )}
            <div className="flex-1 min-w-0 flex overflow-hidden">
              <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-hidden min-h-0">
                  {talkView === 'conversation'
                    ? <ChatInterface />
                    : <ExecutionGraphView onOpenSessionInConversation={openSessionInConversation} />}
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

        {activeSection === 'observe' && (
          <ObservabilityPage />
        )}

        {activeSection === 'architect' && (
          <ArchitectPage />
        )}

      </main>
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} initialTab={settingsInitialTab} />}

      {/* Backend offline banner — only visible while the backend is unreachable */}
      <BackendStatusBadge />
    </div>
  );
}

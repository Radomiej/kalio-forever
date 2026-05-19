import { useState, useEffect } from 'react';
import {
  MessageSquare, Settings, Wrench, BrainCircuit, Activity,
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
import type { LLMConfigWithSource } from './features/settings/llm-panel.types';
import { useSessionStore } from './store/sessionStore';
import { useAgentStore } from './store/agentStore';
import { backendHealth } from './services/backendHealth';
import { useSettingsStore } from './features/settings/settingsStore';

type ActiveSection = 'landing' | 'talk' | 'tools' | 'mind' | 'observe';
type TalkTab = 'conversations' | 'agents';
type TalkView = 'conversation' | 'graph';
type ToolsTab = 'native' | 'mcp' | 'raapps';
type MindTab = 'memory' | 'files' | 'skills' | 'personas';

type AppViewState = {
  activeSection: ActiveSection;
  talkTab: TalkTab;
  talkView: TalkView;
  toolsTab: ToolsTab;
  mindTab: MindTab;
  selectedSkillId: string | null;
};

const APP_VIEW_STATE_STORAGE_KEY = 'kalio:app-view-state';

const DEFAULT_APP_VIEW_STATE: AppViewState = {
  activeSection: 'landing',
  talkTab: 'conversations',
  talkView: 'conversation',
  toolsTab: 'native',
  mindTab: 'memory',
  selectedSkillId: null,
};

const TALK_VIEW_OPTIONS: ReadonlyArray<{ id: TalkView; label: string }> = [
  { id: 'conversation', label: 'Conversation' },
  { id: 'graph', label: 'Graph' },
];

function isActiveSection(value: unknown): value is ActiveSection {
  return value === 'landing' || value === 'talk' || value === 'tools' || value === 'mind' || value === 'observe';
}

function isTalkTab(value: unknown): value is TalkTab {
  return value === 'conversations' || value === 'agents';
}

function isTalkView(value: unknown): value is TalkView {
  return value === 'conversation' || value === 'graph';
}

function isToolsTab(value: unknown): value is ToolsTab {
  return value === 'native' || value === 'mcp' || value === 'raapps';
}

function isMindTab(value: unknown): value is MindTab {
  return value === 'memory' || value === 'files' || value === 'skills' || value === 'personas';
}

function loadAppViewState(): AppViewState {
  if (typeof window === 'undefined') {
    return DEFAULT_APP_VIEW_STATE;
  }

  try {
    const raw = window.sessionStorage.getItem(APP_VIEW_STATE_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_APP_VIEW_STATE;
    }

    const parsed = JSON.parse(raw) as Partial<AppViewState>;
    return {
      activeSection: isActiveSection(parsed.activeSection) ? parsed.activeSection : DEFAULT_APP_VIEW_STATE.activeSection,
      talkTab: isTalkTab(parsed.talkTab) ? parsed.talkTab : DEFAULT_APP_VIEW_STATE.talkTab,
      talkView: isTalkView(parsed.talkView) ? parsed.talkView : DEFAULT_APP_VIEW_STATE.talkView,
      toolsTab: isToolsTab(parsed.toolsTab) ? parsed.toolsTab : DEFAULT_APP_VIEW_STATE.toolsTab,
      mindTab: isMindTab(parsed.mindTab) ? parsed.mindTab : DEFAULT_APP_VIEW_STATE.mindTab,
      selectedSkillId: typeof parsed.selectedSkillId === 'string' ? parsed.selectedSkillId : null,
    };
  } catch {
    return DEFAULT_APP_VIEW_STATE;
  }
}

const NAV: { id: ActiveSection; icon: React.ReactNode; label: string }[] = [
  { id: 'talk',    icon: <MessageSquare size={18} />, label: 'Talk' },
  { id: 'tools',   icon: <Wrench size={18} />,        label: 'Tools' },
  { id: 'mind',    icon: <BrainCircuit size={18} />,  label: 'Mind' },
  { id: 'observe', icon: <Activity size={18} />,      label: 'Observability' },
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

  const openSettings = (tab?: string) => { setSettingsInitialTab(tab); setSettingsOpen(true); };
  const setBackendConfig = useSettingsStore((s) => s.setBackendConfig);
  const { sessions } = useSessionStore();
  const pendingConfirmations = useAgentStore((s) => s.pendingConfirmations);
  const hasPendingConfirmation = Object.keys(pendingConfirmations).length > 0;
  const setCanvasOpen = useAgentStore((s) => s.setCanvasOpen);

  // Initialize on app mount
  useEffect(() => {
    backendHealth.start();
    void fetch('/api/llm/config')
      .then((r) => r.json())
      .then((cfg: LLMConfigWithSource) => {
        setBackendConfig(cfg);
      })
      .catch(() => {/* non-fatal */});
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

  const goHome = () => {
    setActiveSection('landing');
  };

  return (
    <div data-testid="app-root" className="flex h-screen w-screen overflow-hidden bg-base-100">

      {/* ── Icon rail ── */}
      <nav className="w-14 shrink-0 flex flex-col items-center py-3 gap-1 border-r border-base-300 bg-base-200 z-10">
        {/* Logo — click to return to landing page */}
        <button
          className={`mb-1 btn btn-ghost btn-sm w-10 h-10 p-0 flex items-center justify-center ${
            activeSection === 'landing'
              ? 'bg-sky-500/15 text-sky-400 border-l-2 border-sky-500'
              : ''
          }`}
          onClick={goHome}
          data-testid="nav-home"
          aria-label="Home"
          title="Home"
        >
          <span className={`font-black text-lg select-none ${
            activeSection === 'landing'
              ? 'text-sky-400 drop-shadow-[0_0_10px_oklch(0.60_0.176_232.6/0.9)]'
              : 'text-primary drop-shadow-[0_0_8px_oklch(0.60_0.176_232.6/0.7)]'
          }`}>K</span>
        </button>

        <div className="w-8 border-b border-base-300 my-1" />

        {/* Nav tabs */}
        {NAV.map((item) => (
          <div key={item.id} className="relative">
            <button
              className={`btn btn-ghost btn-sm w-10 h-10 p-0 flex flex-col items-center justify-center tooltip tooltip-right ${
                activeSection === item.id && activeSection !== 'landing'
                  ? 'bg-sky-500/15 text-sky-400 border-l-2 border-sky-500'
                  : 'text-base-content/60 hover:text-base-content/90'
              }`}
              data-tip={item.label}
              onClick={() => setActiveSection(item.id)}
              data-testid={`nav-${item.id}`}
              aria-label={item.label}
              title={item.label}
            >
              {item.icon}
            </button>
            {item.id === 'talk' && sessions.length > 1 && (
              <span className="absolute -top-1 -right-1 badge badge-xs badge-ghost pointer-events-none">
                {sessions.length}
              </span>
            )}
          </div>
        ))}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Settings button */}
        <div className="mb-2 relative">
          <button
            className="btn btn-ghost btn-sm w-10 h-10 p-0 flex items-center justify-center tooltip tooltip-right text-base-content/60 hover:text-primary"
            data-tip="Settings"
            onClick={() => openSettings()}
            data-testid="nav-settings"
            aria-label="Settings"
            title="Settings"
          >
            <Settings size={18} />
          </button>
        </div>
      </nav>

      {/* ── Main: full screen sections ── */}
      <main className="flex-1 overflow-hidden min-w-0" data-testid="main-chat">
        {activeSection === 'landing' && (
          <LandingPage onNavigateToChat={() => setActiveSection('talk')} />
        )}

        {/* talk section: always mounted so ChatInterface never loses socket listeners
            or in-flight streaming state when the user navigates to the landing page */}
        <div className={`flex h-full ${activeSection !== 'talk' ? 'hidden' : ''}`}>
            {/* Left sidebar: session list */}
            <div className="w-72 shrink-0 flex flex-col border-r border-base-300 overflow-hidden">
              <div className="flex border-b border-base-300 shrink-0">
                {[
                  { id: 'conversations' as const, label: 'Conversations' },
                  { id: 'agents' as const, label: 'Active' },
                ].map((t) => (
                  <button
                    key={t.id}
                    className={`flex-1 py-2 text-xs font-medium ${
                      talkTab === t.id
                        ? 'text-sky-400 border-b-2 border-sky-500 bg-sky-500/10'
                        : 'text-base-content/50 hover:bg-base-200'
                    }`}
                    onClick={() => setTalkTab(t.id)}
                  >
                    <span className="relative inline-flex items-center gap-1">
                      {t.label}
                      {t.id === 'agents' && hasPendingConfirmation && (
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full bg-warning animate-pulse"
                          data-testid="active-tab-pending-dot"
                          title="Awaiting confirmation"
                        />
                      )}
                    </span>
                  </button>
                ))}
              </div>
              <div className="border-b border-base-300 bg-base-100/80 px-3 py-3 shrink-0">
                <p className="text-[10px] uppercase tracking-[0.24em] text-base-content/40">View</p>
                <div className="mt-2 grid grid-cols-2 gap-2" data-testid="talk-sidebar-view-switcher">
                  {TALK_VIEW_OPTIONS.map((view) => (
                    <button
                      key={view.id}
                      type="button"
                      data-testid={`talk-sidebar-${view.id}-entry`}
                      className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                        talkView === view.id
                          ? 'border-sky-500 bg-sky-500/14 text-sky-300 shadow-[0_0_0_1px_rgba(14,165,233,0.15)]'
                          : 'border-base-300 bg-base-100 text-base-content/65 hover:text-base-content hover:border-base-content/20'
                      }`}
                      onClick={() => setTalkView(view.id)}
                    >
                      {view.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-hidden">
                {talkTab === 'conversations' && (
                  <ConversationPanel onSelect={() => {}} />
                )}
                {talkTab === 'agents' && (
                  <ConversationManagerPanel onNavigate={() => setTalkTab('conversations')} />
                )}
              </div>
            </div>
            <div className="flex-1 min-w-0 flex overflow-hidden">
              <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                <div className="border-b border-base-300 bg-base-100/90 backdrop-blur supports-[backdrop-filter]:bg-base-100/75 px-4 py-2 flex items-center justify-between gap-4 shrink-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.24em] text-base-content/40">Talk view</p>
                    </div>
                    {TALK_VIEW_OPTIONS.map((view) => (
                      <button
                        key={view.id}
                        type="button"
                        data-testid={`talk-view-${view.id}`}
                        className={`rounded-full min-w-[8.5rem] px-4 py-2 text-sm font-medium border transition-colors ${
                          talkView === view.id
                            ? 'border-sky-500 bg-sky-500/14 text-sky-300 shadow-[0_0_0_1px_rgba(14,165,233,0.15)]'
                            : 'border-base-300 text-base-content/65 hover:text-base-content hover:border-base-content/20 bg-base-100/55'
                        }`}
                        onClick={() => setTalkView(view.id)}
                      >
                        {view.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-base-content/45">Conversation and graph are two views of the same Talk state, so live sockets and stream state remain intact.</p>
                </div>

                <div className="flex-1 overflow-hidden min-h-0">
                  {talkView === 'conversation' ? <ChatInterface /> : <ExecutionGraphView />}
                </div>
              </div>

              {talkView === 'conversation' && (
                <div className="relative flex">
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
                  { id: 'raapps' as const, label: 'RaConsierge' },
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

      </main>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} initialTab={settingsInitialTab} />}

      {/* Backend offline banner — only visible while the backend is unreachable */}
      <BackendStatusBadge />
    </div>
  );
}

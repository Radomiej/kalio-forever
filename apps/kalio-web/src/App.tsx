import { useState, useEffect } from 'react';
import {
  MessageSquare, Settings, Wrench, BrainCircuit, Activity,
} from 'lucide-react';
import { ChatInterface } from './features/chat/ChatInterface';
import { CanvasPanel } from './features/chat/CanvasPanel';
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
import { AgentLoopPanel } from './features/agentLoop/AgentLoopPanel';
import { LandingPage } from './features/landing/LandingPage';
import { BackendStatusBadge } from './components/ui/BackendStatusBadge';
import { ObservabilityPage } from './features/observability/ObservabilityPage';
import { useSessionStore } from './store/sessionStore';
import { backendHealth } from './services/backendHealth';
import { useSettingsStore } from './features/settings/settingsStore';

type ActiveSection = 'landing' | 'talk' | 'tools' | 'mind' | 'observe';

const NAV: { id: ActiveSection; icon: React.ReactNode; label: string }[] = [
  { id: 'talk',    icon: <MessageSquare size={18} />, label: 'Talk' },
  { id: 'tools',   icon: <Wrench size={18} />,        label: 'Tools' },
  { id: 'mind',    icon: <BrainCircuit size={18} />,  label: 'Mind' },
  { id: 'observe', icon: <Activity size={18} />,      label: 'Observability' },
];

type TalkTab = 'conversations' | 'agents' | 'loops';
type ToolsTab = 'native' | 'mcp' | 'raapps';
type MindTab = 'memory' | 'files' | 'skills' | 'personas';

export function App() {
  const [activeSection, setActiveSection] = useState<ActiveSection>('landing');
  const [talkTab, setTalkTab] = useState<TalkTab>('conversations');
  const [toolsTab, setToolsTab] = useState<ToolsTab>('native');
  const [mindTab, setMindTab] = useState<MindTab>('memory');
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const setBackendConfig = useSettingsStore((s) => s.setBackendConfig);
  const { sessions } = useSessionStore();

  // Initialize on app mount
  useEffect(() => {
    backendHealth.start();
    void fetch('/api/llm/config')
      .then((r) => r.json())
      .then((cfg: { provider: string; model: string; baseUrl: string; contextWindowSize: number }) => {
        setBackendConfig(cfg);
      })
      .catch(() => {/* non-fatal */});
  }, [setBackendConfig]);

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
            onClick={() => setSettingsOpen(true)}
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

        {activeSection === 'talk' && (
          <div className="flex h-full">
            {/* Left sidebar: session list */}
            <div className="w-72 shrink-0 flex flex-col border-r border-base-300 overflow-hidden">
              <div className="flex border-b border-base-300 shrink-0">
                {[
                  { id: 'conversations' as const, label: 'Conversations' },
                  { id: 'agents' as const, label: 'Active' },
                  { id: 'loops' as const, label: 'Loops' },
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
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-hidden">
                {talkTab === 'conversations' && (
                  <ConversationPanel onSelect={() => {}} />
                )}
                {talkTab === 'agents' && (
                  <ConversationManagerPanel onNavigate={() => setTalkTab('conversations')} />
                )}
                {talkTab === 'loops' && <AgentLoopPanel />}
              </div>
            </div>
            {/* Right: chat area */}
            <div className="flex-1 overflow-hidden">
              <ChatInterface />
            </div>
          </div>
        )}

        {activeSection === 'tools' && (
          <div className="flex flex-col h-full">
            {/* Tools tabs */}
            <div className="flex border-b border-base-300 shrink-0">
              {[
                { id: 'native' as const, label: 'Native' },
                { id: 'mcp' as const, label: 'MCP' },
                { id: 'raapps' as const, label: 'RA-Apps' },
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
              {toolsTab === 'mcp' && <MCPPanel />}
              {toolsTab === 'raapps' && (
                <RAAppManager
                  onOpenVFS={() => {/* RA-Apps catalog has no VFS */}}
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

      {/* ── Canvas panel (right) ── */}
      <div className="relative flex">
        <CanvasPanel open={canvasOpen} onToggle={() => setCanvasOpen((v) => !v)} />
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

      {/* Backend offline banner — only visible while the backend is unreachable */}
      <BackendStatusBadge />
    </div>
  );
}

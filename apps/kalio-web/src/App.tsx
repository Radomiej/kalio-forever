import { useState, useRef, useEffect } from 'react';
import {
  MessageSquare, Package, Settings, Wrench, Upload,
  PanelLeftClose, PanelLeftOpen, Layers, FolderOpen, Activity, Sparkles, BrainCircuit,
  ScrollText, Repeat,
} from 'lucide-react';
import { ChatInterface } from './features/chat/ChatInterface';
import { CanvasPanel } from './features/chat/CanvasPanel';
import { ConversationPanel } from './features/sessions/ConversationPanel';
import { ConversationManagerPanel } from './features/sessions/ConversationManagerPanel';
import { PersonaPanel } from './features/persona/PersonaPanel';
import { SettingsModal } from './features/settings/SettingsModal';
import { VFSExplorer } from './features/vfs/VFSExplorer';
import { SessionVFSPanel } from './features/vfs/SessionVFSPanel';
import { MCPPanel } from './features/mcp/MCPPanel';
import { ToolPanel } from './features/tools/ToolPanel';
import { RAAppManager } from './features/raapp/RAAppManager';
import { WorkspacePanel } from './features/workspaces/WorkspacePanel';
import { SkillListPanel } from './features/skills/SkillListPanel';
import { SkillEditorPanel } from './features/skills/SkillEditorPanel';
import { MemoryPage } from './features/memory/MemoryPage';
import { AuditLogPanel } from './features/audit/AuditLogPanel';
import { AgentLoopPanel } from './features/agentLoop/AgentLoopPanel';
import { LandingPage } from './features/landing/LandingPage';
import { BackendStatusBadge } from './components/ui/BackendStatusBadge';
import { useSessionStore } from './store/sessionStore';
import { backendHealth } from './services/backendHealth';
import { useSettingsStore } from './features/settings/settingsStore';

type Tab = 'sessions' | 'tools' | 'raapps' | 'workspaces' | 'files' | 'agents' | 'agentloop' | 'skills' | 'memory' | 'audit' | 'persona' | 'mcp';

const NAV: { id: Tab; icon: React.ReactNode; label: string }[] = [
  { id: 'sessions',   icon: <MessageSquare size={18} />,   label: 'Conversations' },
  { id: 'agents',     icon: <Activity size={18} />,        label: 'Active Agents' },
  { id: 'agentloop',  icon: <Repeat size={18} />,           label: 'Agent Loops' },
  { id: 'tools',      icon: <Wrench size={18} />,          label: 'Tools' },
  { id: 'raapps',     icon: <Package size={18} />,         label: 'RA-Apps' },
  { id: 'workspaces', icon: <Layers size={18} />,          label: 'Workspaces' },
  { id: 'skills',     icon: <Sparkles size={18} />,        label: 'Skills' },
  { id: 'memory',     icon: <BrainCircuit size={18} />,    label: 'Memory' },
  { id: 'audit',      icon: <ScrollText size={18} />,      label: 'Audit Log' },
  { id: 'files',      icon: <FolderOpen size={18} />,      label: 'Session Files' },
  { id: 'persona',    icon: <Activity size={18} />,        label: 'Persona' },
  { id: 'mcp',        icon: <Wrench size={18} />,          label: 'MCP Servers' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('sessions');
  const [view, setView] = useState<'landing' | 'app'>('landing');
  const [vfsAppId, setVfsAppId] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const setBackendConfig = useSettingsStore((s) => s.setBackendConfig);
  const { sessions } = useSessionStore();
  // Use sessions for badge count
  void sessions;

  // Initialize on app mount
  useEffect(() => {
    backendHealth.start();
    // Fetch actual model + context from backend
    void fetch('/api/llm/config')
      .then((r) => r.json())
      .then((cfg: { provider: string; model: string; baseUrl: string; contextWindowSize: number }) => {
        setBackendConfig(cfg);
      })
      .catch(() => {/* non-fatal */});
  }, [setBackendConfig]);

  const handleQuickUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.name.endsWith('.zip')) { setUploadStatus('Only .zip files'); return; }
    setUploadStatus('Uploading…');
    try {
      // Placeholder for upload logic
      setUploadStatus('✓ Uploaded');
      setTimeout(() => setUploadStatus(null), 3000);
    } catch {
      setUploadStatus('Upload failed');
      setTimeout(() => setUploadStatus(null), 3000);
    }
  };

  const handleNavClick = (id: Tab) => {
    // Clicking any nav tab exits landing page
    if (view === 'landing') setView('app');
    if (id === 'memory') {
      setSidebarOpen(false);
    } else if (!sidebarOpen) {
      setSidebarOpen(true);
    }
    setTab(id);
  };

  const openVFS = (appId: string) => {
    setVfsAppId(appId);
    setTab('sessions');
  };

  return (
    <div data-testid="app-root" className="flex h-screen w-screen overflow-hidden bg-base-100">

      {/* ── Icon rail ── */}
      <nav className="w-14 shrink-0 flex flex-col items-center py-3 gap-1 border-r border-base-300 bg-base-200 z-10">
        {/* Logo — click to return to landing page */}
        <button
          className={`mb-1 btn btn-ghost btn-sm w-10 h-10 p-0 flex items-center justify-center ${
            view === 'landing'
              ? 'bg-sky-500/15 text-sky-400 border-l-2 border-sky-500'
              : ''
          }`}
          onClick={() => setView('landing')}
          data-testid="nav-home"
          aria-label="Home"
          title="Home"
        >
          <span className={`font-black text-lg select-none ${
            view === 'landing'
              ? 'text-sky-400 drop-shadow-[0_0_10px_oklch(0.60_0.176_232.6/0.9)]'
              : 'text-primary drop-shadow-[0_0_8px_oklch(0.60_0.176_232.6/0.7)]'
          }`}>K</span>
        </button>

        {/* Toggle sidebar */}
        <button
          className="btn btn-ghost btn-sm w-10 h-10 p-0 flex items-center justify-center tooltip tooltip-right text-base-content/60 hover:text-primary"
          data-tip={sidebarOpen ? 'Hide panel' : 'Show panel'}
          onClick={() => setSidebarOpen((v) => !v)}
          data-testid="nav-toggle-sidebar"
          aria-label={sidebarOpen ? 'Hide panel' : 'Show panel'}
          title={sidebarOpen ? 'Hide panel' : 'Show panel'}
        >
          {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>

        <div className="w-8 border-b border-base-300 my-1" />

        {/* Nav tabs */}
        {NAV.map((item) => (
          <div key={item.id} className="relative">
            <button
              className={`btn btn-ghost btn-sm w-10 h-10 p-0 flex flex-col items-center justify-center tooltip tooltip-right ${
                sidebarOpen && tab === item.id && view !== 'landing'
                  ? 'bg-sky-500/15 text-sky-400 border-l-2 border-sky-500'
                  : 'text-base-content/60 hover:text-base-content/90'
              }`}
              data-tip={item.label}
              onClick={() => handleNavClick(item.id)}
              data-testid={`nav-${item.id}`}
              aria-label={item.label}
              title={item.label}
            >
              {item.icon}
            </button>
            {item.id === 'sessions' && sessions.length > 1 && (
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

        {/* Quick upload ZIP */}
        <div className="mb-1 relative">
          <button
            className="btn btn-ghost btn-sm w-10 h-10 p-0 flex items-center justify-center tooltip tooltip-right text-base-content/60 hover:text-primary"
            data-tip="Upload RA-App ZIP"
            onClick={() => fileInputRef.current?.click()}
            data-testid="nav-upload-zip"
            aria-label="Upload RA-App ZIP"
            title="Upload RA-App ZIP"
          >
            <Upload size={16} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={handleQuickUpload}
            aria-label="Upload RA-App ZIP file"
            title="Upload RA-App ZIP file"
          />
          {uploadStatus && (
            <div className="absolute left-12 bottom-0 bg-base-300 text-xs px-2 py-1 rounded whitespace-nowrap z-50 shadow">
              {uploadStatus}
            </div>
          )}
        </div>
      </nav>

      {/* ── Collapsible sidebar ── */}
      <aside
        className={`shrink-0 border-r border-base-300 overflow-hidden flex flex-col bg-base-100 transition-all duration-200 ease-in-out ${sidebarOpen && view !== 'landing' ? 'w-65' : 'w-0'}`}
        data-testid="sidebar"
      >
        <div className="w-65 flex flex-col h-full">

          {/* Sessions tab */}
          {tab === 'sessions' && !vfsAppId && (
            <ConversationPanel onSelect={() => {
              // Auto-close sidebar on mobile after selecting a conversation
              if (window.innerWidth < 768) setSidebarOpen(false);
            }} />
          )}
          {tab === 'sessions' && vfsAppId && (
            <div className="p-4">
              <VFSExplorer />
            </div>
          )}

          {/* Active Agents tab */}
          {tab === 'agents' && (
            <ConversationManagerPanel onNavigate={() => {
              setTab('sessions');
              if (window.innerWidth < 768) setSidebarOpen(false);
            }} />
          )}

          {/* Tools tab */}
          {tab === 'tools' && (
            <div className="flex flex-col h-full">
              <div className="px-3 py-3 border-b border-base-300 flex items-center justify-between shrink-0">
                <span className="text-xs font-semibold text-base-content/60 uppercase tracking-wider">Tools</span>
                <button
                  className="btn btn-ghost btn-xs tooltip tooltip-left"
                  data-tip="Upload RA-App ZIP"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Upload RA-App ZIP"
                  title="Upload RA-App ZIP"
                >
                  <Wrench size={12} />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <ToolPanel />
              </div>
            </div>
          )}

          {/* RA-Apps tab */}
          {tab === 'raapps' && (
            <RAAppManager
              onOpenVFS={openVFS}
              onRunWithAgent={() => {
                // Ignore delayed callbacks once user navigates to another tab.
                setTab((current) => (current === 'raapps' ? 'sessions' : current));
              }}
            />
          )}

          {/* Workspaces tab */}
          {tab === 'workspaces' && <WorkspacePanel />}

          {/* Skills tab */}
          {tab === 'skills' && <SkillListPanel selectedId={selectedSkillId} onSelect={setSelectedSkillId} />}

          {/* Persona tab */}
          {tab === 'persona' && <PersonaPanel />}

          {/* Session Files tab */}
          {tab === 'files' && <SessionVFSPanel />}

          {/* Agent Loop tab */}
          {tab === 'agentloop' && <AgentLoopPanel />}

          {/* Audit Log tab */}
          {tab === 'audit' && <AuditLogPanel />}

          {/* MCP tab */}
          {tab === 'mcp' && <MCPPanel />}

        </div>
      </aside>

      {/* ── Main: landing page or app content ── */}
      <main className="flex-1 overflow-hidden p-3 min-w-0" data-testid="main-chat">
        {view === 'landing' ? (
          <LandingPage onNavigateToChat={() => { setView('app'); setTab('sessions'); if (!sidebarOpen) setSidebarOpen(true); }} />
        ) : tab === 'skills' ? (
          <SkillEditorPanel skillId={selectedSkillId} />
        ) : tab === 'memory' ? (
          <MemoryPage />
        ) : (
          <ChatInterface />
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

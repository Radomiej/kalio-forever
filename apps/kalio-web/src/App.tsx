import { useState } from 'react';
import {
  MessageSquare, Settings, FolderOpen, Bot, PanelLeftClose, PanelLeftOpen, Plug,
} from 'lucide-react';
import { ChatInterface } from './features/chat/ChatInterface';
import { CanvasPanel } from './features/chat/CanvasPanel';
import { SessionPanel } from './features/sessions/SessionPanel';
import { PersonaPanel } from './features/persona/PersonaPanel';
import { SettingsModal } from './features/settings/SettingsModal';
import { VFSExplorer } from './features/vfs/VFSExplorer';
import { MCPPanel } from './features/mcp/MCPPanel';

type Tab = 'sessions' | 'persona' | 'vfs' | 'mcp';

const NAV: { id: Tab; icon: React.ReactNode; label: string }[] = [
  { id: 'sessions', icon: <MessageSquare size={18} />, label: 'Conversations' },
  { id: 'persona',  icon: <Bot size={18} />,           label: 'Persona' },
  { id: 'vfs',      icon: <FolderOpen size={18} />,    label: 'Session Files' },
  { id: 'mcp',      icon: <Plug size={18} />,          label: 'MCP Servers' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('sessions');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);

  const handleNavClick = (id: Tab) => {
    if (id === tab && sidebarOpen) {
      setSidebarOpen(false);
    } else {
      setTab(id);
      setSidebarOpen(true);
    }
  };

  return (
    <div data-testid="app-root" className="flex h-screen w-screen overflow-hidden bg-base-100">

      {/* ── Icon rail ── */}
      <nav className="w-14 shrink-0 flex flex-col items-center py-3 gap-1 border-r border-base-300 bg-base-200 z-10">
        {/* Logo */}
        <div className="mb-1 flex items-center justify-center w-10 h-10">
          <span className="font-black text-lg select-none text-primary drop-shadow-[0_0_8px_oklch(0.60_0.176_232.6/0.7)]">K</span>
        </div>

        {/* Toggle sidebar */}
        <button
          className="btn btn-ghost btn-sm w-10 h-10 p-0 flex items-center justify-center tooltip tooltip-right text-base-content/60 hover:text-primary"
          data-tip={sidebarOpen ? 'Hide panel' : 'Show panel'}
          onClick={() => setSidebarOpen((v) => !v)}
          data-testid="nav-toggle-sidebar"
          aria-label={sidebarOpen ? 'Hide panel' : 'Show panel'}
        >
          {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>

        <div className="w-8 border-b border-base-300 my-1" />

        {/* Nav tabs */}
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`btn btn-ghost btn-sm w-10 h-10 p-0 flex flex-col items-center justify-center tooltip tooltip-right ${
              sidebarOpen && tab === item.id
                ? 'bg-sky-500/15 text-sky-400 border-l-2 border-sky-500'
                : 'text-base-content/60 hover:text-base-content/90'
            }`}
            data-tip={item.label}
            onClick={() => handleNavClick(item.id)}
            data-testid={`nav-${item.id}`}
            aria-label={item.label}
          >
            {item.icon}
          </button>
        ))}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Settings */}
        <div className="mb-2">
          <button
            className="btn btn-ghost btn-sm w-10 h-10 p-0 flex items-center justify-center tooltip tooltip-right text-base-content/60 hover:text-primary"
            data-tip="Settings"
            onClick={() => setSettingsOpen(true)}
            data-testid="nav-settings"
            aria-label="Settings"
          >
            <Settings size={18} />
          </button>
        </div>
      </nav>

      {/* ── Collapsible sidebar ── */}
      <aside
        className={`shrink-0 border-r border-base-300 overflow-hidden flex flex-col bg-base-100 transition-all duration-200 ease-in-out ${sidebarOpen ? 'w-64' : 'w-0'}`}
        data-testid="sidebar"
      >
        <div className="w-64 flex flex-col h-full overflow-hidden">
          {tab === 'sessions' && <SessionPanel />}
          {tab === 'persona'  && <PersonaPanel />}
          {tab === 'vfs'      && <VFSExplorer />}
          {tab === 'mcp'      && <MCPPanel />}
        </div>
      </aside>

      {/* ── Main chat ── */}
      <main className="flex flex-1 flex-col overflow-hidden relative">
        <ChatInterface />
      </main>

      {/* ── Canvas panel (right) ── */}
      <div className="relative flex">
        <CanvasPanel open={canvasOpen} onToggle={() => setCanvasOpen((v) => !v)} />
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

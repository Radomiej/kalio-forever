import { useState } from 'react';
import { ChatInterface } from './features/chat/ChatInterface';
import { SessionPanel } from './features/sessions/SessionPanel';
import { PersonaPanel } from './features/persona/PersonaPanel';
import { SettingsModal } from './features/settings/SettingsModal';
import { VFSExplorer } from './features/vfs/VFSExplorer';
import { MCPPanel } from './features/mcp/MCPPanel';
import { Panel } from './components/ui/Panel';

type SidebarView = 'sessions' | 'persona' | 'vfs' | 'mcp';

export function App() {
  const [sidebarView, setSidebarView] = useState<SidebarView>('sessions');
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div data-testid="app-root" className="flex h-screen w-screen overflow-hidden bg-base-100">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-base-300 bg-base-200">
        <div className="flex items-center justify-between border-b border-base-300 p-3">
          <span className="font-bold text-primary">Kalio v2</span>
          <button
            data-testid="open-settings"
            className="btn btn-ghost btn-xs"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙️
          </button>
        </div>

        <nav className="flex gap-1 p-2">
          {(['sessions', 'persona', 'vfs', 'mcp'] as SidebarView[]).map((view) => (
            <button
              key={view}
              data-testid={`nav-${view}`}
              className={`btn btn-xs flex-1 ${sidebarView === view ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setSidebarView(view)}
            >
              {view}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto">
          {sidebarView === 'sessions' && <SessionPanel />}
          {sidebarView === 'persona' && <PersonaPanel />}
          {sidebarView === 'vfs' && <VFSExplorer />}
          {sidebarView === 'mcp' && <MCPPanel />}
        </div>
      </aside>

      {/* Main */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <ChatInterface />
      </main>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

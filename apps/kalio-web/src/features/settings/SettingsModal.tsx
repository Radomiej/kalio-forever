import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { SETTINGS_BLOCKS } from './registry';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [tabId, setTabId] = useState(SETTINGS_BLOCKS[0]?.id ?? 'llm');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const activeBlock = SETTINGS_BLOCKS.find((b) => b.id === tabId) ?? SETTINGS_BLOCKS[0];
  const ActiveComponent = activeBlock?.component;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/80 backdrop-blur-sm p-4 sm:p-8"
      role="dialog" aria-modal="true" aria-label="Settings"
      data-testid="settings-modal"
    >
      <div className="bg-base-100 rounded-xl shadow-2xl w-full max-w-4xl h-full max-h-[680px] flex flex-col overflow-hidden border border-sky-500/20">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-base-300 shrink-0 bg-base-200/50">
          <h2 data-testid="settings-title" className="text-xl font-bold">Settings</h2>
          <button
            className="btn btn-ghost btn-circle btn-sm"
            onClick={onClose}
            aria-label="Close settings"
            data-testid="settings-close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">

          {/* Sidebar Tabs */}
          <div className="w-56 shrink-0 border-r border-base-300 bg-base-200/30 p-3 flex flex-col gap-1 overflow-y-auto">
            {SETTINGS_BLOCKS.map((block) => (
              <button
                key={block.id}
                className={`btn btn-sm justify-start gap-3 w-full border-none shadow-none font-medium transition-colors ${
                  tabId === block.id
                    ? 'bg-sky-500/10 text-sky-400 border-l-2 border-sky-500 hover:bg-sky-500/15 rounded-none rounded-r-lg'
                    : 'bg-transparent text-base-content/70 hover:bg-base-300 hover:text-base-content'
                }`}
                onClick={() => setTabId(block.id)}
                data-testid={`settings-tab-${block.id}`}
              >
                {block.icon}
                {block.label}
              </button>
            ))}
          </div>

          {/* Panel */}
          <div className="flex-1 overflow-hidden relative">
            <div className="absolute inset-0 overflow-y-auto p-6">
              <div className="max-w-2xl mx-auto bg-base-100 rounded-lg p-5 shadow-sm border border-base-200">
                {ActiveComponent && <ActiveComponent />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

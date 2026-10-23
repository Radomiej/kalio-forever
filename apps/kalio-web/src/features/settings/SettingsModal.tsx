import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { SETTINGS_BLOCKS } from './registry';
import { useSettingsStore } from './settingsStore';

interface SettingsModalProps {
  onClose: () => void;
  initialTab?: string;
}

function tabStops(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]',
  )).filter((element) => {
    if (element.tabIndex < 0 || element.matches(':disabled') || element.closest('[hidden], [inert]')) return false;
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = window.getComputedStyle(ancestor);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (ancestor instanceof HTMLDetailsElement && !ancestor.open
        && !ancestor.querySelector('summary')?.contains(element)) return false;
      if (ancestor === container) break;
    }
    return true;
  });
}

export function SettingsModal({ onClose, initialTab }: SettingsModalProps) {
  const [tabId, setTabId] = useState(initialTab ?? SETTINGS_BLOCKS[0]?.id ?? 'llm');
  const contentRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const pendingRuntimeFocusRequestRef = useRef(false);
  const requestedSettingsTab = useSettingsStore((state) => state.requestedSettingsTab);
  const clearRequestedSettingsTab = useSettingsStore((state) => state.clearRequestedSettingsTab);
  const requestRuntimeModelFocus = useSettingsStore((state) => state.requestRuntimeModelFocus);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modal = modalRef.current;
      if (!modal || modal.inert || e.defaultPrevented) return;
      const activeDialog = document.activeElement?.closest('dialog, [role="dialog"]');
      if (activeDialog && activeDialog !== modal) return;
      if (e.key === 'Escape'
        && document.activeElement?.closest('[role="combobox"][aria-expanded="true"]')) return;
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab') return;
      const stops = tabStops(modal);
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      if (!modal.contains(active) || (e.shiftKey ? active === first : active === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useLayoutEffect(() => {
    const previousFocus = document.activeElement;
    closeButtonRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (!requestedSettingsTab) {
      return;
    }

    pendingRuntimeFocusRequestRef.current = requestedSettingsTab === 'runtime';
    setTabId(requestedSettingsTab);
    clearRequestedSettingsTab();
  }, [clearRequestedSettingsTab, requestedSettingsTab]);

  useEffect(() => {
    if (tabId !== 'runtime' || !pendingRuntimeFocusRequestRef.current) {
      return;
    }

    pendingRuntimeFocusRequestRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      requestRuntimeModelFocus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [requestRuntimeModelFocus, tabId]);

  useEffect(() => {
    if (typeof contentRef.current?.scrollTo === 'function') {
      contentRef.current.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [tabId]);

  const activeBlock = SETTINGS_BLOCKS.find((b) => b.id === tabId) ?? SETTINGS_BLOCKS[0];
  const ActiveComponent = activeBlock?.component;

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/80 p-3 backdrop-blur-sm sm:p-6"
      role="dialog" aria-modal="true" aria-label="Settings"
      data-testid="settings-modal"
    >
      <div className="flex h-[min(920px,calc(100vh-1.5rem))] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-sky-500/20 bg-base-100 shadow-2xl sm:h-[min(920px,calc(100vh-3rem))]">

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-base-300 bg-base-200/50 px-5 py-4 sm:px-6">
          <h2 data-testid="settings-title" className="text-xl font-bold">Settings</h2>
          <button
            ref={closeButtonRef}
            className="btn btn-ghost btn-circle btn-sm"
            onClick={onClose}
            aria-label="Close settings"
            data-testid="settings-close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">

          {/* Sidebar Tabs */}
          <div
            className="grid shrink-0 grid-cols-2 gap-1.5 overflow-y-auto border-b border-base-300 bg-base-200/30 p-3 sm:grid-cols-3 lg:w-64 lg:grid-cols-1 lg:content-start lg:overflow-visible lg:border-b-0 lg:border-r"
            data-testid="settings-navigation"
          >
            {SETTINGS_BLOCKS.map((block) => (
              <button
                key={block.id}
                type="button"
                className={`btn btn-sm h-10 min-h-10 justify-start gap-3 whitespace-normal px-3 py-2 text-left font-medium shadow-none transition-colors ${
                  tabId === block.id
                    ? 'border-none bg-sky-500/10 text-sky-400 ring-1 ring-inset ring-sky-500/30 hover:bg-sky-500/15'
                    : 'border-none bg-transparent text-base-content/70 hover:bg-base-300 hover:text-base-content'
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
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div ref={contentRef} className="absolute inset-0 overflow-y-auto p-4 sm:p-6" data-testid="settings-panel-scroll">
              <div className="mx-auto w-full max-w-4xl">
                {ActiveComponent && <ActiveComponent />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

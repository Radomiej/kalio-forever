import { useState } from 'react';
import { Check, Copy, Play } from 'lucide-react';
import type { ChatMessage, ChatSession, Persona } from '@kalio/types';
import type { TokenCount } from '../../services/tokenCounter';
import { ConversationFilesBar } from '../vfs/ConversationFilesBar';
import { ContextStats } from './ContextStats';
import type { RawContextStats } from './ContextStats';
import { TokenBadge } from './TokenBadge';
import type { ArchitectSchema } from '../architect/architect.types';

export type ChatConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

const VFS_REFRESH_TOOL_NAMES = new Set(['vfs_write', 'image_generate', 'image_edit']);
const WELCOME_PROMPTS = [
  'What can you do?',
  'Build a calculator app',
  'Create a todo list',
  'Generate an image of a fox',
];

export function shouldRefreshVfsForToolResult(toolName: string | undefined, data: unknown): boolean {
  if (!toolName) {
    return false;
  }
  if (VFS_REFRESH_TOOL_NAMES.has(toolName)) {
    return true;
  }
  if (toolName !== 'run_subagent' || !data || typeof data !== 'object') {
    return false;
  }

  const result = data as Record<string, unknown>;
  if (result['vfsMode'] === 'shared') {
    return true;
  }

  const copiedFiles = result['copiedFiles'];
  return Array.isArray(copiedFiles) && copiedFiles.length > 0;
}

export function buildCopiedChatText(messages: ChatMessage[]): string {
  const toolResultByCallId = new Map(
    messages
      .filter((m) => m.role === 'tool_result' && m.toolCallId)
      .map((m) => [m.toolCallId!, m.content]),
  );

  const entries: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'system' || msg.role === 'tool_result') continue;

    const who = msg.role === 'user' ? 'You' : 'Kalio';
    const parts: string[] = [];

    if (msg.thinking) {
      parts.push(`[Thinking]\n${msg.thinking}\n[/Thinking]`);
    }
    if (msg.content) {
      parts.push(msg.content);
    }
    if (msg.toolCalls?.length) {
      for (const tc of msg.toolCalls) {
        const result = toolResultByCallId.get(tc.id) ?? '';
        parts.push(`[Tool: ${tc.name}(${JSON.stringify(tc.args)})]\n→ ${result}`);
      }
    }

    entries.push(`${who}:\n${parts.join('\n\n')}`);
  }

  return entries.join('\n\n---\n\n');
}

interface ChatStatusBannersProps {
  connectionState: ChatConnectionState;
  error: string | null;
  onCloseError: () => void;
  onCloseRecoveryNotice: () => void;
  onCloseRetryError: () => void;
  onRetry: () => void;
  recoveryNotice: string | null;
  retryError: string | null;
}

export function ChatStatusBanners({
  connectionState,
  error,
  onCloseError,
  onCloseRecoveryNotice,
  onCloseRetryError,
  onRetry,
  recoveryNotice,
  retryError,
}: ChatStatusBannersProps) {
  const showConnectionBanner = connectionState !== 'connected';

  return (
    <>
      {showConnectionBanner && (
        <div data-testid="chat-connection-status" className="alert alert-info m-2 py-2 text-sm">
          <span className="loading loading-ring loading-xs" />
          <span>
            {connectionState === 'connecting' && 'Connecting to backend...'}
            {connectionState === 'reconnecting' && 'Reconnecting. Current session will be resynced.'}
            {connectionState === 'disconnected' && 'Backend connection is offline. New messages will wait for reconnect.'}
          </span>
        </div>
      )}
      {recoveryNotice && (
        <div data-testid="chat-recovery-notice" className="alert alert-info m-2 py-2 text-sm flex items-center gap-2">
          <span className="flex-1">{recoveryNotice}</span>
          <button className="btn btn-ghost btn-xs" onClick={onCloseRecoveryNotice}>x</button>
        </div>
      )}
      {error && (
        <div data-testid="chat-error" className="alert alert-error m-2 py-2 text-sm">
          {error}
          <button className="btn btn-ghost btn-xs ml-auto" onClick={onCloseError}>x</button>
        </div>
      )}
      {retryError && (
        <div data-testid="chat-retry-error" className="alert alert-warning m-2 py-2 text-sm flex items-center gap-2">
          <span className="flex-1">{retryError}</span>
          <button className="btn btn-xs btn-warning" onClick={onRetry}>
            Retry
          </button>
          <button className="btn btn-ghost btn-xs" onClick={onCloseRetryError}>x</button>
        </div>
      )}
    </>
  );
}

interface ChatSessionHeaderProps {
  activeContext: { systemPrompt: string | null; activeToolNames: string[] };
  activeModel: string | null;
  activeSession: ChatSession;
  activeSessionId: string;
  copied: boolean;
  messages: ChatMessage[];
  needsCompact: boolean;
  onCloseContextStats: () => void;
  onCompactNow: () => void;
  onCopyChat: () => void;
  onToggleContextStats: () => void;
  showContextStats: boolean;
  tokenCount: TokenCount;
  rawContext: RawContextStats;
  vfsRefreshSignal: number;
}

export function ChatSessionHeader({
  activeContext,
  activeModel,
  activeSession,
  activeSessionId,
  copied,
  messages,
  needsCompact,
  onCloseContextStats,
  onCompactNow,
  onCopyChat,
  onToggleContextStats,
  showContextStats,
  tokenCount,
  rawContext,
  vfsRefreshSignal,
}: ChatSessionHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-base-300 shrink-0">
      <span className="text-sm font-medium truncate flex-1">{activeSession.title}</span>
      <ConversationFilesBar sessionId={activeSessionId} refreshSignal={vfsRefreshSignal} />
      {messages.length > 0 && (
        <button
          className="btn btn-ghost btn-xs text-base-content/40 hover:text-base-content/70"
          onClick={onCopyChat}
          title="Copy chat to clipboard"
        >
          {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
        </button>
      )}
      <div className="relative shrink-0">
        <TokenBadge tokenCount={tokenCount} onClick={onToggleContextStats} />
        {showContextStats && (
          <ContextStats
            tokenCount={tokenCount}
            onCompactNow={needsCompact ? onCompactNow : undefined}
            onClose={onCloseContextStats}
            systemPrompt={activeContext.systemPrompt}
            activeToolNames={activeContext.activeToolNames}
            rawContext={rawContext}
          />
        )}
      </div>
      {activeModel && (
        <span className="text-[10px] font-mono text-base-content/65 shrink-0 truncate max-w-[9rem]" title={activeModel}>
          {activeModel}
        </span>
      )}
    </div>
  );
}

interface ChatWelcomeScreenProps {
  activeSession: ChatSession | null;
  activeSessionId: string | null;
  architectures: ArchitectSchema[];
  isStreaming: boolean;
  onArchitectureChange: (schemaId: string) => void;
  onArchitectureRun: (content: string, schemaId: string) => void;
  onPersonaChange: (personaId: string) => void;
  onSend: (content: string, personaId: string) => void;
  personas: Persona[];
  selectedArchitectureId: string;
}

export function ChatWelcomeScreen({
  activeSession,
  activeSessionId,
  architectures,
  isStreaming,
  onArchitectureChange,
  onArchitectureRun,
  onPersonaChange,
  onSend,
  personas,
  selectedArchitectureId,
}: ChatWelcomeScreenProps) {
  const [prompt, setPrompt] = useState('');
  const activeArchitecture = selectedArchitectureId === 'single-chat'
    ? null
    : architectures.find((schema) => schema.id === selectedArchitectureId) ?? null;

  const submitPrompt = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || !activeSessionId || isStreaming) return;
    if (activeArchitecture) {
      onArchitectureRun(trimmed, activeArchitecture.id);
    } else {
      onSend(trimmed, activeSession?.personaId ?? 'default');
    }
    setPrompt('');
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 w-full max-w-xl mx-auto px-4" data-testid="welcome-screen">
      <div className="text-center select-none">
        <div className="text-primary font-black text-4xl drop-shadow-[0_0_12px_oklch(0.60_0.176_232.6/0.6)] mb-2">K</div>
        <h2 className="text-base font-semibold text-base-content/80">KALIO</h2>
        <p className="text-base-content/65 text-xs mt-1 leading-relaxed max-w-60">
          AI assistant - build apps, query data, generate images, run tools
        </p>
      </div>
      {activeSessionId && (
        <div className="w-full space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            {personas.length > 1 && (
              <div>
                <label htmlFor="welcome-persona-select" className="text-[10px] uppercase tracking-wider text-base-content/65 mb-1 block pl-1">
                  Persona
                </label>
                <select
                  id="welcome-persona-select"
                  aria-label="Persona"
                  className="select select-bordered select-sm w-full text-sm"
                  value={activeSession?.personaId ?? 'default'}
                  onChange={(event) => onPersonaChange(event.target.value)}
                  disabled={isStreaming}
                  data-testid="welcome-persona-select"
                >
                  {personas.map((persona) => (
                    <option key={persona.id} value={persona.id}>{persona.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className={personas.length > 1 ? '' : 'md:col-span-2'}>
              <label htmlFor="welcome-architecture-select" className="text-[10px] uppercase tracking-wider text-base-content/65 mb-1 block pl-1">
                Architecture
              </label>
              <select
                id="welcome-architecture-select"
                aria-label="Architecture"
                className="select select-bordered select-sm w-full text-sm"
                value={selectedArchitectureId}
                onChange={(event) => onArchitectureChange(event.target.value)}
                disabled={isStreaming}
                data-testid="welcome-architecture-select"
              >
                <option value="single-chat">Single Chat</option>
                {architectures.map((schema) => (
                  <option key={schema.id} value={schema.id}>{schema.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="rounded-lg border border-base-300 bg-base-100/80 p-2">
            <textarea
              className="textarea textarea-ghost min-h-24 w-full resize-none text-sm leading-6 focus:outline-none"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submitPrompt(prompt);
                }
              }}
              placeholder={activeArchitecture ? `Run prompt through ${activeArchitecture.name}` : 'Ask Kalio...'}
              disabled={isStreaming}
              data-testid="welcome-prompt-input"
            />
            <div className="flex items-center justify-between gap-3 border-t border-base-300/70 px-1 pt-2">
              <span className="truncate text-[11px] text-base-content/65" data-testid="welcome-routing-summary">
                {activeArchitecture ? `Graph runtime: ${activeArchitecture.name}` : 'Direct chat runtime'}
              </span>
              <button
                type="button"
                className="btn btn-primary btn-sm gap-2"
                onClick={() => submitPrompt(prompt)}
                disabled={isStreaming || prompt.trim().length === 0}
                data-testid="welcome-run-prompt"
              >
                <Play size={14} />
                Run
              </button>
            </div>
          </div>
        </div>
      )}
      {activeSessionId && (
        <div className="flex flex-wrap justify-center gap-2 mt-1">
          {WELCOME_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="btn btn-sm btn-ghost border border-base-300/70 text-xs text-base-content/70 hover:text-primary hover:border-primary/40"
              onClick={() => submitPrompt(prompt)}
              disabled={isStreaming}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

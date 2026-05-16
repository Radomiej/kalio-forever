import { Check, Copy } from 'lucide-react';
import type { ChatMessage, ChatSession, Persona } from '@kalio/types';
import type { TokenCount } from '../../services/tokenCounter';
import { ConversationFilesBar } from '../vfs/ConversationFilesBar';
import { ContextStats } from './ContextStats';
import { TokenBadge } from './TokenBadge';

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
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => {
      const who = message.role === 'user' ? 'You' : 'Kalio';
      return `${who}: ${message.content}`;
    })
    .join('\n\n');
}

interface ChatStatusBannersProps {
  error: string | null;
  onCloseError: () => void;
  onCloseRetryError: () => void;
  onRetry: () => void;
  retryError: string | null;
}

export function ChatStatusBanners({
  error,
  onCloseError,
  onCloseRetryError,
  onRetry,
  retryError,
}: ChatStatusBannersProps) {
  return (
    <>
      {error && (
        <div data-testid="chat-error" className="alert alert-error m-2 py-2 text-sm">
          {error}
          <button className="btn btn-ghost btn-xs ml-auto" onClick={onCloseError}>✕</button>
        </div>
      )}
      {retryError && (
        <div data-testid="chat-retry-error" className="alert alert-warning m-2 py-2 text-sm flex items-center gap-2">
          <span className="flex-1">{retryError}</span>
          <button className="btn btn-xs btn-warning" onClick={onRetry}>
            Retry
          </button>
          <button className="btn btn-ghost btn-xs" onClick={onCloseRetryError}>✕</button>
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
          />
        )}
      </div>
      {activeModel && (
        <span className="text-[10px] font-mono text-base-content/35 shrink-0 truncate max-w-[9rem]" title={activeModel}>
          {activeModel}
        </span>
      )}
    </div>
  );
}

interface ChatWelcomeScreenProps {
  activeSession: ChatSession | null;
  activeSessionId: string | null;
  isStreaming: boolean;
  onPersonaChange: (personaId: string) => void;
  onSend: (content: string, personaId: string) => void;
  personas: Persona[];
}

export function ChatWelcomeScreen({
  activeSession,
  activeSessionId,
  isStreaming,
  onPersonaChange,
  onSend,
  personas,
}: ChatWelcomeScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 max-w-sm mx-auto px-4" data-testid="welcome-screen">
      <div className="text-center select-none">
        <div className="text-primary font-black text-4xl drop-shadow-[0_0_12px_oklch(0.60_0.176_232.6/0.6)] mb-2">K</div>
        <h2 className="text-base font-semibold text-base-content/80">KALIO</h2>
        <p className="text-base-content/45 text-xs mt-1 leading-relaxed max-w-60">
          AI assistant — build apps, query data, generate images, run tools
        </p>
      </div>
      {activeSessionId && personas.length > 1 && (
        <div className="w-full max-w-xs">
          <label className="text-[10px] uppercase tracking-wider text-base-content/35 mb-1 block pl-1">
            Persona
          </label>
          <select
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
      {activeSessionId && (
        <div className="flex flex-wrap justify-center gap-2 mt-1">
          {WELCOME_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="btn btn-sm btn-ghost border border-base-300/70 text-xs text-base-content/70 hover:text-primary hover:border-primary/40"
              onClick={() => onSend(prompt, activeSession?.personaId ?? 'default')}
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
import { Check, Copy } from 'lucide-react';
import type { ChatMessage, ChatSession, LLMContextPreview, Persona } from '@kalio/types';
import type { TokenCount } from '../../services/tokenCounter';
import { ConversationFilesBar } from '../vfs/ConversationFilesBar';
import { ContextStats, type ContextPreviewStatus } from './ContextStats';
import { TokenBadge } from './TokenBadge';
import type { ArchitectSchema } from '../architect/architect.types';
import { NewChatScreen } from './launch/NewChatScreen';
import { findArchitectureRunInMessages } from './architectureChatSummary';

export type ChatConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

const VFS_REFRESH_TOOL_NAMES = new Set(['vfs_write', 'image_generate', 'image_edit']);
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

function architectureSessionLabel(session: ChatSession): string | null {
  const architectureContext = session.runtimeContext?.architectureContext;
  if (!architectureContext || typeof architectureContext !== 'object') {
    return null;
  }
  const displayLabel = architectureContext['displayLabel'];
  if (typeof displayLabel === 'string' && displayLabel.trim().length > 0) {
    return displayLabel.trim();
  }
  const schemaName = architectureContext['schemaName'];
  return typeof schemaName === 'string' && schemaName.trim().length > 0 ? schemaName.trim() : null;
}

function humanizeArchitectureSchemaId(schemaId: string): string {
  return schemaId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function architectureMessageLabel(messages: ChatMessage[]): string | null {
  const summary = findArchitectureRunInMessages(messages);
  if (!summary) {
    return null;
  }

  for (const message of [...messages].reverse()) {
    if (message.role !== 'assistant' || !message.toolCalls?.length) {
      continue;
    }

    const matchingCall = message.toolCalls.find((toolCall) => (
      toolCall.name === 'run_subagent'
      && toolCall.args['architectureRunId'] === summary.runId
      && typeof toolCall.args['schemaName'] === 'string'
      && toolCall.args['schemaName'].trim().length > 0
    ));

    if (matchingCall && typeof matchingCall.args['schemaName'] === 'string') {
      return matchingCall.args['schemaName'].trim();
    }
  }

  return summary.schemaId.trim().length > 0
    ? humanizeArchitectureSchemaId(summary.schemaId)
    : null;
}

function resolveArchitectureLabel(session: ChatSession, messages: ChatMessage[]): string | null {
  return architectureSessionLabel(session) ?? architectureMessageLabel(messages);
}

function isChildSessionWithoutMessages(
  session: ChatSession | null,
): session is ChatSession & { parentSessionId: string } {
  return typeof session?.parentSessionId === 'string' && session.parentSessionId.length > 0;
}

function PendingChildSessionScreen({ activeSession }: { activeSession: ChatSession }) {
  const architectureLabel = architectureSessionLabel(activeSession);
  const waitingLabel = architectureLabel ? `${architectureLabel} branch` : 'Sub-conversation';

  return (
    <div
      className="flex min-h-[18rem] items-center justify-center px-6 py-10 text-center"
      data-testid="pending-child-session-screen"
    >
      <div className="max-w-xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-base-content/45">
          {waitingLabel}
        </p>
        <h2 className="mt-2 text-lg font-semibold text-base-content">
          Waiting for the first persisted message
        </h2>
        <p className="mt-3 text-sm leading-6 text-base-content/65">
          This child session already exists, but the agent has not written visible chat output yet.
          Use the host workflow timeline to track live router and branch progress.
        </p>
      </div>
    </div>
  );
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
  contextPreview: LLMContextPreview | null;
  contextPreviewStatus: ContextPreviewStatus;
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
  contextPreview,
  contextPreviewStatus,
  vfsRefreshSignal,
}: ChatSessionHeaderProps) {
  const architectureLabel = resolveArchitectureLabel(activeSession, messages);

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-base-300 shrink-0">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium" data-testid="chat-session-title">{activeSession.title}</span>
        {architectureLabel && (
          <span
            className="shrink-0 rounded border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-200"
            data-testid="chat-session-architecture-label"
          >
            {architectureLabel}
          </span>
        )}
      </div>
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
            contextPreview={contextPreview}
            contextPreviewStatus={contextPreviewStatus}
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
  onDraftChange: (content: string) => void;
  onPersonaChange: (personaId: string) => void;
  onProjectPathChange: (projectPath: string) => void;
  onSend: (content: string, personaId: string) => void;
  personas: Persona[];
  projectPath: string;
  selectedPersonaId: string;
  selectedArchitectureId: string;
}

export function ChatWelcomeScreen({
  activeSession,
  activeSessionId,
  architectures,
  isStreaming,
  onArchitectureChange,
  onArchitectureRun,
  onDraftChange,
  onPersonaChange,
  onProjectPathChange,
  onSend,
  personas,
  projectPath,
  selectedPersonaId,
  selectedArchitectureId,
}: ChatWelcomeScreenProps) {
  if (activeSession && isChildSessionWithoutMessages(activeSession)) {
    return <PendingChildSessionScreen activeSession={activeSession} />;
  }

  return (
    <>
      {activeSessionId && (
        <NewChatScreen
          key={activeSessionId}
          architectures={architectures}
          heading={activeSession?.title ?? 'New Chat'}
          isBusy={isStreaming}
          onArchitectureChange={onArchitectureChange}
          onDraftChange={onDraftChange}
          onPersonaChange={onPersonaChange}
          onProjectPathChange={onProjectPathChange}
          onRunPrompt={(content) => {
            onDraftChange('');
            if (selectedArchitectureId === 'single-chat') {
              onSend(content, selectedPersonaId);
              return;
            }
            onArchitectureRun(content, selectedArchitectureId);
          }}
          personas={personas}
          projectPath={projectPath}
          selectedPersonaId={selectedPersonaId}
          selectedArchitectureId={selectedArchitectureId}
          subtitle="AI assistant - build apps, query data, generate images, run tools"
          testIdPrefix="welcome"
        />
      )}
    </>
  );
}

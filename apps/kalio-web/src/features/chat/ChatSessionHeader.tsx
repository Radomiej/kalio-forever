import { Check, Copy } from 'lucide-react';
import type { ChatMessage, ChatSession, LLMContextPreview, Project } from '@kalio/types';
import type { TokenCount } from '../../services/tokenCounter';
import { ConversationFilesBar } from '../vfs/ConversationFilesBar';
import { ContextStats, type ContextPreviewStatus } from './ContextStats';
import { TokenBadge } from './TokenBadge';
import { isPendingHostSession } from './pendingHostSession';
import type { TalkView } from '../../App.types';
import { ProjectPicker } from '../projects/ProjectPicker';
import { TalkViewSwitcher } from './TalkViewSwitcher';
import { resolveArchitectureLabel } from './chatSessionLabels';

interface ChatSessionHeaderProps {
  activeContext: { systemPrompt: string | null; activeToolNames: string[] };
  activeModel: string | null;
  activeProvider?: string | null;
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
  talkView?: TalkView;
  onTalkViewChange?: (view: TalkView) => void;
  projectId?: string;
  onProjectChange?: (project: Project) => void;
  projectPickerDisabled?: boolean;
}

export function ChatSessionHeader({
  activeContext,
  activeModel,
  activeProvider = null,
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
  talkView,
  onTalkViewChange,
  projectId,
  onProjectChange,
  projectPickerDisabled = false,
}: ChatSessionHeaderProps) {
  talkView ??= 'conversation';
  onTalkViewChange ??= () => undefined;
  const architectureLabel = resolveArchitectureLabel(activeSession, messages);
  const pendingHostSession = isPendingHostSession(activeSession);
  const runtimeLabel = [activeProvider, activeModel].filter(Boolean).join(' · ');

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
      <TalkViewSwitcher value={talkView} onChange={onTalkViewChange} />
      {projectId && onProjectChange && (
        <div className="hidden w-44 shrink-0 sm:block">
          <ProjectPicker value={projectId} onChange={onProjectChange} disabled={projectPickerDisabled || pendingHostSession} testId="chat-project-picker" label="" />
        </div>
      )}
      {!pendingHostSession && <ConversationFilesBar sessionId={activeSessionId} refreshSignal={vfsRefreshSignal} />}
      {messages.length > 0 && (
        <button
          className="btn btn-ghost btn-xs text-base-content/40 hover:text-base-content/70"
          onClick={onCopyChat}
          title="Copy chat to clipboard"
          aria-label="Copy chat to clipboard"
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
      {runtimeLabel && (
        <span
          className="max-w-[14rem] shrink-0 truncate rounded-md border border-base-300/70 bg-base-200/50 px-2 py-1 text-[10px] font-medium text-base-content/65"
          title={runtimeLabel}
          data-testid="chat-runtime-label"
        >
          {runtimeLabel}
        </span>
      )}
    </div>
  );
}

import type { ChatMessage, ChatSession, Persona, Project } from '@kalio/types';
import { useAgentStore } from '../../store/agentStore';
import { useSessionStore } from '../../store/sessionStore';
import { mergeRuntimeSessionStatusSnapshots } from '../../store/agentRuntimeSelectors';
import type { ArchitectSchema } from '../architect/architect.types';
import { NewChatScreen } from './launch/NewChatScreen';
import { isPendingHostSession } from './pendingHostSession';
import { compactArchitectureTraceContent, findArchitectureRunInMessages } from './architectureChatSummary';
import { architectureSessionLabel } from './chatSessionLabels';
import { architectureSlotIdForSession, sessionStatusSnapshotToRuntimeState } from '../sessions/sessionTreeDisplay';
import type { LiveTurnState } from './liveTurnState';
export { ChatSessionHeader } from './ChatSessionHeader';

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

function isChildSessionWithoutMessages(
  session: ChatSession | null,
): session is ChatSession & { parentSessionId: string } {
  return typeof session?.parentSessionId === 'string' && session.parentSessionId.length > 0;
}

function runtimePhaseLabel(activeSession: ChatSession): string {
  const mergedSnapshots = mergeRuntimeSessionStatusSnapshots(
    useAgentStore.getState().sessionStatusSnapshots,
    useAgentStore.getState().runtimeActivitySnapshots,
  );
  const snapshot = mergedSnapshots[activeSession.id];
  const runtimeState = sessionStatusSnapshotToRuntimeState(snapshot);
  if (runtimeState === 'waiting') return 'Waiting';
  if (runtimeState === 'running') return 'Running';
  if (runtimeState === 'pending') return 'Pending';
  const phase = snapshot?.run?.phase;
  if (phase === 'tool_pending') return 'Waiting';
  if (phase === 'tool_running' || phase === 'llm_streaming' || phase === 'started') return 'Running';
  return 'Pending';
}

function childSessionTraceSummary(activeSession: ChatSession): { action: string; detail?: string } | null {
  const hostSessionId = typeof activeSession.runtimeContext?.architectureContext?.['hostSessionId'] === 'string'
    ? activeSession.runtimeContext.architectureContext['hostSessionId']
    : activeSession.parentSessionId;
  if (!hostSessionId) {
    return null;
  }
  const hostMessages = useSessionStore.getState().sessionMessages[hostSessionId] ?? [];
  const summary = findArchitectureRunInMessages(hostMessages);
  if (!summary) {
    return null;
  }
  const slotId = architectureSlotIdForSession(activeSession);
  const step = [...summary.trace].reverse().find((candidate) => (
    candidate.sessionId === activeSession.id
    || (slotId !== undefined && candidate.nodeId === slotId)
  ));
  if (!step) {
    return null;
  }
  const action = step.actionSummary?.trim()
    || compactArchitectureTraceContent(step.content, step.speaker).trim()
    || 'Workflow activity recorded.';
  const detail = step.detail?.trim()
    || step.nextNodeId
    || undefined;
  return { action, detail };
}

function PendingChildSessionScreen({ activeSession }: { activeSession: ChatSession }) {
  const architectureLabel = architectureSessionLabel(activeSession);
  const waitingLabel = architectureLabel ? `${architectureLabel} branch` : 'Sub-conversation';
  const phaseLabel = runtimePhaseLabel(activeSession);
  const traceSummary = childSessionTraceSummary(activeSession);

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
          {phaseLabel} before the first persisted message
        </h2>
        <p className="mt-3 text-sm leading-6 text-base-content/65">
          This child session already exists, but the agent has not written visible chat output yet.
        </p>
        <div className="mt-4 rounded-xl border border-base-300 bg-base-200/40 px-4 py-3 text-left">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-base-content/45">
            Current activity
          </p>
          <p className="mt-2 text-sm font-medium text-base-content">
            {traceSummary?.action ?? 'Waiting for live workflow activity.'}
          </p>
          {traceSummary?.detail && (
            <p className="mt-1 text-xs leading-5 text-base-content/55">
              {traceSummary.detail}
            </p>
          )}
        </div>
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
  onProjectChange?: (project: Project) => void;
  onSend: (content: string, personaId: string) => void;
  personas: Persona[];
  projectPath: string;
  projectId?: string;
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
  onProjectChange,
  onSend,
  personas,
  projectPath,
  projectId,
  selectedPersonaId,
  selectedArchitectureId,
}: ChatWelcomeScreenProps) {
  if (activeSession && isChildSessionWithoutMessages(activeSession)) {
    return <PendingChildSessionScreen activeSession={activeSession} />;
  }

  const launchBusy = isStreaming || isPendingHostSession(activeSession);

  return (
    <NewChatScreen
      key={activeSessionId ?? 'new-chat'}
      architectures={architectures}
      heading={activeSession?.title ?? 'New Chat'}
      isBusy={launchBusy}
      onArchitectureChange={onArchitectureChange}
      onDraftChange={onDraftChange}
      onPersonaChange={onPersonaChange}
      onProjectPathChange={onProjectPathChange}
      onProjectChange={onProjectChange}
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
      projectId={projectId}
      selectedPersonaId={selectedPersonaId}
      selectedArchitectureId={selectedArchitectureId}
      subtitle="AI assistant - build apps, query data, generate images, run tools"
      testIdPrefix="welcome"
    />
  );
}

interface PendingAssistantBubbleProps {
  liveTurnState: LiveTurnState;
}

function liveTurnStatusLabel(liveTurnState: LiveTurnState): string {
  switch (liveTurnState.phase) {
    case 'thinking':
      return 'thinking';
    case 'streaming_text':
      return 'responding';
    case 'running_tool':
      return liveTurnState.toolName ? `${liveTurnState.toolName} running` : 'tool running';
    case 'queued_followup':
      return liveTurnState.queuedDepth > 0 ? `queued ${liveTurnState.queuedDepth}` : 'queued';
    case 'pending':
    default:
      return 'pending';
  }
}

function liveTurnBody(liveTurnState: LiveTurnState): string {
  if (liveTurnState.previewText?.trim()) {
    return liveTurnState.previewText.trim();
  }

  if (liveTurnState.workflowActive) {
    return 'Kalio is coordinating the workflow.';
  }

  switch (liveTurnState.phase) {
    case 'thinking':
      return 'Kalio is thinking before the first visible answer.';
    case 'running_tool':
      return liveTurnState.toolName
        ? `Kalio is using ${liveTurnState.toolName}.`
        : 'Kalio is running a tool.';
    case 'queued_followup':
      return 'Kalio is finishing the current turn before processing the queued follow-up.';
    case 'streaming_text':
      return 'Kalio is streaming a partial answer.';
    case 'pending':
    default:
      return 'Kalio is responding.';
  }
}

export function PendingAssistantBubble({ liveTurnState }: PendingAssistantBubbleProps) {
  return (
    <div className="flex justify-start" data-testid="pending-agent-bubble">
      <div className="max-w-[min(42rem,92%)] rounded-2xl border border-sky-500/20 bg-base-300/85 px-4 py-3 text-sm text-base-content shadow-sm">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-sky-300/90">
          <span className="loading loading-dots loading-xs" />
          <span data-testid="pending-agent-phase">{liveTurnStatusLabel(liveTurnState)}</span>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-base-content/80">
          {liveTurnBody(liveTurnState)}
        </p>
      </div>
    </div>
  );
}

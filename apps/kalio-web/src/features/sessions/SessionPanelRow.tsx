import type { Dispatch, MouseEvent, ReactNode, RefObject, SetStateAction } from 'react';
import { AlertTriangle, Archive, BrainCircuit, Check, CheckCircle2, ChevronRight, GitBranch, Loader2, MessageSquare, Pencil, RotateCcw, TerminalSquare, Trash2, X, XCircle } from 'lucide-react';
import type { ChatSession } from '@kalio/types';
import { formatRelativeTime } from './session.utils';
import { displayTitleForSession } from './sessionTreeDisplay';
import type { SessionOriginFilter } from './sessionListModel';
import type { AgentTurn } from '../../store/sessionStore';

const formatChildCount = (count: number): string => count > 99 ? '99+' : String(count);

function sessionKindPresentation(session: ChatSession) {
  if (session.kind === 'subagent') {
    return {
      icon: BrainCircuit,
      iconClassName: 'text-sky-300 bg-sky-500/10 border-sky-500/20',
      label: 'Sub-agent',
      badgeClassName: 'text-sky-300 bg-sky-500/10 border border-sky-500/20',
      testId: `subagent-session-badge-${session.id}`,
    };
  }
  if (session.kind === 'cli-agent') {
    return {
      icon: TerminalSquare,
      iconClassName: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
      label: 'CLI agent',
      badgeClassName: 'text-amber-300 bg-amber-500/10 border border-amber-500/20',
      testId: `cli-agent-session-badge-${session.id}`,
    };
  }
  if (session.kind === 'agent-flow') {
    return {
      icon: GitBranch,
      iconClassName: 'text-violet-300 bg-violet-500/10 border-violet-500/20',
      label: 'AgentFlow',
      badgeClassName: 'text-violet-300 bg-violet-500/10 border border-violet-500/20',
      testId: `agent-flow-session-badge-${session.id}`,
    };
  }
  return {
    icon: MessageSquare,
    iconClassName: 'text-base-content/55 bg-base-300/35 border-base-300/50',
    label: 'Root chat',
    badgeClassName: '',
    testId: `root-chat-session-badge-${session.id}`,
  };
}

function architectureBadgeLabel(session: ChatSession): string | null {
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

type ChildToggle = {
  count: number;
  expanded: boolean;
};

type SessionPanelSessionItemProps = {
  session: ChatSession;
  depth: number;
  activeSessionId: string | null;
  originFilter: SessionOriginFilter;
  childSessionsByParent: Map<string, ChatSession[]>;
  pendingConfirmations: Record<string, unknown>;
  pendingBudgetApprovals: Record<string, unknown>;
  activeLoopSessionIds: Set<string>;
  queuedDepthBySession: Record<string, number>;
  sessionAgentTurns: Record<string, AgentTurn[]>;
  renamingId: string | null;
  renameValue: string;
  renameRef: RefObject<HTMLInputElement | null>;
  personaName: string | null;
  compactChild?: boolean;
  childToggle?: ChildToggle;
  onSelectSession: (id: string) => void;
  onStartRename: (event: MouseEvent, session: ChatSession) => void;
  onCommitRename: (id: string) => void;
  onCancelRename: () => void;
  onRenameValueChange: Dispatch<SetStateAction<string>>;
  onDeleteSession: (event: MouseEvent, id: string) => void;
  onArchiveSession: (event: MouseEvent, id: string) => void;
  onRestoreSession: (event: MouseEvent, session: ChatSession) => void;
  onToggleRootExpansion: (event: MouseEvent, id: string) => void;
};

type SessionRuntimeState = 'waiting' | 'running' | 'error' | 'done';

function sessionRuntimeState(
  sessionId: string,
  pendingConfirmations: Record<string, unknown>,
  pendingBudgetApprovals: Record<string, unknown>,
  activeLoopSessionIds: Set<string>,
  queuedDepthBySession: Record<string, number>,
  sessionAgentTurns: Record<string, AgentTurn[]>,
): SessionRuntimeState | null {
  const safePendingConfirmations = pendingConfirmations ?? {};
  const safePendingBudgetApprovals = pendingBudgetApprovals ?? {};
  const safeActiveLoopSessionIds = activeLoopSessionIds ?? new Set<string>();
  const safeQueuedDepthBySession = queuedDepthBySession ?? {};
  const safeSessionAgentTurns = sessionAgentTurns ?? {};
  if (safePendingConfirmations[sessionId] || safePendingBudgetApprovals[sessionId]) {
    return 'waiting';
  }
  if (safeActiveLoopSessionIds.has(sessionId) || (safeQueuedDepthBySession[sessionId] ?? 0) > 0) {
    return 'running';
  }
  const lastTurn = safeSessionAgentTurns[sessionId]?.at(-1);
  if (lastTurn?.error) {
    return 'error';
  }
  if (lastTurn?.done) {
    return 'done';
  }
  return null;
}

function countDescendantRuntimeStates(
  sessionId: string,
  childSessionsByParent: Map<string, ChatSession[]>,
  pendingConfirmations: Record<string, unknown>,
  pendingBudgetApprovals: Record<string, unknown>,
  activeLoopSessionIds: Set<string>,
  queuedDepthBySession: Record<string, number>,
  sessionAgentTurns: Record<string, AgentTurn[]>,
): { running: number; waiting: number } {
  const safeChildSessionsByParent = childSessionsByParent ?? new Map<string, ChatSession[]>();
  const counts = { running: 0, waiting: 0 };
  const pending = [...(safeChildSessionsByParent.get(sessionId) ?? [])];

  while (pending.length > 0) {
    const child = pending.shift();
    if (!child) break;
    const state = sessionRuntimeState(
      child.id,
      pendingConfirmations,
      pendingBudgetApprovals,
      activeLoopSessionIds,
      queuedDepthBySession,
      sessionAgentTurns,
    );
    if (state === 'waiting') {
      counts.waiting += 1;
    } else if (state === 'running') {
      counts.running += 1;
    }
    pending.push(...(safeChildSessionsByParent.get(child.id) ?? []));
  }

  return counts;
}

export function SessionPanelSessionItem({
  session,
  depth,
  activeSessionId,
  originFilter,
  childSessionsByParent,
  pendingConfirmations,
  pendingBudgetApprovals,
  activeLoopSessionIds,
  queuedDepthBySession,
  sessionAgentTurns,
  renamingId,
  renameValue,
  renameRef,
  personaName,
  compactChild,
  childToggle,
  onSelectSession,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onRenameValueChange,
  onDeleteSession,
  onArchiveSession,
  onRestoreSession,
  onToggleRootExpansion,
}: SessionPanelSessionItemProps) {
  const isChildSession = Boolean(session.parentSessionId);
  const treeDepth = Math.min(depth, 4);
  const displayTitle = displayTitleForSession(session, childSessionsByParent);
  const sessionKind = sessionKindPresentation(session);
  const SessionKindIcon = sessionKind.icon;
  const architectureLabel = architectureBadgeLabel(session);
  const runtimeState = sessionRuntimeState(
    session.id,
    pendingConfirmations,
    pendingBudgetApprovals,
    activeLoopSessionIds,
    queuedDepthBySession,
    sessionAgentTurns,
  );
  const descendantStates = countDescendantRuntimeStates(
    session.id,
    childSessionsByParent,
    pendingConfirmations,
    pendingBudgetApprovals,
    activeLoopSessionIds,
    queuedDepthBySession,
    sessionAgentTurns,
  );
  const activeDescendantLabel = descendantStates.waiting > 0
    ? `${descendantStates.waiting} waiting`
    : descendantStates.running > 0
      ? `${descendantStates.running} active`
      : null;

  return (
    <div
      key={session.id}
      className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer border-b border-base-300/40 last:border-0 hover:bg-base-200/50 transition-colors ${isChildSession ? 'border-l border-l-sky-500/20' : ''} ${
        activeSessionId === session.id ? 'bg-sky-500/10 border-l-2 border-l-sky-500' : ''
      }`}
      style={{ paddingLeft: (originFilter === 'agent' || compactChild) ? `${12 + treeDepth * 14}px` : undefined }}
      onClick={() => void onSelectSession(session.id)}
      data-testid="session-item"
      data-session-id={session.id}
    >
      {(originFilter === 'agent' || compactChild) && isChildSession && (
        <span className="mt-1.5 h-3 w-3 shrink-0 rounded-bl-md border-b border-l border-sky-500/30" aria-hidden="true" />
      )}
      {renamingId === session.id ? (
        <form
          className="flex flex-1 items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            void onCommitRename(session.id);
          }}
        >
          <input
            ref={renameRef}
            className="input input-bordered input-xs flex-1 min-w-0"
            value={renameValue}
            onChange={(event) => onRenameValueChange(event.target.value)}
            onClick={(event) => event.stopPropagation()}
          />
          <button type="submit" className="btn btn-ghost btn-xs p-0 w-5 h-5" onClick={(event) => event.stopPropagation()}>
            <Check size={10} className="text-success" />
          </button>
          <button type="button" className="btn btn-ghost btn-xs p-0 w-5 h-5" onClick={(event) => { event.stopPropagation(); onCancelRename(); }}>
            <X size={10} />
          </button>
        </form>
      ) : (
        <div className="flex flex-1 min-w-0 items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border ${sessionKind.iconClassName}`}
                data-testid={`session-kind-icon-${session.id}`}
                title={sessionKind.label}
                aria-label={sessionKind.label}
              >
                <SessionKindIcon size={11} />
              </span>
              <span
                className="min-w-0 flex-1 break-words text-xs font-medium leading-snug"
                data-testid={`session-title-${session.id}`}
              >
                {displayTitle}
              </span>
              {runtimeState === 'waiting' && (
                <AlertTriangle
                  size={10}
                  className="text-warning shrink-0"
                  aria-label="Awaiting confirmation"
                  data-testid={`session-pending-confirmation-${session.id}`}
                />
              )}
              {runtimeState === 'running' && (
                <Loader2
                  size={10}
                  className="shrink-0 animate-spin text-sky-300"
                  aria-label="Session running"
                  data-testid={`session-running-${session.id}`}
                />
              )}
              {runtimeState === 'done' && (
                <CheckCircle2
                  size={10}
                  className="shrink-0 text-emerald-300"
                  aria-label="Session completed"
                  data-testid={`session-done-${session.id}`}
                />
              )}
              {runtimeState === 'error' && (
                <XCircle
                  size={10}
                  className="shrink-0 text-rose-300"
                  aria-label="Session failed"
                  data-testid={`session-error-${session.id}`}
                />
              )}
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              {session.kind !== 'chat' && (
                <span
                  className={`text-[9px] rounded px-1 py-0.5 leading-none shrink-0 ${sessionKind.badgeClassName}`}
                  data-testid={sessionKind.testId}
                >
                  {sessionKind.label}
                </span>
              )}
              {personaName && (
                <span className="text-[10px] text-base-content/65 bg-base-300/50 rounded px-1 py-0.5 leading-none truncate max-w-[7rem]">
                  {personaName}
                </span>
              )}
              {architectureLabel && (
                <span
                  className="text-[9px] rounded border border-sky-500/20 bg-sky-500/10 px-1 py-0.5 leading-none text-sky-200 truncate max-w-[8rem]"
                  data-testid={`session-architecture-label-${session.id}`}
                >
                  {architectureLabel}
                </span>
              )}
              {activeDescendantLabel && (
                <span
                  className={`text-[9px] rounded border px-1 py-0.5 leading-none truncate max-w-[7rem] ${
                    descendantStates.waiting > 0
                      ? 'border-warning/30 bg-warning/10 text-warning'
                      : 'border-sky-500/20 bg-sky-500/10 text-sky-200'
                  }`}
                  data-testid={`session-descendant-activity-${session.id}`}
                >
                  {activeDescendantLabel}
                </span>
              )}
              <span className="text-[10px] text-base-content/60 leading-none ml-auto shrink-0">
                {formatRelativeTime(session.updatedAt)}
              </span>
            </div>
          </div>
          <div className="flex min-w-0 shrink-0 items-start justify-end gap-1 pt-0.5">
            <button
              className="btn btn-ghost btn-xs p-0 w-7 h-7 shrink-0 opacity-0 group-hover:opacity-100 text-base-content/40 hover:text-sky-400"
              onClick={(event) => onStartRename(event, session)}
              title="Rename"
              aria-label={`Rename session ${displayTitle}`}
            >
              <Pencil size={12} />
            </button>
            {originFilter === 'agent' && (
              <button
                className="btn btn-ghost btn-xs p-0 w-7 h-7 shrink-0 opacity-0 group-hover:opacity-100 text-base-content/40 hover:text-warning"
                onClick={(event) => void onArchiveSession(event, session.id)}
                title="Archive"
                aria-label={`Archive session ${displayTitle}`}
                data-testid={`archive-session-${session.id}`}
              >
                <Archive size={12} />
              </button>
            )}
            {originFilter === 'archived' && (
              <button
                className="btn btn-ghost btn-xs p-0 w-7 h-7 shrink-0 opacity-0 group-hover:opacity-100 text-base-content/40 hover:text-success"
                onClick={(event) => void onRestoreSession(event, session)}
                title="Restore"
                aria-label={`Restore session ${displayTitle}`}
                data-testid={`restore-session-${session.id}`}
              >
                <RotateCcw size={12} />
              </button>
            )}
            <button
              className="btn btn-ghost btn-xs p-0 w-7 h-7 shrink-0 opacity-0 group-hover:opacity-100 text-base-content/40 hover:text-error"
              onClick={(event) => void onDeleteSession(event, session.id)}
              title="Delete"
              aria-label={`Delete session ${displayTitle}`}
            >
              <Trash2 size={12} />
            </button>
            {childToggle && (
              <button
                type="button"
                className="grid h-6 min-w-7 shrink-0 place-items-center rounded border border-sky-500/20 bg-sky-500/10 px-1 text-[10px] font-mono text-sky-300 hover:bg-sky-500/15"
                aria-label={`${childToggle.expanded ? 'Collapse' : 'Expand'} child conversations for ${displayTitle}`}
                data-testid={`toggle-session-children-${session.id}`}
                onClick={(event) => onToggleRootExpansion(event, session.id)}
                title={`${childToggle.count} child conversation${childToggle.count === 1 ? '' : 's'}`}
              >
                <span className="flex min-w-0 items-center gap-0.5">
                  <ChevronRight size={10} className={`transition-transform ${childToggle.expanded ? 'rotate-90' : ''}`} />
                  <span className="min-w-[1rem] text-center leading-none">{formatChildCount(childToggle.count)}</span>
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type RenderSessionChildRowsArgs = Omit<SessionPanelSessionItemProps, 'session' | 'depth' | 'personaName' | 'compactChild' | 'childToggle'> & {
  parentId: string;
  depth: number;
  getPersonaName: (personaId: string) => string | null;
};

export function renderSessionChildRows({
  parentId,
  depth,
  childSessionsByParent,
  getPersonaName,
  ...itemProps
}: RenderSessionChildRowsArgs): ReactNode[] {
  return (childSessionsByParent.get(parentId) ?? []).flatMap((child) => [
    <SessionPanelSessionItem
      key={child.id}
      {...itemProps}
      session={child}
      depth={depth}
      childSessionsByParent={childSessionsByParent}
      personaName={getPersonaName(child.personaId)}
      compactChild
    />,
    ...renderSessionChildRows({
      ...itemProps,
      parentId: child.id,
      depth: depth + 1,
      childSessionsByParent,
      getPersonaName,
    }),
  ]);
}

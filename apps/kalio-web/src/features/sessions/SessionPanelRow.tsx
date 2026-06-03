import type { Dispatch, MouseEvent, ReactNode, RefObject, SetStateAction } from 'react';
import { AlertTriangle, Archive, Check, ChevronRight, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import type { ChatSession } from '@kalio/types';
import { formatRelativeTime } from './session.utils';
import { displayTitleForSession } from './sessionTreeDisplay';
import type { SessionOriginFilter } from './sessionListModel';

const formatChildCount = (count: number): string => count > 99 ? '99+' : String(count);

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

export function SessionPanelSessionItem({
  session,
  depth,
  activeSessionId,
  originFilter,
  childSessionsByParent,
  pendingConfirmations,
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
  const sessionKindBadge = session.kind === 'subagent'
    ? {
        label: 'Sub-agent',
        className: 'text-sky-300 bg-sky-500/10 border border-sky-500/20',
        testId: `subagent-session-badge-${session.id}`,
      }
    : session.kind === 'cli-agent'
      ? {
          label: 'CLI agent',
          className: 'text-amber-300 bg-amber-500/10 border border-amber-500/20',
          testId: `cli-agent-session-badge-${session.id}`,
        }
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
              <span className="min-w-0 flex-1 break-words text-xs font-medium leading-snug">
                {displayTitle}
              </span>
              {Boolean(pendingConfirmations[session.id]) && (
                <AlertTriangle
                  size={10}
                  className="text-warning shrink-0"
                  aria-label="Awaiting confirmation"
                  data-testid={`session-pending-confirmation-${session.id}`}
                />
              )}
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              {sessionKindBadge && (
                <span
                  className={`text-[9px] rounded px-1 py-0.5 leading-none shrink-0 ${sessionKindBadge.className}`}
                  data-testid={sessionKindBadge.testId}
                >
                  {sessionKindBadge.label}
                </span>
              )}
              {personaName && (
                <span className="text-[10px] text-base-content/65 bg-base-300/50 rounded px-1 py-0.5 leading-none truncate max-w-[7rem]">
                  {personaName}
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

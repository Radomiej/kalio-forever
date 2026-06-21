import { useDeferredValue, useMemo, type ComponentProps, type ReactNode } from 'react';
import type { ChatSession } from '@kalio/types';
import type { ConversationTreeModel } from './conversationTreeModel';
import type { SessionOriginFilter } from './sessionListModel';
import {
  countVisibleConversationTreeDescendants,
  displayTitleForSession,
  hasExpandedAncestor,
} from './sessionTreeDisplay';
import { renderSessionChildRows, SessionPanelSessionItem } from './SessionPanelRow';

type SessionListEntry = ConversationTreeModel['sessionListEntries'][number];
type SessionPanelItemProps = Omit<
  ComponentProps<typeof SessionPanelSessionItem>,
  'session' | 'depth' | 'personaName' | 'childToggle'
>;

interface SessionPanelListProps {
  activeSessionId: string | null;
  childSessionsByParent: ConversationTreeModel['childSessionsByParent'];
  descendantCountByParent: ConversationTreeModel['descendantCountByParent'];
  emptyState: ReactNode;
  expandedRoots: Set<string>;
  getPersonaName: (personaId: string) => string | null;
  itemProps: SessionPanelItemProps;
  loading: boolean;
  originFilter: SessionOriginFilter;
  sessionById: ConversationTreeModel['sessionById'];
  sessionListEntries: ConversationTreeModel['sessionListEntries'];
  visibleSessionsCount: number;
}

export function SessionPanelList({
  activeSessionId,
  childSessionsByParent,
  descendantCountByParent,
  emptyState,
  expandedRoots,
  getPersonaName,
  itemProps,
  loading,
  originFilter,
  sessionById,
  sessionListEntries,
  visibleSessionsCount,
}: SessionPanelListProps) {
  const deferredEntries = useDeferredValue(sessionListEntries);
  const entries = useMemo(
    () => deferredEntries.filter((entry) => !isEntryHidden(entry, originFilter, sessionById, expandedRoots)),
    [deferredEntries, expandedRoots, originFilter, sessionById],
  );

  return (
    <div className="flex-1 overflow-y-auto" data-testid="session-panel-list">
      {visibleSessionsCount === 0 && !loading ? emptyState : null}
      {entries.map((entry) => renderEntry({
        entry,
        activeSessionId,
        childSessionsByParent,
        descendantCountByParent,
        expandedRoots,
        getPersonaName,
        itemProps,
        originFilter,
      }))}
    </div>
  );
}

function isEntryHidden(
  entry: SessionListEntry,
  originFilter: SessionOriginFilter,
  sessionById: ConversationTreeModel['sessionById'],
  expandedRoots: Set<string>,
): boolean {
  const session = entry.session;
  return Boolean(
    entry.type !== 'root'
    && (originFilter === 'all' || originFilter === 'user')
    && session.parentSessionId
    && hasExpandedAncestor(session, sessionById, expandedRoots),
  );
}

function renderEntry({
  entry,
  activeSessionId,
  childSessionsByParent,
  descendantCountByParent,
  expandedRoots,
  getPersonaName,
  itemProps,
  originFilter,
  stickyRoots = true,
}: {
  entry: SessionListEntry;
  activeSessionId: string | null;
  childSessionsByParent: Map<string, ChatSession[]>;
  descendantCountByParent: Map<string, number>;
  expandedRoots: Set<string>;
  getPersonaName: (personaId: string) => string | null;
  itemProps: SessionPanelItemProps;
  originFilter: SessionOriginFilter;
  stickyRoots?: boolean;
}): ReactNode {
  if (entry.type === 'root') {
    const root = entry.session;
    const rootTitle = displayTitleForSession(root, childSessionsByParent);
    return (
      <div
        key={`root-${root.id}`}
        className={`${stickyRoots ? 'sticky top-0 z-10 ' : ''}cursor-pointer border-b border-base-300/60 bg-base-100/95 px-3 py-2 transition-colors hover:bg-base-200/70 ${
          activeSessionId === root.id ? 'border-l-2 border-l-sky-500 bg-sky-500/10' : ''
        }`}
        onClick={() => void itemProps.onSelectSession(root.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void itemProps.onSelectSession(root.id);
          }
        }}
        role="button"
        tabIndex={0}
        data-testid="session-tree-root"
        data-session-id={root.id}
      >
        <p className="break-words text-[10px] font-semibold uppercase tracking-[0.12em] text-base-content/60">
          {rootTitle}
        </p>
        <p className="mt-0.5 text-[10px] text-base-content/60">{entry.childCount} child run{entry.childCount === 1 ? '' : 's'}</p>
      </div>
    );
  }

  const session = entry.session;
  const children = childSessionsByParent.get(session.id) ?? [];
  const expanded = expandedRoots.has(session.id);
  const visibleChildConversationCount = countVisibleConversationTreeDescendants(
    session.id,
    childSessionsByParent,
    descendantCountByParent,
  );

  if (
    (originFilter === 'all' || originFilter === 'user')
    && !session.parentSessionId
    && children.length > 0
    && visibleChildConversationCount > 0
  ) {
    return (
      <div key={session.id}>
        <SessionPanelSessionItem
          {...itemProps}
          session={session}
          depth={entry.depth}
          personaName={getPersonaName(session.personaId)}
          childToggle={{ count: visibleChildConversationCount, expanded }}
        />
        {expanded && renderSessionChildRows({
          ...itemProps,
          parentId: session.id,
          depth: entry.depth + 1,
          getPersonaName,
        })}
      </div>
    );
  }

  return (
    <SessionPanelSessionItem
      key={session.id}
      {...itemProps}
      session={session}
      depth={entry.depth}
      personaName={getPersonaName(session.personaId)}
    />
  );
}

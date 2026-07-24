import { useEffect, useState } from 'react';
import type { ChatSession } from '@kalio/types';
import type { TalkGrouping } from '../../App.types';
import { loadTalkGroupingPreference, persistTalkGroupingPreference } from '../../App.viewState';
import { useProjectStore } from '../../store/projectStore';
import type { SessionOriginFilter } from './sessionListModel';
import { buildProjectSessionGroups, type ProjectSessionGroup } from './projectSessionListModel';

export function useProjectSessionGrouping({
  sessions,
  activeSessionId,
  originFilter,
}: {
  sessions: ChatSession[];
  activeSessionId: string | null;
  originFilter: SessionOriginFilter;
}): {
  projects: ReturnType<typeof useProjectStore.getState>['projects'];
  groupingMode: TalkGrouping;
  setGroupingMode: (value: TalkGrouping) => void;
  projectGroups: ProjectSessionGroup[];
} {
  const projects = useProjectStore((state) => state.projects);
  const loadProjects = useProjectStore((state) => state.loadProjects);
  const [groupingMode, setGroupingMode] = useState<TalkGrouping>(() => loadTalkGroupingPreference());

  useEffect(() => {
    void loadProjects().catch((error: unknown) => console.warn('[SessionPanel] load projects failed', error));
  }, [loadProjects]);

  useEffect(() => {
    persistTalkGroupingPreference(groupingMode);
  }, [groupingMode]);

  return {
    projects,
    groupingMode,
    setGroupingMode,
    projectGroups: buildProjectSessionGroups({
      projects,
      sessions,
      activeSessionId,
      originFilter,
    }),
  };
}

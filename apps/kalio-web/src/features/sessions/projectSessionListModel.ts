import type { ChatSession, Project, ProjectKind } from '@kalio/types';
import {
  buildSessionListEntries,
  type SessionListEntry,
  type SessionOriginFilter,
  sortSessionsForSidebar,
} from './sessionListModel';

const SYSTEM_PROJECT_ORDER: ReadonlyArray<ProjectKind> = ['none', 'external', 'audit', 'other'];

export interface ProjectSessionGroup {
  project: Project;
  entries: SessionListEntry[];
  latestActivityAt: number;
  isExpanded: boolean;
}

export interface BuildProjectSessionGroupsOptions {
  projects: Project[];
  sessions: ChatSession[];
  activeSessionId: string | null;
  originFilter: SessionOriginFilter;
}

export function buildProjectSessionGroups({
  projects,
  sessions,
  activeSessionId,
  originFilter,
}: BuildProjectSessionGroupsOptions): ProjectSessionGroup[] {
  const noProject = projects.find((project) => project.kind === 'none') ?? buildFallbackProject('none');
  const projectList = projects.some((project) => project.id === noProject.id)
    ? projects
    : [noProject, ...projects];
  const projectById = new Map(projectList.map((project) => [project.id, project]));
  const orderedSessions = sortSessionsForSidebar(sessions);
  const entries = buildSessionListEntries(
    orderedSessions,
    activeSessionId,
    originFilter,
    new Map(sessions.map((session) => [session.id, session])),
  );
  const entriesByProjectId = new Map<string, SessionListEntry[]>();
  const activityByProjectId = new Map<string, number>();

  entries.forEach((entry) => {
    const projectId = projectById.has(entry.session.projectId ?? '') ? entry.session.projectId! : noProject.id;
    entriesByProjectId.set(projectId, [...(entriesByProjectId.get(projectId) ?? []), entry]);
    activityByProjectId.set(
      projectId,
      Math.max(activityByProjectId.get(projectId) ?? 0, entry.session.updatedAt),
    );
  });

  const activeProjectId = activeSessionId === null
    ? null
    : (() => {
      const activeSession = sessions.find((session) => session.id === activeSessionId);
      return activeSession && projectById.has(activeSession.projectId ?? '')
        ? activeSession.projectId!
        : noProject.id;
    })();
  const groups = projectList.map((project) => ({
    project,
    entries: entriesByProjectId.get(project.id) ?? [],
    latestActivityAt: activityByProjectId.get(project.id) ?? project.updatedAt,
    isExpanded: activeProjectId === project.id,
  }));

  return groups.sort((left, right) => {
    const leftSystemOrder = left.project.isSystem ? SYSTEM_PROJECT_ORDER.indexOf(left.project.kind) : -1;
    const rightSystemOrder = right.project.isSystem ? SYSTEM_PROJECT_ORDER.indexOf(right.project.kind) : -1;

    if (left.project.isSystem !== right.project.isSystem) return left.project.isSystem ? -1 : 1;
    if (left.project.isSystem && right.project.isSystem && leftSystemOrder !== rightSystemOrder) {
      return leftSystemOrder - rightSystemOrder;
    }
    if (left.latestActivityAt !== right.latestActivityAt) return right.latestActivityAt - left.latestActivityAt;
    return left.project.name.localeCompare(right.project.name);
  });
}

function buildFallbackProject(kind: ProjectKind): Project {
  const names: Record<ProjectKind, string> = {
    workspace: 'Workspace',
    none: 'Bez projektu',
    external: 'Zewnętrzne',
    audit: 'Audyt',
    other: 'Inne',
  };
  return {
    id: `system:${kind}`,
    name: names[kind],
    path: null,
    kind,
    isSystem: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

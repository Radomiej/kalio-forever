import { describe, expect, it } from 'vitest';
import type { ChatSession, Project } from '@kalio/types';
import { buildProjectSessionGroups } from './projectSessionListModel';

function makeSession(overrides: Partial<ChatSession>): ChatSession {
  return {
    id: 'session-1',
    personaId: 'default',
    title: 'Session',
    projectId: 'system:none',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project>): Project {
  return {
    id: 'project-1',
    name: 'Project',
    path: 'C:/Project',
    kind: 'workspace',
    isSystem: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('projectSessionListModel', () => {
  it('puts the no-project bucket first, then fixed categories, then active projects', () => {
    const projects = [
      makeProject({ id: 'project-beta', name: 'Beta', updatedAt: 20 }),
      makeProject({ id: 'project-alpha', name: 'Alpha', updatedAt: 10 }),
      makeProject({ id: 'system:none', name: 'Bez projektu', kind: 'none', path: null, isSystem: true }),
      makeProject({ id: 'system:external', name: 'Zewnętrzne', kind: 'external', path: null, isSystem: true }),
      makeProject({ id: 'system:audit', name: 'Audyt', kind: 'audit', path: null, isSystem: true }),
      makeProject({ id: 'system:other', name: 'Inne', kind: 'other', path: null, isSystem: true }),
    ];
    const sessions = [
      makeSession({ id: 'alpha-session', projectId: 'project-alpha', updatedAt: 10 }),
      makeSession({ id: 'beta-session', projectId: 'project-beta', updatedAt: 30 }),
      makeSession({ id: 'none-session', projectId: 'system:none', updatedAt: 40 }),
      makeSession({ id: 'audit-session', projectId: 'system:audit', updatedAt: 20 }),
    ];

    const groups = buildProjectSessionGroups({ projects, sessions, activeSessionId: null, originFilter: 'all' });

    expect(groups.map((group) => group.project.id)).toEqual([
      'system:none',
      'system:external',
      'system:audit',
      'system:other',
      'project-beta',
      'project-alpha',
    ]);
  });

  it('preserves the existing session tree inside a project group', () => {
    const projects = [makeProject({ id: 'project-1' })];
    const sessions = [
      makeSession({ id: 'root', projectId: 'project-1', updatedAt: 30 }),
      makeSession({ id: 'child', projectId: 'project-1', parentSessionId: 'root', kind: 'subagent', updatedAt: 31 }),
    ];

    const groups = buildProjectSessionGroups({ projects, sessions, activeSessionId: 'child', originFilter: 'all' });

    const projectGroup = groups.find((group) => group.project.id === 'project-1');
    expect(projectGroup?.entries.map((entry) => entry.session.id)).toEqual(['root']);
    expect(projectGroup?.isExpanded).toBe(true);
  });
});

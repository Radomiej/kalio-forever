import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@kalio/types';

const getProjectsMock = vi.hoisted(() => vi.fn());
const createProjectMock = vi.hoisted(() => vi.fn());

vi.mock('../services/apiClient', () => ({
  getProjects: getProjectsMock,
  createProject: createProjectMock,
}));

import { useProjectStore } from './projectStore';

function makeProject(id: string, name = id): Project {
  return { id, name, path: `C:/projects/${id}`, kind: 'workspace', isSystem: false, createdAt: 1, updatedAt: 1 };
}

describe('projectStore', () => {
  beforeEach(() => {
    useProjectStore.setState({ projects: [], isLoading: false, error: null });
    getProjectsMock.mockReset();
    createProjectMock.mockReset();
  });

  it('upserts new and existing projects and clears errors on replacement', () => {
    const first = makeProject('p1');
    useProjectStore.setState({ error: 'stale' });
    useProjectStore.getState().upsertProject(first);
    useProjectStore.getState().upsertProject({ ...first, name: 'Renamed' });

    expect(useProjectStore.getState().projects).toEqual([{ ...first, name: 'Renamed' }]);
    useProjectStore.getState().setProjects([makeProject('p2')]);
    expect(useProjectStore.getState().error).toBeNull();
  });

  it('loads projects once, supports force reload, and updates loading state', async () => {
    const projects = [makeProject('p1')];
    getProjectsMock.mockResolvedValue(projects);

    await expect(useProjectStore.getState().loadProjects()).resolves.toEqual(projects);
    expect(getProjectsMock).toHaveBeenCalledTimes(1);
    await expect(useProjectStore.getState().loadProjects()).resolves.toEqual(projects);
    expect(getProjectsMock).toHaveBeenCalledTimes(1);
    await expect(useProjectStore.getState().loadProjects(true)).resolves.toEqual(projects);
    expect(getProjectsMock).toHaveBeenCalledTimes(2);

    useProjectStore.setState({ isLoading: true });
    await expect(useProjectStore.getState().loadProjects(true)).resolves.toEqual(projects);
    expect(getProjectsMock).toHaveBeenCalledTimes(2);
  });

  it('stores Error messages and rethrows load failures', async () => {
    getProjectsMock.mockRejectedValueOnce(new Error('network down'));
    await expect(useProjectStore.getState().loadProjects()).rejects.toThrow('network down');
    expect(useProjectStore.getState()).toMatchObject({ isLoading: false, error: 'network down' });

    getProjectsMock.mockRejectedValueOnce('bad failure');
    await expect(useProjectStore.getState().loadProjects(true)).rejects.toBe('bad failure');
    expect(useProjectStore.getState().error).toBe('Failed to load projects');
  });

  it('creates a project through the API and adds it to the store', async () => {
    const project = makeProject('p-new');
    createProjectMock.mockResolvedValue(project);

    await expect(useProjectStore.getState().addProject({ name: 'New', path: project.path! })).resolves.toEqual(project);

    expect(createProjectMock).toHaveBeenCalledWith({ name: 'New', path: project.path });
    expect(useProjectStore.getState().projects).toEqual([project]);
  });
});

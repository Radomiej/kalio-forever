import { create } from 'zustand';
import type { CreateProjectDto, Project } from '@kalio/types';
import { createProject, getProjects } from '../services/apiClient';

interface ProjectState {
  projects: Project[];
  isLoading: boolean;
  error: string | null;
  setProjects: (projects: Project[]) => void;
  upsertProject: (project: Project) => void;
  loadProjects: (force?: boolean) => Promise<Project[]>;
  addProject: (dto: CreateProjectDto) => Promise<Project>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  isLoading: false,
  error: null,
  setProjects: (projects) => set({ projects, error: null }),
  upsertProject: (project) => set((state) => ({
    projects: state.projects.some((item) => item.id === project.id)
      ? state.projects.map((item) => item.id === project.id ? project : item)
      : [...state.projects, project],
  })),
  loadProjects: async (force = false) => {
    if (get().isLoading || (!force && get().projects.length > 0)) return get().projects;
    set({ isLoading: true, error: null });
    try {
      const projects = await getProjects();
      set({ projects, isLoading: false });
      return projects;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load projects';
      set({ isLoading: false, error: message });
      throw error;
    }
  },
  addProject: async (dto) => {
    const project = await createProject(dto);
    get().upsertProject(project);
    return project;
  },
}));

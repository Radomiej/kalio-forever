import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project } from '@kalio/types';

const { projectState } = vi.hoisted(() => ({
  projectState: {
    projects: [] as Project[],
    loadProjects: vi.fn().mockResolvedValue([]),
    addProject: vi.fn(),
  },
}));

vi.mock('../../store/projectStore', () => ({
  useProjectStore: (selector: (state: typeof projectState) => unknown) => selector(projectState),
}));

import { ProjectPicker } from './ProjectPicker';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Kalio Forever',
    path: 'C:\\Work\\kalio-forever',
    kind: 'workspace',
    isSystem: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('ProjectPicker', () => {
  beforeEach(() => {
    projectState.projects = [
      makeProject(),
      makeProject({ id: 'project-2', name: 'Portal App', path: 'C:\\Work\\portal-app' }),
      makeProject({ id: 'system:none', name: 'Bez projektu', path: null, kind: 'none', isSystem: true }),
    ];
    projectState.loadProjects.mockReset();
    projectState.loadProjects.mockResolvedValue(projectState.projects);
    projectState.addProject.mockReset();
  });

  it('finds an existing project by fuzzy name/path and selects it with Enter', () => {
    const onChange = vi.fn();
    render(<ProjectPicker value="system:none" onChange={onChange} />);

    fireEvent.click(screen.getByTestId('project-picker-trigger'));
    const search = screen.getByRole('textbox');
    fireEvent.change(search, { target: { value: 'portal app' } });
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'project-2' }));
  });

  it('creates a project from the modal and selects it', async () => {
    const created = makeProject({ id: 'project-3', name: 'New Workspace', path: 'C:\\Work\\new-workspace' });
    projectState.addProject.mockResolvedValue(created);
    const onChange = vi.fn();
    render(<ProjectPicker value="system:none" onChange={onChange} />);

    fireEvent.click(screen.getByTestId('project-picker-trigger'));
    fireEvent.click(screen.getByRole('button', { name: /Nowy projekt/i }));
    fireEvent.change(screen.getByLabelText('Ścieżka'), { target: { value: created.path } });
    fireEvent.change(screen.getByLabelText('Nazwa'), { target: { value: created.name } });
    fireEvent.click(screen.getByRole('button', { name: /Utwórz/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(created));
    expect(projectState.addProject).toHaveBeenCalledWith({ name: created.name, path: created.path });
  });

  it('supports working without a project and validates an empty path', () => {
    const onChange = vi.fn();
    render(<ProjectPicker value="project-1" onChange={onChange} />);

    fireEvent.click(screen.getByTestId('project-picker-trigger'));
    fireEvent.click(screen.getByRole('button', { name: /Pracuj bez projektu/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'system:none', kind: 'none' }));

    fireEvent.click(screen.getByTestId('project-picker-trigger'));
    fireEvent.click(screen.getByRole('button', { name: /Nowy projekt/i }));
    fireEvent.click(screen.getByRole('button', { name: /Utwórz/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(projectState.addProject).not.toHaveBeenCalled();
  });

  it('shows a dedicated duplicate-path error for the backend 409 response', async () => {
    projectState.addProject.mockRejectedValue({ response: { status: 409 } });
    render(<ProjectPicker value="system:none" onChange={() => undefined} />);

    fireEvent.click(screen.getByTestId('project-picker-trigger'));
    fireEvent.click(screen.getByRole('button', { name: /Nowy projekt/i }));
    fireEvent.change(screen.getByLabelText('Ścieżka'), { target: { value: 'C:\\Work\\duplicate' } });
    fireEvent.click(screen.getByRole('button', { name: /Utwórz/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(projectState.addProject).toHaveBeenCalledTimes(1);
  });

  it('closes the new-project modal with Escape', () => {
    render(<ProjectPicker value="system:none" onChange={() => undefined} />);

    fireEvent.click(screen.getByTestId('project-picker-trigger'));
    fireEvent.click(screen.getByRole('button', { name: /Nowy projekt/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

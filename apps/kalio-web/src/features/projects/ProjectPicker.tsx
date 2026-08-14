import { ChevronDown, Check, Folder, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '@kalio/types';
import { useProjectStore } from '../../store/projectStore';

export interface ProjectPickerProps {
  value: string;
  onChange: (project: Project) => void;
  disabled?: boolean;
  testId?: string;
  label?: string;
}

function fuzzyScore(project: Project, query: string): number {
  if (!query) return 0;
  const haystack = `${project.name} ${project.path ?? ''}`.toLocaleLowerCase();
  const tokens = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.every((token) => haystack.includes(token))) return -1;
  return tokens.reduce((score, token) => score + (haystack.indexOf(token) === 0 ? 0 : haystack.indexOf(token) + 1), 0);
}

function displayPath(project: Project): string {
  return project.path ?? 'Sandbox VFS';
}

function defaultProjectName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).pop() ?? '';
}

function comparablePath(path: string): string {
  return path.trim().replace(/[\\/]+$/, '').replaceAll('\\', '/').toLocaleLowerCase();
}

function isDuplicateError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'response' in error
    && (error as { response?: { status?: number } }).response?.status === 409;
}

export function ProjectPicker({ value, onChange, disabled = false, testId = 'project-picker', label = 'Projekt' }: ProjectPickerProps) {
  const projects = useProjectStore((state) => state.projects);
  const loadProjects = useProjectStore((state) => state.loadProjects);
  const addProject = useProjectStore((state) => state.addProject);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = projects.find((project) => project.id === value) ?? projects.find((project) => project.kind === 'none');

  useEffect(() => {
    void loadProjects().catch((loadError: unknown) => {
      console.warn('[ProjectPicker] load projects failed', loadError);
    });
  }, [loadProjects]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!createOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setCreateOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createOpen]);

  const options = useMemo(() => projects
    .map((project) => ({ project, score: fuzzyScore(project, query) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => left.score - right.score || left.project.name.localeCompare(right.project.name))
    .map((entry) => entry.project), [projects, query]);

  const selectProject = (project: Project) => {
    onChange(project);
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  };

  const openCreate = () => {
    setError(null);
    setName(defaultProjectName(path));
    setCreateOpen(true);
    setOpen(false);
  };

  const submitCreate = async () => {
    const trimmedPath = path.trim();
    if (!trimmedPath) {
      setError('Podaj ścieżkę projektu.');
      return;
    }
    const duplicate = projects.find((project) => project.path && comparablePath(project.path) === comparablePath(trimmedPath));
    if (duplicate) {
      setError(`Projekt dla tej ścieżki już istnieje: ${duplicate.name}.`);
      return;
    }
    try {
      const project = await addProject({ name: name.trim() || defaultProjectName(trimmedPath), path: trimmedPath });
      selectProject(project);
      setCreateOpen(false);
      setPath('');
      setName('');
    } catch (createError) {
      setError(isDuplicateError(createError)
        ? 'Projekt dla tej ścieżki już istnieje. Wybierz istniejący projekt.'
        : 'Nie udało się utworzyć projektu. Sprawdź ścieżkę.');
    }
  };

  return (
    <div className="relative" data-testid={testId}>
      <span className="mb-1.5 block pl-1 text-[11px] uppercase tracking-wider text-base-content/65">{label}</span>
      <button
        type="button"
        className="flex min-h-9 w-full items-center gap-2 rounded-lg border border-base-300 bg-base-100 px-3 text-left text-sm hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActiveIndex(0); }
          if (event.key === 'Escape') setOpen(false);
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={`${testId}-trigger`}
      >
        <Folder size={15} className="shrink-0 text-base-content/55" />
        <span className="min-w-0 flex-1 truncate">{selected?.name ?? 'Bez projektu'}</span>
        <span className="max-w-[45%] truncate text-[11px] text-base-content/45">{selected ? displayPath(selected) : 'Sandbox VFS'}</span>
        <ChevronDown size={14} className="shrink-0 text-base-content/45" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-72 overflow-hidden rounded-xl border border-base-300 bg-base-200 p-1.5 shadow-2xl" role="listbox" aria-label="Wybierz projekt">
          <div className="flex items-center gap-2 rounded-lg bg-base-100 px-2">
            <Search size={14} className="text-base-content/45" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, options.length - 1)); }
                if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
                if (event.key === 'Enter' && options[activeIndex]) { event.preventDefault(); selectProject(options[activeIndex]); }
                if (event.key === 'Escape') setOpen(false);
              }}
              placeholder="Szukaj projektów"
              className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none"
              aria-label="Szukaj projektów"
            />
          </div>
          <div className="mt-1 max-h-64 overflow-y-auto">
            {options.map((project, index) => (
              <button
                key={project.id}
                type="button"
                role="option"
                aria-selected={project.id === value}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${index === activeIndex ? 'bg-base-300' : 'hover:bg-base-300/70'}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectProject(project)}
              >
                <Folder size={14} className="shrink-0 text-base-content/55" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="block truncate">{project.name}</span>
                  <span className="block truncate text-[10px] text-base-content/45">{displayPath(project)}</span>
                </span>
                {project.id === value && <Check size={14} className="shrink-0 text-primary" />}
              </button>
            ))}
            {options.length === 0 && <p className="px-2 py-3 text-xs text-base-content/50">Brak pasujących projektów.</p>}
          </div>
          <div className="mt-1 border-t border-base-300 pt-1">
            <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-base-300/70" onClick={openCreate}>
              <Plus size={14} /> Nowy projekt
            </button>
            <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-base-300/70" onClick={() => selectProject(projects.find((project) => project.kind === 'none') ?? { id: 'system:none', name: 'Bez projektu', path: null, kind: 'none', isSystem: true, createdAt: 0, updatedAt: 0 })}>
              <X size={14} /> Pracuj bez projektu
            </button>
          </div>
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Nowy projekt">
          <div className="w-full max-w-md rounded-2xl border border-base-300 bg-base-200 p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Nowy projekt</h3>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setCreateOpen(false)} aria-label="Zamknij"><X size={15} /></button>
            </div>
            <label className="mt-4 block text-xs text-base-content/65" htmlFor={`${testId}-name`}>Nazwa</label>
            <input id={`${testId}-name`} className="input input-bordered input-sm mt-1 w-full" value={name} onChange={(event) => setName(event.target.value)} />
            <label className="mt-3 block text-xs text-base-content/65" htmlFor={`${testId}-path`}>Ścieżka</label>
            <input id={`${testId}-path`} className="input input-bordered input-sm mt-1 w-full" value={path} onChange={(event) => { setPath(event.target.value); if (!name) setName(defaultProjectName(event.target.value)); }} autoFocus />
            {error && <p className="mt-3 text-xs text-error" role="alert">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreateOpen(false)}>Anuluj</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void submitCreate()}>Utwórz</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { BrainCircuit, Plus } from 'lucide-react';
import { apiClient } from '../../services/apiClient';
import type { Persona, CreatePersonaDto, UpdatePersonaDto } from '@kalio/types';
import { PersonaEditorPanel } from './PersonaEditorPanel';
import { PersonaListItem } from './PersonaListItem';
import { PersonaPageState } from './PersonaPageState';

export function PersonaPanel() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 6000);

    try {
      setLoading(true);
      setLoadError(null);
      const response = await apiClient.get<Persona[]>('/api/personas', { signal: controller.signal });
      setPersonas(response.data);
      setSelectedPersonaId((current) => current ?? response.data[0]?.id ?? null);
    } catch (err: unknown) {
      console.error('[PersonaPanel] load failed', err);
      setLoadError('Unable to load personas. Check the API connection and try again.');
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (dto: CreatePersonaDto) => {
    const { data } = await apiClient.post<Persona>('/api/personas', dto);
    setPersonas((prev) => [...prev, data]);
    setSelectedPersonaId(data.id);
    setShowCreate(false);
  };

  const handleUpdate = async (patch: UpdatePersonaDto) => {
    if (!selectedPersonaId) return;
    const { data } = await apiClient.put<Persona>(`/api/personas/${selectedPersonaId}`, patch);
    setPersonas((prev) => prev.map((p) => (p.id === selectedPersonaId ? data : p)));
  };

  const handleDelete = async (id: string) => {
    await apiClient.delete(`/api/personas/${id}`);
    setPersonas((prev) => prev.filter((p) => p.id !== id));
    setSelectedPersonaId((current) => (current === id ? null : current));
  };

  const selectedPersona = personas.find((persona) => persona.id === selectedPersonaId) ?? null;

  return (
    <div data-testid="persona-panel" className="flex h-full flex-col overflow-hidden bg-base-100">
      <header className="shrink-0 border-b border-base-300 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BrainCircuit size={18} className="text-sky-400" />
              <h1 className="text-lg font-semibold text-base-content">Personas</h1>
              <span className="badge badge-sm badge-ghost">
                {personas.length} persona{personas.length !== 1 ? 's' : ''}
              </span>
            </div>
            <p className="mt-1 text-xs text-base-content/45">
              Configure instruction profiles, model defaults, and allowed tools.
            </p>
          </div>
          <button
            className="btn btn-primary btn-sm gap-2"
            onClick={() => { setShowCreate(true); setSelectedPersonaId(null); }}
            title="New persona"
            data-testid="new-persona-btn"
          >
            <Plus size={14} />
            New persona
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-b border-base-300 bg-base-200/25 p-3 lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-base-content/50">Persona list</span>
            <span className="text-xs text-base-content/40">{personas.length}</span>
          </div>

          {loading && personas.length === 0 && (
            <div className="rounded-lg border border-base-300 bg-base-100/60 p-6 text-center text-xs text-base-content/40">
              Loading...
            </div>
          )}
          {!loading && loadError && (
            <div className="rounded-lg border border-error/30 bg-error/10 p-6 text-center">
              <p className="text-sm font-medium text-error">Unable to load personas</p>
              <p className="mt-1 text-xs text-error/70">{loadError}</p>
              <button className="btn btn-xs btn-ghost mt-3 text-error" onClick={() => void load()}>
                Retry
              </button>
            </div>
          )}
          {!loading && !loadError && personas.length === 0 && (
            <div className="rounded-lg border border-base-300 bg-base-100/60 p-6 text-center">
              <p className="text-sm font-medium text-base-content/65">No personas yet</p>
              <p className="mt-1 text-xs text-base-content/40">Create a persona to define an agent profile.</p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {personas.map((persona) => (
              <PersonaListItem
                key={persona.id}
                persona={persona}
                selected={persona.id === selectedPersonaId && !showCreate}
                onSelect={() => { setSelectedPersonaId(persona.id); setShowCreate(false); }}
              />
            ))}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto p-5">
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            {loading && personas.length === 0 ? (
              <PersonaPageState title="Loading personas" body="Fetching persona profiles and tool policies." />
            ) : loadError ? (
              <PersonaPageState title="Unable to load personas" body={loadError} actionLabel="Retry" onAction={() => void load()} tone="error" />
            ) : showCreate ? (
              <PersonaEditorPanel
                mode="create"
                persona={null}
                onSave={handleCreate}
                onCancel={() => setShowCreate(false)}
              />
            ) : selectedPersona ? (
              <PersonaEditorPanel
                mode="edit"
                persona={selectedPersona}
                onSave={handleUpdate}
                onDelete={handleDelete}
              />
            ) : (
              <PersonaPageState
                title="No persona selected"
                body="Create a persona or choose one from the list to edit its prompt, avatar, and tool policy."
                actionLabel="New persona"
                onAction={() => setShowCreate(true)}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

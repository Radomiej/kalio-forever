import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, Check, X, ChevronDown } from 'lucide-react';
import { apiClient } from '../../services/apiClient';
import type { Persona, CreatePersonaDto, UpdatePersonaDto } from '@kalio/types';

export function PersonaPanel() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiClient
      .get<Persona[]>('/api/personas')
      .then((r) => setPersonas(r.data))
      .catch((err: unknown) => console.error('[PersonaPanel] load failed', err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (dto: CreatePersonaDto) => {
    const { data } = await apiClient.post<Persona>('/api/personas', dto);
    setPersonas((prev) => [...prev, data]);
    setShowCreate(false);
  };

  const handleUpdate = async (id: string, patch: UpdatePersonaDto) => {
    const { data } = await apiClient.put<Persona>(`/api/personas/${id}`, patch);
    setPersonas((prev) => prev.map((p) => (p.id === id ? data : p)));
  };

  const handleDelete = async (id: string) => {
    await apiClient.delete(`/api/personas/${id}`);
    setPersonas((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div data-testid="persona-panel" className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-base-300 shrink-0">
        <span className="text-xs text-base-content/50">{personas.length} persona{personas.length !== 1 ? 's' : ''}</span>
        <button
          className="btn btn-ghost btn-xs gap-1"
          onClick={() => setShowCreate((v) => !v)}
          title="New persona"
          data-testid="new-persona-btn"
        >
          <Plus size={12} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {showCreate && (
          <PersonaForm
            onSave={handleCreate}
            onCancel={() => setShowCreate(false)}
          />
        )}
        {loading && personas.length === 0 && (
          <div className="text-xs text-base-content/40 text-center py-6">Loading…</div>
        )}
        {personas.map((p) => (
          <PersonaRow
            key={p.id}
            persona={p}
            onUpdate={(patch) => void handleUpdate(p.id, patch)}
            onDelete={() => void handleDelete(p.id)}
          />
        ))}
      </div>
    </div>
  );
}

function PersonaForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<CreatePersonaDto>;
  onSave: (dto: CreatePersonaDto) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [model, setModel] = useState(initial?.model ?? 'gpt-4o-mini');
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? 'You are a helpful assistant.');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), model: model.trim(), systemPrompt: systemPrompt.trim(), skills: [] });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-b border-base-300 p-3 flex flex-col gap-2 bg-base-200/40">
      <input
        className="input input-bordered input-xs w-full"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <input
        className="input input-bordered input-xs w-full font-mono"
        placeholder="Model (e.g. gpt-4o-mini)"
        value={model}
        onChange={(e) => setModel(e.target.value)}
      />
      <textarea
        className="textarea textarea-bordered textarea-xs w-full resize-none"
        rows={3}
        placeholder="System prompt"
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
      />
      <div className="flex gap-1 justify-end">
        <button className="btn btn-ghost btn-xs" onClick={onCancel}><X size={12} /></button>
        <button className="btn btn-primary btn-xs gap-1" onClick={() => void submit()} disabled={saving || !name.trim()}>
          <Check size={12} /> Save
        </button>
      </div>
    </div>
  );
}

function PersonaRow({
  persona,
  onUpdate,
  onDelete,
}: {
  persona: Persona;
  onUpdate: (patch: UpdatePersonaDto) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(persona.name);
  const [model, setModel] = useState(persona.model);
  const [systemPrompt, setSystemPrompt] = useState(persona.systemPrompt);

  const save = () => {
    onUpdate({ name: name.trim(), model: model.trim(), systemPrompt: systemPrompt.trim() });
    setEditing(false);
  };

  const cancel = () => {
    setName(persona.name);
    setModel(persona.model);
    setSystemPrompt(persona.systemPrompt);
    setEditing(false);
  };

  return (
    <div
      data-testid="persona-item"
      className="border-b border-base-300/50 last:border-0"
    >
      <div className="flex items-center gap-1 px-3 py-2">
        <button
          className="flex-1 text-left min-w-0"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex items-center gap-1">
            <ChevronDown size={10} className={`shrink-0 text-base-content/30 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            <span className="text-xs font-medium truncate">{persona.name}</span>
            <span className="text-[10px] text-base-content/40 font-mono ml-1 truncate">{persona.model}</span>
          </div>
        </button>
        <button
          className="btn btn-ghost btn-xs text-base-content/30 hover:text-sky-400 p-0 w-5 h-5"
          onClick={() => { setExpanded(true); setEditing(true); }}
          title="Edit"
        >
          <Pencil size={10} />
        </button>
        <button
          className="btn btn-ghost btn-xs text-base-content/30 hover:text-error p-0 w-5 h-5"
          onClick={onDelete}
          title="Delete"
        >
          <Trash2 size={10} />
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          {editing ? (
            <>
              <input
                className="input input-bordered input-xs w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
              />
              <input
                className="input input-bordered input-xs w-full font-mono"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Model"
              />
              <textarea
                className="textarea textarea-bordered textarea-xs w-full resize-none"
                rows={4}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
              />
              <div className="flex gap-1 justify-end">
                <button className="btn btn-ghost btn-xs" onClick={cancel}><X size={12} /></button>
                <button className="btn btn-primary btn-xs gap-1" onClick={save}><Check size={12} /> Save</button>
              </div>
            </>
          ) : (
            <p className="text-xs text-base-content/50 whitespace-pre-wrap">{persona.systemPrompt}</p>
          )}
        </div>
      )}
    </div>
  );
}


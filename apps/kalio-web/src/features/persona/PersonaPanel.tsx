import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, Check, X, ChevronDown, Wrench } from 'lucide-react';
import { apiClient } from '../../services/apiClient';
import type { Persona, CreatePersonaDto, MCPPolicy, UpdatePersonaDto } from '@kalio/types';
import { PersonaToolPicker, PersonaToolBadges } from './PersonaToolPicker';

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
  initial?: Partial<CreatePersonaDto & { allowedTools: string[]; mcpPolicy: MCPPolicy }>;
  onSave: (dto: CreatePersonaDto) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [model, setModel] = useState(initial?.model ?? 'gpt-4o-mini');
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? 'You are a helpful assistant.');
  const [allowedTools, setAllowedTools] = useState<string[]>(initial?.allowedTools ?? []);
  const [mcpPolicy, setMcpPolicy] = useState<MCPPolicy>(initial?.mcpPolicy ?? 'allow_all');
  const [saving, setSaving] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), model: model.trim(), systemPrompt: systemPrompt.trim(), allowedTools, mcpPolicy });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-b border-base-300 p-3 flex flex-col gap-2 bg-base-200/40">
      <input
        data-testid="persona-name-input"
        className="input input-bordered input-xs w-full"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <input
        data-testid="persona-model-input"
        className="input input-bordered input-xs w-full font-mono"
        placeholder="Model (e.g. gpt-4o-mini)"
        value={model}
        onChange={(e) => setModel(e.target.value)}
      />
      <textarea
        data-testid="persona-prompt-textarea"
        className="textarea textarea-bordered textarea-xs w-full resize-none"
        rows={3}
        placeholder="System prompt"
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
      />

      {/* Tools section */}
      <div className="rounded border border-base-300 overflow-hidden">
        <button
          type="button"
          data-testid="persona-tools-toggle"
          className="w-full flex items-center gap-2 px-2 py-1.5 bg-base-200/60 hover:bg-base-200 text-left"
          onClick={() => setToolsOpen((v) => !v)}
        >
          <Wrench size={11} className="text-base-content/40 shrink-0" />
          <span className="text-xs text-base-content/70 flex-1">Tools</span>
          {allowedTools.length > 0 && (
            <span className="badge badge-xs badge-primary">{allowedTools.length}</span>
          )}
          <ChevronDown size={10} className={`text-base-content/30 transition-transform ${toolsOpen ? 'rotate-180' : ''}`} />
        </button>
        {toolsOpen && (
          <div className="p-2">
            <PersonaToolPicker
              selected={allowedTools}
              mcpPolicy={mcpPolicy}
              onChange={(s, p) => { setAllowedTools(s); setMcpPolicy(p); }}
            />
          </div>
        )}
      </div>

      <div className="flex gap-1 justify-end">
        <button className="btn btn-ghost btn-xs" onClick={onCancel}><X size={12} /></button>
        <button
          data-testid="persona-save-btn"
          className="btn btn-primary btn-xs gap-1"
          onClick={() => void submit()}
          disabled={saving || !name.trim()}
        >
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
  const [skills, setSkills] = useState<string[]>(persona.allowedTools ?? []);
  const [mcpPolicy, setMcpPolicy] = useState<MCPPolicy>(persona.mcpPolicy ?? 'allow_all');
  const [toolsOpen, setToolsOpen] = useState(false);

  const save = () => {
    onUpdate({ name: name.trim(), model: model.trim(), systemPrompt: systemPrompt.trim(), allowedTools: skills, mcpPolicy });
    setEditing(false);
  };

  const cancel = () => {
    setName(persona.name);
    setModel(persona.model);
    setSystemPrompt(persona.systemPrompt);
    setSkills(persona.allowedTools ?? []);
    setMcpPolicy(persona.mcpPolicy ?? 'allow_all');
    setEditing(false);
  };

  return (
    <div data-testid="persona-item" className="border-b border-base-300/50 last:border-0">
      <div className="flex items-center gap-1 px-3 py-2">
        <button className="flex-1 text-left min-w-0" onClick={() => setExpanded((v) => !v)}>
          <div className="flex items-center gap-1">
            <ChevronDown size={10} className={`shrink-0 text-base-content/30 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            <span className="text-xs font-medium truncate">{persona.name}</span>
            <span className="text-[10px] text-base-content/40 font-mono ml-1 truncate">{persona.model}</span>
            {(persona.allowedTools?.length ?? 0) > 0 && (
              <span className="ml-1 badge badge-xs badge-ghost" title={`${persona.allowedTools.length} tools`}>
                <Wrench size={8} className="mr-0.5" />{persona.allowedTools.length}
              </span>
            )}
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
          data-testid="persona-delete-btn"
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

              {/* Tools section in edit mode */}
              <div className="rounded border border-base-300 overflow-hidden">
                <button
                  type="button"
                  data-testid="persona-tools-toggle"
                  className="w-full flex items-center gap-2 px-2 py-1.5 bg-base-200/60 hover:bg-base-200 text-left"
                  onClick={() => setToolsOpen((v) => !v)}
                >
                  <Wrench size={11} className="text-base-content/40 shrink-0" />
                  <span className="text-xs text-base-content/70 flex-1">Tools</span>
                  {skills.length > 0 && (
                    <span className="badge badge-xs badge-primary">{skills.length}</span>
                  )}
                  <ChevronDown size={10} className={`text-base-content/30 transition-transform ${toolsOpen ? 'rotate-180' : ''}`} />
                </button>
                {toolsOpen && (
                  <div className="p-2">
                    <PersonaToolPicker
                      selected={skills}
                      mcpPolicy={mcpPolicy}
                      onChange={(s, p) => { setSkills(s); setMcpPolicy(p); }}
                    />
                  </div>
                )}
              </div>

              <div className="flex gap-1 justify-end">
                <button className="btn btn-ghost btn-xs" onClick={cancel}><X size={12} /></button>
                <button className="btn btn-primary btn-xs gap-1" onClick={save}><Check size={12} /> Save</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-base-content/50 whitespace-pre-wrap">{persona.systemPrompt}</p>
              <PersonaToolBadges tools={persona.allowedTools ?? []} mcpPolicy={persona.mcpPolicy} />
            </>
          )}
        </div>
      )}
    </div>
  );
}


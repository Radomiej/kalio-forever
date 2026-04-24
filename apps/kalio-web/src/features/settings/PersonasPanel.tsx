import { useState, useEffect, useCallback } from 'react';
import { Plus, Save, Trash2, ChevronRight, Loader2, AlertCircle, Lock } from 'lucide-react';
import type { Persona, ToolMeta } from '@kalio/types';

const SYSTEM_PERSONA_IDS = new Set(['default', 'ra-apps']);

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

interface EditForm {
  name: string;
  systemPrompt: string;
  model: string;
  skills: string[];   // empty = all tools; otherwise explicit allowlist
}

function emptyForm(): EditForm {
  return { name: '', systemPrompt: '', model: '', skills: [] };
}

function personaToForm(p: Persona): EditForm {
  return { name: p.name, systemPrompt: p.systemPrompt, model: p.model ?? '', skills: p.skills ?? [] };
}

// ─── Tool Toggle Row ────────────────────────────────────────────────────────
function ToolRow({
  tool,
  checked,
  allEnabled,
  onChange,
}: {
  tool: ToolMeta;
  checked: boolean;
  allEnabled: boolean;
  onChange: (name: string, on: boolean) => void;
}) {
  return (
    <label
      className={`flex items-start gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
        checked || allEnabled ? 'bg-sky-500/10' : 'hover:bg-base-300/50'
      }`}
      data-testid={`tool-toggle-${tool.name}`}
    >
      <input
        type="checkbox"
        className="checkbox checkbox-sm checkbox-primary mt-0.5"
        checked={allEnabled || checked}
        disabled={allEnabled}
        onChange={(e) => onChange(tool.name, e.target.checked)}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-sky-400">{tool.name}</span>
          {tool.requiresConfirmation && (
            <span className="badge badge-xs badge-warning">HITL</span>
          )}
        </div>
        <p className="text-xs text-base-content/60 mt-0.5 line-clamp-2">{tool.description}</p>
      </div>
    </label>
  );
}

// ─── Edit Panel ─────────────────────────────────────────────────────────────
function PersonaEditPanel({
  persona,
  tools,
  onSave,
  onDelete,
  onClose,
}: {
  persona: Persona | null;
  tools: ToolMeta[];
  onSave: (form: EditForm) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const isNew = persona === null;
  const isSystem = !isNew && SYSTEM_PERSONA_IDS.has(persona.id);
  const [form, setForm] = useState<EditForm>(persona ? personaToForm(persona) : emptyForm());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const allTools = form.skills.length === 0;

  const setField = <K extends keyof EditForm>(k: K, v: EditForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const toggleAllTools = (on: boolean) => setField('skills', on ? [] : tools.map((t) => t.name));

  const toggleTool = (name: string, on: boolean) => {
    if (on) {
      setField('skills', [...form.skills, name]);
    } else {
      const next = form.skills.filter((s) => s !== name);
      // If all tools end up selected explicitly, collapse back to []
      setField('skills', next.length === tools.length ? [] : next);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setErr('Name is required'); return; }
    setSaving(true);
    setErr(null);
    try {
      await onSave(form);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete persona "${persona?.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="persona-edit-panel">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button className="btn btn-ghost btn-xs gap-1" onClick={onClose}>
          <ChevronRight size={14} className="rotate-180" />
          All Personas
        </button>
        {isSystem && (
          <span className="badge badge-sm badge-ghost gap-1 text-base-content/50">
            <Lock size={10} /> System
          </span>
        )}
      </div>

      {err && (
        <div className="alert alert-error py-2 text-sm" data-testid="persona-edit-error">
          <AlertCircle size={16} />
          {err}
        </div>
      )}

      {/* Name */}
      <div className="form-control gap-1">
        <label className="label-text font-semibold">Name</label>
        <input
          className="input input-bordered input-sm w-full"
          value={form.name}
          disabled={isSystem}
          onChange={(e) => setField('name', e.target.value)}
          data-testid="persona-name-input"
        />
      </div>

      {/* System Prompt */}
      <div className="form-control gap-1">
        <label className="label-text font-semibold">System Prompt</label>
        <textarea
          className="textarea textarea-bordered textarea-sm w-full font-mono text-xs resize-none"
          rows={7}
          value={form.systemPrompt}
          onChange={(e) => setField('systemPrompt', e.target.value)}
          placeholder="You are a helpful assistant…"
          data-testid="persona-prompt-input"
        />
      </div>

      {/* Model override */}
      <div className="form-control gap-1">
        <label className="label-text font-semibold">Model override <span className="text-xs font-normal text-base-content/40">(leave blank to use active credential)</span></label>
        <input
          className="input input-bordered input-sm w-full font-mono"
          value={form.model}
          onChange={(e) => setField('model', e.target.value)}
          placeholder="e.g. gpt-4o-mini"
          data-testid="persona-model-input"
        />
      </div>

      {/* Tool access */}
      <div className="form-control gap-2">
        <div className="flex items-center justify-between">
          <label className="label-text font-semibold">Tool Access</label>
          <label className="flex items-center gap-2 cursor-pointer text-xs text-base-content/60">
            <input
              type="checkbox"
              className="checkbox checkbox-xs checkbox-primary"
              checked={allTools}
              onChange={(e) => toggleAllTools(e.target.checked)}
              data-testid="tool-toggle-all"
            />
            All tools
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-56 overflow-y-auto border border-base-300 rounded-lg p-2">
          {tools.map((t) => (
            <ToolRow
              key={t.name}
              tool={t}
              checked={form.skills.includes(t.name)}
              allEnabled={allTools}
              onChange={toggleTool}
            />
          ))}
        </div>
        <p className="text-xs text-base-content/40">
          {allTools
            ? `All ${tools.length} tools available`
            : `${form.skills.length} / ${tools.length} tools enabled`}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2 border-t border-base-300">
        {!isNew && !isSystem ? (
          <button
            className="btn btn-ghost btn-sm text-error gap-1"
            onClick={handleDelete}
            disabled={deleting}
            data-testid="persona-delete-btn"
          >
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Delete
          </button>
        ) : <div />}

        <button
          className="btn btn-primary btn-sm gap-1"
          onClick={handleSave}
          disabled={saving}
          data-testid="persona-save-btn"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {isNew ? 'Create' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────────
export function PersonasPanel() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [tools, setTools] = useState<ToolMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Persona | null | 'new'>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ps, ts] = await Promise.all([
        apiFetch<Persona[]>('/personas'),
        apiFetch<ToolMeta[]>('/tools'),
      ]);
      setPersonas(ps);
      setTools(ts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSave = async (form: EditForm) => {
    if (selected === 'new') {
      await apiFetch<Persona>('/personas', {
        method: 'POST',
        body: JSON.stringify(form),
      });
    } else if (selected) {
      await apiFetch<Persona>(`/personas/${selected.id}`, {
        method: 'PUT',
        body: JSON.stringify(form),
      });
    }
    setSelected(null);
    await load();
  };

  const handleDelete = async () => {
    if (!selected || selected === 'new') return;
    await apiFetch(`/personas/${selected.id}`, { method: 'DELETE' });
    setSelected(null);
    await load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-base-content/40" data-testid="personas-panel">
        <Loader2 size={24} className="animate-spin" />
      </div>
    );
  }

  if (selected !== null) {
    return (
      <div data-testid="personas-panel">
        <PersonaEditPanel
          persona={selected === 'new' ? null : selected}
          tools={tools}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setSelected(null)}
        />
      </div>
    );
  }

  return (
    <div data-testid="personas-panel" className="flex flex-col gap-4">
      {error && (
        <div className="alert alert-error py-2 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base-content">Personas</h3>
        <button
          className="btn btn-primary btn-sm gap-1"
          onClick={() => setSelected('new')}
          data-testid="new-persona-btn"
        >
          <Plus size={14} />
          New Persona
        </button>
      </div>

      <div className="flex flex-col gap-2" data-testid="persona-list">
        {personas.map((p) => (
          <button
            key={p.id}
            className="flex items-center justify-between p-3 rounded-lg border border-base-300 hover:border-sky-500/40 hover:bg-sky-500/5 transition-colors text-left"
            onClick={() => setSelected(p)}
            data-testid={`persona-row-${p.id}`}
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{p.name}</span>
                {SYSTEM_PERSONA_IDS.has(p.id) && (
                  <span className="badge badge-xs badge-ghost text-base-content/40">system</span>
                )}
              </div>
              <p className="text-xs text-base-content/50 mt-0.5 line-clamp-1">
                {p.systemPrompt.slice(0, 80)}
              </p>
              <p className="text-xs text-base-content/30 mt-0.5">
                {(p.skills ?? []).length === 0
                  ? `All ${tools.length} tools`
                  : `${(p.skills ?? []).length} tools`}
              </p>
            </div>
            <ChevronRight size={16} className="text-base-content/30 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

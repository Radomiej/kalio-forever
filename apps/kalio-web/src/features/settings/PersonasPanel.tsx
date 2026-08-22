import { useState, useEffect, useCallback } from 'react';
import { Plus, ChevronRight, Loader2, AlertCircle } from 'lucide-react';
import type { Persona, ToolMeta } from '@kalio/types';
import { PersonaEditPanel, type EditForm } from './PersonaEditPanel';
import { apiFetch } from './persona-api';

const SYSTEM_PERSONA_IDS = new Set(['default', 'ra-apps']);

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
                {(p.allowedTools ?? []).length === 0
                  ? `All ${tools.length} tools`
                  : `${(p.allowedTools ?? []).length} tools`}
              </p>
            </div>
            <ChevronRight size={16} className="text-base-content/30 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

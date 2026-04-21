import { useEffect, useState } from 'react';
import { apiClient } from '../../services/apiClient';
import type { Persona, CreatePersonaDto } from '@kalio/types';

export function PersonaPanel() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    apiClient
      .get<Persona[]>('/api/personas')
      .then((r) => setPersonas(r.data))
      .catch((err: unknown) => console.error('[PersonaPanel] load failed', err));
  }, []);

  const createDefault = async () => {
    setCreating(true);
    try {
      const dto: CreatePersonaDto = {
        name: 'Default',
        systemPrompt: 'You are a helpful assistant.',
        model: 'gpt-4o-mini',
        skills: [],
      };
      const { data } = await apiClient.post<Persona>('/api/personas', dto);
      setPersonas((prev) => [...prev, data]);
    } catch (err) {
      console.error('[PersonaPanel] create failed', err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div data-testid="persona-panel" className="flex flex-col gap-1 p-2">
      <button
        data-testid="new-persona-btn"
        className="btn btn-primary btn-xs w-full"
        onClick={createDefault}
        disabled={creating}
      >
        + New Persona
      </button>
      {personas.map((p) => (
        <div key={p.id} data-testid="persona-item" className="rounded border border-base-300 p-2 text-xs">
          <div className="font-semibold">{p.name}</div>
          <div className="text-base-content/60">{p.model}</div>
        </div>
      ))}
    </div>
  );
}

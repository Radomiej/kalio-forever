import { useEffect, useState } from 'react';
import { Plus, Trash2, Sparkles } from 'lucide-react';
import type { Skill } from '@kalio/types';

interface Props {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function SkillListPanel({ selectedId, onSelect }: Props) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch('/api/skills')
      .then((r) => r.json())
      .then((data: Skill[]) => setSkills(data))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    const res = await fetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Skill', description: '', prompt: '' }),
    });
    const skill = await res.json() as Skill;
    setSkills((prev) => [...prev, skill]);
    onSelect(skill.id);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`/api/skills/${id}`, { method: 'DELETE' });
    setSkills((prev) => prev.filter((s) => s.id !== id));
    if (selectedId === id) onSelect(null);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-base-300 flex items-center gap-2">
        <Sparkles size={14} className="text-base-content/50" />
        <span className="text-sm font-semibold flex-1">Skills</span>
        <button className="btn btn-xs btn-ghost" onClick={handleCreate} title="New skill">
          <Plus size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <p className="text-xs text-base-content/40 p-3">Loading…</p>}
        {!loading && skills.length === 0 && (
          <p className="text-xs text-base-content/40 p-3">No skills yet. Click + to create.</p>
        )}
        {skills.map((skill) => (
          <button
            key={skill.id}
            onClick={() => onSelect(skill.id)}
            className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-base-200 transition-colors group ${selectedId === skill.id ? 'bg-base-300' : ''}`}
          >
            <span className="flex-1 truncate">{skill.name}</span>
            <span className="badge badge-xs opacity-60 shrink-0">{skill.source}</span>
            <span
              onClick={(e) => handleDelete(skill.id, e)}
              role="button"
              className="opacity-0 group-hover:opacity-100 transition-opacity text-error hover:text-error cursor-pointer"
            >
              <Trash2 size={12} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Save, Sparkles } from 'lucide-react';
import type { Skill, UpdateSkillDto } from '@kalio/types';

interface Props {
  skillId: string | null;
}

export function SkillEditorPanel({ skillId }: Props) {
  const [skill, setSkill] = useState<Skill | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!skillId) { setSkill(null); return; }
    fetch(`/api/skills/${skillId}`)
      .then((r) => r.json())
      .then((data: Skill) => {
        setSkill(data);
        setName(data.name);
        setDescription(data.description);
        setPrompt(data.prompt);
      })
      .catch(() => setSkill(null));
  }, [skillId]);

  const handleSave = async () => {
    if (!skill) return;
    setSaving(true);
    const dto: UpdateSkillDto = { name, description, prompt };
    await fetch(`/api/skills/${skill.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dto),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  if (!skillId) {
    return (
      <div className="flex items-center justify-center h-full text-base-content/40 text-sm">
        <div className="text-center">
          <Sparkles size={32} className="mx-auto mb-2 opacity-30" />
          <p>Select a skill to edit</p>
        </div>
      </div>
    );
  }

  if (!skill) return <div className="p-4 text-sm text-base-content/40">Loading…</div>;

  return (
    <div data-testid="skill-editor" className="flex flex-col h-full p-4 gap-4 max-w-2xl">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-primary" />
        <h2 className="text-base font-semibold flex-1">Skill Editor</h2>
        <button
          className={`btn btn-sm btn-primary ${saving ? 'loading' : ''}`}
          data-testid="skill-save-btn"
          onClick={handleSave}
          disabled={saving}
        >
          {saved ? '✓ Saved' : <><Save size={13} className="mr-1" />Save</>}
        </button>
      </div>

      <div className="form-control gap-1">
        <label className="label py-0"><span className="label-text text-xs">Name</span></label>
        <input
          data-testid="skill-name-input"
          className="input input-sm input-bordered w-full"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="form-control gap-1">
        <label className="label py-0"><span className="label-text text-xs">Description</span></label>
        <input
          className="input input-sm input-bordered w-full"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this skill do?"
        />
      </div>

      <div className="form-control gap-1 flex-1">
        <label className="label py-0">
          <span className="label-text text-xs">System Prompt Injection</span>
          <span className="label-text-alt text-xs text-base-content/40">Injected into system prompt when skill is active</span>
        </label>
        <textarea
          className="textarea textarea-bordered flex-1 font-mono text-xs resize-none min-h-40"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter the prompt snippet this skill injects…"
        />
      </div>

      <div className="text-xs text-base-content/40">
        Source: <span className="badge badge-xs">{skill.source}</span>
        {' · '}Created: {new Date(skill.createdAt).toLocaleDateString()}
      </div>
    </div>
  );
}

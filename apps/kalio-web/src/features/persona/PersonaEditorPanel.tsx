import { useEffect, useState } from 'react';
import { Check, Trash2, Wrench } from 'lucide-react';
import type { CreatePersonaDto, MCPPolicy, Persona, PersonaAvatarToken, UpdatePersonaDto } from '@kalio/types';
import { PersonaAvatar } from './PersonaAvatar';
import { defaultAvatarFromName } from './persona-avatar.utils';
import { PersonaAvatarModal } from './PersonaAvatarModal';
import { PersonaToolPicker } from './PersonaToolPicker';

interface CreateProps {
  mode: 'create';
  persona: null;
  onSave: (dto: CreatePersonaDto) => Promise<void>;
  onDelete?: undefined;
  onCancel?: () => void;
}

interface EditProps {
  mode: 'edit';
  persona: Persona | null;
  onSave: (dto: UpdatePersonaDto) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onCancel?: () => void;
}

type Props = CreateProps | EditProps;

export function PersonaEditorPanel(props: Props) {
  const { mode, persona, onSave, onDelete, onCancel } = props;
  const [name, setName] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.');
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [mcpPolicy, setMcpPolicy] = useState<MCPPolicy>('allow_all');
  const [avatar, setAvatar] = useState<PersonaAvatarToken>(() => defaultAvatarFromName(''));
  const [avatarManuallySelected, setAvatarManuallySelected] = useState(false);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode === 'create') {
      setName('');
      setModel('gpt-4o-mini');
      setSystemPrompt('You are a helpful assistant.');
      setAllowedTools([]);
      setMcpPolicy('allow_all');
      setAvatar(defaultAvatarFromName(''));
      setAvatarManuallySelected(false);
      return;
    }

    if (!persona) return;

    setName(persona.name);
    setModel(persona.model);
    setSystemPrompt(persona.systemPrompt);
    setAllowedTools(persona.allowedTools ?? []);
    setMcpPolicy(persona.mcpPolicy ?? 'allow_all');
    setAvatar({
      avatarSeed: persona.avatarSeed,
      avatarVariant: persona.avatarVariant,
      avatarPaletteKey: persona.avatarPaletteKey,
      avatarIndex: persona.avatarIndex,
    });
    setAvatarManuallySelected(true);
  }, [mode, persona?.id]);

  useEffect(() => {
    if (avatarManuallySelected || mode === 'edit') return;
    setAvatar(defaultAvatarFromName(name));
  }, [name, avatarManuallySelected, mode]);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        model: model.trim(),
        systemPrompt: systemPrompt.trim(),
        allowedTools,
        mcpPolicy,
        avatarSeed: avatar.avatarSeed,
        avatarVariant: avatar.avatarVariant,
        avatarPaletteKey: avatar.avatarPaletteKey,
        avatarIndex: avatar.avatarIndex,
      };
      if (mode === 'create') {
        await onSave(payload);
      } else {
        await onSave(payload);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!persona || !onDelete) return;
    if (!window.confirm(`Delete persona "${persona.name}"?`)) return;
    await onDelete(persona.id);
  };

  if (mode === 'edit' && !persona) {
    return (
      <section className="flex min-h-80 flex-col items-center justify-center rounded-lg border border-dashed border-base-300 bg-base-200/40 p-8 text-center">
        <p className="text-sm font-medium text-base-content/65">No persona selected</p>
        <p className="mt-1 max-w-md text-xs text-base-content/40">
          Choose a persona from the list or create a new one.
        </p>
      </section>
    );
  }

  return (
    <section data-testid="persona-editor" className="rounded-lg border border-base-300 bg-base-200/45">
      <div className="border-b border-base-300 px-5 py-4">
        <div className="flex flex-wrap items-start gap-4">
          <PersonaAvatar token={avatar} size={56} />
          <div className="min-w-0 flex-1 grid gap-3 md:grid-cols-2">
            <input
              data-testid="persona-name-input"
              className="input input-bordered input-sm w-full"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              data-testid="persona-model-input"
              className="input input-bordered input-sm w-full font-mono"
              placeholder="Model (e.g. gpt-4o-mini)"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            {onCancel && (
              <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
            )}
            {mode === 'edit' && onDelete && (
              <button
                className="btn btn-outline btn-error btn-sm gap-2"
                data-testid="persona-delete-btn"
                onClick={() => void handleDelete()}
              >
                <Trash2 size={14} /> Delete
              </button>
            )}
            <button
              data-testid="persona-save-btn"
              className="btn btn-primary btn-sm gap-2"
              onClick={() => void submit()}
              disabled={saving || !name.trim()}
            >
              <Check size={14} /> Save
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-5 p-5">
        <div className="form-control gap-1">
          <label className="label py-0"><span className="label-text text-xs">System prompt</span></label>
          <textarea
            data-testid="persona-prompt-textarea"
            className="textarea textarea-bordered w-full resize-y font-mono text-sm min-h-48"
            placeholder="System prompt"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
          />
        </div>

        <div className="rounded-lg border border-base-300 bg-base-100/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-base-content/45">Avatar</p>
              <p className="mt-1 text-xs text-base-content/45">
                {avatar.avatarVariant} · {avatar.avatarPaletteKey} · #{avatar.avatarIndex}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              data-testid="persona-change-avatar-btn"
              onClick={() => setAvatarModalOpen(true)}
            >
              Change avatar
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-base-300 bg-base-100/70 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Wrench size={14} className="text-base-content/45" />
            <p className="text-xs font-semibold uppercase tracking-wider text-base-content/45">Tools and MCP policy</p>
          </div>
          <PersonaToolPicker
            selected={allowedTools}
            mcpPolicy={mcpPolicy}
            onChange={(tools, policy) => {
              setAllowedTools(tools);
              setMcpPolicy(policy);
            }}
          />
        </div>
      </div>

      {avatarModalOpen && (
        <PersonaAvatarModal
          baseSeed={name}
          selected={avatar}
          onClose={() => setAvatarModalOpen(false)}
          onSelect={(next) => {
            setAvatar(next);
            setAvatarManuallySelected(true);
            setAvatarModalOpen(false);
          }}
        />
      )}
    </section>
  );
}

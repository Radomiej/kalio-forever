import { useState } from 'react';
import { BrainCircuit, Check, ChevronDown, Pencil, Plus, Trash2, Wrench, X } from 'lucide-react';
import type { CreatePersonaDto, MCPPolicy, Persona, UpdatePersonaDto } from '@kalio/types';
import { PersonaToolBadges, PersonaToolPicker } from './PersonaToolPicker';

export function PersonaPageSummary({ persona, onCreate }: { persona: Persona | null; onCreate: () => void }) {
  if (!persona) {
    return (
      <section className="flex min-h-80 flex-col items-center justify-center rounded-lg border border-dashed border-base-300 bg-base-200/40 p-8 text-center">
        <BrainCircuit size={28} className="text-base-content/20" />
        <p className="mt-3 text-sm font-medium text-base-content/65">No persona selected</p>
        <p className="mt-1 max-w-md text-xs text-base-content/40">
          Create a persona or choose one from the list to inspect its system prompt and tool policy.
        </p>
        <button className="btn btn-primary btn-sm mt-4 gap-2" onClick={onCreate}>
          <Plus size={14} />
          New persona
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-base-300 bg-base-200/45 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-base-content">{persona.name}</h2>
          <p className="mt-1 font-mono text-xs text-base-content/45">{persona.model}</p>
        </div>
        <span className="badge badge-sm badge-ghost">{(persona.allowedTools?.length ?? 0)} tools</span>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-lg border border-base-300 bg-base-100/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-base-content/45">System prompt</p>
          <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-6 text-base-content/70">
            {persona.systemPrompt}
          </p>
        </div>
        <div className="rounded-lg border border-base-300 bg-base-100/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-base-content/45">Tool access</p>
          <PersonaToolBadges tools={persona.allowedTools ?? []} mcpPolicy={persona.mcpPolicy} />
          <p className="mt-3 text-xs text-base-content/40">
            Use the list card edit action to change prompt, model, and allowed tools.
          </p>
        </div>
      </div>
    </section>
  );
}

export function PersonaPageState({
  title,
  body,
  actionLabel,
  onAction,
  tone = 'neutral',
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'neutral' | 'error';
}) {
  const isError = tone === 'error';

  return (
    <section className={`flex min-h-80 flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center ${isError ? 'border-error/30 bg-error/10' : 'border-base-300 bg-base-200/40'}`}>
      <BrainCircuit size={28} className={isError ? 'text-error/60' : 'text-base-content/20'} />
      <p className={`mt-3 text-sm font-medium ${isError ? 'text-error' : 'text-base-content/65'}`}>{title}</p>
      <p className={`mt-1 max-w-md text-xs ${isError ? 'text-error/70' : 'text-base-content/40'}`}>{body}</p>
      {actionLabel && onAction && (
        <button className={`btn btn-sm mt-4 gap-2 ${isError ? 'btn-outline btn-error' : 'btn-primary'}`} onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </section>
  );
}

export function PersonaForm({
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
    <div className="flex flex-col gap-3 p-4">
      <input data-testid="persona-name-input" className="input input-bordered input-sm w-full" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <input data-testid="persona-model-input" className="input input-bordered input-sm w-full font-mono" placeholder="Model (e.g. gpt-4o-mini)" value={model} onChange={(e) => setModel(e.target.value)} />
      <textarea data-testid="persona-prompt-textarea" className="textarea textarea-bordered textarea-sm w-full resize-y" rows={6} placeholder="System prompt" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />

      <PersonaToolsSection
        selected={allowedTools}
        mcpPolicy={mcpPolicy}
        open={toolsOpen}
        onToggle={() => setToolsOpen((v) => !v)}
        onChange={(s, p) => { setAllowedTools(s); setMcpPolicy(p); }}
      />

      <div className="flex gap-2 justify-end">
        <button className="btn btn-ghost btn-sm gap-2" onClick={onCancel}><X size={14} /> Cancel</button>
        <button data-testid="persona-save-btn" className="btn btn-primary btn-sm gap-2" onClick={() => void submit()} disabled={saving || !name.trim()}>
          <Check size={14} /> Save
        </button>
      </div>
    </div>
  );
}

function PersonaToolsSection({
  selected,
  mcpPolicy,
  open,
  onToggle,
  onChange,
}: {
  selected: string[];
  mcpPolicy: MCPPolicy;
  open: boolean;
  onToggle: () => void;
  onChange: (tools: string[], policy: MCPPolicy) => void;
}) {
  return (
    <div className="rounded-lg border border-base-300 overflow-hidden">
      <button type="button" data-testid="persona-tools-toggle" className="w-full flex items-center gap-2 px-3 py-2 bg-base-200/60 hover:bg-base-200 text-left" onClick={onToggle}>
        <Wrench size={13} className="text-base-content/45 shrink-0" />
        <span className="text-xs font-medium text-base-content/75 flex-1">Tools</span>
        {selected.length > 0 && <span className="badge badge-xs badge-primary">{selected.length}</span>}
        <ChevronDown size={12} className={`text-base-content/35 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="p-3">
          <PersonaToolPicker selected={selected} mcpPolicy={mcpPolicy} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

export function PersonaRow({
  persona,
  selected,
  onSelect,
  onUpdate,
  onDelete,
}: {
  persona: Persona;
  selected: boolean;
  onSelect: () => void;
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
    <div data-testid="persona-item" className={`rounded-lg border bg-base-100/70 ${selected ? 'border-sky-500/60 shadow-[0_0_0_1px_rgba(56,189,248,0.18)]' : 'border-base-300'}`}>
      <div className="flex items-center gap-1 px-3 py-2.5">
        <button className="flex-1 text-left min-w-0" onClick={() => { onSelect(); setExpanded((v) => !v); }}>
          <div className="flex items-center gap-1">
            <ChevronDown size={12} className={`shrink-0 text-base-content/35 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            <span className="text-sm font-medium truncate">{persona.name}</span>
            <span className="text-[10px] text-base-content/40 font-mono ml-1 truncate">{persona.model}</span>
            {(persona.allowedTools?.length ?? 0) > 0 && (
              <span className="ml-1 badge badge-xs badge-ghost" title={`${persona.allowedTools.length} tools`}>
                <Wrench size={8} className="mr-0.5" />{persona.allowedTools.length}
              </span>
            )}
          </div>
        </button>
        <button className="btn btn-ghost btn-xs text-base-content/35 hover:text-sky-400 p-0 w-6 h-6" onClick={() => { onSelect(); setExpanded(true); setEditing(true); }} title="Edit">
          <Pencil size={11} />
        </button>
        <button className="btn btn-ghost btn-xs text-base-content/35 hover:text-error p-0 w-6 h-6" onClick={onDelete} title="Delete" data-testid="persona-delete-btn">
          <Trash2 size={11} />
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          {editing ? (
            <>
              <input className="input input-bordered input-sm w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
              <input className="input input-bordered input-sm w-full font-mono" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model" />
              <textarea className="textarea textarea-bordered textarea-sm w-full resize-y" rows={6} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
              <PersonaToolsSection selected={skills} mcpPolicy={mcpPolicy} open={toolsOpen} onToggle={() => setToolsOpen((v) => !v)} onChange={(s, p) => { setSkills(s); setMcpPolicy(p); }} />
              <div className="flex gap-2 justify-end">
                <button className="btn btn-ghost btn-sm" onClick={cancel}><X size={14} /> Cancel</button>
                <button className="btn btn-primary btn-sm gap-2" onClick={save}><Check size={14} /> Save</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs leading-5 text-base-content/55 whitespace-pre-wrap">{persona.systemPrompt}</p>
              <PersonaToolBadges tools={persona.allowedTools ?? []} mcpPolicy={persona.mcpPolicy} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

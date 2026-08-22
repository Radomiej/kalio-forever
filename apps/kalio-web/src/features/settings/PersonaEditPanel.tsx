import { useState, useEffect } from 'react';
import { Save, Trash2, ChevronRight, Loader2, AlertCircle, Lock } from 'lucide-react';
import type { Credential, ExecutionProfile, Persona, ToolMeta } from '@kalio/types';
import { PersonaRuntimeSelector } from '../persona/PersonaRuntimeSelector';
import { ClaudeNativeToolPicker } from '../persona/ClaudeNativeToolPicker';
import {
  findDirectProfile,
  findProfile,
  nativeModelOptions,
  preferredProfile,
  type PersonaRuntimeKind,
} from '../persona/persona-runtime-selection';
import { apiFetch } from './persona-api';
import { PersonaToolRow } from './PersonaToolRow';

const SYSTEM_PERSONA_IDS = new Set(['default', 'ra-apps']);

export interface EditForm {
  name: string;
  systemPrompt: string;
  model: string;
  executionProfileId?: string;
  allowedTools: string[];   // empty = all tools; otherwise explicit allowlist
  providerToolNames: string[];
}

function emptyForm(): EditForm {
  return { name: '', systemPrompt: '', model: '', allowedTools: [], providerToolNames: [] };
}

function personaToForm(p: Persona): EditForm {
  return {
    name: p.name,
    systemPrompt: p.systemPrompt,
    model: p.model ?? '',
    ...(p.executionProfileId ? { executionProfileId: p.executionProfileId } : {}),
    allowedTools: p.allowedTools ?? [],
    providerToolNames: p.providerToolNames ?? [],
  };
}

export function PersonaEditPanel({
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
  const [runtimeKind, setRuntimeKind] = useState<PersonaRuntimeKind>('direct-llm');
  const [executionProfiles, setExecutionProfiles] = useState<ExecutionProfile[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [directCredentialId, setDirectCredentialId] = useState('');
  const [credentialModels, setCredentialModels] = useState<string[]>([]);
  const [reasoningEffort, setReasoningEffort] = useState('');
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [credentialsLoading, setCredentialsLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(false);
  const allTools = form.allowedTools.length === 0;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiFetch<ExecutionProfile[]>('/runtime/profiles'),
      apiFetch<Credential[]>('/credentials'),
    ]).then(([profiles, loadedCredentials]) => {
      if (cancelled) return;
      setExecutionProfiles(profiles.filter((profile) => profile.enabled));
      setCredentials(loadedCredentials);
    }).catch((error: unknown) => {
      if (!cancelled) console.error('[PersonasPanel] runtime option load failed', error);
    }).finally(() => {
      if (cancelled) return;
      setProfilesLoading(false);
      setCredentialsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const profile = findProfile(executionProfiles, form.executionProfileId);
    if (profile) {
      setRuntimeKind(profile.kind);
      setReasoningEffort(profile.reasoningEffort ?? '');
      setDirectCredentialId(profile.kind === 'direct-llm' ? (profile.authProfileId ?? '') : '');
      return;
    }
    setRuntimeKind('direct-llm');
    setReasoningEffort('');
  }, [executionProfiles, form.executionProfileId]);

  useEffect(() => {
    if (!directCredentialId) {
      setCredentialModels([]);
      setModelsLoading(false);
      return;
    }
    let cancelled = false;
    setModelsLoading(true);
    void apiFetch<{ models: string[] }>(`/credentials/${encodeURIComponent(directCredentialId)}/models`)
      .then((result) => {
        if (!cancelled) setCredentialModels(result.models);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error('[PersonasPanel] credential model load failed', error);
          setCredentialModels([]);
        }
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [directCredentialId]);

  const setField = <K extends keyof EditForm>(k: K, v: EditForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const toggleAllTools = (on: boolean) => setField('allowedTools', on ? [] : tools.map((t) => t.name));

  const toggleTool = (name: string, on: boolean) => {
    if (on) {
      setField('allowedTools', [...form.allowedTools, name]);
    } else {
      const next = form.allowedTools.filter((s) => s !== name);
      // If all tools end up selected explicitly, collapse back to []
      setField('allowedTools', next.length === tools.length ? [] : next);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setErr('Name is required'); return; }
    setSaving(true);
    setErr(null);
    try {
      let resolvedExecutionProfileId = form.executionProfileId;
      if (runtimeKind === 'direct-llm' && directCredentialId) {
        const credential = credentials.find((item) => item.id === directCredentialId);
        if (!credential) throw new Error('Selected provider connection is no longer available.');
        const existing = findDirectProfile(executionProfiles, directCredentialId, credential.provider, form.model.trim());
        const profile = existing ?? await apiFetch<ExecutionProfile>('/runtime/profiles/direct/resolve', {
          method: 'POST',
          body: JSON.stringify({ credentialId: directCredentialId, model: form.model.trim() }),
        });
        resolvedExecutionProfileId = profile.id;
      } else if (runtimeKind !== 'direct-llm') {
        const selected = findProfile(executionProfiles, form.executionProfileId);
        const profile = selected && selected.kind === runtimeKind && selected.model === form.model
          && (selected.reasoningEffort ?? '') === reasoningEffort
          ? selected
          : preferredProfile(executionProfiles, runtimeKind, form.model, reasoningEffort);
        resolvedExecutionProfileId = profile.id;
      } else if (resolvedExecutionProfileId && !findProfile(executionProfiles, resolvedExecutionProfileId)) {
        resolvedExecutionProfileId = undefined;
      }
      await onSave({
        ...form,
        name: form.name.trim(),
        systemPrompt: form.systemPrompt.trim(),
        model: form.model.trim(),
        ...(resolvedExecutionProfileId ? { executionProfileId: resolvedExecutionProfileId } : {}),
      });
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

      <PersonaRuntimeSelector
        runtimeKind={runtimeKind}
        profiles={executionProfiles}
        credentials={credentials}
        profilesLoading={profilesLoading}
        credentialsLoading={credentialsLoading}
        credentialModels={credentialModels}
        modelsLoading={modelsLoading}
        directCredentialId={directCredentialId}
        model={form.model}
        reasoningEffort={reasoningEffort}
        onRuntimeKindChange={(kind) => {
          setRuntimeKind(kind);
          if (kind === 'direct-llm') {
            setDirectCredentialId('');
            setReasoningEffort('');
            setField('executionProfileId', undefined);
            setField('model', '');
            return;
          }
          const option = nativeModelOptions(executionProfiles, kind)[0];
          if (!option) {
            setField('executionProfileId', undefined);
            setField('model', '');
            return;
          }
          setField('executionProfileId', option.profile.id);
          setField('model', option.model);
          setReasoningEffort(option.profile.reasoningEffort ?? '');
          setDirectCredentialId('');
        }}
        onDirectCredentialChange={(credentialId) => {
          setDirectCredentialId(credentialId);
          setField('executionProfileId', undefined);
          const credential = credentials.find((item) => item.id === credentialId);
          if (credential?.model) setField('model', credential.model);
        }}
        onDirectModelChange={(nextModel) => {
          setField('model', nextModel);
          setField('executionProfileId', undefined);
        }}
        onNativeModelChange={(nextModel) => {
          if (runtimeKind === 'direct-llm') return;
          const profile = preferredProfile(executionProfiles, runtimeKind, nextModel);
          setField('model', nextModel);
          setField('executionProfileId', profile.id);
          setReasoningEffort(profile.reasoningEffort ?? '');
        }}
        onReasoningChange={(nextReasoning) => {
          if (runtimeKind === 'direct-llm') return;
          const profile = preferredProfile(executionProfiles, runtimeKind, form.model, nextReasoning);
          setReasoningEffort(nextReasoning);
          setField('executionProfileId', profile.id);
        }}
      />
      {form.executionProfileId && !profilesLoading && !findProfile(executionProfiles, form.executionProfileId) && (
        <p className="text-xs text-warning" data-testid="persona-missing-profile-warning">
          This persona references an unavailable execution profile. Choose an enabled profile before saving.
        </p>
      )}

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
            <PersonaToolRow
              key={t.name}
              tool={t}
              checked={form.allowedTools.includes(t.name)}
              allEnabled={allTools}
              onChange={toggleTool}
            />
          ))}
        </div>
        <p className="text-xs text-base-content/40">
          {allTools
            ? `All ${tools.length} tools available`
            : `${form.allowedTools.length} / ${tools.length} tools enabled`}
        </p>
      </div>

      {runtimeKind === 'claude-agent-sdk' && (
        <ClaudeNativeToolPicker
          selected={form.providerToolNames}
          onChange={(providerToolNames) => setField('providerToolNames', providerToolNames)}
        />
      )}

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

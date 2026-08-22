import { useEffect, useRef, useState } from 'react';
import { Check, Trash2, Wrench } from 'lucide-react';
import type { CreatePersonaDto, Credential, ExecutionProfile, MCPPolicy, Persona, PersonaAvatarToken, UpdatePersonaDto } from '@kalio/types';
import { getCredentialModels, getCredentials, getExecutionProfiles, resolveDirectExecutionProfile } from '../../services/apiClient';
import { PersonaAvatar } from './PersonaAvatar';
import { defaultAvatarFromName } from './persona-avatar.utils';
import { PersonaAvatarModal } from './PersonaAvatarModal';
import { PersonaToolPicker } from './PersonaToolPicker';
import { ClaudeNativeToolPicker } from './ClaudeNativeToolPicker';
import { PersonaRuntimeSelector } from './PersonaRuntimeSelector';
import {
  findDirectProfile,
  findProfile,
  nativeModelOptions,
  preferredProfile,
  type PersonaRuntimeKind,
} from './persona-runtime-selection';

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
  const [runtimeKind, setRuntimeKind] = useState<PersonaRuntimeKind>('direct-llm');
  const [executionProfileId, setExecutionProfileId] = useState('');
  const [executionProfiles, setExecutionProfiles] = useState<ExecutionProfile[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [directCredentialId, setDirectCredentialId] = useState('');
  const [credentialModels, setCredentialModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState('');
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [credentialsLoading, setCredentialsLoading] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.');
  const [maxToolAttempts, setMaxToolAttempts] = useState<number | ''>('');
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [providerToolNames, setProviderToolNames] = useState<string[]>([]);
  const [mcpPolicy, setMcpPolicy] = useState<MCPPolicy>('allow_all');
  const [avatar, setAvatar] = useState<PersonaAvatarToken>(() => defaultAvatarFromName(''));
  const [avatarManuallySelected, setAvatarManuallySelected] = useState(false);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const initializedEditorKey = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getExecutionProfiles()
      .then((profiles) => {
        if (!cancelled) setExecutionProfiles(profiles.filter((profile) => profile.enabled));
      })
      .catch((error: unknown) => console.error('[PersonaEditorPanel] execution profile load failed', error))
      .finally(() => {
        if (!cancelled) setProfilesLoading(false);
      });
    getCredentials()
      .then((items) => {
        if (!cancelled) setCredentials(items);
      })
      .catch((error: unknown) => console.error('[PersonaEditorPanel] credential load failed', error))
      .finally(() => {
        if (!cancelled) setCredentialsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const editorKey = `${mode}:${persona?.id ?? 'new'}`;
    if (initializedEditorKey.current === editorKey) return;
    initializedEditorKey.current = editorKey;

    if (mode === 'create') {
      setName('');
      setModel('gpt-4o-mini');
      setRuntimeKind('direct-llm');
      setExecutionProfileId('');
      setDirectCredentialId('');
      setCredentialModels([]);
      setReasoningEffort('');
      setSystemPrompt('You are a helpful assistant.');
      setMaxToolAttempts('');
      setAllowedTools([]);
      setProviderToolNames([]);
      setMcpPolicy('allow_all');
      setAvatar(defaultAvatarFromName(''));
      setAvatarManuallySelected(false);
      return;
    }

    if (!persona) return;

    setName(persona.name);
    const profile = findProfile(executionProfiles, persona.executionProfileId);
    setRuntimeKind(profile?.kind ?? 'direct-llm');
    setModel(profile?.model || persona.model);
    setExecutionProfileId(profile?.id ?? persona.executionProfileId ?? '');
    setDirectCredentialId(profile?.kind === 'direct-llm' ? (profile.authProfileId ?? '') : '');
    setReasoningEffort(profile?.reasoningEffort ?? '');
    setSystemPrompt(persona.systemPrompt);
    setMaxToolAttempts(persona.maxToolAttempts ?? '');
    setAllowedTools(persona.allowedTools ?? []);
    setProviderToolNames(persona.providerToolNames ?? []);
    setMcpPolicy(persona.mcpPolicy ?? 'allow_all');
    setAvatar({
      avatarSeed: persona.avatarSeed,
      avatarVariant: persona.avatarVariant,
      avatarPaletteKey: persona.avatarPaletteKey,
      avatarIndex: persona.avatarIndex,
    });
    setAvatarManuallySelected(true);
  }, [mode, persona, executionProfiles]);

  useEffect(() => {
    if (mode !== 'edit' || !persona?.executionProfileId || executionProfiles.length === 0) return;
    const profile = findProfile(executionProfiles, persona.executionProfileId);
    if (!profile) return;
    setRuntimeKind(profile.kind);
    setModel(profile.model || persona.model);
    setExecutionProfileId(profile.id);
    setDirectCredentialId(profile.kind === 'direct-llm' ? (profile.authProfileId ?? '') : '');
    setReasoningEffort(profile.reasoningEffort ?? '');
  }, [mode, persona, executionProfiles]);

  useEffect(() => {
    if (!directCredentialId) {
      setCredentialModels([]);
      return;
    }
    let cancelled = false;
    setModelsLoading(true);
    getCredentialModels(directCredentialId)
      .then((models) => {
        if (!cancelled) setCredentialModels(models);
      })
      .catch((error: unknown) => {
        console.error('[PersonaEditorPanel] credential model load failed', error);
        if (!cancelled) setCredentialModels([]);
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [directCredentialId]);

  useEffect(() => {
    if (avatarManuallySelected || mode === 'edit') return;
    setAvatar(defaultAvatarFromName(name));
  }, [name, avatarManuallySelected, mode]);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      let resolvedExecutionProfileId: string | undefined;
      if (runtimeKind === 'direct-llm' && directCredentialId) {
        const credential = credentials.find((item) => item.id === directCredentialId);
        if (!credential) throw new Error('Selected provider connection is no longer available.');
        const existing = findDirectProfile(executionProfiles, directCredentialId, credential.provider, model.trim());
        const profile = existing ?? await resolveDirectExecutionProfile({
          credentialId: directCredentialId,
          model: model.trim(),
        });
        resolvedExecutionProfileId = profile.id;
      } else if (runtimeKind !== 'direct-llm') {
        const selected = findProfile(executionProfiles, executionProfileId);
        if (!selected || selected.kind !== runtimeKind || selected.model !== model || (selected.reasoningEffort ?? '') !== reasoningEffort) {
          const fallback = nativeModelOptions(executionProfiles, runtimeKind)
            .find((option) => option.model === model)?.profile;
          if (!fallback) throw new Error(`No enabled ${runtimeKind} profile is available for ${model}.`);
          resolvedExecutionProfileId = preferredProfile(executionProfiles, runtimeKind, fallback.model, reasoningEffort).id;
        } else {
          resolvedExecutionProfileId = selected.id;
        }
      } else {
        resolvedExecutionProfileId = executionProfileId || undefined;
      }
      const payload = {
        name: name.trim(),
        model: model.trim(),
        systemPrompt: systemPrompt.trim(),
        ...(resolvedExecutionProfileId ? { executionProfileId: resolvedExecutionProfileId } : {}),
        ...(maxToolAttempts === '' ? {} : { maxToolAttempts }),
        allowedTools,
        providerToolNames,
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

  const missingProfileBinding = Boolean(
    mode === 'edit'
      && persona?.executionProfileId
      && !profilesLoading
      && !findProfile(executionProfiles, persona.executionProfileId),
  );

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
            <PersonaRuntimeSelector
              runtimeKind={runtimeKind}
              profiles={executionProfiles}
              credentials={credentials}
              profilesLoading={profilesLoading}
              credentialsLoading={credentialsLoading}
              credentialModels={credentialModels}
              modelsLoading={modelsLoading}
              directCredentialId={directCredentialId}
              model={model}
              reasoningEffort={reasoningEffort}
              onRuntimeKindChange={(kind) => {
                setRuntimeKind(kind);
                if (kind === 'direct-llm') {
                  setExecutionProfileId('');
                  setReasoningEffort('');
                  setModel('');
                  return;
                }
                const options = nativeModelOptions(executionProfiles, kind);
                const selected = options[0]?.profile;
                if (selected) {
                  setExecutionProfileId(selected.id);
                  setModel(selected.model);
                  setReasoningEffort(selected.reasoningEffort ?? '');
                }
                setDirectCredentialId('');
              }}
              onDirectCredentialChange={(credentialId) => {
                setDirectCredentialId(credentialId);
                setExecutionProfileId('');
                const credential = credentials.find((item) => item.id === credentialId);
                if (credential?.model) setModel(credential.model);
              }}
              onDirectModelChange={(nextModel) => {
                setModel(nextModel);
                setExecutionProfileId('');
              }}
              onNativeModelChange={(nextModel) => {
                setModel(nextModel);
                if (runtimeKind === 'direct-llm') return;
                const selected = preferredProfile(executionProfiles, runtimeKind, nextModel);
                setReasoningEffort(selected.reasoningEffort ?? '');
                setExecutionProfileId(selected.id);
              }}
              onReasoningChange={(nextReasoning) => {
                setReasoningEffort(nextReasoning);
                if (runtimeKind === 'direct-llm') return;
                const selected = preferredProfile(executionProfiles, runtimeKind, model, nextReasoning);
                setExecutionProfileId(selected.id);
              }}
            />
            {missingProfileBinding && (
              <p className="text-xs text-warning md:col-span-2" data-testid="persona-missing-profile-warning">
                This persona references an unavailable execution profile. Choose an enabled profile before saving.
              </p>
            )}
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
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-base-content/45">Tool loop override</p>
              <p className="mt-1 text-xs text-base-content/45">
                Leave empty to use the system default. Persona override applies to direct chats and workflow slots without node override.
              </p>
            </div>
            <input
              data-testid="persona-max-tool-attempts-input"
              type="number"
              min={1}
              max={100}
              className="input input-bordered input-sm w-28 font-mono"
              placeholder="default"
              value={maxToolAttempts}
              onChange={(event) => {
                const value = event.target.value;
                setMaxToolAttempts(value === '' ? '' : Math.max(1, Math.min(100, parseInt(value, 10) || 1)));
              }}
            />
          </div>
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
          {runtimeKind === 'claude-agent-sdk' && (
            <div className="mt-4 border-t border-base-300 pt-4">
              <ClaudeNativeToolPicker selected={providerToolNames} onChange={setProviderToolNames} />
            </div>
          )}
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

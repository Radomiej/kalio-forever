import type { Credential, ExecutionProfile } from '@kalio/types';
import {
  formatCredentialOption,
  nativeModelOptions,
  nativeReasoningOptions,
  providerLabel,
  RUNTIME_KIND_LABELS,
  type PersonaRuntimeKind,
} from './persona-runtime-selection';

interface Props {
  runtimeKind: PersonaRuntimeKind;
  profiles: ExecutionProfile[];
  credentials: Credential[];
  profilesLoading: boolean;
  credentialsLoading: boolean;
  credentialModels: string[];
  modelsLoading: boolean;
  directCredentialId: string;
  model: string;
  reasoningEffort: string;
  onRuntimeKindChange: (kind: PersonaRuntimeKind) => void;
  onDirectCredentialChange: (credentialId: string) => void;
  onDirectModelChange: (model: string) => void;
  onNativeModelChange: (model: string) => void;
  onReasoningChange: (reasoning: string) => void;
}

export function PersonaRuntimeSelector({
  runtimeKind,
  profiles,
  credentials,
  profilesLoading,
  credentialsLoading,
  credentialModels,
  modelsLoading,
  directCredentialId,
  model,
  reasoningEffort,
  onRuntimeKindChange,
  onDirectCredentialChange,
  onDirectModelChange,
  onNativeModelChange,
  onReasoningChange,
}: Props) {
  const nativeOptions = runtimeKind === 'direct-llm' ? [] : nativeModelOptions(profiles, runtimeKind);
  const reasoningOptions = runtimeKind === 'direct-llm'
    ? []
    : nativeReasoningOptions(profiles, runtimeKind, model);
  const selectedCredential = credentials.find((credential) => credential.id === directCredentialId);
  const directModels = uniqueModels([
    ...credentialModels,
    ...(selectedCredential?.model ? [selectedCredential.model] : []),
    ...(model.trim() ? [model] : []),
  ]);
  return (
    <div className="form-control gap-2 md:col-span-2" data-testid="persona-runtime-selector">
      <label className="label py-0" htmlFor="persona-runtime-kind-select">
        <span className="label-text text-xs">Execution source</span>
      </label>
      <select
        id="persona-runtime-kind-select"
        data-testid="persona-runtime-kind-select"
        className="select select-bordered select-sm w-full"
        value={runtimeKind}
         disabled={profilesLoading}
        onChange={(event) => onRuntimeKindChange(event.target.value as PersonaRuntimeKind)}
      >
        {Object.entries(RUNTIME_KIND_LABELS).map(([kind, label]) => (
          <option key={kind} value={kind}>{label}</option>
        ))}
      </select>

      {runtimeKind === 'direct-llm' ? (
        <>
          <label className="label py-0" htmlFor="persona-direct-provider-select">
            <span className="label-text text-xs">Provider connection</span>
          </label>
          <select
            id="persona-direct-provider-select"
            data-testid="persona-direct-provider-select"
            className="select select-bordered select-sm w-full"
            value={directCredentialId}
             disabled={credentialsLoading}
            onChange={(event) => onDirectCredentialChange(event.target.value)}
          >
            <option value="">Environment fallback · active provider</option>
            {credentials.map((credential) => (
              <option key={credential.id} value={credential.id}>{formatCredentialOption(credential)}</option>
            ))}
          </select>
          <label className="label py-0" htmlFor="persona-model-input">
            <span className="label-text text-xs">Model</span>
          </label>
          {directModels.length > 0 && directCredentialId ? (
            <select
              id="persona-model-input"
              data-testid="persona-model-input"
              className="select select-bordered select-sm w-full font-mono"
              value={model}
              disabled={modelsLoading}
              onChange={(event) => onDirectModelChange(event.target.value)}
            >
              {directModels.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}
            </select>
          ) : (
            <input
              id="persona-model-input"
              data-testid="persona-model-input"
              className="input input-bordered input-sm w-full font-mono"
              placeholder="Model (e.g. gpt-4o-mini)"
              value={model}
              onChange={(event) => onDirectModelChange(event.target.value)}
            />
          )}
          <p className="text-xs text-base-content/45">
            {selectedCredential
              ? `${providerLabel(selectedCredential.provider)} is selected. Model discovery is scoped to this connection.`
              : 'Uses the active provider from Settings. Choose a saved connection to bind this persona to one provider.'}
          </p>
        </>
      ) : runtimeKind === 'devin-api' ? (
        <p className="text-xs text-base-content/55 md:col-span-2" data-testid="persona-devin-runtime-summary">
          Devin Cloud manages the agent mode remotely. Model and reasoning controls are not exposed by this integration.
        </p>
      ) : (
        <>
          <label className="label py-0" htmlFor="persona-model-input">
            <span className="label-text text-xs">Model</span>
          </label>
          <select
            id="persona-model-input"
            data-testid="persona-model-input"
            className="select select-bordered select-sm w-full font-mono"
            value={model}
            disabled={profilesLoading || nativeOptions.length === 0}
            onChange={(event) => onNativeModelChange(event.target.value)}
          >
            {nativeOptions.length === 0 ? (
              <option value="">No enabled model profiles</option>
            ) : nativeOptions.map((option) => (
              <option key={option.model} value={option.model}>{option.model}</option>
            ))}
          </select>
          <label className="label py-0" htmlFor="persona-reasoning-select">
            <span className="label-text text-xs">Reasoning level</span>
          </label>
          <select
            id="persona-reasoning-select"
            data-testid="persona-reasoning-select"
            className="select select-bordered select-sm w-full font-mono"
            value={reasoningEffort}
            disabled={profilesLoading || reasoningOptions.length === 0}
            onChange={(event) => onReasoningChange(event.target.value)}
          >
            {reasoningOptions.length === 0
              ? <option value="">default</option>
              : reasoningOptions.map((effort) => <option key={effort} value={effort}>{effort || 'default'}</option>)}
          </select>
          <p className="text-xs text-base-content/45">
            Model and reasoning are backed by an enabled {RUNTIME_KIND_LABELS[runtimeKind]} execution profile.
          </p>
        </>
      )}
    </div>
  );
}

function uniqueModels(models: string[]): string[] {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

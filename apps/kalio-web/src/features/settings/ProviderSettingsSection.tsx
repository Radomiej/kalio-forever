import { AlertCircle, Loader2, Plus, Zap } from 'lucide-react';
import type { Credential } from '@kalio/types';
import type { AddForm, ProviderTestState } from './llm-panel.types';
import { ProviderCard } from './ProviderCard';
import { ALL_PROVIDER_TYPES, PROVIDER_LABELS } from './llm-provider-settings';

interface ProviderSettingsSectionProps {
  credentials: Credential[];
  activeId: string | null;
  syncing: string | null;
  loading: boolean;
  showForm: boolean;
  form: AddForm;
  allowsKeylessAuth: boolean;
  normalizedApiKey?: string;
  testState: ProviderTestState;
  testError: string | null;
  emptyStateMessage: string;
  onActivate: (credentialId: string) => void;
  onRemove: (credentialId: string) => void;
  onShowAdd: () => void;
  onCancelAdd: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onProviderTypeChange: (provider: string) => void;
  onNameChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onTest: () => void;
}

export function ProviderSettingsSection({
  credentials,
  activeId,
  syncing,
  loading,
  showForm,
  form,
  allowsKeylessAuth,
  normalizedApiKey,
  testState,
  testError,
  emptyStateMessage,
  onActivate,
  onRemove,
  onShowAdd,
  onCancelAdd,
  onSubmit,
  onProviderTypeChange,
  onNameChange,
  onApiKeyChange,
  onBaseUrlChange,
  onModelChange,
  onTest,
}: ProviderSettingsSectionProps) {
  return (
    <section className="flex flex-col gap-4 border border-base-300 rounded-xl p-4 bg-base-200/10">
      <div>
        <h3 className="text-sm font-semibold mb-1">Providers</h3>
        <p className="text-xs text-base-content/60">
          Saved provider credentials. Activate one here to make it the active runtime provider.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-base-content/50 py-4">
          <Loader2 size={14} className="animate-spin" /> Loading credentials...
        </div>
      ) : (
        <>
          {credentials.length > 0 ? (
            <div className="flex flex-col gap-2">
              {credentials.map((credential) => (
                <ProviderCard
                  key={credential.id}
                  credential={credential}
                  isActive={credential.id === activeId}
                  isSyncing={syncing === credential.id}
                  onActivate={onActivate}
                  onRemove={onRemove}
                />
              ))}
            </div>
          ) : (
            <div className="text-sm text-base-content/50 italic text-center py-6">
              {emptyStateMessage}
            </div>
          )}

          {showForm ? (
            <form
              className="flex flex-col gap-3 border border-base-300 rounded-lg p-4 bg-base-200/40"
              onSubmit={onSubmit}
              data-testid="add-provider-form"
            >
              <h4 className="text-sm font-semibold">Add Provider</h4>

              <label className="form-control gap-1">
                <span className="text-xs text-base-content/60">Name <span className="text-base-content/40">(optional - defaults to provider)</span></span>
                <input
                  className="input input-bordered input-sm"
                  placeholder="e.g. My OpenAI Key"
                  value={form.name}
                  onChange={(event) => onNameChange(event.target.value)}
                  required
                />
              </label>

              <div className="flex gap-2 flex-wrap">
                {ALL_PROVIDER_TYPES.map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    className={`btn btn-xs ${form.provider === provider ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
                    onClick={() => onProviderTypeChange(provider)}
                  >
                    {PROVIDER_LABELS[provider]}
                  </button>
                ))}
              </div>

              <label className="form-control gap-1">
                <span className="text-xs text-base-content/60">
                  API Key {allowsKeylessAuth ? <span className="text-base-content/40">(optional for local providers)</span> : null}
                </span>
                <input
                  className="input input-bordered input-sm font-mono"
                  type="password"
                  placeholder={allowsKeylessAuth ? 'Optional for local endpoint' : 'sk-...'}
                  value={form.apiKey}
                  onChange={(event) => onApiKeyChange(event.target.value)}
                  data-testid="add-provider-apikey"
                  required={!allowsKeylessAuth}
                />
              </label>

              <label className="form-control gap-1">
                <span className="text-xs text-base-content/60">Base URL</span>
                <input
                  className="input input-bordered input-sm font-mono"
                  value={form.baseUrl}
                  onChange={(event) => onBaseUrlChange(event.target.value)}
                />
              </label>

              <label className="form-control gap-1">
                <span className="text-xs text-base-content/60">Model</span>
                <input
                  className="input input-bordered input-sm font-mono"
                  value={form.model}
                  onChange={(event) => onModelChange(event.target.value)}
                  data-testid="add-provider-model"
                />
              </label>

              {testError && (
                <div className={`text-xs flex gap-1 items-center ${testState === 'ok' ? 'text-success' : 'text-error'}`}>
                  <AlertCircle size={12} /> {testError}
                </div>
              )}

              <div className="flex gap-2 items-center justify-between">
                <button
                  type="button"
                  className={`btn btn-ghost btn-xs gap-1 ${testState === 'ok' ? 'text-success' : testState === 'error' ? 'text-error' : 'text-base-content/60'}`}
                  onClick={onTest}
                  disabled={(!allowsKeylessAuth && !normalizedApiKey) || testState === 'testing'}
                  data-testid="add-provider-test"
                >
                  {testState === 'testing' ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                  {testState === 'ok' ? 'Connected!' : testState === 'error' ? 'Failed' : 'Test'}
                </button>

                <div className="flex gap-2">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={onCancelAdd}>Cancel</button>
                  <button type="submit" className="btn btn-primary btn-sm" data-testid="add-provider-submit">Add Provider</button>
                </div>
              </div>
            </form>
          ) : (
            <button
              className="btn btn-ghost btn-sm gap-2 self-start text-sky-400 hover:text-sky-300"
              onClick={onShowAdd}
              data-testid="add-provider-btn"
            >
              <Plus size={14} /> Add Provider
            </button>
          )}
        </>
      )}
    </section>
  );
}
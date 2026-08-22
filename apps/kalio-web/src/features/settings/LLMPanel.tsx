import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Credential, CreateCredentialDto } from '@kalio/types';
import { useSettingsStore } from './settingsStore';
import { LLMPanelErrorAlert, LLMPanelHeader } from './LLMPanel.Chrome';
import { ProviderSettingsSection } from './ProviderSettingsSection';
import { LLMProviderHealthCard } from './LLMPanel.ProviderHealth';
import { LLMRuntimeSettingsSection } from './LLMPanel.RuntimeSettings';
import { buildLLMPanelDerivedState } from './LLMPanel.derived';
import {
  isLocalLlmProviderConfig,
  PROVIDER_BASE_URLS,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_LABELS,
} from './llm-provider-settings';
import type {
  AddForm,
  LLMConfigWithSource,
  ProviderTestState,
} from './llm-panel.types';
import {
  apiFetch,
  buildActiveRuntimeConfig,
  emptyForm,
  normalizeOptionalText,
  normalizeProviderName,
} from './llm-panel.utils';
import {
  DEFAULT_TOOL_TIMEOUT_SETTINGS,
  normalizeToolTimeout,
  type ToolTimeoutKey,
  type ToolTimeoutSettings,
} from './tool-timeout-settings';

type MaxToolAttemptsSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const MIN_MAX_TOOL_ATTEMPTS = 1;
const MAX_MAX_TOOL_ATTEMPTS = 100;
const MAX_TOOL_ATTEMPTS_SAVED_RESET_MS = 2_000;

function normalizeMaxToolAttempts(size: number): number {
  return Math.max(MIN_MAX_TOOL_ATTEMPTS, Math.min(MAX_MAX_TOOL_ATTEMPTS, Math.round(size)));
}

export function LLMPanel({ mode = 'full' }: { mode?: 'full' | 'providers' | 'runtime' } = {}) {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [contextWindow, setContextWindow] = useState(32000);
  const [maxToolAttempts, setMaxToolAttempts] = useState(30);
  const [toolTimeouts, setToolTimeouts] = useState<ToolTimeoutSettings>(DEFAULT_TOOL_TIMEOUT_SETTINGS);
  const [runtimeConfig, setRuntimeConfig] = useState<LLMConfigWithSource | null>(null);
  const [lastEnvRuntimeConfig, setLastEnvRuntimeConfig] = useState<LLMConfigWithSource | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AddForm>(emptyForm());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [testState, setTestState] = useState<ProviderTestState>('idle');
  const [testError, setTestError] = useState<string | null>(null);
  const [maxToolAttemptsSaveStatus, setMaxToolAttemptsSaveStatus] = useState<MaxToolAttemptsSaveStatus>('idle');
  const persistedContextWindow = useRef(32000);
  const contextWindowSaveInFlight = useRef(false);
  const persistedMaxToolAttempts = useRef(30);
  const maxToolAttemptsSaveInFlight = useRef(false);
  const pendingMaxToolAttemptsSave = useRef<number | null>(null);
  const maxToolAttemptsSavedResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistedToolTimeouts = useRef<ToolTimeoutSettings>({ ...DEFAULT_TOOL_TIMEOUT_SETTINGS });
  const pendingToolTimeoutCommits = useRef<Partial<Record<ToolTimeoutKey, boolean>>>({});

  const setBackendConfig = useSettingsStore((s) => s.setBackendConfig);
  const requestSettingsTab = useSettingsStore((s) => s.requestSettingsTab);
  const requestRuntimeModelFocus = useSettingsStore((s) => s.requestRuntimeModelFocus);
  const runtimeModelFocusRequest = useSettingsStore((s) => s.runtimeModelFocusRequest);
  const normalizedApiKey = normalizeOptionalText(form.apiKey);
  const normalizedBaseUrl = normalizeOptionalText(form.baseUrl);
  const normalizedModel = normalizeOptionalText(form.model);
  const allowsKeylessAuth = isLocalLlmProviderConfig(form.provider, normalizedBaseUrl);
  const applyRuntimeConfig = useCallback((config: LLMConfigWithSource) => {
    setRuntimeConfig(config);
    setBackendConfig(config);
    setMaxToolAttempts(config.maxToolAttempts ?? 30);
    if (config.source === 'env') {
      setLastEnvRuntimeConfig(config);
    }
  }, [setBackendConfig]);
  const activeCredential = useMemo(
    () => credentials.find((credential) => credential.id === activeId) ?? null,
    [activeId, credentials],
  );
  const activeRuntimeConfig = useMemo(
    () => buildActiveRuntimeConfig(activeCredential, runtimeConfig),
    [activeCredential, runtimeConfig],
  );
  const envRuntimeConfig = runtimeConfig?.source === 'env' ? runtimeConfig : lastEnvRuntimeConfig;
  const derived = buildLLMPanelDerivedState({
    activeRuntimeConfig,
    runtimeConfig,
    lastEnvRuntimeConfig,
    showForm,
    allowsKeylessAuth,
  });
  const reportUpdateError = useCallback((message: string, err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`[LLMPanel] ${message}`, error);
    setError(message);
  }, []);

  const refreshBackendConfig = useCallback(async (expectedSource?: 'db' | 'env') => {
    try {
      const cfg = await apiFetch<LLMConfigWithSource>('/llm/config');

      if (expectedSource === 'env' && cfg.source !== 'env' && lastEnvRuntimeConfig) {
        applyRuntimeConfig(lastEnvRuntimeConfig);
        return;
      }

      applyRuntimeConfig(cfg);
    } catch (err) {
      console.error(
        '[LLMPanel] Failed to refresh backend config',
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }, [applyRuntimeConfig, lastEnvRuntimeConfig]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [creds, active, cw, toolTimeouts, llmCfg] = await Promise.all([
        apiFetch<Credential[]>('/credentials'),
        apiFetch<{ credentialId: string | null }>('/credentials/active'),
        apiFetch<{ size: number }>('/credentials/settings/context-window'),
        apiFetch<ToolTimeoutSettings>('/credentials/settings/tool-timeouts'),
        apiFetch<LLMConfigWithSource>('/llm/config'),
      ]);
      const normalizedToolTimeouts = { ...DEFAULT_TOOL_TIMEOUT_SETTINGS, ...toolTimeouts };
      setCredentials(creds);
      setActiveId(active.credentialId);
      setContextWindow(cw.size);
      persistedContextWindow.current = cw.size;
      setToolTimeouts(normalizedToolTimeouts);
      persistedToolTimeouts.current = normalizedToolTimeouts;
      applyRuntimeConfig(llmCfg);
      persistedMaxToolAttempts.current = llmCfg.maxToolAttempts ?? 30;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [applyRuntimeConfig]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => () => {
    if (maxToolAttemptsSavedResetTimer.current) {
      clearTimeout(maxToolAttemptsSavedResetTimer.current);
    }
  }, []);

  const handleProviderChange = (provider: string) => {
    setForm((f) => ({
      ...f,
      provider,
      baseUrl: PROVIDER_BASE_URLS[provider] ?? '',
      model: PROVIDER_DEFAULT_MODELS[provider] ?? '',
      name: f.nameEdited ? f.name : (PROVIDER_LABELS[provider] || ''),
    }));
    setTestState('idle');
    setTestError(null);
  };

  const handleTest = async () => {
    setTestState('testing');
    setTestError(null);
    try {
      const result = await apiFetch<{ ok: boolean; latencyMs: number; error?: string }>('/credentials/test', {
        method: 'POST',
        body: JSON.stringify({
          provider: form.provider,
          apiKey: normalizedApiKey ?? '',
          model: normalizedModel ?? PROVIDER_DEFAULT_MODELS[form.provider] ?? '',
          baseUrl: normalizedBaseUrl,
        }),
      });

      if (!result.ok) {
        throw new Error(result.error ?? 'Provider test failed');
      }

      setTestState('ok');
      setTestError(`Connection verified in ${result.latencyMs}ms`);
    } catch (e) {
      setTestState('error');
      setTestError(e instanceof Error ? e.message : 'Network error');
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const dto: CreateCredentialDto = {
        name: normalizeProviderName(form.name, form.provider),
        provider: form.provider,
        apiKey: normalizedApiKey,
        baseUrl: normalizedBaseUrl,
        model: normalizedModel,
      };
      const created = await apiFetch<Credential>('/credentials', {
        method: 'POST',
        body: JSON.stringify(dto),
      });
      setCredentials((prev) => [...prev, created]);
      setForm(emptyForm());
      setShowForm(false);
      setTestState('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    }
  };

  const handleRuntimeConfigChange = useCallback((updated: LLMConfigWithSource) => {
    applyRuntimeConfig(updated);

    if (activeId) {
      setCredentials((current) => current.map((credential) => (
        credential.id === activeId
          ? {
              ...credential,
              model: updated.model,
              baseUrl: updated.baseUrl || undefined,
            }
          : credential
      )));
    }
  }, [activeId, applyRuntimeConfig]);

  const handleCancelAdd = useCallback(() => {
    setShowForm(false);
    setTestState('idle');
    setTestError(null);
  }, []);

  const handleEditActiveModel = useCallback(() => {
    requestSettingsTab('runtime');
    requestRuntimeModelFocus();
  }, [requestRuntimeModelFocus, requestSettingsTab]);

  const handleActivate = async (credentialId: string) => {
    setSyncing(credentialId);
    try {
      await apiFetch(`/credentials/active/${credentialId}`, { method: 'PUT' });
      setActiveId(credentialId);
      await refreshBackendConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate');
    } finally {
      setSyncing(null);
    }
  };

  const handleUseEnvFallback = useCallback(async () => {
    setSyncing('__env__');
    try {
      await apiFetch('/credentials/active', { method: 'DELETE' });
      setActiveId(null);
      if (lastEnvRuntimeConfig) {
        applyRuntimeConfig(lastEnvRuntimeConfig);
      }
      await refreshBackendConfig('env');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch to env fallback');
    } finally {
      setSyncing(null);
    }
  }, [applyRuntimeConfig, lastEnvRuntimeConfig, refreshBackendConfig]);

  const handleRemove = async (credentialId: string) => {
    setSyncing(credentialId);
    try {
      await apiFetch(`/credentials/${credentialId}`, { method: 'DELETE' });
      setCredentials((prev) => prev.filter((c) => c.id !== credentialId));
      if (activeId === credentialId) {
        setActiveId(null);
        if (lastEnvRuntimeConfig) {
          applyRuntimeConfig(lastEnvRuntimeConfig);
        }
        await refreshBackendConfig('env');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove');
    } finally {
      setSyncing(null);
    }
  };

  const handleContextWindowInputChange = (size: number) => {
    if (!Number.isFinite(size)) return;
    setContextWindow(Math.max(4000, Math.min(1_000_000, Math.round(size))));
  };

  const handleContextWindowCommit = async (size: number) => {
    if (!Number.isFinite(size) || contextWindowSaveInFlight.current) return;

    const normalized = Math.max(4000, Math.min(1_000_000, Math.round(size)));
    const previousValue = persistedContextWindow.current;
    if (normalized === previousValue) return;

    contextWindowSaveInFlight.current = true;
    try {
      await apiFetch('/credentials/settings/context-window', {
        method: 'PUT',
        body: JSON.stringify({ size: normalized }),
      });
      persistedContextWindow.current = normalized;
      await refreshBackendConfig();
    } catch (err) {
      reportUpdateError('Failed to update context window', err);
      persistedContextWindow.current = previousValue;
      setContextWindow(previousValue);
    } finally {
      contextWindowSaveInFlight.current = false;
    }
  };

  const handleMaxToolAttemptsCommit = async (size: number) => {
    if (!Number.isFinite(size)) return;

    const normalized = normalizeMaxToolAttempts(size);
    if (maxToolAttemptsSaveInFlight.current) {
      pendingMaxToolAttemptsSave.current = normalized;
      setMaxToolAttemptsSaveStatus('saving');
      return;
    }

    const previousValue = persistedMaxToolAttempts.current;
    if (normalized === previousValue) {
      setMaxToolAttemptsSaveStatus('saved');
      if (maxToolAttemptsSavedResetTimer.current) {
        clearTimeout(maxToolAttemptsSavedResetTimer.current);
      }
      maxToolAttemptsSavedResetTimer.current = setTimeout(() => {
        setMaxToolAttemptsSaveStatus('idle');
      }, MAX_TOOL_ATTEMPTS_SAVED_RESET_MS);
      return;
    }

    maxToolAttemptsSaveInFlight.current = true;
    setMaxToolAttemptsSaveStatus('saving');
    if (maxToolAttemptsSavedResetTimer.current) {
      clearTimeout(maxToolAttemptsSavedResetTimer.current);
      maxToolAttemptsSavedResetTimer.current = null;
    }
    try {
      await apiFetch('/credentials/settings/max-tool-attempts', {
        method: 'PUT',
        body: JSON.stringify({ size: normalized }),
      });
      persistedMaxToolAttempts.current = normalized;
      await refreshBackendConfig();
      setMaxToolAttempts(normalized);
      setMaxToolAttemptsSaveStatus('saved');
      maxToolAttemptsSavedResetTimer.current = setTimeout(() => {
        setMaxToolAttemptsSaveStatus('idle');
      }, MAX_TOOL_ATTEMPTS_SAVED_RESET_MS);
    } catch (err) {
      reportUpdateError('Failed to update max tool attempts', err);
      persistedMaxToolAttempts.current = previousValue;
      setMaxToolAttempts(previousValue);
      setMaxToolAttemptsSaveStatus('error');
    } finally {
      maxToolAttemptsSaveInFlight.current = false;
      const pendingValue = pendingMaxToolAttemptsSave.current;
      pendingMaxToolAttemptsSave.current = null;
      if (pendingValue !== null && pendingValue !== persistedMaxToolAttempts.current) {
        void handleMaxToolAttemptsCommit(pendingValue);
      }
    }
  };

  const handleMaxToolAttemptsInputChange = (size: number) => {
    if (!Number.isFinite(size)) return;
    const normalized = normalizeMaxToolAttempts(size);
    setMaxToolAttempts(normalized);
    void handleMaxToolAttemptsCommit(normalized);
  };

  const handleToolTimeoutInputChange = (key: ToolTimeoutKey, value: number) => {
    const normalized = normalizeToolTimeout(key, value);
    setToolTimeouts((current) => ({ ...current, [key]: normalized }));
  };

  const commitToolTimeoutChange = async (key: ToolTimeoutKey, value: number) => {
    const normalized = normalizeToolTimeout(key, value);
    const previousValue = persistedToolTimeouts.current[key];
    if (normalized === previousValue || pendingToolTimeoutCommits.current[key]) return;

    pendingToolTimeoutCommits.current[key] = true;
    try {
      await apiFetch('/credentials/settings/tool-timeouts', {
        method: 'PUT',
        body: JSON.stringify({ [key]: normalized }),
      });
      persistedToolTimeouts.current = { ...persistedToolTimeouts.current, [key]: normalized };
    } catch (err) {
      reportUpdateError('Failed to update tool timeout', err);
      setToolTimeouts((current) => ({ ...current, [key]: previousValue }));
    } finally {
      delete pendingToolTimeoutCommits.current[key];
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="llm-panel">
      <LLMPanelHeader
        title={mode === 'runtime' ? 'Runtime Settings' : 'LLM Settings'}
        description={
          mode === 'runtime'
            ? 'Adjust the active provider model and turn-level limits.'
            : mode === 'providers'
              ? 'Configure provider credentials and connection health. Active provider selection is stored in the database, and API keys remain write-only.'
              : 'Configure model behavior, runtime limits, and provider credentials. Active provider selection is stored in the database, and API keys remain write-only.'
        }
      />
      {error && <LLMPanelErrorAlert error={error} onClear={() => setError(null)} />}

      {mode !== 'runtime' ? (
        <LLMProviderHealthCard
          activeProviderLabel={derived.activeProviderLabel}
          activeProviderModel={derived.activeProviderModel}
          activeProviderSource={derived.activeProviderSource}
          testState={testState}
          testError={testError}
          showWindowsLocalHint={derived.showWindowsLocalHint}
        />
      ) : null}

      {mode !== 'runtime' ? (
        <ProviderSettingsSection
          credentials={credentials}
          activeId={activeId}
          syncing={syncing}
          loading={loading}
          showEnvFallback={runtimeConfig !== null}
          envFallbackActive={!activeId && runtimeConfig?.source === 'env'}
          envFallbackProviderId={derived.envFallbackProviderId}
          envFallbackProviderLabel={derived.envFallbackProviderLabel}
          envFallbackModel={derived.envFallbackModel}
          showForm={showForm}
          form={form}
          allowsKeylessAuth={allowsKeylessAuth}
          normalizedApiKey={normalizedApiKey}
          testState={testState}
          testError={testError}
          emptyStateMessage={derived.providerEmptyStateMessage}
          onActivate={(credentialId) => void handleActivate(credentialId)}
          onRemove={(credentialId) => void handleRemove(credentialId)}
          onEdit={() => void handleEditActiveModel()}
          onUseEnvFallback={() => void handleUseEnvFallback()}
          onShowAdd={() => setShowForm(true)}
          onCancelAdd={handleCancelAdd}
          onSubmit={(event) => void handleAdd(event)}
          onProviderTypeChange={handleProviderChange}
          onNameChange={(value) => setForm((current) => ({ ...current, name: value, nameEdited: true }))}
          onApiKeyChange={(value) => setForm((current) => ({ ...current, apiKey: value }))}
          onBaseUrlChange={(value) => setForm((current) => ({ ...current, baseUrl: value }))}
          onModelChange={(value) => setForm((current) => ({ ...current, model: value }))}
          onTest={() => void handleTest()}
        />
      ) : null}

      {mode !== 'providers' ? (
        <LLMRuntimeSettingsSection
          activeRuntimeConfig={activeRuntimeConfig}
          providers={credentials}
          activeProviderId={activeId}
          envFallback={envRuntimeConfig ? {
            provider: envRuntimeConfig.provider,
            label: PROVIDER_LABELS[envRuntimeConfig.provider] ?? envRuntimeConfig.provider,
            model: envRuntimeConfig.model,
          } : null}
          providerSyncing={syncing !== null}
          contextWindow={contextWindow}
          maxToolAttempts={maxToolAttempts}
          maxToolAttemptsSaveStatus={maxToolAttemptsSaveStatus}
          toolTimeouts={toolTimeouts}
          focusModelInputSignal={runtimeModelFocusRequest}
          onRuntimeConfigChange={handleRuntimeConfigChange}
          onActivateProvider={(credentialId) => void handleActivate(credentialId)}
          onUseEnvFallback={() => void handleUseEnvFallback()}
          onContextWindowInputChange={handleContextWindowInputChange}
          onContextWindowCommit={(size) => void handleContextWindowCommit(size)}
          onMaxToolAttemptsInputChange={handleMaxToolAttemptsInputChange}
          onMaxToolAttemptsCommit={(size) => void handleMaxToolAttemptsCommit(size)}
          onToolTimeoutInputChange={handleToolTimeoutInputChange}
          onToolTimeoutCommit={(key, value) => void commitToolTimeoutChange(key, value)}
        />
      ) : null}
    </div>
  );
}

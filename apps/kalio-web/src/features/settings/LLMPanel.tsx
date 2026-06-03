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
export function LLMPanel() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [contextWindow, setContextWindow] = useState(32000);
  const [maxToolAttempts, setMaxToolAttempts] = useState(8);
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
  const persistedContextWindow = useRef(32000);
  const persistedMaxToolAttempts = useRef(8);
  const persistedToolTimeouts = useRef<ToolTimeoutSettings>({ ...DEFAULT_TOOL_TIMEOUT_SETTINGS });

  const setBackendConfig = useSettingsStore((s) => s.setBackendConfig);
  const normalizedApiKey = normalizeOptionalText(form.apiKey);
  const normalizedBaseUrl = normalizeOptionalText(form.baseUrl);
  const normalizedModel = normalizeOptionalText(form.model);
  const allowsKeylessAuth = isLocalLlmProviderConfig(form.provider, normalizedBaseUrl);
  const applyRuntimeConfig = useCallback((config: LLMConfigWithSource) => {
    setRuntimeConfig(config);
    setBackendConfig(config);
    setMaxToolAttempts(config.maxToolAttempts ?? 8);
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
      setCredentials(creds);
      setActiveId(active.credentialId);
      setContextWindow(cw.size);
      persistedContextWindow.current = cw.size;
      setToolTimeouts(toolTimeouts);
      persistedToolTimeouts.current = toolTimeouts;
      applyRuntimeConfig(llmCfg);
      persistedMaxToolAttempts.current = llmCfg.maxToolAttempts ?? 8;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [applyRuntimeConfig]);

  useEffect(() => { void load(); }, [load]);

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

  const handleContextWindowChange = async (size: number) => {
    const previousValue = persistedContextWindow.current;
    setContextWindow(size);
    try {
      await apiFetch('/credentials/settings/context-window', {
        method: 'PUT',
        body: JSON.stringify({ size }),
      });
      persistedContextWindow.current = size;
      await refreshBackendConfig();
    } catch (err) {
      reportUpdateError('Failed to update context window', err);
      setContextWindow(previousValue);
    }
  };

  const handleMaxToolAttemptsChange = async (size: number) => {
    const normalized = Math.max(1, Math.min(100, Math.round(size)));
    const previousValue = persistedMaxToolAttempts.current;
    setMaxToolAttempts(normalized);
    try {
      await apiFetch('/credentials/settings/max-tool-attempts', {
        method: 'PUT',
        body: JSON.stringify({ size: normalized }),
      });
      persistedMaxToolAttempts.current = normalized;
      await refreshBackendConfig();
    } catch (err) {
      reportUpdateError('Failed to update max tool attempts', err);
      setMaxToolAttempts(previousValue);
    }
  };

  const handleToolTimeoutInputChange = (key: ToolTimeoutKey, value: number) => {
    const normalized = normalizeToolTimeout(key, value);
    setToolTimeouts((current) => ({ ...current, [key]: normalized }));
  };

  const commitToolTimeoutChange = async (key: ToolTimeoutKey, value: number) => {
    const normalized = normalizeToolTimeout(key, value);
    const previousValue = persistedToolTimeouts.current[key];
    if (normalized === previousValue) return;

    try {
      await apiFetch('/credentials/settings/tool-timeouts', {
        method: 'PUT',
        body: JSON.stringify({ [key]: normalized }),
      });
      persistedToolTimeouts.current = { ...persistedToolTimeouts.current, [key]: normalized };
    } catch (err) {
      reportUpdateError('Failed to update tool timeout', err);
      setToolTimeouts((current) => ({ ...current, [key]: previousValue }));
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="llm-panel">
      <LLMPanelHeader />
      {error && <LLMPanelErrorAlert error={error} onClear={() => setError(null)} />}

      <LLMProviderHealthCard
        activeProviderLabel={derived.activeProviderLabel}
        activeProviderModel={derived.activeProviderModel}
        activeProviderSource={derived.activeProviderSource}
        testState={testState}
        testError={testError}
        showWindowsLocalHint={derived.showWindowsLocalHint}
      />

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

      <LLMRuntimeSettingsSection
        activeRuntimeConfig={activeRuntimeConfig}
        contextWindow={contextWindow}
        maxToolAttempts={maxToolAttempts}
        toolTimeouts={toolTimeouts}
        onRuntimeConfigChange={handleRuntimeConfigChange}
        onContextWindowChange={handleContextWindowChange}
        onMaxToolAttemptsChange={handleMaxToolAttemptsChange}
        onToolTimeoutInputChange={handleToolTimeoutInputChange}
        onToolTimeoutCommit={(key, value) => void commitToolTimeoutChange(key, value)}
      />
    </div>
  );
}

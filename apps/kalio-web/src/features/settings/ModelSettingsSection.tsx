import { useState, useEffect, useCallback } from 'react';
import { Loader2, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { ModelCombobox } from './ModelCombobox';
import type { ActiveRuntimeConfig, LLMConfigWithSource } from './llm-panel.types';

interface Props {
  activeRuntimeConfig: ActiveRuntimeConfig | null;
  onRuntimeConfigChange: (updated: LLMConfigWithSource) => void;
}

interface GenSettings {
  temperature: number;
  maxTokens: number;
}

const DEFAULT_GEN_SETTINGS: GenSettings = { temperature: 0.7, maxTokens: 4096 };

function parseFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sanitizeGenSettings(value: unknown): GenSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_GEN_SETTINGS;
  }

  const raw = value as Record<string, unknown>;
  return {
    temperature: parseFiniteNumber(raw['temperature']) ?? DEFAULT_GEN_SETTINGS.temperature,
    maxTokens: parseFiniteNumber(raw['maxTokens']) ?? DEFAULT_GEN_SETTINGS.maxTokens,
  };
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const method = opts?.method?.toUpperCase() ?? 'GET';
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    cache: method === 'GET' ? 'no-store' : undefined,
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function ModelSettingsSection({ activeRuntimeConfig, onRuntimeConfigChange }: Props) {
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>(activeRuntimeConfig?.model ?? '');
  const [modelSaving, setModelSaving] = useState(false);
  const [modelSaved, setModelSaved] = useState(false);

  const [genSettings, setGenSettings] = useState<GenSettings>(DEFAULT_GEN_SETTINGS);
  const [genLoading, setGenLoading] = useState(true);
  const [genSaving, setGenSaving] = useState(false);
  const [genSaved, setGenSaved] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Keep the combobox in sync with the active runtime provider.
  useEffect(() => {
    setSelectedModel(activeRuntimeConfig?.model ?? '');
  }, [activeRuntimeConfig?.credentialId, activeRuntimeConfig?.model, activeRuntimeConfig?.source]);

  useEffect(() => {
    setModelSaved(false);
  }, [activeRuntimeConfig?.credentialId, activeRuntimeConfig?.source]);

  // Load generation settings once
  useEffect(() => {
    setGenLoading(true);
    apiFetch<GenSettings>('/credentials/settings/generation')
      .then((s) => { setGenSettings(sanitizeGenSettings(s)); })
      .catch((err: unknown) => {
        console.error(
          '[ModelSettingsSection] Failed to load generation settings',
          err instanceof Error ? err : new Error(String(err)),
        );
        setGenSettings(DEFAULT_GEN_SETTINGS);
      })
      .finally(() => setGenLoading(false));
  }, []);

  const fetchModels = useCallback(async () => {
    if (!activeRuntimeConfig) return;
    setModelsLoading(true);
    setModelsError(null);
    try {
      const { models: list } = await apiFetch<{ models: string[] }>('/llm/active/models');
      setModels(list);
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : 'Failed to load models');
    } finally {
      setModelsLoading(false);
    }
  }, [activeRuntimeConfig?.credentialId, activeRuntimeConfig?.source]);

  useEffect(() => {
    void fetchModels();
  }, [fetchModels]);

  const handleModelSave = async () => {
    if (!activeRuntimeConfig || !selectedModel) return;
    setModelSaving(true);
    setModelsError(null);
    try {
      const updated = await apiFetch<LLMConfigWithSource>('/llm/active/model', {
        method: 'PUT',
        body: JSON.stringify({ model: selectedModel }),
      });
      onRuntimeConfigChange(updated);
      setModelSaved(true);
      setTimeout(() => setModelSaved(false), 2000);
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : 'Failed to save model');
    } finally {
      setModelSaving(false);
    }
  };

  const handleGenSave = async () => {
    setGenSaving(true);
    setGenError(null);
    try {
      await apiFetch('/credentials/settings/generation', {
        method: 'PUT',
        body: JSON.stringify(genSettings),
      });
      setGenSaved(true);
      setTimeout(() => setGenSaved(false), 2000);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setGenSaving(false);
    }
  };

  const handleTemperatureInput = (event: React.FormEvent<HTMLInputElement>) => {
    const next = Number.parseFloat(event.currentTarget.value);
    if (!Number.isFinite(next)) {
      return;
    }
    setGenSettings((g) => ({ ...g, temperature: next }));
  };

  const handleMaxTokensInput = (event: React.FormEvent<HTMLInputElement>) => {
    const next = Number.parseInt(event.currentTarget.value, 10);
    if (!Number.isFinite(next)) {
      return;
    }
    setGenSettings((g) => ({ ...g, maxTokens: next }));
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-sm font-semibold mb-1">Active Provider</h3>
        {!activeRuntimeConfig ? (
          <p className="text-xs text-base-content/50 italic">
            Select or configure an active provider before changing its model.
          </p>
        ) : (
          <div className="rounded-lg border border-base-300 bg-base-200/30 p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="badge badge-sm badge-outline font-mono">{activeRuntimeConfig.provider}</span>
              <span className="text-sm font-medium text-base-content">{activeRuntimeConfig.displayName}</span>
              <span className="badge badge-ghost badge-xs ml-auto">
                {activeRuntimeConfig.source === 'db' ? 'saved provider' : 'env fallback'}
              </span>
            </div>
            <div className="text-xs text-base-content/60 flex flex-col gap-1">
              <div>Current model: <span className="font-mono text-base-content/80">{activeRuntimeConfig.model || 'not set'}</span></div>
              {activeRuntimeConfig.baseUrl ? (
                <div>Base URL: <span className="font-mono text-base-content/80">{activeRuntimeConfig.baseUrl}</span></div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-1">Active Model</h3>
        {!activeRuntimeConfig ? (
          <p className="text-xs text-base-content/50 italic">
            No active provider configured yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-base-content/60">
              Select the runtime model used for new turns.
            </p>

            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <ModelCombobox
                  value={selectedModel}
                  options={models}
                  onChange={(v) => { setSelectedModel(v); setModelSaved(false); }}
                  loading={modelsLoading}
                  placeholder="e.g. gpt-4o-mini"
                  data-testid="model-selector"
                />
                {modelsError && (
                  <p className="text-xs text-error mt-1 flex items-center gap-1">
                    <AlertCircle size={11} /> {modelsError}
                  </p>
                )}
              </div>

              <button
                className="btn btn-xs btn-ghost text-base-content/50"
                onClick={() => void fetchModels()}
                disabled={modelsLoading}
                title="Refresh model list"
              >
                <RefreshCw size={12} className={modelsLoading ? 'animate-spin' : ''} />
              </button>

              <button
                className={`btn btn-sm gap-1 ${modelSaved ? 'btn-success' : 'btn-primary'}`}
                onClick={() => void handleModelSave()}
                disabled={modelSaving || !selectedModel || selectedModel === activeRuntimeConfig.model}
                data-testid="model-save"
              >
                {modelSaving ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : modelSaved ? (
                  <><Check size={13} /> Saved</>
                ) : (
                  'Save'
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Generation Parameters ──────────────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Generation Parameters</h3>
        {genLoading ? (
          <div className="flex items-center gap-2 text-xs text-base-content/50">
            <Loader2 size={12} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Temperature */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-base-content/60">Temperature</span>
                <span className="badge badge-neutral font-mono text-xs" data-testid="gen-temperature-value">
                  {genSettings.temperature.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                className="range range-sm range-primary w-full"
                min={0}
                max={2}
                step={0.05}
                value={genSettings.temperature}
                onChange={() => undefined}
                onInput={handleTemperatureInput}
                data-testid="gen-temperature"
              />
              <div className="flex justify-between text-[10px] text-base-content/40 mt-1 px-1">
                <span>0 (deterministic)</span><span>1 (balanced)</span><span>2 (creative)</span>
              </div>
            </div>

            {/* Max Tokens */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-base-content/60">Max Output Tokens</span>
                <span className="badge badge-neutral font-mono text-xs">{genSettings.maxTokens.toLocaleString('en-US')}</span>
              </div>
              <input
                type="range"
                className="range range-sm range-secondary w-full"
                min={256}
                max={16384}
                step={256}
                value={genSettings.maxTokens}
                onChange={() => undefined}
                onInput={handleMaxTokensInput}
                data-testid="gen-max-tokens"
              />
              <div className="flex justify-between text-[10px] text-base-content/40 mt-1 px-1">
                <span>256</span><span>4k</span><span>8k</span><span>16k</span>
              </div>
            </div>

            {genError && (
              <p className="text-xs text-error flex items-center gap-1">
                <AlertCircle size={11} /> {genError}
              </p>
            )}

            <button
              className={`btn btn-sm self-end gap-1 ${genSaved ? 'btn-success' : 'btn-outline'}`}
              onClick={() => void handleGenSave()}
              disabled={genSaving}
              data-testid="gen-save"
            >
              {genSaving ? (
                <Loader2 size={13} className="animate-spin" />
              ) : genSaved ? (
                <><Check size={13} /> Saved</>
              ) : (
                'Save Parameters'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { Loader2, RefreshCw, Check, AlertCircle, ChevronDown } from 'lucide-react';
import type { Credential } from '@kalio/types';

interface Props {
  activeCredential: Credential | null;
  onModelChange: (updated: Credential) => void;
}

interface GenSettings {
  temperature: number;
  maxTokens: number;
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function ModelSettingsSection({ activeCredential, onModelChange }: Props) {
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>(activeCredential?.model ?? '');
  const [modelSaving, setModelSaving] = useState(false);
  const [modelSaved, setModelSaved] = useState(false);

  const [genSettings, setGenSettings] = useState<GenSettings>({ temperature: 0.7, maxTokens: 4096 });
  const [genLoading, setGenLoading] = useState(true);
  const [genSaving, setGenSaving] = useState(false);
  const [genSaved, setGenSaved] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Update selected model when active credential changes
  useEffect(() => {
    setSelectedModel(activeCredential?.model ?? '');
    setModelSaved(false);
  }, [activeCredential?.id, activeCredential?.model]);

  // Load generation settings once
  useEffect(() => {
    setGenLoading(true);
    apiFetch<GenSettings>('/credentials/settings/generation')
      .then((s) => { setGenSettings(s); })
      .catch(() => { /* use defaults */ })
      .finally(() => setGenLoading(false));
  }, []);

  const fetchModels = useCallback(async () => {
    if (!activeCredential) return;
    setModelsLoading(true);
    setModelsError(null);
    try {
      const { models: list } = await apiFetch<{ models: string[] }>(`/credentials/${activeCredential.id}/models`);
      setModels(list);
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : 'Failed to load models');
    } finally {
      setModelsLoading(false);
    }
  }, [activeCredential?.id]);

  useEffect(() => {
    void fetchModels();
  }, [fetchModels]);

  const handleModelSave = async () => {
    if (!activeCredential || !selectedModel) return;
    setModelSaving(true);
    try {
      const updated = await apiFetch<Credential>(`/credentials/${activeCredential.id}/model`, {
        method: 'PATCH',
        body: JSON.stringify({ model: selectedModel }),
      });
      onModelChange(updated);
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

  return (
    <div className="flex flex-col gap-5 border-t border-base-300 pt-4">
      {/* ── Active Model ───────────────────────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold mb-1">Active Model</h3>
        {!activeCredential ? (
          <p className="text-xs text-base-content/50 italic">
            Activate a provider above to select its model.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-base-content/60">
              Model for <span className="font-medium text-base-content">{activeCredential.name}</span>
              <span className="ml-1 badge badge-xs badge-outline font-mono">{activeCredential.provider}</span>
            </p>

            <div className="flex gap-2 items-start">
              <div className="flex-1">
                {modelsLoading ? (
                  <div className="input input-bordered input-sm flex items-center gap-2 text-xs text-base-content/50">
                    <Loader2 size={12} className="animate-spin" /> Loading models…
                  </div>
                ) : models.length > 0 ? (
                  <div className="relative">
                    <select
                      className="select select-bordered select-sm w-full font-mono pr-8"
                      value={selectedModel}
                      onChange={(e) => { setSelectedModel(e.target.value); setModelSaved(false); }}
                      data-testid="model-selector"
                    >
                      {selectedModel && !models.includes(selectedModel) && (
                        <option value={selectedModel}>{selectedModel} (current)</option>
                      )}
                      {models.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-base-content/50" />
                  </div>
                ) : (
                  <input
                    className="input input-bordered input-sm w-full font-mono"
                    value={selectedModel}
                    onChange={(e) => { setSelectedModel(e.target.value); setModelSaved(false); }}
                    placeholder="e.g. gpt-4o-mini"
                    data-testid="model-selector"
                  />
                )}
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
                disabled={modelSaving || !selectedModel || selectedModel === activeCredential.model}
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
                onChange={(e) => setGenSettings((g) => ({ ...g, temperature: parseFloat(e.target.value) }))}
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
                <span className="badge badge-neutral font-mono text-xs">{genSettings.maxTokens.toLocaleString()}</span>
              </div>
              <input
                type="range"
                className="range range-sm range-secondary w-full"
                min={256}
                max={16384}
                step={256}
                value={genSettings.maxTokens}
                onChange={(e) => setGenSettings((g) => ({ ...g, maxTokens: parseInt(e.target.value, 10) }))}
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

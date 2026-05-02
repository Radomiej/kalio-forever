import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Loader2, Check, Save } from 'lucide-react';
import type { ImageConfigResponse, UpdateImageConfigDto, ImageProviderType, ImageDetail } from '@kalio/types';

const PROVIDER_LABELS: Record<ImageProviderType, string> = {
  auto:       'Auto (CometAPI)',
  cometapi:   'CometAPI (recommended)',
  openai:     'OpenAI',
  openrouter: 'OpenRouter',
  replicate:  'Replicate (direct)',
};

const PROVIDER_BASE_URLS: Record<ImageProviderType, string> = {
  auto:       '',
  cometapi:   'https://api.cometapi.com/v1',
  openai:     'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  replicate:  'https://api.replicate.com/v1',
};

const PROVIDER_DEFAULT_MODELS: Record<ImageProviderType, string> = {
  auto:       'flux-schnell',
  cometapi:   'flux-schnell',
  openai:     'dall-e-3',
  openrouter: 'openai/dall-e-3',
  replicate:  'flux-schnell',
};

/** Models available per provider (shown as quick-select suggestions) */
const PROVIDER_MODELS: Record<ImageProviderType, Array<{ value: string; label: string }>> = {
  auto: [
    { value: 'mock-stock',       label: 'mock-stock (free placeholder)' },
    { value: 'flux-schnell',      label: 'flux-schnell (fast)' },
    { value: 'flux-dev',          label: 'flux-dev (quality)' },
    { value: 'flux-1.1-pro',      label: 'flux-1.1-pro (best)' },
    { value: 'dall-e-3',          label: 'dall-e-3' },
    { value: 'gpt-image-1',       label: 'gpt-image-1' },
  ],
  cometapi: [
    { value: 'mock-stock',       label: 'mock-stock (free placeholder)' },
    { value: 'flux-schnell',      label: 'flux-schnell (fast, cheap)' },
    { value: 'flux-dev',          label: 'flux-dev (quality)' },
    { value: 'flux-1.1-pro',      label: 'flux-1.1-pro (best)' },
    { value: 'dall-e-3',          label: 'dall-e-3' },
    { value: 'gpt-image-1',       label: 'gpt-image-1 (vision+edit)' },
    { value: 'ideogram-v2',       label: 'ideogram-v2' },
    { value: 'ideogram-v2-turbo', label: 'ideogram-v2-turbo (fast)' },
    { value: 'stable-diffusion-3-5-large', label: 'SD 3.5 large' },
  ],
  openai: [
    { value: 'gpt-image-1',       label: 'gpt-image-1 (recommended)' },
    { value: 'dall-e-3',          label: 'dall-e-3' },
    { value: 'dall-e-2',          label: 'dall-e-2 (legacy)' },
  ],
  openrouter: [
    { value: 'openai/dall-e-3',   label: 'openai/dall-e-3' },
    { value: 'stability-ai/stable-diffusion-xl-base-1.0', label: 'SDXL 1.0' },
  ],
  replicate: [
    { value: 'flux-schnell',      label: 'flux-schnell' },
    { value: 'flux-dev',          label: 'flux-dev' },
    { value: 'flux-pro',          label: 'flux-pro' },
    { value: 'flux-1.1-pro',      label: 'flux-1.1-pro' },
    { value: 'black-forest-labs/flux-schnell', label: 'flux-schnell (full path)' },
  ],
};

const DETAIL_LEVELS: ImageDetail[] = ['low', 'auto', 'high'];

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

interface FormState {
  provider: ImageProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
  compressionEnabled: boolean;
  maxDimension: number;
  maxKb: number;
  detail: ImageDetail;
}

function configToForm(cfg: ImageConfigResponse): FormState {
  return {
    provider: cfg.provider,
    apiKey: '',
    baseUrl: cfg.baseUrl ?? PROVIDER_BASE_URLS[cfg.provider],
    model: cfg.model ?? PROVIDER_DEFAULT_MODELS[cfg.provider],
    compressionEnabled: cfg.compression?.enabled ?? false,
    maxDimension: cfg.compression?.maxDimension ?? 1024,
    maxKb: cfg.compression?.maxKb ?? 512,
    detail: cfg.compression?.detail ?? 'low',
  };
}

export function ImageSettingsPanel() {
  const [config, setConfig] = useState<ImageConfigResponse | null>(null);
  const [form, setForm] = useState<FormState>({
    provider: 'auto', apiKey: '', baseUrl: '', model: 'flux-schnell',
    compressionEnabled: false, maxDimension: 1024, maxKb: 512, detail: 'low',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await apiFetch<ImageConfigResponse>('/image/config');
      setConfig(cfg);
      setForm(configToForm(cfg));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleProviderChange = (provider: ImageProviderType) => {
    setForm((f) => ({
      ...f,
      provider,
      baseUrl: PROVIDER_BASE_URLS[provider],
      model: PROVIDER_DEFAULT_MODELS[provider],
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const dto: UpdateImageConfigDto = {
        provider: form.provider,
        model: form.model || undefined,
        baseUrl: form.baseUrl || undefined,
        compression: {
          enabled: form.compressionEnabled,
          maxDimension: form.maxDimension,
          maxKb: form.maxKb,
          detail: form.detail,
        },
      };
      if (form.apiKey.trim().length > 0) dto.apiKey = form.apiKey.trim();

      const updated = await apiFetch<ImageConfigResponse>('/image/config', {
        method: 'PUT',
        body: JSON.stringify(dto),
      });
      setConfig(updated);
      setForm(() => ({ ...configToForm(updated), apiKey: '' }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-base-content/40">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 max-w-xl">
      <div>
        <h2 className="text-sm font-semibold text-base-content/80 mb-0.5">Image Generation</h2>
        <p className="text-xs text-base-content/40">
          Configure the provider and API key used by <code className="font-mono">image_generate</code> and <code className="font-mono">image_edit</code> tools.
          {config?.source === 'default' && (
            <span className="ml-1 text-warning/80">No key saved yet — tools will fail until configured.</span>
          )}
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-error/10 border border-error/20 text-error text-xs">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Provider Card */}
      <div className="bg-base-200/50 rounded-lg border border-base-300/40 p-4 space-y-4">
        <h3 className="text-xs font-semibold text-base-content/60 uppercase tracking-wide">Provider</h3>

        {/* Provider selector */}
        <div className="space-y-1">
          <label className="text-xs text-base-content/50">Provider</label>
          <select
            className="select select-sm select-bordered w-full"
            value={form.provider}
            onChange={(e) => handleProviderChange(e.target.value as ImageProviderType)}
          >
            {(Object.keys(PROVIDER_LABELS) as ImageProviderType[]).map((p) => (
              <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
            ))}
          </select>
        </div>

        {/* API key */}
        <div className="space-y-1">
          <label className="text-xs text-base-content/50">
            API Key {config?.source === 'db' && <span className="text-success/70">(saved)</span>}
          </label>
          <input
            type="password"
            className="input input-sm input-bordered w-full font-mono"
            placeholder={config?.source === 'db' ? '●●●●●●●●  (leave blank to keep existing)' : 'Enter API key…'}
            value={form.apiKey}
            onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
            autoComplete="off"
          />
        </div>

        {/* Base URL */}
        <div className="space-y-1">
          <label className="text-xs text-base-content/50">Base URL</label>
          <input
            type="text"
            className="input input-sm input-bordered w-full font-mono"
            placeholder="https://api.cometapi.com/v1"
            value={form.baseUrl}
            onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
          />
        </div>

        {/* Model */}
        <div className="space-y-1">
          <label className="text-xs text-base-content/50">Default Model</label>
          <input
            type="text"
            className="input input-sm input-bordered w-full font-mono"
            placeholder="flux-schnell"
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
          />
          <div className="flex flex-wrap gap-1 mt-1">
            {(PROVIDER_MODELS[form.provider] ?? PROVIDER_MODELS['cometapi']).map((m) => (
              <button
                key={m.value}
                type="button"
                className={`btn btn-xs rounded-full border ${form.model === m.value ? 'btn-primary' : 'btn-ghost border-base-300/40'}`}
                onClick={() => setForm((f) => ({ ...f, model: m.value }))}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Compression Card */}
      <div className="bg-base-200/50 rounded-lg border border-base-300/40 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-base-content/60 uppercase tracking-wide">Reference Image Compression</h3>
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={form.compressionEnabled}
            onChange={(e) => setForm((f) => ({ ...f, compressionEnabled: e.target.checked }))}
          />
        </div>
        <p className="text-[10px] text-base-content/30">
          Applied to reference images passed to <code className="font-mono">image_edit</code> to reduce token usage.
        </p>

        {form.compressionEnabled && (
          <div className="space-y-3">
            {/* Preset buttons */}
            <div className="flex gap-2">
              {([
                { label: 'Budget', dim: 512, kb: 256, detail: 'low' },
                { label: 'Balanced', dim: 1024, kb: 512, detail: 'auto' },
                { label: 'Quality', dim: 2048, kb: 1024, detail: 'high' },
              ] as Array<{ label: string; dim: number; kb: number; detail: ImageDetail }>).map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="btn btn-xs btn-ghost border border-base-300/60"
                  onClick={() => setForm((f) => ({ ...f, maxDimension: p.dim, maxKb: p.kb, detail: p.detail }))}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-base-content/50">Max dimension (px)</label>
                <input
                  type="number"
                  className="input input-sm input-bordered w-full"
                  min={256}
                  max={4096}
                  value={form.maxDimension}
                  onChange={(e) => setForm((f) => ({ ...f, maxDimension: Number(e.target.value) }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-base-content/50">Max size (KB)</label>
                <input
                  type="number"
                  className="input input-sm input-bordered w-full"
                  min={64}
                  max={10240}
                  value={form.maxKb}
                  onChange={(e) => setForm((f) => ({ ...f, maxKb: Number(e.target.value) }))}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-base-content/50">Detail level</label>
              <div className="flex gap-2">
                {DETAIL_LEVELS.map((d) => (
                  <label key={d} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      className="radio radio-xs"
                      checked={form.detail === d}
                      onChange={() => setForm((f) => ({ ...f, detail: d }))}
                    />
                    <span className="text-xs capitalize">{d}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn btn-sm btn-primary gap-1.5"
          onClick={() => { void handleSave(); }}
          disabled={saving}
        >
          {saving ? (
            <Loader2 size={13} className="animate-spin" />
          ) : saved ? (
            <Check size={13} />
          ) : (
            <Save size={13} />
          )}
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
        </button>
        {saved && (
          <span className="text-xs text-success/70 flex items-center gap-1">
            <Check size={11} /> Config saved
          </span>
        )}
      </div>
    </div>
  );
}

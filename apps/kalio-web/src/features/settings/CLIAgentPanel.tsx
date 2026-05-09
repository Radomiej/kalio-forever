import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, XCircle, Loader2, RefreshCw, Terminal, ExternalLink } from 'lucide-react';
import type { CLIAgentAdapterInfo, CLIAgentConfig } from '@kalio/types';

type ConfigDraft = Partial<CLIAgentConfig>;

interface AdapterCardProps {
  info: CLIAgentAdapterInfo;
}

const TIMEOUT_MIN_MS = 10_000;
const TIMEOUT_MAX_MS = 1_200_000;
const MAX_OUTPUT_MIN = 1_000;
const MAX_OUTPUT_MAX = 500_000;

function normalizeOptionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeCliPath(value: string): string {
  return normalizeOptionalText(value) ?? '';
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeNumberInput(value: string, fallback: number, min: number, max: number): number {
  if (value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampNumber(parsed, min, max) : fallback;
}

function normalizeExtraArgs(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function AdapterCard({ info }: AdapterCardProps) {
  const [config, setConfig] = useState<CLIAgentConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ConfigDraft>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/cli-agents/${info.id}/config`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}: ${r.statusText}`);
        return r.json() as Promise<CLIAgentConfig>;
      })
      .then((c) => { setConfig(c); setDraft({}); setConfigError(null); })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to load config';
        setConfigError(msg);
        console.error('[CLIAgentPanel] config load', err);
      });
  }, [info.id]);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload: CLIAgentConfig = {
        ...config,
        ...draft,
        cliPath: normalizeCliPath(draft.cliPath ?? config.cliPath),
        timeoutMs: clampNumber(typeof draft.timeoutMs === 'number' ? draft.timeoutMs : config.timeoutMs, TIMEOUT_MIN_MS, TIMEOUT_MAX_MS),
        maxOutputChars: clampNumber(
          typeof draft.maxOutputChars === 'number' ? draft.maxOutputChars : config.maxOutputChars,
          MAX_OUTPUT_MIN,
          MAX_OUTPUT_MAX,
        ),
        extraArgs: Array.isArray(draft.extraArgs) ? draft.extraArgs : config.extraArgs,
      };
      const res = await fetch(`/api/cli-agents/${info.id}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      const updated = await res.json() as CLIAgentConfig;
      setConfig(updated);
      setDraft({});
      setSaveMsg('Saved');
    } catch (err: unknown) {
      setSaveMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const merged: CLIAgentConfig | null = config ? { ...config, ...draft } : null;
  const isDirty = Object.keys(draft).length > 0;

  return (
    <div className="border border-base-300 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-base-200/40">
        <Terminal size={16} className="text-base-content/50 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">{info.displayName}</div>
          {info.available ? (
            <div className="text-xs text-success flex items-center gap-1">
              <CheckCircle2 size={10} />
              {info.version ?? 'installed'}
            </div>
          ) : (
            <div className="text-xs text-error flex items-center gap-1">
              <XCircle size={10} />
              not found in PATH
            </div>
          )}
        </div>
        {!info.available && (
          <a
            href={info.installUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-xs btn-ghost gap-1 text-info"
          >
            Install <ExternalLink size={10} />
          </a>
        )}
      </div>

      {configError && (
        <div className="px-4 py-2 text-xs text-error">{configError}</div>
      )}
      {/* Config */}
      {merged && !configError && (
        <div className="px-4 py-3 flex flex-col gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="toggle toggle-sm toggle-success"
              checked={merged.enabled}
              onChange={(e) => setDraft((d: ConfigDraft) => ({ ...d, enabled: e.target.checked }))}
            />
            <span className="text-sm">Enable</span>
          </label>

          <div className="form-control gap-1">
            <label className="label-text text-xs text-base-content/60">CLI path override (leave blank for PATH)</label>
            <input
              type="text"
              className="input input-bordered input-xs font-mono"
              placeholder="e.g. /usr/local/bin/copilot"
              value={merged.cliPath ?? ''}
              onChange={(e) => setDraft((d: ConfigDraft) => ({
                ...d,
                cliPath: normalizeCliPath(e.target.value),
              }))}
            />
          </div>

          <div className="form-control gap-1">
            <label className="label-text text-xs text-base-content/60">Timeout (ms)</label>
            <input
              type="number"
              className="input input-bordered input-xs font-mono w-36"
              min={TIMEOUT_MIN_MS}
              max={TIMEOUT_MAX_MS}
              step={10_000}
              value={merged.timeoutMs ?? 600_000}
              onChange={(e) => setDraft((d: ConfigDraft) => ({
                ...d,
                timeoutMs: normalizeNumberInput(e.target.value, merged.timeoutMs, TIMEOUT_MIN_MS, TIMEOUT_MAX_MS),
              }))}
            />
          </div>

          <div className="form-control gap-1">
            <label className="label-text text-xs text-base-content/60">Max output chars</label>
            <input
              type="number"
              className="input input-bordered input-xs font-mono w-36"
              min={MAX_OUTPUT_MIN}
              max={MAX_OUTPUT_MAX}
              step={1_000}
              value={merged.maxOutputChars ?? 16_000}
              onChange={(e) => setDraft((d: ConfigDraft) => ({
                ...d,
                maxOutputChars: normalizeNumberInput(e.target.value, merged.maxOutputChars, MAX_OUTPUT_MIN, MAX_OUTPUT_MAX),
              }))}
            />
          </div>

          <div className="form-control gap-1">
            <label className="label-text text-xs text-base-content/60">Extra args (one per line)</label>
            <textarea
              className="textarea textarea-bordered textarea-xs font-mono text-xs"
              rows={2}
              placeholder="e.g. --no-auto-commit"
              value={(merged.extraArgs ?? []).join('\n')}
              onChange={(e) =>
                setDraft((d: ConfigDraft) => ({
                  ...d,
                  extraArgs: normalizeExtraArgs(e.target.value),
                }))
              }
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              className="btn btn-xs btn-primary"
              disabled={!isDirty || saving}
              onClick={() => void handleSave()}
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
            </button>
            {saveMsg && (
              <span className={`text-xs ${saveMsg === 'Saved' ? 'text-success' : 'text-error'}`}>
                {saveMsg}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function CLIAgentPanel() {
  const [adapters, setAdapters] = useState<CLIAgentAdapterInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Load cached results from BE (instant — no probing on this request). */
  const loadAdapters = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/cli-agents');
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      const data = await res.json() as CLIAgentAdapterInfo[];
      setAdapters(data);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  /** Force BE to re-probe all adapters, then reload. */
  const refreshProbes = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/cli-agents/refresh', { method: 'POST' });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      const data = await res.json() as CLIAgentAdapterInfo[];
      setAdapters(data);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAdapters(); }, [loadAdapters]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold mb-1">CLI Coding Agents</h3>
          <p className="text-sm text-base-content/60">
            Kalio can delegate coding tasks to external CLI agents. Configure each adapter below.
          </p>
        </div>
        <button
          className="btn btn-xs btn-ghost gap-1"
          disabled={loading}
          onClick={() => void refreshProbes()}
          title="Re-probe all CLI agents"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loadError && (
        <div className="alert alert-error text-sm">{loadError}</div>
      )}

      {loading && adapters.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-base-content/50">
          <Loader2 size={14} className="animate-spin" />
          Probing installed CLI agents…
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {adapters.map((a) => (
            <AdapterCard key={a.id} info={a} />
          ))}
        </div>
      )}
    </div>
  );
}

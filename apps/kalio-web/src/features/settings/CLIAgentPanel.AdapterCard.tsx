import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Terminal, ExternalLink } from 'lucide-react';
import type { CLIAgentAdapterInfo, CLIAgentConfig } from '@kalio/types';
import {
  type ConfigDraft,
  buildCliAgentPayload,
  HARD_TIMEOUT_MAX_MS,
  HARD_TIMEOUT_MIN_MS,
  MAX_OUTPUT_MAX,
  MAX_OUTPUT_MIN,
  modelPlaceholder,
  normalizeArchitecturePreference,
  normalizeCliPath,
  normalizeExtraArgs,
  normalizeModel,
  normalizeNumberInput,
  normalizeOptionalText,
  TIMEOUT_MAX_MS,
  TIMEOUT_MIN_MS,
} from './CLIAgentPanel.model';

interface AdapterCardProps {
  info: CLIAgentAdapterInfo;
}

export function AdapterCard({ info }: AdapterCardProps) {
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
      const payload = buildCliAgentPayload(config, draft);
      const res = await fetch(`/api/cli-agents/${info.id}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errorBody = await res.json().catch((err: unknown) => {
          console.debug('[CLIAgentPanel] save error response was not JSON', err);
          return null;
        }) as { message?: string } | null;
        throw new Error(errorBody?.message ?? `${res.status}: ${res.statusText}`);
      }
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
              placeholder={`e.g. /usr/local/bin/${info.id}`}
              value={merged.cliPath ?? ''}
              onChange={(e) => setDraft((d: ConfigDraft) => ({
                ...d,
                cliPath: normalizeCliPath(e.target.value),
              }))}
            />
          </div>

          {info.supportsModelSelection && (
            <div className="form-control gap-1">
              <label className="label-text text-xs text-base-content/60">Model override (optional)</label>
              <input
                type="text"
                className="input input-bordered input-xs font-mono"
                placeholder={modelPlaceholder(info.id)}
                value={merged.model ?? ''}
                onChange={(e) => setDraft((d: ConfigDraft) => ({
                  ...d,
                  model: normalizeModel(e.target.value),
                }))}
              />
            </div>
          )}

          <div className="form-control gap-1">
            <label className="label-text text-xs text-base-content/60" htmlFor={`architecture-preference-${info.id}`}>
              Architecture run preference
            </label>
            <textarea
              id={`architecture-preference-${info.id}`}
              className="textarea textarea-bordered textarea-xs text-xs"
              rows={2}
              placeholder="e.g. Prefer cheap materialization; avoid broad rewrites."
              value={merged.architecturePreference ?? ''}
              onChange={(e) => setDraft((d: ConfigDraft) => ({
                ...d,
                architecturePreference: normalizeArchitecturePreference(e.target.value),
              }))}
            />
          </div>

          <div className="form-control gap-1">
            <label className="label-text text-xs text-base-content/60">Inactivity timeout (ms)</label>
            <input
              type="number"
              aria-label="Inactivity timeout"
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

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={merged.hardTimeoutEnabled ?? false}
              onChange={(e) => setDraft((d: ConfigDraft) => ({ ...d, hardTimeoutEnabled: e.target.checked }))}
            />
            <span className="text-sm">Enable hard wall-clock timeout</span>
          </label>

          <div className="form-control gap-1">
            <label className="label-text text-xs text-base-content/60">Hard timeout (ms)</label>
            <input
              type="number"
              aria-label="Hard timeout"
              className="input input-bordered input-xs font-mono w-36"
              min={HARD_TIMEOUT_MIN_MS}
              max={HARD_TIMEOUT_MAX_MS}
              step={60_000}
              value={merged.hardTimeoutMs ?? 3_600_000}
              disabled={!merged.hardTimeoutEnabled}
              onChange={(e) => setDraft((d: ConfigDraft) => ({
                ...d,
                hardTimeoutMs: normalizeNumberInput(e.target.value, merged.hardTimeoutMs ?? 3_600_000, HARD_TIMEOUT_MIN_MS, HARD_TIMEOUT_MAX_MS),
              }))}
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="toggle toggle-sm"
              checked={merged.autoRecoveryEnabled ?? false}
              onChange={(e) => setDraft((d: ConfigDraft) => ({ ...d, autoRecoveryEnabled: e.target.checked }))}
            />
            <span className="text-sm">Auto-recover idle durable sessions</span>
          </label>

          <div className="form-control gap-1">
            <label className="label-text text-xs text-base-content/60">Auto-recovery prompt</label>
            <input
              type="text"
              className="input input-bordered input-xs"
              value={merged.autoRecoveryPrompt ?? 'continue'}
              disabled={!merged.autoRecoveryEnabled}
              onChange={(e) => setDraft((d: ConfigDraft) => ({
                ...d,
                autoRecoveryPrompt: normalizeOptionalText(e.target.value) ?? 'continue',
              }))}
            />
          </div>

          <div className="form-control gap-1">
            <label className="label-text text-xs text-base-content/60">Max output chars</label>
            <input
              type="number"
              aria-label="Max output chars"
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

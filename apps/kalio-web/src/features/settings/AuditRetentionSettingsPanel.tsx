import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, Save, DatabaseZap } from 'lucide-react';
import type { AuditRetentionPolicy, AuditRetentionStatus } from '@kalio/types';

type EditableAuditRetentionPolicy = Pick<
  AuditRetentionPolicy,
  'retentionDays' | 'archiveRetentionDays' | 'pruneEveryWrites' | 'pruneIntervalHours' | 'maxHotRows' | 'maxArchivedRows'
>;

const DEFAULT_POLICY: EditableAuditRetentionPolicy = {
  retentionDays: 30,
  archiveRetentionDays: 30,
  pruneEveryWrites: 100,
  pruneIntervalHours: 24,
  maxHotRows: 50_000,
  maxArchivedRows: 250_000,
};

const FIELDS: Array<{
  key: keyof EditableAuditRetentionPolicy;
  label: string;
  min: number;
  max: number;
  hint: string;
}> = [
  {
    key: 'retentionDays',
    label: 'Hot delete after days',
    min: 1,
    max: 365,
    hint: 'Rows older than this are copied to cold storage and removed from the fast audit timeline. Default is one month.',
  },
  {
    key: 'archiveRetentionDays',
    label: 'Cold delete after days',
    min: 1,
    max: 3650,
    hint: 'Cold audit rows older than this are permanently deleted. Default is one month.',
  },
  {
    key: 'pruneEveryWrites',
    label: 'Cold copy every writes',
    min: 1,
    max: 100_000,
    hint: 'Retention copies eligible rows to cold storage after this many new audit writes.',
  },
  {
    key: 'pruneIntervalHours',
    label: 'Cold copy interval hours',
    min: 1,
    max: 720,
    hint: 'Retention also cold-copies eligible rows after this many hours. Default is daily.',
  },
  {
    key: 'maxHotRows',
    label: 'Max hot rows',
    min: 100,
    max: 2_000_000,
    hint: 'Hard cap for the fast audit table.',
  },
  {
    key: 'maxArchivedRows',
    label: 'Max cold rows',
    min: 1_000,
    max: 10_000_000,
    hint: 'Hard cap for cold audit storage.',
  },
];

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`${response.status}: ${text}`);
  }
  return response.json() as Promise<T>;
}

function policyFromStatus(status: AuditRetentionStatus): EditableAuditRetentionPolicy {
  return {
    retentionDays: status.retentionDays,
    archiveRetentionDays: status.archiveRetentionDays,
    pruneEveryWrites: status.pruneEveryWrites,
    pruneIntervalHours: status.pruneIntervalHours,
    maxHotRows: status.maxHotRows,
    maxArchivedRows: status.maxArchivedRows,
  };
}

function clampField(key: keyof EditableAuditRetentionPolicy, value: number): number {
  const field = FIELDS.find((item) => item.key === key);
  if (!field) return value;
  return Math.max(field.min, Math.min(Math.trunc(value), field.max));
}

export function AuditRetentionSettingsPanel() {
  const [policy, setPolicy] = useState<EditableAuditRetentionPolicy>(DEFAULT_POLICY);
  const [status, setStatus] = useState<AuditRetentionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await apiFetch<AuditRetentionStatus>('/audit-log/retention', { cache: 'no-store' });
      setStatus(loaded);
      setPolicy(policyFromStatus(loaded));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit retention policy');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await apiFetch<AuditRetentionPolicy>('/audit-log/retention', {
        method: 'PUT',
        body: JSON.stringify(policy),
      });
      const loaded = await apiFetch<AuditRetentionStatus>('/audit-log/retention', { cache: 'no-store' });
      setStatus(loaded);
      setPolicy(policyFromStatus(loaded));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save audit retention policy');
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    setSaved(false);
    setError(null);
    try {
      const loaded = await apiFetch<AuditRetentionStatus>('/audit-log/retention/run?confirm=true', { method: 'POST' });
      setStatus(loaded);
      setPolicy(policyFromStatus(loaded));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run audit retention');
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-base-content/50" data-testid="audit-retention-settings-panel">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">Loading...</span>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-5 p-4" data-testid="audit-retention-settings-panel">
      <div>
        <h2 className="mb-0.5 text-sm font-semibold text-base-content/80">Audit Retention</h2>
        <p className="text-xs text-base-content/50">
          Control incremental cold copies, hot timeline cleanup, and cold storage deletion.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-error/20 bg-error/10 p-3 text-xs text-error">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {saved && !error && (
        <div className="flex items-start gap-2 rounded-lg border border-success/20 bg-success/10 p-3 text-xs text-success">
          <DatabaseZap size={14} className="mt-0.5 shrink-0" />
          <span>Audit retention policy updated.</span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <label key={field.key} className="rounded-lg border border-base-300/50 bg-base-200/30 p-3">
            <span id={`audit-retention-${field.key}-label`} className="mb-1 block text-xs font-semibold text-base-content/70">{field.label}</span>
            <input
              aria-labelledby={`audit-retention-${field.key}-label`}
              type="number"
              min={field.min}
              max={field.max}
              value={policy[field.key]}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                if (!Number.isFinite(parsed)) return;
                setPolicy((current) => ({
                  ...current,
                  [field.key]: clampField(field.key, parsed),
                }));
                setSaved(false);
              }}
              className="input input-bordered input-sm w-full font-mono"
            />
            <span className="mt-1 block text-[11px] leading-4 text-base-content/45">{field.hint}</span>
          </label>
        ))}
      </div>

      {status && (
        <div className="grid gap-2 rounded-lg border border-base-300/50 bg-base-100/40 p-3 text-[11px] text-base-content/55 sm:grid-cols-2">
          <span>Hot rows: <span className="font-mono">{status.hotRows.toLocaleString('en-US')}</span></span>
          <span>Cold rows: <span className="font-mono">{status.archivedRows.toLocaleString('en-US')}</span></span>
          <span>Cold storage: <span className="font-mono">{status.coldStorageMode}</span></span>
          <span>Cold copy: <span className="font-mono">every {status.pruneEveryWrites} writes / {status.pruneIntervalHours}h</span></span>
          <span>Hot delete after: <span className="font-mono">{status.retentionDays}d</span></span>
          <span>Cold delete after: <span className="font-mono">{status.archiveRetentionDays}d</span></span>
          <span>Last run: <span className="font-mono">{formatTimestamp(status.lastRetentionRunAt)}</span></span>
          <span>Next run: <span className="font-mono">{formatTimestamp(status.nextRetentionRunAt)}</span></span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm gap-2" disabled={saving || running} onClick={() => { void handleSave(); }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save policy
        </button>
        <button type="button" className="btn btn-outline btn-sm gap-2" disabled={saving || running} onClick={() => { void runNow(); }}>
          {running ? <Loader2 size={14} className="animate-spin" /> : <DatabaseZap size={14} />}
          Run retention now
        </button>
      </div>
    </div>
  );
}

function formatTimestamp(value: number | null): string {
  return value == null ? 'not yet' : new Date(value).toLocaleString();
}

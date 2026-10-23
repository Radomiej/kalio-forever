export function AuditFact({ label, testId, value }: { label: string; testId?: string; value: string }) {
  return (
    <p className="min-w-0" data-testid={testId}>
      <span className="font-semibold text-base-content">{label}</span>
      <span className="text-base-content/55"> = </span>
      <span>{value}</span>
    </p>
  );
}

export function NumberField({
  label,
  min,
  max,
  onChange,
  testId,
  value,
}: {
  label: string;
  min: number;
  max?: number;
  onChange: (value: number) => void;
  testId: string;
  value: number;
}) {
  return (
    <label className="flex shrink-0 items-center gap-1 rounded-md border border-base-300 bg-base-100/70 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-base-content/65">
      {label}
      <input
        className="h-6 w-12 rounded border border-base-300 bg-base-100 px-1.5 text-xs font-semibold text-base-content outline-none"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value, 10);
          if (Number.isFinite(parsed) && parsed >= min && (max === undefined || parsed <= max)) {
            onChange(parsed);
          }
        }}
        data-testid={testId}
      />
    </label>
  );
}

export function ToggleField({
  checked,
  disabled = false,
  label,
  onChange,
  testId,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (value: boolean) => void;
  testId: string;
}) {
  return (
    <label className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-base-300 bg-base-100/70 px-2 py-1.5" data-testid={testId}>
      <span className="font-semibold text-base-content/75">{label}</span>
      <input
        type="checkbox"
        className="toggle toggle-info min-h-11 min-w-14"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export function RunMetric({ label, tone = 'ok', value }: { label: string; tone?: 'ok' | 'warning' | 'danger'; value: string }) {
  return (
    <div className={`min-w-12 rounded-md border px-2 py-1 ${
      tone === 'danger'
        ? 'border-error/40 bg-error/10'
        : tone === 'warning'
          ? 'border-warning/40 bg-warning/10'
          : 'border-base-300 bg-base-100/60'
    }`}>
      <div className="text-[11px] font-semibold text-base-content">{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-base-content/60">{label}</div>
    </div>
  );
}

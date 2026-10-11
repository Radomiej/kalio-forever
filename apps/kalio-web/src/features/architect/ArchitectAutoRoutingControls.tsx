import type { ArchitectureSchemaNode } from '@kalio/types';

interface ArchitectAutoRoutingControlsProps {
  nodeId: string;
  value?: ArchitectureSchemaNode['autoRouting'];
  onChange?: (nodeId: string, value: NonNullable<ArchitectureSchemaNode['autoRouting']>) => void;
}

export function ArchitectAutoRoutingControls({ nodeId, value, onChange }: ArchitectAutoRoutingControlsProps) {
  const settings = value ?? { confidenceThreshold: 0.7, instructions: '' };
  return (
    <section className="mt-4 space-y-3 rounded-md border border-base-300/80 bg-base-200/50 p-2.5">
      <label className="form-control gap-1">
        <span className="label-text text-xs font-semibold text-base-content/70">Confidence threshold</span>
        <input
          aria-label="Confidence threshold"
          className="input input-bordered input-sm h-9 min-h-9 w-full"
          type="number" min={0} max={1} step={0.01}
          value={settings.confidenceThreshold} disabled={!onChange}
          onChange={(event) => {
            const threshold = event.target.valueAsNumber;
            if (Number.isFinite(threshold) && threshold >= 0 && threshold <= 1) {
              onChange?.(nodeId, { ...settings, confidenceThreshold: threshold });
            }
          }}
        />
      </label>
      <label className="form-control gap-1">
        <span className="label-text text-xs font-semibold text-base-content/70">Routing instructions</span>
        <textarea
          aria-label="Routing instructions"
          className="textarea textarea-bordered min-h-20 w-full text-xs"
          maxLength={2000} value={settings.instructions} disabled={!onChange}
          onChange={(event) => {
            if (event.target.value.length <= 2000) onChange?.(nodeId, { ...settings, instructions: event.target.value });
          }}
        />
      </label>
      <p className="text-[11px] leading-4 text-base-content/55">Connect at least one choice route and exactly one default route.</p>
    </section>
  );
}

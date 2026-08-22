import type { ToolMeta } from '@kalio/types';

export function PersonaToolRow({
  tool,
  checked,
  allEnabled,
  onChange,
}: {
  tool: ToolMeta;
  checked: boolean;
  allEnabled: boolean;
  onChange: (name: string, on: boolean) => void;
}) {
  return (
    <label
      className={`flex items-start gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
        checked || allEnabled ? 'bg-sky-500/10' : 'hover:bg-base-300/50'
      }`}
      data-testid={`tool-toggle-${tool.name}`}
    >
      <input
        type="checkbox"
        className="checkbox checkbox-sm checkbox-primary mt-0.5"
        checked={allEnabled || checked}
        disabled={allEnabled}
        onChange={(e) => onChange(tool.name, e.target.checked)}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-sky-400">{tool.name}</span>
          {tool.requiresConfirmation && <span className="badge badge-xs badge-warning">HITL</span>}
        </div>
        <p className="text-xs text-base-content/60 mt-0.5 line-clamp-2">{tool.description}</p>
      </div>
    </label>
  );
}

import type { ToolTimeoutKey, ToolTimeoutSettings } from './tool-timeout-settings';

interface ToolTimeoutsSectionProps {
  values: ToolTimeoutSettings;
  onInputChange: (key: ToolTimeoutKey, value: number) => void;
  onCommit: (key: ToolTimeoutKey, value: number) => void;
}

const TOOL_TIMEOUT_CONTROLS: Array<{
  key: ToolTimeoutKey;
  label: string;
  testId: string;
  min: number;
  max: number;
  step: number;
}> = [
  {
    key: 'webSearchTimeoutMs',
    label: 'Web search timeout',
    testId: 'web-search-timeout',
    min: 15000,
    max: 600000,
    step: 15000,
  },
  {
    key: 'providerLocalTimeoutMs',
    label: 'Local provider probe timeout',
    testId: 'provider-local-timeout',
    min: 1000,
    max: 30000,
    step: 1000,
  },
  {
    key: 'providerRemoteTimeoutMs',
    label: 'Remote provider probe timeout',
    testId: 'provider-remote-timeout',
    min: 5000,
    max: 120000,
    step: 5000,
  },
];

export function ToolTimeoutsSection({ values, onInputChange, onCommit }: ToolTimeoutsSectionProps) {
  return (
    <div className="border-t border-base-300 pt-4">
      <h3 className="text-sm font-semibold mb-1">Tool Timeouts</h3>
      <p className="text-xs text-base-content/60 mb-3">
        Shared backend timeouts for web search and provider probes. Raise them when external services are slow.
      </p>

      <div className="space-y-4">
        {TOOL_TIMEOUT_CONTROLS.map((control) => (
          <div key={control.key}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-base-content/60">{control.label}</span>
              <span className="badge badge-neutral font-mono text-xs" data-testid={`${control.testId}-value`}>
                {Math.round(values[control.key] / 1000)}s
              </span>
            </div>
            <input
              type="range"
              className="range range-sm range-primary w-full"
              min={control.min}
              max={control.max}
              step={control.step}
              value={values[control.key]}
              onChange={(e) => onInputChange(control.key, parseInt(e.target.value, 10))}
              onMouseUp={(e) => onCommit(control.key, parseInt((e.target as HTMLInputElement).value, 10))}
              onTouchEnd={(e) => onCommit(control.key, parseInt((e.target as HTMLInputElement).value, 10))}
              onBlur={(e) => onCommit(control.key, parseInt((e.target as HTMLInputElement).value, 10))}
              data-testid={`${control.testId}-slider`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
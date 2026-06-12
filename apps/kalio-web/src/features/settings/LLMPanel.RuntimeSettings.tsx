import type { ActiveRuntimeConfig, LLMConfigWithSource } from './llm-panel.types';
import { ModelSettingsSection } from './ModelSettingsSection';
import { ProviderStreamsSection } from './ProviderStreamsSection';
import { ToolTimeoutsSection } from './ToolTimeoutsSection';
import type { ToolTimeoutKey, ToolTimeoutSettings } from './tool-timeout-settings';
import { formatLargeTokenCount } from './settings-format';

export function LLMRuntimeSettingsSection({
  activeRuntimeConfig,
  contextWindow,
  maxToolAttempts,
  toolTimeouts,
  focusModelInputSignal,
  onRuntimeConfigChange,
  onContextWindowInputChange,
  onContextWindowCommit,
  onMaxToolAttemptsInputChange,
  onMaxToolAttemptsCommit,
  onToolTimeoutInputChange,
  onToolTimeoutCommit,
}: {
  activeRuntimeConfig: ActiveRuntimeConfig | null;
  contextWindow: number;
  maxToolAttempts: number;
  toolTimeouts: ToolTimeoutSettings;
  focusModelInputSignal: number;
  onRuntimeConfigChange: (updated: LLMConfigWithSource) => void;
  onContextWindowInputChange: (size: number) => void;
  onContextWindowCommit: (size: number) => void;
  onMaxToolAttemptsInputChange: (size: number) => void;
  onMaxToolAttemptsCommit: (size: number) => void;
  onToolTimeoutInputChange: (key: ToolTimeoutKey, value: number) => void;
  onToolTimeoutCommit: (key: ToolTimeoutKey, value: number) => void;
}) {
  return (
    <section className="flex flex-col gap-5 border border-base-300 rounded-xl p-4 bg-base-200/10">
      <div>
        <h3 className="text-sm font-semibold mb-1">Runtime Settings</h3>
        <p className="text-xs text-base-content/60">
          Configure the active provider, runtime model, generation parameters, and turn-level limits.
        </p>
      </div>

      <ModelSettingsSection
        activeRuntimeConfig={activeRuntimeConfig}
        focusModelInputSignal={focusModelInputSignal}
        onRuntimeConfigChange={onRuntimeConfigChange}
      />

      <div className="border-t border-base-300 pt-4">
        <h3 className="text-sm font-semibold mb-1">Context Window</h3>
        <p className="text-xs text-base-content/60 mb-3">
          Oldest messages are trimmed automatically when history exceeds this limit.
          Stored in the backend.
        </p>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-base-content/60">Max tokens</span>
          <span className="badge badge-neutral font-mono text-xs" data-testid="context-window-value">
            {formatLargeTokenCount(contextWindow)}
          </span>
        </div>
        <input
          type="range"
          className="range range-sm range-primary w-full"
          min={4000}
          max={1_000_000}
          step={4000}
          value={contextWindow}
          onChange={() => undefined}
          onInput={(event) => void onContextWindowInputChange(parseInt((event.target as HTMLInputElement).value, 10))}
          onMouseUp={(event) => void onContextWindowCommit(parseInt((event.target as HTMLInputElement).value, 10))}
          onTouchEnd={(event) => void onContextWindowCommit(parseInt((event.target as HTMLInputElement).value, 10))}
          onBlur={(event) => void onContextWindowCommit(parseInt((event.target as HTMLInputElement).value, 10))}
          aria-label="Context window"
          data-testid="context-window-slider"
        />
        <div className="flex justify-between text-[10px] text-base-content/40 mt-1 px-1">
          <span>4k</span><span>32k</span><span>128k</span><span>1M</span>
        </div>
      </div>

      <ProviderStreamsSection
        value={toolTimeouts.providerMaxConcurrentStreams}
        onInputChange={(value) => onToolTimeoutInputChange('providerMaxConcurrentStreams', value)}
        onCommit={(value) => onToolTimeoutCommit('providerMaxConcurrentStreams', value)}
      />

      <div className="border-t border-base-300 pt-4">
        <h3 className="text-sm font-semibold mb-1">Agent Loop Limit</h3>
        <p className="text-xs text-base-content/60 mb-3">
          Max tool-attempt loop iterations per turn before automatic stop.
          Increase for complex test scenarios (for example 25).
        </p>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-base-content/60">Max tool attempts</span>
          <span className="badge badge-neutral font-mono text-xs" data-testid="max-tool-attempts-value">
            {maxToolAttempts}
          </span>
        </div>
        <input
          type="range"
          className="range range-sm range-primary w-full"
          min={1}
          max={100}
          step={1}
          value={maxToolAttempts}
          onChange={() => undefined}
          onInput={(event) => void onMaxToolAttemptsInputChange(parseInt((event.target as HTMLInputElement).value, 10))}
          onMouseUp={(event) => void onMaxToolAttemptsCommit(parseInt((event.target as HTMLInputElement).value, 10))}
          onTouchEnd={(event) => void onMaxToolAttemptsCommit(parseInt((event.target as HTMLInputElement).value, 10))}
          onBlur={(event) => void onMaxToolAttemptsCommit(parseInt((event.target as HTMLInputElement).value, 10))}
          aria-label="Max tool attempts"
          data-testid="max-tool-attempts-slider"
        />
        <div className="flex justify-between text-[10px] text-base-content/40 mt-1 px-1">
          <span>1</span><span>8</span><span>25</span><span>100</span>
        </div>
      </div>

      <ToolTimeoutsSection
        values={toolTimeouts}
        onInputChange={onToolTimeoutInputChange}
        onCommit={onToolTimeoutCommit}
      />
    </section>
  );
}

import type { ActiveRuntimeConfig, LLMConfigWithSource } from './llm-panel.types';
import { ModelSettingsSection } from './ModelSettingsSection';
import { ProviderStreamsSection } from './ProviderStreamsSection';
import { SettingsRangeField } from './SettingsRangeField';
import { ToolTimeoutsSection } from './ToolTimeoutsSection';
import type { ToolTimeoutKey, ToolTimeoutSettings } from './tool-timeout-settings';
import { formatLargeTokenCount } from './settings-format';

export function LLMRuntimeSettingsSection({
  activeRuntimeConfig,
  contextWindow,
  maxToolAttempts,
  maxToolAttemptsSaveStatus,
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
  maxToolAttemptsSaveStatus: 'idle' | 'saving' | 'saved' | 'error';
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
    <section className="flex flex-col gap-6">
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
        <SettingsRangeField
          ariaLabel="Context window"
          label="Max tokens"
          marks={[
            { value: 4_000, label: '4k' },
            { value: 32_000, label: '32k' },
            { value: 128_000, label: '128k' },
            { value: 1_000_000, label: '1M' },
          ]}
          min={4000}
          max={1_000_000}
          step={4000}
          value={contextWindow}
          valueLabel={formatLargeTokenCount(contextWindow)}
          valueTestId="context-window-value"
          onInput={(event) => void onContextWindowInputChange(parseInt((event.target as HTMLInputElement).value, 10))}
          onMouseUp={(event) => void onContextWindowCommit(parseInt((event.target as HTMLInputElement).value, 10))}
          onTouchEnd={(event) => void onContextWindowCommit(parseInt((event.target as HTMLInputElement).value, 10))}
          onBlur={(event) => void onContextWindowCommit(parseInt((event.target as HTMLInputElement).value, 10))}
          testId="context-window-slider"
        />
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
          Increase for complex test scenarios (for example 30).
        </p>
        <SettingsRangeField
          ariaLabel="Max tool attempts"
          label="Max tool attempts"
          marks={[
            { value: 1, label: '1' },
            { value: 8, label: '8' },
            { value: 30, label: '30' },
            { value: 100, label: '100' },
          ]}
          min={1}
          max={100}
          step={1}
          value={maxToolAttempts}
          valueLabel={maxToolAttempts}
          valueTestId="max-tool-attempts-value"
          onInput={(event) => void onMaxToolAttemptsInputChange(parseInt((event.target as HTMLInputElement).value, 10))}
          onMouseUp={(event) => void onMaxToolAttemptsCommit(parseInt((event.target as HTMLInputElement).value, 10))}
          onTouchEnd={(event) => void onMaxToolAttemptsCommit(parseInt((event.target as HTMLInputElement).value, 10))}
          onBlur={(event) => void onMaxToolAttemptsCommit(parseInt((event.target as HTMLInputElement).value, 10))}
          testId="max-tool-attempts-slider"
        />
        <p
          aria-live="polite"
          className={`mt-2 text-xs ${
            maxToolAttemptsSaveStatus === 'error'
              ? 'text-error'
              : maxToolAttemptsSaveStatus === 'saved'
                ? 'text-success'
                : maxToolAttemptsSaveStatus === 'saving'
                  ? 'text-warning'
                  : 'text-base-content/50'
          }`}
          data-testid="max-tool-attempts-save-status"
          role="status"
        >
          {maxToolAttemptsSaveStatus === 'error'
            ? 'Save failed'
            : maxToolAttemptsSaveStatus === 'saved'
              ? 'Saved'
              : maxToolAttemptsSaveStatus === 'saving'
                ? 'Saving...'
                : 'Stored in backend'}
        </p>
      </div>

      <ToolTimeoutsSection
        values={toolTimeouts}
        onInputChange={onToolTimeoutInputChange}
        onCommit={onToolTimeoutCommit}
      />
    </section>
  );
}

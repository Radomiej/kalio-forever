import { SettingsRangeField } from './SettingsRangeField';

interface ProviderStreamsSectionProps {
  value: number;
  onInputChange: (value: number) => void;
  onCommit: (value: number) => void;
}

export function ProviderStreamsSection({
  value,
  onInputChange,
  onCommit,
}: ProviderStreamsSectionProps) {
  return (
    <div className="border-t border-base-300 pt-4">
      <h3 className="text-sm font-semibold mb-1">Provider Streams</h3>
      <p className="text-xs text-base-content/60 mb-3">
        Limit concurrent provider streams so parallel agent runs stay within provider rate limits.
      </p>
      <SettingsRangeField
        ariaLabel="Max provider streams"
        label="Max provider streams"
        marks={[
          { value: 1, label: '1' },
          { value: 4, label: '4' },
          { value: 8, label: '8' },
          { value: 20, label: '20' },
        ]}
        min={1}
        max={20}
        step={1}
        value={value}
        valueLabel={value}
        valueTestId="provider-max-streams-value"
        onInput={(event) => onInputChange(parseInt((event.target as HTMLInputElement).value, 10))}
        onMouseUp={(event) => onCommit(parseInt((event.target as HTMLInputElement).value, 10))}
        onTouchEnd={(event) => onCommit(parseInt((event.target as HTMLInputElement).value, 10))}
        onBlur={(event) => onCommit(parseInt((event.target as HTMLInputElement).value, 10))}
        testId="provider-max-streams-slider"
      />
    </div>
  );
}

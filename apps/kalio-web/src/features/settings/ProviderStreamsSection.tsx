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
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-base-content/60">Max provider streams</span>
        <span className="badge badge-neutral font-mono text-xs" data-testid="provider-max-streams-value">
          {value}
        </span>
      </div>
      <input
        type="range"
        className="range range-sm range-primary w-full"
        min={1}
        max={20}
        step={1}
        value={value}
        onChange={() => undefined}
        onInput={(event) => onInputChange(parseInt((event.target as HTMLInputElement).value, 10))}
        onMouseUp={(event) => onCommit(parseInt((event.target as HTMLInputElement).value, 10))}
        onTouchEnd={(event) => onCommit(parseInt((event.target as HTMLInputElement).value, 10))}
        onBlur={(event) => onCommit(parseInt((event.target as HTMLInputElement).value, 10))}
        aria-label="Max provider streams"
        data-testid="provider-max-streams-slider"
      />
      <div className="flex justify-between text-[10px] text-base-content/40 mt-1 px-1">
        <span>1</span><span>4</span><span>8</span><span>20</span>
      </div>
    </div>
  );
}

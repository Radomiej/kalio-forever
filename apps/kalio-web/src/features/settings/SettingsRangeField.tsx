import type {
  ChangeEventHandler,
  FocusEventHandler,
  FormEventHandler,
  MouseEventHandler,
  TouchEventHandler,
} from 'react';
import { getSettingsRangeMarkPosition, type SettingsRangeMark } from './settings-range';

interface SettingsRangeFieldProps {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  inputClassName?: string;
  label: string;
  marks?: SettingsRangeMark[];
  max: number;
  min: number;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  onInput?: FormEventHandler<HTMLInputElement>;
  onMouseUp?: MouseEventHandler<HTMLInputElement>;
  onTouchEnd?: TouchEventHandler<HTMLInputElement>;
  step: number;
  testId: string;
  value: number;
  valueLabel: number | string;
  valueTestId?: string;
}

function getMarkTransform(index: number, total: number): string {
  if (index === 0) {
    return 'translateX(0)';
  }

  if (index === total - 1) {
    return 'translateX(-100%)';
  }

  return 'translateX(-50%)';
}

export function SettingsRangeField({
  ariaLabel,
  className,
  disabled = false,
  inputClassName = 'range range-sm range-primary w-full',
  label,
  marks = [],
  max,
  min,
  onBlur,
  onChange,
  onInput,
  onMouseUp,
  onTouchEnd,
  step,
  testId,
  value,
  valueLabel,
  valueTestId,
}: SettingsRangeFieldProps) {
  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs text-base-content/60">{label}</span>
        <span className="badge badge-neutral font-mono text-xs" data-testid={valueTestId ?? `${testId}-value`}>
          {valueLabel}
        </span>
      </div>

      <input
        type="range"
        className={inputClassName}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={onChange ?? (() => undefined)}
        onInput={onInput}
        onMouseUp={onMouseUp}
        onTouchEnd={onTouchEnd}
        onBlur={onBlur}
        aria-label={ariaLabel}
        data-testid={testId}
      />

      {marks.length > 0 ? (
        <div className="relative mt-2 h-5 select-none text-[10px] text-base-content/45" aria-hidden="true">
          {marks.map((mark, index) => (
            <span
              key={`${mark.value}-${mark.label}`}
              className={`absolute top-0 whitespace-nowrap ${
                value === mark.value ? 'text-base-content/75' : ''
              }`}
              style={{
                left: `${getSettingsRangeMarkPosition(min, max, mark.value)}%`,
                transform: getMarkTransform(index, marks.length),
              }}
              data-testid={`${testId}-mark-${mark.value}`}
            >
              {mark.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

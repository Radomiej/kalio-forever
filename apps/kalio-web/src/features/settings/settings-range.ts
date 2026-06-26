export interface SettingsRangeMark {
  label: string;
  value: number;
}

export function getSettingsRangeMarkPosition(min: number, max: number, value: number): number {
  if (max <= min) {
    return 0;
  }

  const normalized = ((value - min) / (max - min)) * 100;
  return Math.min(100, Math.max(0, Number(normalized.toFixed(3))));
}

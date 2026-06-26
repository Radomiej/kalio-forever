import { describe, expect, it } from 'vitest';
import { getSettingsRangeMarkPosition } from './settings-range';

describe('getSettingsRangeMarkPosition', () => {
  it('positions uneven marks proportionally across the slider range', () => {
    expect(getSettingsRangeMarkPosition(1, 10, 1)).toBe(0);
    expect(getSettingsRangeMarkPosition(1, 10, 3)).toBe(22.222);
    expect(getSettingsRangeMarkPosition(1, 10, 5)).toBe(44.444);
    expect(getSettingsRangeMarkPosition(1, 10, 10)).toBe(100);
  });

  it('clamps values outside the range', () => {
    expect(getSettingsRangeMarkPosition(1, 10, -5)).toBe(0);
    expect(getSettingsRangeMarkPosition(1, 10, 15)).toBe(100);
  });

  it('returns zero for invalid ranges', () => {
    expect(getSettingsRangeMarkPosition(10, 10, 10)).toBe(0);
    expect(getSettingsRangeMarkPosition(10, 1, 5)).toBe(0);
  });
});

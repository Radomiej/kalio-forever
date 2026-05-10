import { describe, expect, it } from 'vitest';
import { tileColorFromId, tileSizeForIndex } from './tileColors';

describe('tileColors', () => {
  it('returns deterministic colors for the same app id', () => {
    expect(tileColorFromId('cats-suite')).toEqual(tileColorFromId('cats-suite'));
  });

  it('returns palette entries with background and text colors', () => {
    expect(tileColorFromId('visual-calculator')).toEqual({
      bg: expect.stringMatching(/^#/),
      text: expect.stringMatching(/^#/),
    });
  });

  it('marks every fifth index with offset two as wide', () => {
    expect(tileSizeForIndex(0)).toBe('small');
    expect(tileSizeForIndex(2)).toBe('wide');
    expect(tileSizeForIndex(7)).toBe('wide');
    expect(tileSizeForIndex(8)).toBe('small');
  });
});

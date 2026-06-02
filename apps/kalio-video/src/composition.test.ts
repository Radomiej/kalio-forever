import { describe, expect, it } from 'vitest';
import { KALIO_OVERVIEW_COMPOSITION } from './composition';

describe('Kalio overview composition metadata', () => {
  it('defines a ten second 16:9 product overview composition', () => {
    expect(KALIO_OVERVIEW_COMPOSITION).toEqual({
      id: 'KalioOverview',
      fps: 30,
      width: 1920,
      height: 1080,
      durationInFrames: 300,
    });
  });
});

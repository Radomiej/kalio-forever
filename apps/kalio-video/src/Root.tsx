import { Composition } from 'remotion';
import { KALIO_OVERVIEW_COMPOSITION } from './composition';
import { KalioOverview } from './KalioOverview';

export function RemotionRoot() {
  return (
    <Composition
      id={KALIO_OVERVIEW_COMPOSITION.id}
      component={KalioOverview}
      durationInFrames={KALIO_OVERVIEW_COMPOSITION.durationInFrames}
      fps={KALIO_OVERVIEW_COMPOSITION.fps}
      width={KALIO_OVERVIEW_COMPOSITION.width}
      height={KALIO_OVERVIEW_COMPOSITION.height}
    />
  );
}

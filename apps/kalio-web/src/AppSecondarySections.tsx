import { lazy, Suspense } from 'react';
import type { ActiveSection } from './App.types';

const ObservabilityPage = lazy(() => import('./features/observability/ObservabilityPage')
  .then(({ ObservabilityPage: Page }) => ({ default: Page })));
const ArchitectPage = lazy(() => import('./features/architect')
  .then(({ ArchitectPage: Page }) => ({ default: Page })));

function SectionLoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center" aria-label="Loading section">
      <span className="loading loading-spinner loading-sm text-primary" />
    </div>
  );
}

interface AppSecondarySectionsProps {
  activeSection: ActiveSection;
}

export function AppSecondarySections({ activeSection }: AppSecondarySectionsProps) {
  return (
    <>
      {activeSection === 'observe' && (
        <Suspense fallback={<SectionLoadingFallback />}>
          <ObservabilityPage />
        </Suspense>
      )}
      {activeSection === 'architect' && (
        <Suspense fallback={<SectionLoadingFallback />}>
          <ArchitectPage />
        </Suspense>
      )}
    </>
  );
}

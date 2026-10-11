import type { ComponentProps } from 'react';
import type { EmbeddingStatus } from '@kalio/types';
import { LOCAL_BACKEND_LABELS, LocalEmbeddingConfigCard } from './LocalEmbeddingConfigCard';
import { PROVIDER_LABELS } from './EmbeddingProviderForm';

interface ActiveEmbeddingModelCardProps {
  status: EmbeddingStatus | null;
  localAvailability: ComponentProps<typeof LocalEmbeddingConfigCard>['localAvailability'];
}

export function ActiveEmbeddingModelCard({ status, localAvailability }: ActiveEmbeddingModelCardProps) {
  const availabilityMatches = status?.source === 'local'
    && localAvailability?.model === status.model
    && localAvailability?.backend === status.backend
    && localAvailability?.dimensions === status.dimensions;
  const availability = availabilityMatches ? localAvailability : null;
  let label = 'Checking status…';
  if (status) {
    if (status.source === 'disabled') label = 'Disabled';
    else if (status.source === 'mock') label = 'Test provider';
    else if (status.source !== 'local') label = 'Selected · not tested';
    else if (!availability) label = 'Availability not checked';
    else if (availability.status === 'ready' && availability.installed) label = 'Installed · ready to use';
    else if (availability.status === 'installing') label = 'Installing…';
    else if (availability.status === 'error') label = 'Installation failed';
    else label = 'Not installed · install below';
  }
  const provider = status?.source === 'local' || status?.source === 'disabled'
    ? 'Local embeddings'
    : status?.source === 'mock' ? 'Mock embeddings'
    : status?.source === 'env' ? 'Env Provider'
    : status ? status.activeCredentialName ?? PROVIDER_LABELS[status.provider] ?? status.provider : null;

  return (
    <section className="border border-sky-500/20 bg-sky-500/5 rounded-lg p-4 flex flex-col gap-2 min-w-0" data-testid="embedding-env-card" aria-label="Selected embedding model">
      <h3 className="text-sm font-semibold">Selected embedding model</h3>
      {status && (
        <>
          <p className="text-base font-semibold font-mono break-all">{status.model}</p>
          <p className="text-xs text-base-content/70 break-words"><span>{provider}</span> · {status.dimensions} dimensions</p>
        </>
      )}
      <p className="text-xs font-medium" role="status">{label}</p>
      {status?.source === 'mock' && <p className="text-xs text-base-content/60">Deterministic test provider; no remote model is used.</p>}
      {status?.modelParameters && <p className="text-xs text-base-content/60">Parameters: {status.modelParameters}</p>}
      {status?.source === 'local' && status.backend && (
        <p className="text-xs text-base-content/60">
          Compute: {LOCAL_BACKEND_LABELS[status.backend] ?? status.backend}
          {status.activeBackend ? ` / active ${LOCAL_BACKEND_LABELS[status.activeBackend] ?? status.activeBackend}` : null}
        </p>
      )}
      {status?.source === 'local' && status.backend !== 'cpu' && status.gpuAvailable === false && (
        <p className="text-xs text-base-content/60">GPU unavailable on this machine; CPU will be used.</p>
      )}
    </section>
  );
}

import { useEffect, useState } from 'react';
import type { ExecutionProfile } from '@kalio/types';
import { getDevinCliStatus, type DevinCliStatus } from '../../services/apiClient';

interface Props {
  profiles: ExecutionProfile[];
  model: string;
  onChange: (model: string) => void;
}

const MAX_VISIBLE_MODELS = 100;

export function DevinCliModelSelector({ profiles, model, onChange }: Props) {
  const [status, setStatus] = useState<DevinCliStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getDevinCliStatus(true)
      .then((loaded) => {
        if (cancelled) return;
        setStatus(loaded);
        if (loaded.modelCatalogStatus !== 'ready' || loaded.modelCatalogStale) {
          setError('Could not load a fresh Devin model list. Only saved models can be selected.');
        }
      })
      .catch((loadError: unknown) => {
        console.error('[DevinCliModelSelector] model discovery failed', loadError);
        if (!cancelled) setError('Could not load Devin models. Check Devin CLI status and retry.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [retry]);

  const freshModels = status?.modelCatalogStatus === 'ready' && !status.modelCatalogStale
    ? status.models
    : [];
  const savedModels = profiles
    .filter((profile) => profile.enabled && profile.kind === 'devin-cli-acp')
    .map((profile) => profile.model.trim())
    .filter(Boolean);
  const allModels = [...new Set([...savedModels, ...freshModels, ...(model.trim() ? [model.trim()] : [])])]
    .sort((left, right) => left.localeCompare(right));
  const filteredModels = allModels.filter((candidate) => candidate.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const visibleModels = filteredModels.slice(0, MAX_VISIBLE_MODELS);
  const selectedModel = model.trim();
  if (selectedModel && allModels.includes(selectedModel) && !visibleModels.includes(selectedModel)) {
    visibleModels.unshift(selectedModel);
  }
  const savedModelMissing = Boolean(model.trim() && !freshModels.includes(model) && status?.modelCatalogStatus === 'ready' && !status.modelCatalogStale);

  return (
    <div className="form-control gap-2 md:col-span-2" data-testid="devin-cli-model-selector">
      <label className="label py-0" htmlFor="persona-model-input">
        <span className="label-text text-xs">Devin CLI model</span>
      </label>
      <input
        id="persona-devin-model-search"
        data-testid="persona-devin-model-search"
        aria-label="Search Devin CLI models"
        className="input input-bordered input-sm w-full font-mono"
        placeholder="Filter the discovered models"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <select
        id="persona-model-input"
        data-testid="persona-model-input"
        aria-label="Devin CLI model"
        className="select select-bordered select-sm w-full font-mono"
        value={model}
        disabled={loading || allModels.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose a Devin model</option>
        {visibleModels.map((candidate) => (
          <option key={candidate} value={candidate}>
            {candidate}{savedModelMissing && candidate === model ? ' (saved; not currently discovered)' : ''}
          </option>
        ))}
      </select>
      {filteredModels.length > MAX_VISIBLE_MODELS && (
        <p className="text-xs text-base-content/45" data-testid="persona-devin-model-count">
          Showing {MAX_VISIBLE_MODELS} of {filteredModels.length} models. Filter to narrow the list.
        </p>
      )}
      {loading && <p className="text-xs text-base-content/45" role="status">Loading Devin models…</p>}
      {error && (
        <div className="flex items-center gap-2 text-xs text-warning" data-testid="persona-devin-catalog-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setRetry((count) => count + 1)}>
            Retry
          </button>
        </div>
      )}
      {savedModelMissing && (
        <p className="text-xs text-warning" data-testid="persona-devin-model-warning" role="status">
          The selected saved model is no longer in Devin’s current model catalog. Choose an available model before saving.
        </p>
      )}
    </div>
  );
}

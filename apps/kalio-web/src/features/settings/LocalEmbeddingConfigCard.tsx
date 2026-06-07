import { Loader2 } from 'lucide-react';
import type { EmbeddingStatus, UpdateLocalEmbeddingConfigDto } from '@kalio/types';

export const LOCAL_MODELS = [
  { model: 'Xenova/multilingual-e5-small', dimensions: 384, params: '118M' },
  { model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', dimensions: 384, params: '118M' },
  { model: 'Xenova/multilingual-e5-base', dimensions: 768, params: '278M' },
  { model: 'Xenova/distiluse-base-multilingual-cased-v2', dimensions: 512, params: '135M' },
] as const;

export const LOCAL_BACKEND_LABELS = {
  auto: 'Auto',
  webgpu: 'GPU',
  cpu: 'CPU',
} as const;

interface LocalEmbeddingAvailability {
  status: 'missing' | 'installing' | 'ready' | 'error';
  installed: boolean;
  model: string;
  dimensions: number;
  backend: UpdateLocalEmbeddingConfigDto['backend'];
  message: string | null;
}

interface LocalEmbeddingConfigCardProps {
  form: UpdateLocalEmbeddingConfigDto;
  dirty: boolean;
  syncing: string | null;
  reindexResult: string | null;
  status: EmbeddingStatus | null;
  localTestState: 'idle' | 'testing' | 'ok' | 'error';
  localTestMessage: string | null;
  localConfigWarning: string | null;
  localAvailability: LocalEmbeddingAvailability | null;
  onChange: (form: UpdateLocalEmbeddingConfigDto) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSave: () => void;
  onInstall: () => void;
  onTest: () => void;
  onUseLocal: () => void;
  onReindexAll: () => void;
}

export function LocalEmbeddingConfigCard({
  form,
  dirty,
  syncing,
  reindexResult,
  status,
  localTestState,
  localTestMessage,
  localConfigWarning,
  localAvailability,
  onChange,
  onDirtyChange,
  onSave,
  onInstall,
  onTest,
  onUseLocal,
  onReindexAll,
}: LocalEmbeddingConfigCardProps) {
  const handleModelChange = (model: string) => {
    const preset = LOCAL_MODELS.find((item) => item.model === model);
    onChange({ ...form, model, dimensions: preset?.dimensions ?? form.dimensions });
    onDirtyChange(true);
  };
  const runtimeDiffers = status?.source === 'local'
    && (status.model !== form.model || status.dimensions !== form.dimensions || (status.backend && status.backend !== form.backend));
  const canUseLocal = localAvailability?.status === 'ready';

  return (
    <div className="border border-base-300 rounded-lg p-3 flex flex-col gap-3" data-testid="embedding-local-config">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Local provider</h3>
          <p className="text-xs text-base-content/50">Runs locally by default. Choose a model when needed.</p>
        </div>
        <input
          type="checkbox"
          className="toggle toggle-sm toggle-info"
          checked={form.enabled}
          onChange={(e) => { onChange({ ...form, enabled: e.target.checked }); onDirtyChange(true); }}
          data-testid="embedding-local-enabled"
        />
      </div>
      <div className="grid grid-cols-1 gap-2">
        <select className="select select-bordered select-sm" value={form.model} onChange={(e) => handleModelChange(e.target.value)} data-testid="embedding-local-model">
          {LOCAL_MODELS.map((item) => (
            <option key={item.model} value={item.model}>{item.model} ({item.params})</option>
          ))}
        </select>
      </div>
      <div className="text-xs text-base-content/60 flex flex-col gap-1">
        <span>Saved local model: <span className="font-mono">{form.model}</span> ({form.dimensions}d, {LOCAL_BACKEND_LABELS[form.backend] ?? form.backend})</span>
        {localConfigWarning && (
          <span className="text-warning" data-testid="embedding-local-config-warning">
            {localConfigWarning}
          </span>
        )}
        {runtimeDiffers && (
          <span className="text-warning" data-testid="embedding-local-runtime-mismatch">
            Active runtime differs: <span className="font-mono">{status?.model}</span> ({status?.dimensions}d). Apply local settings or Use local to sync it.
          </span>
        )}
        {localTestMessage && (
          <span className={localTestState === 'ok' ? 'text-success' : localTestState === 'error' ? 'text-error' : ''}>
            {localTestMessage}
          </span>
        )}
        {localAvailability?.message && localTestState === 'idle' && (
          <span
            className={
              localAvailability.status === 'ready'
                ? 'text-success'
                : localAvailability.status === 'error'
                  ? 'text-error'
                  : ''
            }
            data-testid="embedding-local-availability-message"
          >
            {localAvailability.message}
          </span>
        )}
      </div>
      {status?.modelParameters && <span className="text-xs text-base-content/50">Model size: <span className="font-mono">{status.modelParameters}</span></span>}
      {localAvailability?.status === 'installing' && (
        <progress className="progress progress-info w-full" data-testid="embedding-local-install-progress" />
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <button className="btn btn-primary btn-sm" disabled={!dirty || syncing === 'local'} onClick={onSave} data-testid="embedding-local-save">
          {syncing === 'local' ? <Loader2 size={13} className="animate-spin" /> : null}
          Apply local settings
        </button>
        <button
          className="btn btn-outline btn-sm"
          disabled={localAvailability?.status === 'installing' || syncing === 'install-local'}
          onClick={onInstall}
          data-testid="embedding-local-install-btn"
        >
          {localAvailability?.status === 'installing' || syncing === 'install-local' ? <Loader2 size={13} className="animate-spin" /> : null}
          {localAvailability?.status === 'ready' ? 'Reinstall model' : 'Install model'}
        </button>
        <button
          className="btn btn-outline btn-sm"
          disabled={localTestState === 'testing' || localAvailability?.status !== 'ready'}
          onClick={onTest}
          data-testid="embedding-local-test-btn"
        >
          {localTestState === 'testing' ? <Loader2 size={13} className="animate-spin" /> : null}
          Test local
        </button>
        <button className="btn btn-outline btn-sm" disabled={!canUseLocal || syncing === 'use-local'} onClick={onUseLocal} data-testid="embedding-use-local-btn">
          {syncing === 'use-local' ? <Loader2 size={13} className="animate-spin" /> : null}
          Use local
        </button>
        <button className="btn btn-outline btn-sm" disabled={syncing === 'reindex'} onClick={onReindexAll} data-testid="embedding-reindex-all-btn">
          Reindex all
        </button>
        {reindexResult && <span className="text-xs text-success">{reindexResult}</span>}
      </div>
    </div>
  );
}

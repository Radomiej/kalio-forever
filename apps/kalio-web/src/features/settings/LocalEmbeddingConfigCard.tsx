import { Loader2 } from 'lucide-react';
import type { EmbeddingStatus, UpdateLocalEmbeddingConfigDto } from '@kalio/types';

const LOCAL_MODELS = [
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

interface LocalEmbeddingConfigCardProps {
  form: UpdateLocalEmbeddingConfigDto;
  dirty: boolean;
  syncing: string | null;
  reindexPersonaId: string;
  reindexResult: string | null;
  status: EmbeddingStatus | null;
  onChange: (form: UpdateLocalEmbeddingConfigDto) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSave: () => void;
  onUseLocal: () => void;
  onReindex: () => void;
  onReindexAll: () => void;
  onReindexPersonaChange: (personaId: string) => void;
}

export function LocalEmbeddingConfigCard({
  form,
  dirty,
  syncing,
  reindexPersonaId,
  reindexResult,
  status,
  onChange,
  onDirtyChange,
  onSave,
  onUseLocal,
  onReindex,
  onReindexAll,
  onReindexPersonaChange,
}: LocalEmbeddingConfigCardProps) {
  const handleModelChange = (model: string) => {
    const preset = LOCAL_MODELS.find((item) => item.model === model);
    onChange({ ...form, model, dimensions: preset?.dimensions ?? form.dimensions });
    onDirtyChange(true);
  };

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
      {status?.modelParameters && <span className="text-xs text-base-content/50">Model size: <span className="font-mono">{status.modelParameters}</span></span>}
      <div className="flex flex-wrap gap-2 items-center">
        <button className="btn btn-primary btn-sm" disabled={!dirty || syncing === 'local'} onClick={onSave} data-testid="embedding-local-save">
          {syncing === 'local' ? <Loader2 size={13} className="animate-spin" /> : null}
          Apply local settings
        </button>
        <button className="btn btn-outline btn-sm" disabled={syncing === 'use-local'} onClick={onUseLocal} data-testid="embedding-use-local-btn">
          {syncing === 'use-local' ? <Loader2 size={13} className="animate-spin" /> : null}
          Use local
        </button>
        <input className="input input-bordered input-sm w-44" placeholder="persona id" value={reindexPersonaId} onChange={(e) => onReindexPersonaChange(e.target.value)} data-testid="embedding-reindex-persona" />
        <button className="btn btn-outline btn-sm" disabled={syncing === 'reindex'} onClick={onReindex} data-testid="embedding-reindex-btn">
          {syncing === 'reindex' ? <Loader2 size={13} className="animate-spin" /> : null}
          Reindex
        </button>
        <button className="btn btn-outline btn-sm" disabled={syncing === 'reindex'} onClick={onReindexAll} data-testid="embedding-reindex-all-btn">
          Reindex all
        </button>
        {reindexResult && <span className="text-xs text-success">{reindexResult}</span>}
      </div>
    </div>
  );
}

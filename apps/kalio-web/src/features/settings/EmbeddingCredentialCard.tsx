import { useState } from 'react';
import { Check, Loader2, Trash2, Zap } from 'lucide-react';
import type { EmbeddingCredential } from '@kalio/types';

interface EmbeddingCredentialCardProps {
  cred: EmbeddingCredential;
  isActive: boolean;
  providerLabel: string;
  onActivate: () => void;
  onRemove: () => void;
  onTest: () => void;
  testState: 'idle' | 'testing' | 'ok' | 'error';
  testError: string | null;
  syncing: boolean;
}

export function EmbeddingCredentialCard({
  cred,
  isActive,
  providerLabel,
  onActivate,
  onRemove,
  onTest,
  testState,
  testError,
  syncing,
}: EmbeddingCredentialCardProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    <div
      className={`border rounded-lg p-3 flex flex-col gap-2 transition-colors ${isActive ? 'border-sky-500/50 bg-sky-500/5' : 'border-base-300 bg-base-200/30'}`}
      data-testid="embedding-credential-card"
    >
      <div className="flex items-center gap-2">
        {isActive && <Check size={13} className="text-sky-400 shrink-0" />}
        <span className="text-sm font-medium flex-1">{cred.name}</span>
        <span className="badge badge-ghost badge-xs opacity-60">{providerLabel}</span>
        {isActive && <span className="badge badge-info badge-xs">active</span>}
      </div>
      <div className="text-xs text-base-content/60 pl-1 flex flex-col gap-0.5">
        <span>Model: <span className="font-mono">{cred.model}</span></span>
      </div>
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        {!isActive && (
          <button
            className="btn btn-primary btn-xs"
            disabled={syncing}
            onClick={onActivate}
            data-testid="embedding-activate-btn"
          >
            {syncing ? <Loader2 size={11} className="animate-spin" /> : null}
            Activate
          </button>
        )}
        <button
          className={`btn btn-xs gap-1 ${testState === 'ok' ? 'btn-success' : testState === 'error' ? 'btn-error btn-outline' : 'btn-outline btn-primary'}`}
          onClick={onTest}
          disabled={testState === 'testing'}
          data-testid="embedding-test-btn"
        >
          {testState === 'testing' ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
          {testState === 'ok' ? 'OK!' : testState === 'error' ? 'Failed' : 'Test'}
        </button>
        {testError && <span className="text-xs text-error">{testError}</span>}
        <div className="flex-1" />
        {confirmRemove ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-warning">Remove?</span>
            <button className="btn btn-xs btn-error" disabled={syncing} onClick={onRemove}>
              {syncing ? <Loader2 size={11} className="animate-spin" /> : 'Yes'}
            </button>
            <button className="btn btn-xs btn-ghost" onClick={() => setConfirmRemove(false)}>No</button>
          </div>
        ) : (
          <button
            className="btn btn-ghost btn-xs gap-1 text-base-content/40 hover:text-error"
            onClick={() => setConfirmRemove(true)}
            data-testid="embedding-remove-btn"
          >
            <Trash2 size={12} /> Remove
          </button>
        )}
      </div>
    </div>
  );
}

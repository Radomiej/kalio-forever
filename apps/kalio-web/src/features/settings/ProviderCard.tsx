import { useState, useCallback } from 'react';
import {
  Trash2, Check, X, RefreshCw, Plug,
  ChevronDown, ChevronUp, CheckCircle2, Circle, Loader2,
} from 'lucide-react';
import type { Credential } from '@kalio/types';

interface ProviderCardProps {
  credential: Credential;
  isActive: boolean;
  isSyncing: boolean;
  onActivate: (id: string) => void;
  onRemove: (id: string) => void;
}

export function ProviderCard({ credential, isActive, isSyncing, onActivate, onRemove }: ProviderCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testSuccess, setTestSuccess] = useState<boolean | null>(null);
  const [modelCount, setModelCount] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const testConnection = useCallback(async () => {
    setTesting(true);
    setStatus(null);
    setTestSuccess(null);

    try {
      const res = await fetch(`/api/credentials/${credential.id}/test`, { method: 'POST' });
      const json = await res.json() as { ok: boolean; modelCount?: number; error?: string };

      if (json.ok) {
        setTestSuccess(true);
        setModelCount(json.modelCount ?? null);
        setStatus(json.modelCount !== undefined ? `Connected — ${json.modelCount} models available` : 'Connected');
      } else {
        setTestSuccess(false);
        setStatus(`Failed: ${json.error ?? 'unknown error'}`);
      }
    } catch (e) {
      setTestSuccess(false);
      setStatus(`Failed: ${e instanceof Error ? e.message : 'network error'}`);
    } finally {
      setTesting(false);
    }
  }, [credential.id]);

  const showBaseUrl = (credential.provider === 'custom' || credential.provider === 'ollama' || credential.provider === 'bitnet') && !!credential.baseUrl;

  return (
    <div
      className={`border rounded-lg overflow-hidden transition-colors ${isActive ? 'border-sky-500/40 bg-sky-500/5' : 'border-base-300 bg-base-200/50'}`}
      data-testid={`provider-row-${credential.id}`}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-base-300/50"
        onClick={() => setCollapsed((v) => !v)}
      >
        {/* Activate toggle */}
        <button
          className="text-base-content/40 hover:text-sky-400 transition-colors shrink-0"
          onClick={(e) => { e.stopPropagation(); onActivate(credential.id); }}
          title={isActive ? 'Active provider' : 'Set as active'}
          disabled={isSyncing}
          data-testid={`provider-activate-${credential.id}`}
        >
          {isSyncing ? (
            <Loader2 size={16} className="animate-spin" />
          ) : isActive ? (
            <CheckCircle2 size={16} className="text-sky-400" />
          ) : (
            <Circle size={16} />
          )}
        </button>

        {/* Info */}
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <span className="badge badge-sm badge-outline font-mono shrink-0">{credential.provider}</span>
          <span className="font-medium text-sm truncate">{credential.name}</span>
          {credential.model && (
            <span className="text-xs text-base-content/50 font-mono truncate hidden sm:block">{credential.model}</span>
          )}
          {isActive && <span className="badge badge-xs badge-info shrink-0">active</span>}
          {modelCount !== null && testSuccess && (
            <span className="badge badge-xs badge-success gap-1 shrink-0">
              <Check size={10} /> {modelCount} models
            </span>
          )}
          {testSuccess === false && (
            <span className="badge badge-xs badge-error gap-1 shrink-0">
              <X size={10} /> Error
            </span>
          )}
        </div>

        {collapsed ? <ChevronDown size={16} className="shrink-0" /> : <ChevronUp size={16} className="shrink-0" />}
      </div>

      {/* Body (collapsible) */}
      {!collapsed && (
        <div className="px-4 pb-4 space-y-3 border-t border-base-300">
          <div className="mt-3 space-y-1">
            <div className="text-xs text-base-content/50">
              <span className="font-medium">Provider:</span>{' '}
              <span className="font-mono">{credential.provider}</span>
            </div>
            {credential.model && (
              <div className="text-xs text-base-content/50">
                <span className="font-medium">Default model:</span>{' '}
                <span className="font-mono">{credential.model}</span>
              </div>
            )}
            {showBaseUrl && (
              <div className="text-xs text-base-content/50">
                <span className="font-medium">Base URL:</span>{' '}
                <span className="font-mono">{credential.baseUrl}</span>
              </div>
            )}
            <div className="text-xs text-base-content/40 italic">API key stored securely — never exposed</div>
          </div>

          {/* Status */}
          {status && (
            <div className={`text-xs ${testSuccess ? 'text-success' : 'text-error'}`}>
              {status}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <button
              className={`btn btn-xs gap-1 ${testSuccess === true ? 'btn-success' : testSuccess === false ? 'btn-error btn-outline' : 'btn-outline btn-primary'}`}
              onClick={(e) => { e.stopPropagation(); void testConnection(); }}
              disabled={testing}
              data-testid={`provider-test-${credential.id}`}
            >
              {testing ? (
                <><RefreshCw size={12} className="animate-spin" /> Testing…</>
              ) : testSuccess === true ? (
                <><Check size={12} /> Connected</>
              ) : (
                <><Plug size={12} /> Test Connection</>
              )}
            </button>

            {confirmRemove ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-warning">
                  {isActive ? 'Active provider — remove anyway?' : 'Remove this credential?'}
                </span>
                <button
                  className="btn btn-xs btn-error"
                  onClick={() => { onRemove(credential.id); setConfirmRemove(false); }}
                >
                  Yes
                </button>
                <button className="btn btn-xs btn-ghost" onClick={() => setConfirmRemove(false)}>
                  No
                </button>
              </div>
            ) : (
              <button
                className="btn btn-xs btn-ghost text-error hover:bg-error/10"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isActive) { setConfirmRemove(true); } else { onRemove(credential.id); }
                }}
                disabled={isSyncing}
                data-testid={`provider-remove-${credential.id}`}
              >
                <Trash2 size={12} /> Remove
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


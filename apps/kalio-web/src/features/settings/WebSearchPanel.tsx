import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Loader2, Zap, Check, ExternalLink } from 'lucide-react';

type SearchProvider = 'perplexity' | 'perplexity-openrouter';

interface SearchConfig {
  provider: SearchProvider;
  configured: boolean;
  apiKeyMasked: string | null;
}

const PROVIDER_INFO: Record<SearchProvider, { label: string; placeholder: string; docsUrl: string }> = {
  'perplexity': {
    label: 'Perplexity (direct)',
    placeholder: 'pplx-…',
    docsUrl: 'https://docs.perplexity.ai/',
  },
  'perplexity-openrouter': {
    label: 'Perplexity via OpenRouter',
    placeholder: 'sk-or-…',
    docsUrl: 'https://openrouter.ai/models/perplexity',
  },
};

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function WebSearchPanel() {
  const [config, setConfig] = useState<SearchConfig | null>(null);
  const [provider, setProvider] = useState<SearchProvider>('perplexity');
  const [apiKey, setApiKey] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await apiFetch<SearchConfig>('/search/config');
      setConfig(cfg);
      setProvider(cfg.provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleTest = async () => {
    setTestState('testing');
    setTestMsg(null);
    try {
      const res = await apiFetch<{ ok: boolean; error?: string }>('/search/test', { method: 'POST' });
      if (res.ok) {
        setTestState('ok');
        setTestMsg('Connection successful');
      } else {
        setTestState('error');
        setTestMsg(res.error ?? 'Test failed');
      }
    } catch (e) {
      setTestState('error');
      setTestMsg(e instanceof Error ? e.message : 'Network error');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<SearchConfig>('/search/config', {
        method: 'PUT',
        body: JSON.stringify({ provider, apiKey: apiKey || undefined }),
      });
      setConfig(updated);
      setApiKey('');
      setShowForm(false);
      setTestState('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const providerInfo = PROVIDER_INFO[provider];

  return (
    <div className="flex flex-col gap-5" data-testid="web-search-panel">
      <div>
        <h2 className="text-base font-semibold mb-1">Web Search</h2>
        <p className="text-xs text-base-content/60">
          Configure the <code className="font-mono">web_search</code> tool. Powered by Perplexity AI —
          provides real-time search with citations. Requires a Perplexity API key.
        </p>
      </div>

      {error && (
        <div className="alert alert-warning py-2 text-xs gap-2">
          <AlertCircle size={14} />
          {error}
          <button className="btn btn-ghost btn-xs ml-auto" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-base-content/50 py-4">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {/* Current status */}
          {config && (
            <div className={`border rounded-lg p-4 flex flex-col gap-1 ${config.configured ? 'border-sky-500/30 bg-sky-500/5' : 'border-base-300 bg-base-200/50'}`}>
              <div className="flex items-center gap-2 text-sm font-medium">
                {config.configured ? (
                  <Check size={14} className="text-sky-400 shrink-0" />
                ) : (
                  <AlertCircle size={14} className="text-warning shrink-0" />
                )}
                <span>{config.configured ? 'Configured' : 'Not configured'}</span>
                {config.configured && (
                  <button
                    className={`btn btn-ghost btn-xs ml-auto gap-1 ${testState === 'ok' ? 'text-success' : testState === 'error' ? 'text-error' : 'text-base-content/60'}`}
                    onClick={() => void handleTest()}
                    disabled={testState === 'testing'}
                  >
                    {testState === 'testing' ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                    {testState === 'ok' ? 'Connected!' : testState === 'error' ? 'Failed' : 'Test'}
                  </button>
                )}
              </div>
              {config.configured && (
                <div className="text-xs text-base-content/60 ml-5 flex flex-col gap-0.5">
                  <span>Provider: <span className="font-mono">{PROVIDER_INFO[config.provider]?.label ?? config.provider}</span></span>
                  <span>API key: <span className="font-mono">{config.apiKeyMasked}</span></span>
                </div>
              )}
              {!config.configured && (
                <p className="text-xs text-base-content/50 ml-5">
                  The <code className="font-mono">web_search</code> tool is available but will return an error until configured.
                </p>
              )}
              {testMsg && (
                <div className={`text-xs ml-5 flex gap-1 items-center mt-1 ${testState === 'ok' ? 'text-success' : 'text-error'}`}>
                  <AlertCircle size={12} /> {testMsg}
                </div>
              )}
            </div>
          )}

          {/* Configure form */}
          {showForm ? (
            <form
              className="flex flex-col gap-3 border border-base-300 rounded-lg p-4 bg-base-200/40"
              onSubmit={(e) => void handleSave(e)}
              data-testid="search-config-form"
            >
              <h3 className="text-sm font-semibold">Configure Web Search</h3>

              <div className="flex flex-col gap-1">
                <span className="text-xs text-base-content/60">Provider</span>
                <div className="flex gap-2">
                  {(Object.keys(PROVIDER_INFO) as SearchProvider[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`btn btn-xs ${provider === p ? 'btn-primary' : 'btn-ghost border border-base-300'}`}
                      onClick={() => { setProvider(p); setTestState('idle'); }}
                    >
                      {PROVIDER_INFO[p].label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1 text-xs text-base-content/50">
                <a
                  href={providerInfo.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link link-hover flex items-center gap-1"
                >
                  Get API key <ExternalLink size={10} />
                </a>
              </div>

              <label className="form-control gap-1">
                <span className="text-xs text-base-content/60">API Key</span>
                <input
                  className="input input-bordered input-sm font-mono"
                  type="password"
                  placeholder={providerInfo.placeholder}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </label>

              <div className="flex gap-2 items-center justify-between">
                <div />
                <div className="flex gap-2">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShowForm(false); setTestState('idle'); }}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                    {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                    Save
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <button
              className="btn btn-ghost btn-sm gap-2 self-start text-sky-400 hover:text-sky-300"
              onClick={() => setShowForm(true)}
              data-testid="configure-search-btn"
            >
              {config?.configured ? 'Change credentials' : 'Configure'}
            </button>
          )}

          <div className="text-xs text-base-content/40 border-t border-base-300 pt-3">
            Tip: You can also set <code className="font-mono">PERPLEXITY_API_KEY</code> in{' '}
            <code className="font-mono">.env</code>. Settings configured here take precedence.
          </div>
        </>
      )}
    </div>
  );
}

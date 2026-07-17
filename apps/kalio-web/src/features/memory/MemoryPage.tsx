import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { Search, BrainCircuit, Plus, Database, Sparkles, TextSearch, Globe2, Users } from 'lucide-react';
import { apiClient } from '../../services/apiClient';
import type {
  Persona,
  MemoryScopeStats,
  MemoryScopeSummary,
  MemorySearchResult,
  MemorySearchMode,
  MemoryIngestResult,
} from '@kalio/types';
import { ModeButton, ResultCard } from './MemoryPage.Parts';

type FreshnessReason = 'load' | 'search' | 'browse' | 'ingest' | 'delete';
type MemoryScopeId = 'all' | 'web_search' | string;

function formatKb(size: number) {
  return `${(size / 1024).toFixed(1)} KB`;
}

function withScope(result: MemorySearchResult, scopeLabel: string, scopeId: string): MemorySearchResult {
  return {
    ...result,
    metadata: {
      ...(result.metadata ?? {}),
      scope: scopeLabel,
      scopeId,
    },
  };
}

function ScopeCard({
  stat,
  icon,
  selected,
  onClick,
  testId,
}: {
  stat: MemoryScopeStats;
  icon: ReactNode;
  selected: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      className={`min-h-20 rounded-xl border px-4 py-3 text-left transition ${
        selected
          ? 'border-primary/60 bg-primary/12 text-base-content'
          : 'border-base-300 bg-base-200/40 hover:border-primary/50 hover:bg-base-200/70'
      }`}
      onClick={onClick}
      data-testid={testId}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-primary">{icon}</span>
          <span className="truncate text-sm font-semibold">{stat.label}</span>
        </span>
        <span className="badge badge-sm badge-ghost">{stat.count}</span>
      </span>
      <span className="mt-3 flex items-center gap-3 text-xs text-base-content/55">
        <span>Stored memory</span>
        <span>{formatKb(stat.size)}</span>
      </span>
    </button>
  );
}

export function MemoryPage() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [summary, setSummary] = useState<MemoryScopeSummary | null>(null);
  const [selectedScopeId, setSelectedScopeId] = useState<MemoryScopeId>('all');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<MemorySearchMode>('hybrid');
  const [results, setResults] = useState<MemorySearchResult[]>([]);
  const [browseMode, setBrowseMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [ingestText, setIngestText] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [freshness, setFreshness] = useState<{ reason: FreshnessReason; at: number } | null>(null);

  const selectedPersona = personas.find((persona) => persona.id === selectedScopeId) ?? null;
  const selectedStat = selectedScopeId === 'all'
    ? { id: 'all', label: 'All memory', count: summary?.totalCount ?? 0, size: summary?.totalSize ?? 0 }
    : selectedScopeId === 'web_search'
      ? summary?.webSearch
      : summary?.personas.find((stat) => stat.id === selectedScopeId);
  const canIngest = Boolean(selectedPersona);

  const touchFreshness = useCallback((reason: FreshnessReason) => {
    setFreshness({ reason, at: Date.now() });
  }, []);

  const loadSummary = useCallback(async (nextPersonas: Persona[]) => {
    const { data } = await apiClient.get<MemoryScopeSummary>('/api/memory/summary', {
      params: {
        personaIds: nextPersonas.map((persona) => persona.id).join(','),
        personaLabels: nextPersonas.map((persona) => persona.name).join(','),
      },
    });
    setSummary(data);
    touchFreshness('load');
  }, [touchFreshness]);

  const loadPersonas = useCallback(async () => {
    try {
      const { data } = await apiClient.get<Persona[]>('/api/personas');
      setPersonas(data);
      await loadSummary(data);
    } catch (err) {
      console.error('[MemoryPage] failed to load memory scopes', err);
    }
  }, [loadSummary]);

  useEffect(() => {
    void loadPersonas();
  }, [loadPersonas]);

  const loadScopeEntries = useCallback(async (scopeId: MemoryScopeId): Promise<MemorySearchResult[]> => {
    if (scopeId === 'web_search') {
      const { data } = await apiClient.get<MemorySearchResult[]>('/api/memory/web-search');
      return data.map((result) => withScope(result, 'Web search', 'web_search'));
    }

    if (scopeId !== 'all') {
      const persona = personas.find((item) => item.id === scopeId);
      const { data } = await apiClient.get<MemorySearchResult[]>(`/api/memory/${scopeId}`);
      return data.map((result) => withScope(result, persona?.name ?? scopeId, scopeId));
    }

    const personaEntries = await Promise.all(
      personas.map(async (persona) => {
        const { data } = await apiClient.get<MemorySearchResult[]>(`/api/memory/${persona.id}`);
        return data.map((result) => withScope(result, persona.name, persona.id));
      })
    );
    const { data: webResults } = await apiClient.get<MemorySearchResult[]>('/api/memory/web-search');
    return [
      ...webResults.map((result) => withScope(result, 'Web search', 'web_search')),
      ...personaEntries.flat(),
    ];
  }, [personas]);

  const searchScope = useCallback(async (scopeId: MemoryScopeId, value: string): Promise<MemorySearchResult[]> => {
    if (scopeId === 'web_search') {
      const { data } = await apiClient.get<MemorySearchResult[]>('/api/memory/web-search', {
        params: { query: value, limit: 10 },
      });
      return data.map((result) => withScope(result, 'Web search', 'web_search'));
    }

    if (scopeId !== 'all') {
      const persona = personas.find((item) => item.id === scopeId);
      const { data } = await apiClient.get<MemorySearchResult[]>('/api/memory/search', {
        params: { query: value, personaId: scopeId, limit: 10, mode },
      });
      return data.map((result) => withScope(result, persona?.name ?? scopeId, scopeId));
    }

    const personaResults = await Promise.all(
      personas.map(async (persona) => {
        const { data } = await apiClient.get<MemorySearchResult[]>('/api/memory/search', {
          params: { query: value, personaId: persona.id, limit: 8, mode },
        });
        return data.map((result) => withScope(result, persona.name, persona.id));
      })
    );
    const { data: webResults } = await apiClient.get<MemorySearchResult[]>('/api/memory/web-search', {
      params: { query: value, limit: 8 },
    });
    return [
      ...webResults.map((result) => withScope(result, 'Web search', 'web_search')),
      ...personaResults.flat(),
    ].sort((a, b) => b.score - a.score);
  }, [mode, personas]);

  const selectScope = async (scopeId: MemoryScopeId) => {
    setSelectedScopeId(scopeId);
    setIngestOpen(false);
    setLoading(true);
    setBrowseMode(true);
    try {
      setResults(await loadScopeEntries(scopeId));
      touchFreshness('browse');
    } catch (err) {
      console.error('[MemoryPage] browse scope failed', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    const value = query.trim();
    if (!value) return;
    setBrowseMode(false);
    setLoading(true);
    try {
      setResults(await searchScope(selectedScopeId, value));
      touchFreshness('search');
    } catch (err) {
      console.error('[MemoryPage] search failed', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleIngest = async () => {
    if (!selectedPersona || !ingestText.trim()) return;
    setIngesting(true);
    try {
      const { data } = await apiClient.post<MemoryIngestResult>('/api/memory/ingest', {
        text: ingestText.trim(),
        personaId: selectedPersona.id,
      });
      setIngestText('');
      setIngestOpen(false);
      await loadSummary(personas);
      setResults(await loadScopeEntries(selectedPersona.id));
      touchFreshness('ingest');
      alert(`Ingested ${data.count} chunks`);
    } catch (err) {
      console.error('[MemoryPage] ingest failed', err);
      alert('Ingest failed');
    } finally {
      setIngesting(false);
    }
  };

  const handleBrowseAll = async () => {
    setLoading(true);
    setBrowseMode(true);
    try {
      setResults(await loadScopeEntries(selectedScopeId));
      touchFreshness('browse');
    } catch (err) {
      console.error('[MemoryPage] browse all failed', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (result: MemorySearchResult) => {
    const personaId = result.metadata?.scopeId;
    if (!personaId || personaId === 'web_search') return;
    if (!confirm('Delete this memory entry?')) return;
    try {
      await apiClient.delete(`/api/memory/${personaId}/${result.id}`);
      setResults((prev) => prev.filter((item) => item.id !== result.id));
      await loadSummary(personas);
      touchFreshness('delete');
    } catch (err) {
      console.error('[MemoryPage] delete failed', err);
    }
  };

  return (
    <div data-testid="memory-page" className="flex h-full flex-col overflow-hidden bg-base-100">
      <div className="flex shrink-0 items-center justify-between border-b border-base-300 px-4 py-3">
        <div className="flex items-center gap-2">
          <BrainCircuit size={20} className="text-primary" />
          <h2 className="text-lg font-semibold">Memory</h2>
          <span className="badge badge-ghost badge-sm">{summary?.totalCount ?? 0} entries</span>
        </div>
        <button
          className="btn btn-primary btn-sm gap-1"
          onClick={() => setIngestOpen((value) => !value)}
          disabled={!canIngest}
          title={canIngest ? 'Add memory to selected persona' : 'Select a persona scope to add memory'}
          data-testid="memory-ingest-btn"
        >
          <Plus size={14} />
          Add
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-4 border-b border-base-300 bg-base-200/40 px-4 py-2 text-xs text-base-content/60">
        <span className="flex items-center gap-1">
          <Database size={12} />
          {selectedStat?.count ?? 0} entries
        </span>
        <span className="flex items-center gap-1">
          <TextSearch size={12} />
          {formatKb(selectedStat?.size ?? 0)}
        </span>
        <span className="text-primary">{selectedStat?.label ?? 'All memory'}</span>
        <span className="ml-auto flex items-center gap-1 text-base-content/70" data-testid="memory-freshness">
          Sync:
          {freshness ? `${freshness.reason} @ ${new Date(freshness.at).toLocaleTimeString()}` : 'not yet'}
        </span>
      </div>

      {ingestOpen && selectedPersona && (
        <div className="shrink-0 border-b border-base-300 bg-base-200/30 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/50">
            Add to {selectedPersona.name}
          </p>
          <textarea
            className="textarea textarea-bordered w-full resize-none"
            rows={4}
            placeholder="Enter text to add to memory..."
            value={ingestText}
            onChange={(event) => setIngestText(event.target.value)}
            data-testid="memory-ingest-textarea"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button className="btn btn-ghost btn-sm" onClick={() => setIngestOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm gap-1"
              onClick={() => void handleIngest()}
              disabled={ingesting || !ingestText.trim()}
              data-testid="memory-ingest-submit"
            >
              {ingesting ? 'Adding...' : 'Add to Memory'}
            </button>
          </div>
        </div>
      )}

      <div className="shrink-0 border-b border-base-300 p-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              className="input input-bordered w-full pr-10"
              placeholder={`Search ${selectedStat?.label ?? 'all memory'}...`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void handleSearch()}
              data-testid="memory-search-input"
            />
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/40" />
          </div>
          <button
            className="btn btn-primary gap-1"
            onClick={() => void handleSearch()}
            disabled={loading || !query.trim()}
            data-testid="memory-search-btn"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
          <button
            className="btn btn-outline gap-1"
            onClick={() => void handleBrowseAll()}
            disabled={loading}
            data-testid="memory-browse-btn"
            title="Show selected scope entries"
          >
            Browse
          </button>
        </div>

        <div className="mt-3 flex gap-1">
          <ModeButton mode="hybrid" current={mode} onClick={() => setMode('hybrid')} label="Hybrid" icon={<Sparkles size={14} />} />
          <ModeButton mode="vector" current={mode} onClick={() => setMode('vector')} label="Vector" icon={<BrainCircuit size={14} />} />
          <ModeButton mode="fts" current={mode} onClick={() => setMode('fts')} label="Text" icon={<TextSearch size={14} />} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {summary && (
          <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="memory-scope-overview">
            <ScopeCard
              stat={{ id: 'all', label: 'All memory', count: summary.totalCount, size: summary.totalSize }}
              icon={<Database size={16} />}
              selected={selectedScopeId === 'all'}
              onClick={() => void selectScope('all')}
              testId="memory-scope-all"
            />
            <ScopeCard
              stat={summary.webSearch}
              icon={<Globe2 size={16} />}
              selected={selectedScopeId === 'web_search'}
              onClick={() => void selectScope('web_search')}
              testId="memory-scope-web_search"
            />
            {summary.personas.map((stat) => (
              <ScopeCard
                key={stat.id}
                stat={stat}
                icon={<Users size={16} />}
                selected={selectedScopeId === stat.id}
                onClick={() => void selectScope(stat.id)}
                testId={`memory-scope-persona-${stat.id}`}
              />
            ))}
          </div>
        )}

        {results.length === 0 ? (
          <div className="py-12 text-center text-base-content/40">
            {loading ? (
              <span className="loading loading-spinner loading-md"></span>
            ) : (
              <>
                <BrainCircuit size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">
                  {browseMode
                    ? 'No entries in this scope'
                    : query.trim()
                      ? 'No results found'
                      : 'Search globally or open a memory scope above'}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {browseMode && (
              <p className="mb-2 text-xs text-base-content/40">
                Showing {results.length} entr{results.length === 1 ? 'y' : 'ies'} from {selectedStat?.label ?? 'selected scope'}
              </p>
            )}
            {results.map((result, index) => (
              <ResultCard
                key={`${result.metadata?.scopeId ?? 'scope'}-${result.id}`}
                result={result}
                index={index}
                onDelete={() => void handleDelete(result)}
                canDelete={result.metadata?.scopeId !== 'web_search'}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { Search, BrainCircuit, Trash2, Plus, ChevronDown, ChevronUp, Database, Sparkles, TextSearch } from 'lucide-react';
import { apiClient } from '../../services/apiClient';
import type { Persona, MemorySearchResult, MemorySearchMode, MemoryIngestResult } from '@kalio/types';

export function MemoryPage() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<MemorySearchMode>('hybrid');
  const [results, setResults] = useState<MemorySearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [ingestText, setIngestText] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [stats, setStats] = useState<{ count: number; size: number } | null>(null);

  // Load personas on mount
  useEffect(() => {
    apiClient
      .get<Persona[]>('/api/personas')
      .then((r) => {
        setPersonas(r.data);
        if (r.data.length > 0 && !selectedPersonaId) {
          setSelectedPersonaId(r.data[0]!.id);
        }
      })
      .catch((err) => console.error('[MemoryPage] failed to load personas', err));
  }, [selectedPersonaId]);

  // Load stats when persona changes
  useEffect(() => {
    if (!selectedPersonaId) return;
    loadStats();
  }, [selectedPersonaId]);

  const loadStats = useCallback(() => {
    if (!selectedPersonaId) return;
    apiClient
      .get<MemorySearchResult[]>(`/api/memory/${selectedPersonaId}`)
      .then((r) => {
        const entries = r.data;
        const totalSize = entries.reduce((acc, item) => acc + item.content.length, 0);
        setStats({ count: entries.length, size: totalSize });
      })
      .catch(() => setStats(null));
  }, [selectedPersonaId]);

  const handleSearch = async () => {
    if (!selectedPersonaId || !query.trim()) return;
    setLoading(true);
    try {
      const { data } = await apiClient.get<MemorySearchResult[]>('/api/memory/search', {
        params: {
          query: query.trim(),
          personaId: selectedPersonaId,
          limit: 10,
          mode,
        },
      });
      setResults(data);
    } catch (err) {
      console.error('[MemoryPage] search failed', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleIngest = async () => {
    if (!selectedPersonaId || !ingestText.trim()) return;
    setIngesting(true);
    try {
      const { data } = await apiClient.post<MemoryIngestResult>('/api/memory/ingest', {
        text: ingestText.trim(),
        personaId: selectedPersonaId,
      });
      setIngestText('');
      setIngestOpen(false);
      loadStats();
      alert(`Ingested ${data.count} chunks`);
    } catch (err) {
      console.error('[MemoryPage] ingest failed', err);
      alert('Ingest failed');
    } finally {
      setIngesting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!selectedPersonaId) return;
    if (!confirm('Delete this memory entry?')) return;
    try {
      await apiClient.delete(`/api/memory/${selectedPersonaId}/${id}`);
      setResults((prev) => prev.filter((r) => r.id !== id));
      loadStats();
    } catch (err) {
      console.error('[MemoryPage] delete failed', err);
    }
  };

  const selectedPersona = personas.find((p) => p.id === selectedPersonaId);

  return (
    <div data-testid="memory-page" className="flex flex-col h-full overflow-hidden bg-base-100">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-base-300 shrink-0">
        <div className="flex items-center gap-2">
          <BrainCircuit size={20} className="text-primary" />
          <h2 className="text-lg font-semibold">Memory</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* Persona Selector */}
          <select
            className="select select-bordered select-sm"
            value={selectedPersonaId}
            onChange={(e) => setSelectedPersonaId(e.target.value)}
            data-testid="memory-persona-select"
          >
            <option value="">Select persona...</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            className="btn btn-primary btn-sm gap-1"
            onClick={() => setIngestOpen((v) => !v)}
            disabled={!selectedPersonaId}
            data-testid="memory-ingest-btn"
          >
            <Plus size={14} />
            Add
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="px-4 py-2 bg-base-200/50 border-b border-base-300 text-xs text-base-content/60 flex items-center gap-4 shrink-0">
          <span className="flex items-center gap-1">
            <Database size={12} />
            {stats.count} entries
          </span>
          <span className="flex items-center gap-1">
            <TextSearch size={12} />
            {(stats.size / 1024).toFixed(1)} KB
          </span>
          {selectedPersona && (
            <span className="ml-auto text-primary">{selectedPersona.name}</span>
          )}
        </div>
      )}

      {/* Ingest Panel */}
      {ingestOpen && (
        <div className="p-4 border-b border-base-300 bg-base-200/30 shrink-0">
          <textarea
            className="textarea textarea-bordered w-full resize-none"
            rows={4}
            placeholder="Enter text to add to memory..."
            value={ingestText}
            onChange={(e) => setIngestText(e.target.value)}
            data-testid="memory-ingest-textarea"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setIngestOpen(false)}
            >
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

      {/* Search Bar */}
      <div className="p-4 border-b border-base-300 shrink-0">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type="text"
              className="input input-bordered w-full pr-10"
              placeholder="Search memory..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              data-testid="memory-search-input"
            />
            <Search
              size={16}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/40"
            />
          </div>
          <button
            className="btn btn-primary gap-1"
            onClick={() => void handleSearch()}
            disabled={loading || !selectedPersonaId || !query.trim()}
            data-testid="memory-search-btn"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {/* Mode Toggle */}
        <div className="flex gap-1 mt-3">
          <ModeButton
            mode="hybrid"
            current={mode}
            onClick={() => setMode('hybrid')}
            label="Hybrid"
            icon={<Sparkles size={14} />}
          />
          <ModeButton
            mode="vector"
            current={mode}
            onClick={() => setMode('vector')}
            label="Vector"
            icon={<BrainCircuit size={14} />}
          />
          <ModeButton
            mode="fts"
            current={mode}
            onClick={() => setMode('fts')}
            label="Text"
            icon={<TextSearch size={14} />}
          />
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4">
        {results.length === 0 ? (
          <div className="text-center text-base-content/40 py-12">
            {loading ? (
              <span className="loading loading-spinner loading-md"></span>
            ) : (
              <>
                <BrainCircuit size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">
                  {query.trim()
                    ? 'No results found'
                    : 'Search to find memories'}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {results.map((result, index) => (
              <ResultCard
                key={result.id}
                result={result}
                index={index}
                onDelete={() => handleDelete(result.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ModeButton({
  mode,
  current,
  onClick,
  label,
  icon,
}: {
  mode: MemorySearchMode;
  current: MemorySearchMode;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  const active = mode === current;
  return (
    <button
      className={`btn btn-sm gap-1 ${active ? 'btn-primary' : 'btn-ghost'}`}
      onClick={onClick}
      data-testid={`memory-mode-${mode}`}
    >
      {icon}
      {label}
    </button>
  );
}

function ResultCard({
  result,
  index,
  onDelete,
}: {
  result: MemorySearchResult;
  index: number;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(index < 3);

  return (
    <div
      className="border border-base-300 rounded-lg bg-base-200/30 overflow-hidden"
      data-testid="memory-result"
    >
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="badge badge-sm badge-primary">
              {(result.score * 100).toFixed(0)}%
            </span>
            <span className="text-xs text-base-content/40 font-mono">
              {new Date(result.createdAt).toLocaleDateString()}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="btn btn-ghost btn-xs p-1 h-6 w-6"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            <button
              className="btn btn-ghost btn-xs p-1 h-6 w-6 text-error hover:bg-error/10"
              onClick={onDelete}
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {expanded ? (
          <p className="mt-2 text-sm whitespace-pre-wrap">{result.content}</p>
        ) : (
          <p className="mt-2 text-sm line-clamp-2">{result.content}</p>
        )}

        {result.metadata && Object.keys(result.metadata).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {Object.entries(result.metadata).map(([key, value]) => (
              <span
                key={key}
                className="badge badge-xs badge-ghost"
                title={`${key}: ${value}`}
              >
                {key}: {value.slice(0, 20)}{value.length > 20 ? '...' : ''}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

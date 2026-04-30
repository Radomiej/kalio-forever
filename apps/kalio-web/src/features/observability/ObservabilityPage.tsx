import { useState, useEffect, useRef, useCallback } from 'react';
import {
  BrainCircuit, Wrench, CheckCircle2, XCircle, ChevronDown,
  RefreshCw, Zap, Play, Pause, Search, X, Trash2,
} from 'lucide-react';
import type { AuditType, AuditLogEntry } from '@kalio/types';
import { FriendlyId } from '../../components/ui/FriendlyId';
import { useSessionStore } from '../../store/sessionStore';

// ─── Config ───────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<AuditType, { icon: React.ReactNode; cls: string; bg: string; short: string; label: string }> = {
  llm_request:          { icon: <BrainCircuit size={12} />, cls: 'text-sky-400',     bg: 'bg-sky-400/10',     short: 'LLM →',   label: 'LLM Request' },
  llm_response:         { icon: <BrainCircuit size={12} />, cls: 'text-sky-400',     bg: 'bg-sky-400/10',     short: '← LLM',   label: 'LLM Response' },
  tool_call:            { icon: <Wrench size={12} />,        cls: 'text-emerald-400', bg: 'bg-emerald-400/10', short: 'Tool →',  label: 'Tool Call' },
  tool_result:          { icon: <CheckCircle2 size={12} />,  cls: 'text-emerald-400', bg: 'bg-emerald-400/10', short: '← Tool',  label: 'Tool Result' },
  error:                { icon: <XCircle size={12} />,       cls: 'text-error',       bg: 'bg-error/10',       short: 'Error',   label: 'Error' },
  raapp_native_call:    { icon: <Zap size={12} />,           cls: 'text-warning',     bg: 'bg-warning/10',     short: 'RA call', label: 'RA-App Native Call' },
  raapp_native_approved:{ icon: <CheckCircle2 size={12} />,  cls: 'text-warning',     bg: 'bg-warning/10',     short: 'RA ok',   label: 'RA-App Approved' },
};

const ALL_TYPES = Object.keys(TYPE_CONFIG) as AuditType[];

type TimeRange = 'live' | '1h' | '6h' | '24h' | '7d' | 'all';
const TIME_RANGES: { id: TimeRange; label: string; ms: number | null }[] = [
  { id: 'live', label: 'Live', ms: 5 * 60 * 1000 },
  { id: '1h',   label: '1h',  ms: 60 * 60 * 1000 },
  { id: '6h',   label: '6h',  ms: 6 * 60 * 60 * 1000 },
  { id: '24h',  label: '24h', ms: 24 * 60 * 60 * 1000 },
  { id: '7d',   label: '7d',  ms: 7 * 24 * 60 * 60 * 1000 },
  { id: 'all',  label: 'All', ms: null },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatMs(ms: number | null) {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function isSameDay(a: number, b: number) {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() &&
         da.getMonth() === db.getMonth() &&
         da.getDate() === db.getDate();
}

/** True for strings that look like bare nanoid/UUID IDs (no spaces, 15-36 chars). */
function isRawId(s: string): boolean {
  return s.length >= 15 && s.length <= 36 && /^[A-Za-z0-9_-]+$/.test(s);
}

// ─── EntryRow ─────────────────────────────────────────────────────────────────

function EntryRow({ entry, sessionTitles }: { entry: AuditLogEntry; sessionTitles: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const cfg = TYPE_CONFIG[entry.type] ?? TYPE_CONFIG.error;
  const sessionTitle = entry.sessionId ? sessionTitles[entry.sessionId] : undefined;

  return (
    <div className={`rounded-lg border border-base-300 px-3 py-2 ${cfg.bg} transition-all`}>
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        {/* type badge */}
        <span className={`shrink-0 flex items-center gap-1 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${cfg.cls} bg-base-300`}>
          {cfg.icon}
          {cfg.short}
        </span>

        {/* label — auto-convert bare IDs to FriendlyId */}
        {isRawId(entry.label) ? (
          <FriendlyId id={entry.label} context="Msg" className="flex-1" />
        ) : (
          <span className="text-xs text-base-content/90 flex-1 truncate min-w-0">{entry.label}</span>
        )}

        {/* chunkCount badge for llm_response */}
        {entry.type === 'llm_response' && entry.chunkCount != null && (
          <span className="text-[10px] font-mono text-sky-400/70 shrink-0">{entry.chunkCount}c</span>
        )}

        {/* duration */}
        {entry.durationMs != null && (
          <span className={`text-[10px] font-mono shrink-0 ${entry.durationMs > 5000 ? 'text-warning' : 'text-base-content/40'}`}>
            {formatMs(entry.durationMs)}
          </span>
        )}

        {/* session */}
        {entry.sessionId && (
          <FriendlyId
            id={entry.sessionId}
            context="Session"
            resolvedTitle={sessionTitle}
            className="shrink-0"
          />
        )}

        {/* time */}
        <span className="text-[10px] font-mono text-base-content/35 shrink-0">{formatTime(entry.createdAt)}</span>

        {/* expand */}
        {entry.data && (
          <button
            className="shrink-0 text-base-content/30 hover:text-base-content/60 ml-0.5"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle data"
          >
            <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {open && entry.data && (
        <pre className="mt-2 text-[10px] font-mono text-base-content/55 bg-base-300/60 rounded px-2 py-1.5 overflow-x-auto max-h-40 whitespace-pre-wrap">
          {JSON.stringify(entry.data, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function StatsBar({ entries }: { entries: AuditLogEntry[] }) {
  const counts = ALL_TYPES.reduce((acc, t) => {
    acc[t] = entries.filter((e) => e.type === t).length;
    return acc;
  }, {} as Record<AuditType, number>);

  const nonZero = ALL_TYPES.filter((t) => counts[t] > 0);
  if (nonZero.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {nonZero.map((t) => {
        const cfg = TYPE_CONFIG[t];
        return (
          <span key={t} className={`flex items-center gap-1 text-[10px] font-mono ${cfg.cls}`}>
            {cfg.icon}
            <span>{counts[t]}</span>
          </span>
        );
      })}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ObservabilityPage() {
  const sessions = useSessionStore((s) => s.sessions);
  const sessionTitles = Object.fromEntries(
    sessions.filter((s) => s.title).map((s) => [s.id, s.title]),
  ) as Record<string, string>;

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedTypes, setSelectedTypes] = useState<Set<AuditType>>(new Set(ALL_TYPES));
  const [timeRange, setTimeRange] = useState<TimeRange>('live');
  const [search, setSearch] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const range = TIME_RANGES.find((r) => r.id === timeRange);
      const params = new URLSearchParams({ limit: '500' });
      if (range?.ms) {
        params.set('since', String(Date.now() - range.ms));
      }
      if (selectedTypes.size < ALL_TYPES.length) {
        params.set('type', [...selectedTypes].join(','));
      }
      const res = await fetch(`/api/audit-log?${params}`);
      if (res.ok) {
        const data = await res.json() as AuditLogEntry[];
        setEntries(data);
      }
    } catch {
      // network errors are non-fatal
    } finally {
      setLoading(false);
    }
  }, [timeRange, selectedTypes]);

  const clearLogs = async () => {
    if (!window.confirm('Clear all audit log entries? This cannot be undone.')) return;
    setClearing(true);
    try {
      await fetch('/api/audit-log?confirm=true', { method: 'DELETE' });
      await load();
    } catch {
      // network error — silently ignore
    } finally {
      setClearing(false);
    }
  };

  // Initial load + on filter change
  useEffect(() => { void load(); }, [load]);

  // Auto-refresh (only for live/short ranges)
  useEffect(() => {
    if (!autoRefresh || timeRange === 'all' || timeRange === '7d') return;
    const id = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(id);
  }, [autoRefresh, timeRange, load]);

  // Auto-scroll to bottom when new entries arrive and user is already at bottom
  useEffect(() => {
    if (atBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries.length, atBottom]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const threshold = 40;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < threshold);
  };

  // Filtering
  const filtered = entries.filter((e) => {
    if (!selectedTypes.has(e.type)) return false;
    if (search && !e.label.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Group by day for date separators
  const rows: Array<{ kind: 'date'; date: string } | { kind: 'entry'; entry: AuditLogEntry }> = [];
  let lastDay: number | null = null;
  for (const e of filtered) {
    if (lastDay === null || !isSameDay(lastDay, e.createdAt)) {
      rows.push({ kind: 'date', date: formatDate(e.createdAt) });
      lastDay = e.createdAt;
    }
    rows.push({ kind: 'entry', entry: e });
  }

  const toggleType = (t: AuditType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) { next.delete(t); } else { next.add(t); }
      return next;
    });
  };

  const allSelected = selectedTypes.size === ALL_TYPES.length;
  const toggleAll = () => {
    setSelectedTypes(allSelected ? new Set() : new Set(ALL_TYPES));
  };

  return (
    <div className="flex flex-col h-full bg-base-100">

      {/* ── Top toolbar ── */}
      <div className="shrink-0 border-b border-base-300 px-4 py-2 space-y-2">
        {/* Row 1: title + stats + refresh */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-base-content">Audit Log</span>
          <div className="flex-1 min-w-0">
            <StatsBar entries={filtered} />
          </div>
          <button
            className={`btn btn-ghost btn-xs gap-1 ${loading ? 'opacity-60' : ''}`}
            onClick={() => { void load(); }}
            title="Refresh now"
            disabled={loading}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline text-[10px]">Refresh</span>
          </button>
          <button
            className={`btn btn-ghost btn-xs gap-1 text-error/60 hover:text-error ${clearing ? 'opacity-60' : ''}`}
            onClick={() => { void clearLogs(); }}
            title="Clear all audit log entries"
            disabled={clearing}
          >
            <Trash2 size={12} />
            <span className="hidden sm:inline text-[10px]">Clear</span>
          </button>
          <button
            className={`btn btn-ghost btn-xs gap-1 ${autoRefresh ? 'text-sky-400' : 'text-base-content/40'}`}
            onClick={() => setAutoRefresh((v) => !v)}
            title={autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
          >
            {autoRefresh ? <Pause size={12} /> : <Play size={12} />}
            <span className="hidden sm:inline text-[10px]">{autoRefresh ? 'Live' : 'Paused'}</span>
          </button>
        </div>

        {/* Row 2: time range pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {TIME_RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setTimeRange(r.id)}
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${
                timeRange === r.id
                  ? 'bg-sky-500/20 text-sky-400 border-sky-500/40'
                  : 'border-base-300 text-base-content/50 hover:border-base-content/30 hover:text-base-content/70'
              }`}
            >
              {r.label}
            </button>
          ))}
          <span className="text-base-content/20 text-xs ml-1">|</span>
          <span className="text-[11px] text-base-content/40 font-mono">{filtered.length} events</span>
        </div>

        {/* Row 3: type filter chips */}
        <div className="flex items-center gap-1 flex-wrap">
          <button
            className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
              allSelected
                ? 'bg-base-300 text-base-content/70 border-base-300'
                : 'border-dashed border-base-300 text-base-content/40'
            }`}
            onClick={toggleAll}
          >
            {allSelected ? 'All' : 'None'}
          </button>
          {ALL_TYPES.map((t) => {
            const cfg = TYPE_CONFIG[t];
            const active = selectedTypes.has(t);
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                  active
                    ? `${cfg.bg} ${cfg.cls} border-current/30`
                    : 'border-base-300 text-base-content/30 opacity-50'
                }`}
              >
                {cfg.icon}
                {cfg.short}
              </button>
            );
          })}
        </div>

        {/* Row 4: search */}
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/30" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by label…"
            className="input input-bordered input-xs w-full pl-7 pr-7 text-xs"
          />
          {search && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-base-content/30 hover:text-base-content/60"
              onClick={() => setSearch('')}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* ── Timeline ── */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-1"
      >
        {rows.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-base-content/30">
            <Zap size={32} className="opacity-20" />
            <p className="text-sm">No events match your filters.</p>
            <p className="text-xs">Send a message to generate activity.</p>
          </div>
        )}

        {rows.map((row, i) => {
          if (row.kind === 'date') {
            return (
              <div key={`date-${i}`} className="flex items-center gap-2 py-1">
                <div className="flex-1 h-px bg-base-300" />
                <span className="text-[10px] text-base-content/30 font-mono">{row.date}</span>
                <div className="flex-1 h-px bg-base-300" />
              </div>
            );
          }
          return <EntryRow key={row.entry.id} entry={row.entry} sessionTitles={sessionTitles} />;
        })}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

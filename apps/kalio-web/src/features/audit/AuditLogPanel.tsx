import { useEffect, useRef, useState } from 'react';
import { BrainCircuit, Wrench, CheckCircle2, XCircle, RefreshCw, ChevronDown, Zap } from 'lucide-react';

interface AuditEntry {
  id: string;
  sessionId: string | null;
  type: 'llm_request' | 'llm_response' | 'tool_call' | 'tool_result' | 'error' | 'raapp_native_call' | 'raapp_native_approved';
  label: string;
  data: Record<string, unknown> | null;
  durationMs: number | null;
  createdAt: number;
}

const TYPE_CONFIG: Record<AuditEntry['type'], { icon: React.ReactNode; cls: string; short: string }> = {
  llm_request:          { icon: <BrainCircuit size={12} />, cls: 'text-sky-400',    short: 'LLM →' },
  llm_response:         { icon: <BrainCircuit size={12} />, cls: 'text-sky-400',    short: '← LLM' },
  tool_call:            { icon: <Wrench size={12} />,        cls: 'text-emerald-400', short: 'Tool →' },
  tool_result:          { icon: <CheckCircle2 size={12} />,  cls: 'text-emerald-400', short: '← Tool' },
  error:                { icon: <XCircle size={12} />,       cls: 'text-error',       short: 'Error' },
  raapp_native_call:    { icon: <Zap size={12} />,           cls: 'text-warning',     short: 'RA call' },
  raapp_native_approved:{ icon: <CheckCircle2 size={12} />,  cls: 'text-warning',     short: 'RA ok' },
};

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatMs(ms: number | null) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function EntryRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const cfg = TYPE_CONFIG[entry.type];

  return (
    <div className="border-l-2 border-base-300 pl-3 py-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`shrink-0 ${cfg.cls}`}>{cfg.icon}</span>
        <span className={`text-[10px] font-mono font-semibold ${cfg.cls} shrink-0`}>{cfg.short}</span>
        <span className="text-xs text-base-content/80 flex-1 truncate">{entry.label}</span>
        {entry.durationMs != null && (
          <span className="text-[10px] font-mono text-base-content/35 shrink-0">{formatMs(entry.durationMs)}</span>
        )}
        <span className="text-[10px] font-mono text-base-content/30 shrink-0">{formatTime(entry.createdAt)}</span>
        {entry.data && (
          <button
            className="ml-1 text-base-content/30 hover:text-base-content/60"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle data"
          >
            <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      {open && entry.data && (
        <pre className="mt-1 text-[10px] font-mono text-base-content/50 bg-base-200/60 rounded px-2 py-1 overflow-x-auto max-h-32 whitespace-pre-wrap">
          {JSON.stringify(entry.data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/audit-log?limit=200');
      if (res.ok) {
        const data = await res.json() as AuditEntry[];
        setEntries(data);
      }
    } catch {
      // silently ignore network errors
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(id);
  }, [autoRefresh]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-base-300 shrink-0">
        <span className="text-sm font-semibold flex-1">Audit Log</span>
        <label className="flex items-center gap-1.5 text-xs text-base-content/50 cursor-pointer select-none">
          <input
            type="checkbox"
            className="checkbox checkbox-xs"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          auto
        </label>
        <button
          className={`btn btn-ghost btn-xs ${loading ? 'loading' : ''}`}
          onClick={() => { void load(); }}
          title="Refresh"
        >
          {!loading && <RefreshCw size={12} />}
        </button>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {entries.length === 0 && !loading && (
          <p className="text-xs text-base-content/40 text-center mt-8">No audit events yet.<br />Send a message to see activity.</p>
        )}
        {entries.map((e) => <EntryRow key={e.id} entry={e} />)}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}


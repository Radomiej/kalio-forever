import { useState, useEffect, useRef, useCallback } from 'react';
import {
  BrainCircuit, Wrench, CheckCircle2, XCircle, ChevronDown,
  RefreshCw, Zap, Play, Pause, Search, X, Trash2, ShieldAlert,
} from 'lucide-react';
import type { AuditType, AuditLogEntry, AuditRetentionStatus } from '@kalio/types';
import { FriendlyId } from '../../components/ui/FriendlyId';
import { useSessionStore } from '../../store/sessionStore';
import { TruthBoard, laneForEntry } from './TruthBoard';

// ─── Config ───────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<AuditType, { icon: React.ReactNode; cls: string; bg: string; short: string; label: string }> = {
  llm_request:          { icon: <BrainCircuit size={12} />, cls: 'text-sky-400',     bg: 'bg-sky-400/10',     short: 'LLM →',   label: 'LLM Request' },
  llm_response:         { icon: <BrainCircuit size={12} />, cls: 'text-sky-400',     bg: 'bg-sky-400/10',     short: '← LLM',   label: 'LLM Response' },
  tool_call:            { icon: <Wrench size={12} />,        cls: 'text-emerald-400', bg: 'bg-emerald-400/10', short: 'Tool →',  label: 'Tool Call' },
  tool_result:          { icon: <CheckCircle2 size={12} />,  cls: 'text-emerald-400', bg: 'bg-emerald-400/10', short: '← Tool',  label: 'Tool Result' },
  architecture_event:   { icon: <Zap size={12} />,           cls: 'text-warning',     bg: 'bg-warning/10',     short: 'Arch',    label: 'Architecture Event' },
  runtime_event:        { icon: <Zap size={12} />,           cls: 'text-cyan-300',    bg: 'bg-cyan-400/10',    short: 'Run',     label: 'Runtime Event' },
  error:                { icon: <XCircle size={12} />,       cls: 'text-error',       bg: 'bg-error/10',       short: 'Error',   label: 'Error' },
  raapp_native_call:    { icon: <Zap size={12} />,           cls: 'text-warning',     bg: 'bg-warning/10',     short: 'RA call', label: 'RA-App Native Call' },
  raapp_native_approved:{ icon: <CheckCircle2 size={12} />,  cls: 'text-warning',     bg: 'bg-warning/10',     short: 'RA ok',   label: 'RA-App Approved' },
  external_hitl:        { icon: <ShieldAlert size={12} />,   cls: 'text-purple-300',  bg: 'bg-purple-400/10',  short: 'HITL',    label: 'External HITL' },
  escalation:           { icon: <Zap size={12} />,           cls: 'text-error',       bg: 'bg-error/10',       short: '🔴 Alert', label: 'Escalation' },
};

const ALL_TYPES = Object.keys(TYPE_CONFIG) as AuditType[];
type AuditLaneId = ReturnType<typeof laneForEntry>;
const LANE_ROW_CONFIG: Partial<Record<AuditLaneId, { icon: React.ReactNode; cls: string; bg: string; short: string; label: string }>> = {
  architecture: { icon: <Zap size={12} />, cls: 'text-warning', bg: 'bg-warning/10', short: 'Arch', label: 'Architecture Runtime' },
  subagents: { icon: <Wrench size={12} />, cls: 'text-indigo-300', bg: 'bg-indigo-400/10', short: 'Agent', label: 'Sub-agent Activity' },
  hooks: { icon: <ShieldAlert size={12} />, cls: 'text-purple-300', bg: 'bg-purple-400/10', short: 'HITL', label: 'Hooks/HITL' },
};
type TimeRange = 'live' | '1h' | '6h' | '24h' | '7d' | 'all';
const TIME_RANGES: { id: TimeRange; label: string; ms: number | null }[] = [
  { id: 'live', label: 'Live', ms: 5 * 60 * 1000 },
  { id: '1h',   label: '1h',  ms: 60 * 60 * 1000 },
  { id: '6h',   label: '6h',  ms: 6 * 60 * 60 * 1000 },
  { id: '24h',  label: '24h', ms: 24 * 60 * 60 * 1000 },
  { id: '7d',   label: '7d',  ms: 7 * 24 * 60 * 60 * 1000 },
  { id: 'all',  label: 'All', ms: null },
];
type AuditViewMode = 'workflow' | 'tools' | 'all';
const WORKFLOW_LANES = new Set(['llm', 'subagents', 'architecture', 'hooks', 'errors']);

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

function searchableAuditText(entry: AuditLogEntry): string {
  const dataText = entry.data ? JSON.stringify(entry.data) : '';
  return [
    entry.id,
    entry.type,
    entry.label,
    entry.sessionId ?? '',
    dataText,
  ].join(' ').toLowerCase();
}

function auditData(entry: AuditLogEntry): Record<string, unknown> {
  return entry.data && typeof entry.data === 'object' ? entry.data as Record<string, unknown> : {};
}

function stringField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function fileToolPath(data: Record<string, unknown>): string | null {
  const fileTool = data['fileTool'];
  if (!fileTool || typeof fileTool !== 'object') return null;
  const path = (fileTool as Record<string, unknown>)['path'];
  return typeof path === 'string' && path.length > 0 ? path : null;
}

function isToolNoise(entry: AuditLogEntry): boolean {
  const data = auditData(entry);
  const kind = stringField(data, 'kind');
  const domain = stringField(data, 'domain');
  return kind === 'file_tool_call'
    || kind === 'file_tool_result'
    || domain === 'vfs'
    || domain === 'file'
    || /^vfs_|^fs_|file_search|grep/i.test(entry.label);
}

function evidenceChips(entry: AuditLogEntry): string[] {
  const data = auditData(entry);
  return [
    stringField(data, 'kind'),
    stringField(data, 'architectureRunId') ?? stringField(data, 'runId'),
    stringField(data, 'nodeId') ?? stringField(data, 'roleSlotId'),
    fileToolPath(data),
  ].filter((value): value is string => Boolean(value)).slice(0, 4);
}

function architectureRunId(entry: AuditLogEntry): string | null {
  const data = auditData(entry);
  return stringField(data, 'architectureRunId') ?? stringField(data, 'runId');
}

function isArchitectureRunEvidenceEntry(entry: AuditLogEntry): boolean {
  return architectureRunId(entry) !== null
    && (laneForEntry(entry) === 'architecture' || laneForEntry(entry) === 'subagents' || isToolNoise(entry));
}

function toolEvidenceLabel(entry: AuditLogEntry): string | null {
  const data = auditData(entry);
  const toolEvidence = data['toolEvidence'];
  if (toolEvidence && typeof toolEvidence === 'object' && !Array.isArray(toolEvidence)) {
    const evidence = toolEvidence as Record<string, unknown>;
    const successfulToolNames = evidence['successfulToolNames'];
    const toolResultCount = typeof evidence['toolResultCount'] === 'number' ? evidence['toolResultCount'] : 0;
    if (Array.isArray(successfulToolNames)) {
      const names = successfulToolNames.filter((value): value is string => typeof value === 'string' && value.length > 0);
      if (names.length > 0) {
        return `${names.slice(0, 3).join(', ')} (${toolResultCount || names.length})`;
      }
    }
  }
  const fileTool = data['fileTool'];
  if (fileTool && typeof fileTool === 'object') {
    const toolName = (fileTool as Record<string, unknown>)['toolName'];
    return typeof toolName === 'string' && toolName.length > 0 ? toolName : null;
  }
  if ((entry.type === 'tool_call' || entry.type === 'tool_result') && isToolNoise(entry)) {
    return entry.label;
  }
  return null;
}

function incompleteReason(entry: AuditLogEntry): string | null {
  return stringField(auditData(entry), 'incompleteReason');
}

// ─── EntryRow ─────────────────────────────────────────────────────────────────

function EntryRow({ entry, sessionTitles }: { entry: AuditLogEntry; sessionTitles: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const lane = laneForEntry(entry);
  const cfg = isToolNoise(entry) ? TYPE_CONFIG[entry.type] : LANE_ROW_CONFIG[lane] ?? TYPE_CONFIG[entry.type] ?? TYPE_CONFIG.error;
  const sessionTitle = entry.sessionId ? sessionTitles[entry.sessionId] : undefined;
  const chips = evidenceChips(entry);

  return (
    <div className={`min-w-0 rounded-lg border border-base-300 px-3 py-2 ${cfg.bg} transition-all`} data-testid={`audit-entry-row:${entry.id}`}>
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
          <span className={`text-[10px] font-mono shrink-0 ${entry.durationMs > 5000 ? 'text-warning' : 'text-base-content/65'}`}>
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
        <span className="text-[10px] font-mono text-base-content/65 shrink-0">{formatTime(entry.createdAt)}</span>

        {/* expand */}
        {entry.data && (
          <button
            className="shrink-0 grid h-7 w-7 place-items-center rounded text-base-content/60 hover:bg-base-300/60 hover:text-base-content/80 ml-0.5"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle developer payload"
            title={open ? 'Hide developer payload' : 'Show developer payload'}
          >
            <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {chips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span key={chip} className="max-w-full truncate rounded border border-base-300 bg-base-300/35 px-1.5 py-0.5 text-[10px] font-mono text-base-content/65" title={chip}>
              {chip}
            </span>
          ))}
        </div>
      )}

      {open && entry.data && (
        <div className="mt-2 rounded border border-base-300/70 bg-base-300/35 p-2">
          <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.14em] text-base-content/65">
            <span>Developer payload</span>
            <span>raw json</span>
          </div>
          <pre className="max-h-40 overflow-x-auto rounded bg-base-100/80 px-2 py-1.5 text-[10px] font-mono text-base-content/50 whitespace-pre-wrap break-words">
            {JSON.stringify(entry.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

const LANE_STATS = [
  { id: 'llm', label: 'LLM', icon: <BrainCircuit size={12} />, cls: 'text-sky-400' },
  { id: 'subagents', label: 'Sub-agents', icon: <Wrench size={12} />, cls: 'text-indigo-300' },
  { id: 'architecture', label: 'Architecture', icon: <Zap size={12} />, cls: 'text-warning' },
  { id: 'hooks', label: 'HITL', icon: <ShieldAlert size={12} />, cls: 'text-purple-300' },
  { id: 'errors', label: 'Errors', icon: <XCircle size={12} />, cls: 'text-error' },
] as const;

function StatsBar({ entries }: { entries: AuditLogEntry[] }) {
  const counts = LANE_STATS.map((lane) => ({
    ...lane,
    count: entries.filter((entry) => laneForEntry(entry) === lane.id).length,
  })).filter((lane) => lane.count > 0);

  if (counts.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {counts.map((lane) => {
        return (
          <span key={lane.id} className={`flex items-center gap-1 text-[10px] font-mono ${lane.cls}`} title={lane.label}>
            {lane.icon}
            <span>{lane.count}</span>
          </span>
        );
      })}
    </div>
  );
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return String(value);
}

function numberField(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function tokenUsageFromEntry(entry: AuditLogEntry): { in: number; out: number; total: number } | null {
  const data = auditData(entry);
  const usage = data['usage'];
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    const estimatedInput = numberField(data, 'estimatedInputTokens');
    const estimatedOutput = numberField(data, 'estimatedOutputTokens');
    const estimatedTotal = estimatedInput + estimatedOutput;
    return estimatedTotal > 0 ? { in: estimatedInput, out: estimatedOutput, total: estimatedTotal } : null;
  }
  const record = usage as Record<string, unknown>;
  const promptTokens = numberField(record, 'promptTokens');
  const completionTokens = numberField(record, 'completionTokens');
  const totalTokens = numberField(record, 'totalTokens') || promptTokens + completionTokens;
  return totalTokens > 0 ? { in: promptTokens, out: completionTokens, total: totalTokens } : null;
}

function totalTokenUsage(entries: AuditLogEntry[]): { in: number; out: number; total: number } | null {
  const exactUsageEntries = entries.filter((entry) => {
    const usage = auditData(entry)['usage'];
    return usage && typeof usage === 'object' && !Array.isArray(usage);
  });
  const sourceEntries = exactUsageEntries.length > 0 ? exactUsageEntries : entries;
  const total = sourceEntries
    .map(tokenUsageFromEntry)
    .filter((usage): usage is { in: number; out: number; total: number } => usage !== null)
    .reduce((sum, usage) => ({
      in: sum.in + usage.in,
      out: sum.out + usage.out,
      total: sum.total + usage.total,
    }), { in: 0, out: 0, total: 0 });
  return total.total > 0 ? total : null;
}

function formatTokenUsage(usage: { in: number; out: number; total: number }): string {
  return `tok ${formatCompactNumber(usage.total)} (${formatCompactNumber(usage.in)} in / ${formatCompactNumber(usage.out)} out)`;
}

function RetentionStrip({ status }: { status: AuditRetentionStatus | null }) {
  if (!status) return null;
  const pressure = status.maxHotRows > 0 ? status.hotRows / status.maxHotRows : 0;
  const pressureClass = pressure >= 0.9
    ? 'text-error border-error/30 bg-error/10'
    : pressure >= 0.7
      ? 'text-warning border-warning/30 bg-warning/10'
      : 'text-base-content/65 border-base-300 bg-base-200/35';

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 rounded border border-base-300 bg-base-200/25 px-2.5 py-1 text-[10px] text-base-content/65" data-testid="audit-retention-strip">
      <span className="font-semibold uppercase tracking-[0.12em] text-base-content/65">Storage</span>
      <span className={`rounded border px-1.5 py-0.5 font-mono ${pressureClass}`}>
        visible {formatCompactNumber(status.hotRows)}/{formatCompactNumber(status.maxHotRows)}
      </span>
      <span className="rounded border border-base-300 bg-base-300/30 px-1.5 py-0.5 font-mono">
        retention {status.retentionDays}d
      </span>
      <span className={`rounded border px-1.5 py-0.5 font-mono ${status.coldStorageEnabled ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-base-300 bg-base-300/30 text-base-content/65'}`}>
        archived {formatCompactNumber(status.archivedRows)}
      </span>
      <span className="rounded border border-base-300 bg-base-300/30 px-1.5 py-0.5 font-mono">
        settings control pruning
      </span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function ArchitectureRunGroup({ entries, runId, sessionTitles }: { entries: AuditLogEntry[]; runId: string; sessionTitles: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const sorted = [...entries].sort((left, right) => left.createdAt - right.createdAt);
  const latest = sorted.at(-1);
  const eventTypes = new Set(sorted.map((entry) => stringField(auditData(entry), 'eventType')).filter(Boolean));
  const nodes = new Set(sorted.map((entry) => stringField(auditData(entry), 'nodeId')).filter(Boolean));
  const proofTools = new Set(sorted.map((entry) => toolEvidenceLabel(entry)).filter(Boolean));
  const incompleteCount = sorted.filter((entry) => incompleteReason(entry)).length;
  const hasFinal = sorted.some((entry) => stringField(auditData(entry), 'eventType') === 'final_artifact' || entry.label.includes('final_artifact'));
  const tokenUsage = totalTokenUsage(sorted);

  return (
    <div className="min-w-0 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2" data-testid="architecture-run-group">
      <button
        type="button"
        className="flex min-h-[32px] w-full min-w-0 items-center gap-2 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="shrink-0 flex items-center gap-1 rounded bg-base-300 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-warning">
          <Zap size={12} />
          Run
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-base-content/90">
          Architecture run {runId.length > 12 ? `${runId.slice(0, 10)}...` : runId}
        </span>
        <span className="shrink-0 rounded border border-warning/25 bg-base-300/40 px-1.5 py-0.5 text-[10px] font-mono text-base-content/55">
          {sorted.length} events
        </span>
        <span className="hidden shrink-0 rounded border border-base-300 bg-base-300/35 px-1.5 py-0.5 text-[10px] font-mono text-base-content/65 sm:inline">
          {nodes.size} nodes
        </span>
        {hasFinal && (
          <span className="hidden shrink-0 rounded border border-emerald-400/25 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-mono text-emerald-300 sm:inline">
            final
          </span>
        )}
        {proofTools.size > 0 && (
          <span className="shrink-0 rounded border border-emerald-400/25 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-mono text-emerald-300">
            proof {proofTools.size}
          </span>
        )}
        {tokenUsage && (
          <span className="shrink-0 rounded border border-sky-400/25 bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-mono text-sky-300" title={formatTokenUsage(tokenUsage)}>
            {formatTokenUsage(tokenUsage)}
          </span>
        )}
        {incompleteCount > 0 && (
          <span className="shrink-0 rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-mono text-warning">
            incomplete {incompleteCount}
          </span>
        )}
        <span className="shrink-0 text-[10px] font-mono text-base-content/65">{latest ? formatTime(latest.createdAt) : ''}</span>
        <ChevronDown size={12} className={`shrink-0 text-base-content/65 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {[...eventTypes].slice(0, 6).map((eventType) => (
          <span key={eventType} className="rounded border border-base-300 bg-base-300/35 px-1.5 py-0.5 text-[10px] font-mono text-base-content/65">
            {eventType}
          </span>
        ))}
        {[...proofTools].slice(0, 4).map((toolName) => (
          <span key={toolName} className="rounded border border-emerald-400/25 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-mono text-emerald-300">
            {toolName}
          </span>
        ))}
        {incompleteCount > 0 && (
          <span className="rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-mono text-warning">
            incomplete output
          </span>
        )}
        {tokenUsage && (
          <span className="rounded border border-sky-400/25 bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-mono text-sky-300">
            {formatTokenUsage(tokenUsage)}
          </span>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-1.5">
          {sorted.map((entry) => (
            <EntryRow key={entry.id} entry={entry} sessionTitles={sessionTitles} />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionWorkflowGroup({ entries, sessionId, sessionTitles }: { entries: AuditLogEntry[]; sessionId: string; sessionTitles: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const sorted = [...entries].sort((left, right) => left.createdAt - right.createdAt);
  const latest = sorted.at(-1);
  const tokenUsage = totalTokenUsage(sorted);
  const lanes = new Set(sorted.map(laneForEntry));
  const proofTools = new Set(sorted.map((entry) => toolEvidenceLabel(entry)).filter(Boolean));
  const incompleteCount = sorted.filter((entry) => incompleteReason(entry)).length;
  const title = sessionTitles[sessionId] ?? sessionId;

  return (
    <div className="min-w-0 rounded-lg border border-base-300 bg-base-200/35 px-3 py-2" data-testid="session-workflow-group">
      <button
        type="button"
        className="flex min-h-[32px] w-full min-w-0 items-center gap-2 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="shrink-0 flex items-center gap-1 rounded bg-base-300 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-sky-300">
          <BrainCircuit size={12} />
          Chat
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-base-content/90">
          {title}
        </span>
        <span className="shrink-0 rounded border border-base-300 bg-base-300/35 px-1.5 py-0.5 text-[10px] font-mono text-base-content/50">
          {sorted.length} events
        </span>
        {tokenUsage && (
          <span className="hidden shrink-0 rounded border border-sky-400/25 bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-mono text-sky-300 sm:inline" title={formatTokenUsage(tokenUsage)}>
            {formatTokenUsage(tokenUsage)}
          </span>
        )}
        <span className="shrink-0 text-[10px] font-mono text-base-content/65">{latest ? formatTime(latest.createdAt) : ''}</span>
        <ChevronDown size={12} className={`shrink-0 text-base-content/65 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {[...lanes].slice(0, 5).map((lane) => (
          <span key={lane} className="rounded border border-base-300 bg-base-300/35 px-1.5 py-0.5 text-[10px] font-mono text-base-content/65">
            {lane}
          </span>
        ))}
        {[...proofTools].slice(0, 3).map((toolName) => (
          <span key={toolName} className="rounded border border-emerald-400/25 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-mono text-emerald-300">
            {toolName}
          </span>
        ))}
        {incompleteCount > 0 && (
          <span className="rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-mono text-warning">
            incomplete output
          </span>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-1.5">
          {sorted.map((entry) => (
            <EntryRow key={entry.id} entry={entry} sessionTitles={sessionTitles} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ObservabilityPage() {
  const sessions = useSessionStore((s) => s.sessions);
  const sessionTitles = Object.fromEntries(
    sessions.filter((s) => s.title).map((s) => [s.id, s.title]),
  ) as Record<string, string>;

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [retention, setRetention] = useState<AuditRetentionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedTypes, setSelectedTypes] = useState<Set<AuditType>>(new Set(ALL_TYPES));
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [viewMode, setViewMode] = useState<AuditViewMode>('workflow');
  const [search, setSearch] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(false);

  const load = useCallback(async () => {
    try {
      const range = TIME_RANGES.find((r) => r.id === timeRange);
      const params = new URLSearchParams({ limit: '1000', source: 'all' });
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
      const retentionRes = await fetch('/api/audit-log/retention');
      if (retentionRes.ok) {
        setRetention(await retentionRes.json() as AuditRetentionStatus);
      }
    } catch (err) {
      console.warn('[ObservabilityPage] Failed to load audit events', err);
    } finally {
      setLoading(false);
    }
  }, [timeRange, selectedTypes]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await load();
  }, [load]);

  const clearLogs = async () => {
    if (!window.confirm('Clear all audit log entries? This cannot be undone.')) return;
    setClearing(true);
    try {
      await fetch('/api/audit-log?confirm=true', { method: 'DELETE' });
      await load();
    } catch (err) {
      console.warn('[ObservabilityPage] Failed to clear audit log', err);
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
    const lane = laneForEntry(e);
    const toolNoise = isToolNoise(e);
    if (viewMode === 'workflow' && !WORKFLOW_LANES.has(lane) && !(toolNoise && architectureRunId(e))) return false;
    if (viewMode === 'tools' && lane !== 'tools' && !toolNoise) return false;
    if (search && !searchableAuditText(e).includes(search.toLowerCase())) return false;
    return true;
  }).sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
  const workflowCount = entries.filter((entry) => selectedTypes.has(entry.type) && WORKFLOW_LANES.has(laneForEntry(entry)) && !isToolNoise(entry)).length;
  const toolCount = entries.filter((entry) => selectedTypes.has(entry.type) && (laneForEntry(entry) === 'tools' || isToolNoise(entry))).length;

  // Group by day for date separators
  const rows: Array<
    | { kind: 'date'; date: string }
    | { kind: 'entry'; entry: AuditLogEntry }
    | { kind: 'architecture-run'; runId: string; entries: AuditLogEntry[]; createdAt: number }
    | { kind: 'session-group'; sessionId: string; entries: AuditLogEntry[]; createdAt: number }
  > = [];
  let lastDay: number | null = null;
  const grouped = viewMode === 'workflow'
    ? buildWorkflowRows(filtered)
    : filtered.map((entry) => ({ kind: 'entry' as const, entry, createdAt: entry.createdAt }));
  for (const e of grouped) {
    const createdAt = e.kind === 'entry' ? e.entry.createdAt : e.createdAt;
    if (lastDay === null || !isSameDay(lastDay, createdAt)) {
      rows.push({ kind: 'date', date: formatDate(createdAt) });
      lastDay = createdAt;
    }
    rows.push(e);
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
    <div className="flex h-full min-w-0 flex-col overflow-x-hidden bg-base-100">

      {/* ── Top toolbar ── */}
      <div className="min-w-0 shrink-0 space-y-2 overflow-x-hidden border-b border-base-300 px-4 py-2">
        {/* Row 1: title + stats + refresh */}
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <span className="text-sm font-semibold text-base-content">Audit Truth Board</span>
          <div className="flex-1 min-w-0">
            <StatsBar entries={filtered} />
          </div>
          <button
            className={`btn btn-ghost btn-xs gap-1 ${loading ? 'opacity-60' : ''}`}
            onClick={() => { void refresh(); }}
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
            className={`btn btn-ghost btn-xs gap-1 ${autoRefresh ? 'text-sky-400' : 'text-base-content/65'}`}
            onClick={() => setAutoRefresh((v) => !v)}
            title={autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
          >
            {autoRefresh ? <Pause size={12} /> : <Play size={12} />}
            <span className="hidden sm:inline text-[10px]">{autoRefresh ? 'Live' : 'Paused'}</span>
          </button>
        </div>

        <TruthBoard entries={filtered} />
        <RetentionStrip status={retention} />

        {/* Row 2: view mode + time range pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            data-testid="audit-view-workflow"
            onClick={() => setViewMode('workflow')}
            className={`min-h-[28px] px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors ${
              viewMode === 'workflow'
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                : 'border-base-300 text-base-content/65 hover:border-base-content/50 hover:text-base-content/80'
            }`}
            title="Show workflow events: LLM, sub-agents, architecture, HITL, and errors"
          >
            Workflow <span className="font-mono text-[10px]">{workflowCount}</span>
          </button>
          <button
            type="button"
            data-testid="audit-view-tools"
            onClick={() => setViewMode('tools')}
            className={`min-h-[28px] px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors ${
              viewMode === 'tools'
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                : 'border-base-300 text-base-content/65 hover:border-base-content/50 hover:text-base-content/80'
            }`}
            title="Show tool and VFS rows"
          >
            Tools <span className="font-mono text-[10px]">{toolCount}</span>
          </button>
          <button
            type="button"
            data-testid="audit-view-all"
            onClick={() => setViewMode('all')}
            className={`min-h-[28px] px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors ${
              viewMode === 'all'
                ? 'bg-base-300 text-base-content/75 border-base-300'
                : 'border-base-300 text-base-content/65 hover:border-base-content/50 hover:text-base-content/80'
            }`}
            title="Show every audit row"
          >
            All <span className="font-mono text-[10px]">{entries.length}</span>
          </button>
          <span className="text-base-content/20 text-xs mx-1">|</span>
          {TIME_RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setTimeRange(r.id)}
              className={`min-h-[28px] px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                timeRange === r.id
                  ? 'bg-sky-500/20 text-sky-400 border-sky-500/40'
                  : 'border-base-300 text-base-content/50 hover:border-base-content/30 hover:text-base-content/70'
              }`}
            >
              {r.label}
            </button>
          ))}
          <span className="text-base-content/20 text-xs ml-1">|</span>
          <span className="text-[11px] text-base-content/65 font-mono">{filtered.length} events</span>
        </div>

        {/* Row 3: type filter chips */}
        <div className="flex items-center gap-1 flex-wrap">
          <button
            className={`min-h-[28px] px-2 py-1 rounded text-[10px] font-medium border transition-colors ${
              allSelected
                ? 'bg-base-300 text-base-content/70 border-base-300'
                : 'border-dashed border-base-300 text-base-content/65'
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
                className={`flex min-h-[28px] items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border transition-colors ${
                  active
                    ? `${cfg.bg} ${cfg.cls} border-current/30`
                    : 'border-base-300 text-base-content/65 opacity-80'
                }`}
              >
                {cfg.icon}
                {cfg.short}
              </button>
            );
          })}
        </div>

        {/* Row 4: search */}
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/65" />
            <input
              type="text"
              data-testid="audit-search-input"
              aria-label="Filter audit events"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by run id, label, session, node, file path, or audit data..."
              className="input input-bordered input-xs w-full pl-7 text-xs"
            />
          </div>
          {search && (
            <button
              type="button"
              aria-label="Clear audit search"
              className="grid h-6 w-6 shrink-0 place-items-center rounded text-base-content/65 hover:bg-base-300/70 hover:text-base-content/80"
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
        className="min-w-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-4 py-3"
      >
        {rows.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-base-content/65">
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
                <span className="text-[10px] text-base-content/65 font-mono">{row.date}</span>
                <div className="flex-1 h-px bg-base-300" />
              </div>
            );
          }
          if (row.kind === 'architecture-run') {
            return <ArchitectureRunGroup key={`arch-${row.runId}-${row.createdAt}`} runId={row.runId} entries={row.entries} sessionTitles={sessionTitles} />;
          }
          if (row.kind === 'session-group') {
            return <SessionWorkflowGroup key={`session-${row.sessionId}-${row.createdAt}`} sessionId={row.sessionId} entries={row.entries} sessionTitles={sessionTitles} />;
          }
          return <EntryRow key={row.entry.id} entry={row.entry} sessionTitles={sessionTitles} />;
        })}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function buildWorkflowRows(entries: AuditLogEntry[]): Array<
  | { kind: 'entry'; entry: AuditLogEntry; createdAt: number }
  | { kind: 'architecture-run'; runId: string; entries: AuditLogEntry[]; createdAt: number }
  | { kind: 'session-group'; sessionId: string; entries: AuditLogEntry[]; createdAt: number }
> {
  const rows: Array<
    | { kind: 'entry'; entry: AuditLogEntry; createdAt: number }
    | { kind: 'architecture-run'; runId: string; entries: AuditLogEntry[]; createdAt: number }
    | { kind: 'session-group'; sessionId: string; entries: AuditLogEntry[]; createdAt: number }
  > = [];
  const architectureGroups = new Map<string, AuditLogEntry[]>();
  const sessionGroups = new Map<string, AuditLogEntry[]>();
  for (const entry of entries) {
    if (isArchitectureRunEvidenceEntry(entry)) {
      const runId = architectureRunId(entry);
      if (!runId) continue;
      architectureGroups.set(runId, [...(architectureGroups.get(runId) ?? []), entry]);
      continue;
    }
    if (entry.sessionId) {
      sessionGroups.set(entry.sessionId, [...(sessionGroups.get(entry.sessionId) ?? []), entry]);
      continue;
    }
    rows.push({ kind: 'entry', entry, createdAt: entry.createdAt });
  }
  for (const [runId, runEntries] of architectureGroups) {
    rows.push({
      kind: 'architecture-run',
      runId,
      entries: runEntries,
      createdAt: Math.max(...runEntries.map((entry) => entry.createdAt)),
    });
  }
  for (const [sessionId, sessionEntries] of sessionGroups) {
    rows.push({
      kind: 'session-group',
      sessionId,
      entries: sessionEntries,
      createdAt: Math.max(...sessionEntries.map((entry) => entry.createdAt)),
    });
  }
  return rows.sort((left, right) => right.createdAt - left.createdAt);
}

import type { AuditLogEntry } from '@kalio/types';
import {
  AUDIT_TYPE_LABELS,
  TRUTH_LANES,
  auditData,
  formatDuration,
  formatLatestEntry,
  formatLaneLatestLabel,
  formatTokenCount,
  laneForEntry,
  laneStatus,
  laneSummary,
  totalTokenUsage,
} from './TruthBoard.model';

export { laneForEntry } from './TruthBoard.model';

export function TruthBoard({ entries }: { entries: AuditLogEntry[] }) {
  const counts = TRUTH_LANES.map((lane) => ({
    ...lane,
    laneEntries: entries.filter((entry) => laneForEntry(entry) === lane.id),
  })).map((lane) => ({
    ...lane,
    count: lane.laneEntries.length,
    summary: laneSummary(lane.id, lane.laneEntries),
  }));
  const latest = [...entries].reverse()[0];
  const sessionCount = new Set(entries.map((entry) => entry.sessionId).filter(Boolean)).size;
  const subagentEntries = entries.filter((entry) => laneForEntry(entry) === 'subagents');
  const architectureEntries = entries.filter((entry) => laneForEntry(entry) === 'architecture');
  const childIds = new Set(subagentEntries.map((entry) => {
    const data = auditData(entry);
    const subagent = data['subagent'];
    const nestedChildSessionId = subagent && typeof subagent === 'object' && !Array.isArray(subagent)
      ? (subagent as Record<string, unknown>)['childSessionId']
      : undefined;
    return data['childAgentRunId'] ?? data['childSessionId'] ?? nestedChildSessionId;
  }).filter((value): value is string => typeof value === 'string' && value.length > 0));
  const tokens = totalTokenUsage(entries);
  const workTimeMs = entries.reduce((sum, entry) => sum + (entry.durationMs ?? 0), 0);

  return (
    <div className="space-y-2" data-testid="truth-board">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <OverviewCard label="Sessions" value={String(sessionCount)} detail={`${entries.length} visible events`} testId="truth-overview-sessions" />
        <OverviewCard
          label="Sub-agents"
          value={String(childIds.size || subagentEntries.length)}
          detail={`${architectureEntries.length} architecture events`}
          testId="truth-overview-subagents"
        />
        <OverviewCard
          label="Tokens"
          value={formatTokenCount(tokens.total)}
          detail={tokens.total ? `${formatTokenCount(tokens.in)} in / ${formatTokenCount(tokens.out)} out` : 'no token usage'}
          testId="truth-overview-tokens"
        />
        <OverviewCard
          label="Work Time"
          value={formatDuration(workTimeMs)}
          detail={latest ? `latest ${AUDIT_TYPE_LABELS[latest.type] ?? latest.type}` : 'no activity'}
          testId="truth-overview-work-time"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
      {counts.map((lane) => (
        <div key={lane.id} data-testid={`truth-lane-${lane.id}`} className="min-w-0 rounded border border-base-300 bg-base-200/40 px-2.5 py-2 min-h-[82px]">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/65 truncate">{lane.label}</div>
            <span className={`rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] ${laneStatus(lane.id, lane.count).className}`}>
              {laneStatus(lane.id, lane.count).label}
            </span>
          </div>
          <div className="mt-1 text-lg font-mono font-semibold text-base-content">{lane.count}</div>
          <div className="mt-0.5 break-words text-[10px] leading-4 text-base-content/50" title={lane.summary}>{lane.summary}</div>
          <div className="mt-1 text-[9px] leading-3 text-base-content/65" title={lane.laneEntries.at(-1)?.label}>
            {formatLaneLatestLabel(lane.laneEntries.at(-1))}
          </div>
        </div>
      ))}
      </div>
      <div className="min-w-0 rounded border border-base-300 bg-base-200/35 px-2.5 py-1.5 text-[11px] text-base-content/55">
        Latest: {latest ? formatLatestEntry(latest) : 'none'}
      </div>
    </div>
  );
}

function OverviewCard({ detail, label, testId, value }: { detail: string; label: string; testId: string; value: string }) {
  return (
    <div className="min-w-0 rounded border border-base-300 bg-base-200/65 px-3 py-2" data-testid={testId}>
      <div className="text-[10px] uppercase tracking-[0.14em] text-base-content/65">{label}</div>
      <div className="mt-1 truncate font-mono text-xl font-semibold text-base-content">{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-base-content/65" title={detail}>{detail}</div>
    </div>
  );
}

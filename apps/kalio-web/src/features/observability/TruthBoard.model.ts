import type { AuditDomain, AuditLogEntry, AuditType } from '@kalio/types';

export const AUDIT_TYPE_LABELS: Record<AuditType, string> = {
  llm_request: 'LLM Request',
  llm_response: 'LLM Response',
  tool_call: 'Tool Call',
  tool_result: 'Tool Result',
  architecture_event: 'Architecture Event',
  error: 'Error',
  raapp_native_call: 'RA-App Native Call',
  raapp_native_approved: 'RA-App Approved',
  external_hitl: 'External HITL',
  escalation: 'Escalation',
};

export const TRUTH_LANES = [
  { id: 'llm', label: 'LLM' },
  { id: 'tools', label: 'Tools' },
  { id: 'subagents', label: 'Sub-agents' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'hooks', label: 'Hooks/HITL' },
  { id: 'errors', label: 'Errors' },
] as const;

export type TruthLaneId = typeof TRUTH_LANES[number]['id'];

export function auditData(entry: AuditLogEntry): Record<string, unknown> {
  return entry.data && typeof entry.data === 'object' ? entry.data as Record<string, unknown> : {};
}

function auditKind(entry: AuditLogEntry): string | null {
  const kind = auditData(entry)['kind'];
  return typeof kind === 'string' ? kind : null;
}

function auditDomain(entry: AuditLogEntry): AuditDomain | null {
  const domain = auditData(entry)['domain'];
  if (
    domain === 'llm'
    || domain === 'tool'
    || domain === 'subagent'
    || domain === 'architecture'
    || domain === 'hitl'
    || domain === 'hook'
    || domain === 'vfs'
    || domain === 'file'
    || domain === 'raapp'
    || domain === 'error'
    || domain === 'generic'
  ) {
    return domain;
  }
  return null;
}

function stringValue(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function hasArchitectureScope(entry: AuditLogEntry): boolean {
  const data = auditData(entry);
  const domain = auditDomain(entry);
  const kind = auditKind(entry);
  const label = entry.label.toLowerCase();
  return domain === 'architecture'
    || label.startsWith('architecture:')
    || label.startsWith('architecture_event:')
    || label.includes('architecture_run')
    || label.includes('architecture runtime')
    || kind === 'architecture_event'
    || kind === 'architecture_runtime'
    || kind === 'architecture_hydration'
    || kind?.startsWith('architecture_') === true
    || typeof data['architectureRunId'] === 'string'
    || typeof data['runId'] === 'string' && label.includes('architecture')
    || typeof data['schemaId'] === 'string' && (typeof data['eventType'] === 'string' || typeof data['nodeId'] === 'string')
    || stringValue(data, 'eventType')?.startsWith('router_') === true
    || stringValue(data, 'eventType') === 'final_artifact';
}

function isSubagentEntry(entry: AuditLogEntry): boolean {
  const data = auditData(entry);
  const domain = auditDomain(entry);
  const kind = auditKind(entry);
  const hasChildIdentifier = typeof data['childSessionId'] === 'string' || typeof data['childAgentRunId'] === 'string';
  return domain === 'subagent'
    || entry.label.includes('run_subagent')
    || entry.label.includes('spawn_subagent')
    || entry.label.includes('message_subagent')
    || kind === 'subagent_tool_call'
    || kind === 'subagent_tool_result'
    || kind?.includes('subagent') === true
    || entry.label.includes('subagent')
    || entry.label === 'run_subagent'
    || entry.label === 'spawn_subagent'
    || entry.label === 'message_subagent'
    || (hasChildIdentifier && !hasArchitectureScope(entry))
    || Boolean(data['subagent']);
}

function isArchitectureEntry(entry: AuditLogEntry): boolean {
  return hasArchitectureScope(entry);
}

function isFileToolEntry(entry: AuditLogEntry): boolean {
  const domain = auditDomain(entry);
  const kind = auditKind(entry);
  return domain === 'vfs'
    || domain === 'file'
    || kind === 'file_tool_call'
    || kind === 'file_tool_result'
    || /^vfs_|^fs_|file_search|grep/i.test(entry.label);
}

function isHookEntry(entry: AuditLogEntry): boolean {
  const data = auditData(entry);
  const domain = auditDomain(entry);
  const kind = auditKind(entry);
  const label = entry.label.toLowerCase();
  return domain === 'hitl'
    || domain === 'hook'
    || entry.type === 'external_hitl'
    || entry.type === 'raapp_native_call'
    || entry.type === 'raapp_native_approved'
    || entry.type === 'escalation'
    || kind?.includes('hitl') === true
    || label.includes('hitl')
    || typeof data['approvalId'] === 'string'
    || typeof data['approvalKind'] === 'string';
}

export function laneForEntry(entry: AuditLogEntry): typeof TRUTH_LANES[number]['id'] {
  if (entry.type === 'error') return 'errors';
  if (isSubagentEntry(entry)) return 'subagents';
  if (isArchitectureEntry(entry)) return 'architecture';
  if (isHookEntry(entry)) return 'hooks';
  if (entry.type === 'llm_request' || entry.type === 'llm_response') return 'llm';
  return 'tools';
}

function shortValue(value: string): string {
  return value.length > 10 ? `${value.slice(0, 8)}...` : value;
}

function numberValue(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function tokenUsageFromData(data: Record<string, unknown>): { in: number; out: number; total: number } | null {
  const usage = data['usage'];
  if (!usage || typeof usage !== 'object') {
    const estimatedInput = numberValue(data, 'estimatedInputTokens');
    const estimatedOutput = numberValue(data, 'estimatedOutputTokens');
    if (!estimatedInput && !estimatedOutput) return null;
    return {
      in: estimatedInput,
      out: estimatedOutput,
      total: estimatedInput + estimatedOutput,
    };
  }
  const record = usage as Record<string, unknown>;
  const promptTokens = numberValue(record, 'promptTokens');
  const completionTokens = numberValue(record, 'completionTokens');
  const totalTokens = numberValue(record, 'totalTokens') || promptTokens + completionTokens;
  return promptTokens || completionTokens || totalTokens
    ? { in: promptTokens, out: completionTokens, total: totalTokens }
    : null;
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return String(value);
}

function formatTokenUsage(usage: { in: number; out: number; total: number }): string {
  return `tok ${formatTokenCount(usage.total)} (${formatTokenCount(usage.in)} in / ${formatTokenCount(usage.out)} out)`;
}

export function totalTokenUsage(entries: AuditLogEntry[]): { in: number; out: number; total: number } {
  const data = entries.map(auditData);
  const exactUsageData = data.filter((item) => {
    const usage = item['usage'];
    return usage && typeof usage === 'object' && !Array.isArray(usage);
  });
  const usageData = exactUsageData.length > 0 ? exactUsageData : data;
  return usageData
    .map(tokenUsageFromData)
    .filter((usage): usage is { in: number; out: number; total: number } => usage !== null)
    .reduce((sum, usage) => ({
      in: sum.in + usage.in,
      out: sum.out + usage.out,
      total: sum.total + usage.total,
    }), { in: 0, out: 0, total: 0 });
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

export function formatLatestEntry(entry: AuditLogEntry): string {
  const data = auditData(entry);
  const omitted = typeof data['omitted'] === 'number' && data['omitted'] > 0
    ? `, omitted ${data['omitted']}`
    : '';
  const architectureRunId = data['runId'] ?? data['architectureRunId'];
  if (isArchitectureEntry(entry) && typeof architectureRunId === 'string') {
    return `${AUDIT_TYPE_LABELS[entry.type] ?? entry.type} / architecture ${architectureRunId.slice(0, 8)}`;
  }
  return `${AUDIT_TYPE_LABELS[entry.type] ?? entry.type} / ${entry.label}${omitted}`;
}

export function formatLaneLatestLabel(entry: AuditLogEntry | undefined): string {
  if (!entry) return 'no latest event';
  const data = auditData(entry);
  const tokenUsage = tokenUsageFromData(data);
  if ((entry.type === 'llm_request' || entry.type === 'llm_response') && tokenUsage) {
    return `${entry.label.length > 18 ? `${entry.label.slice(0, 15)}...` : entry.label} / ${formatTokenUsage(tokenUsage)}`;
  }
  const kind = auditKind(entry);
  const eventType = stringValue(data, 'eventType');
  const nodeId = stringValue(data, 'nodeId');
  if (kind === 'architecture_event' && eventType) {
    return nodeId ? `${eventType} / ${nodeId}` : eventType;
  }
  if (kind) {
    const roleSlotId = stringValue(data, 'roleSlotId');
    const childAgentRunId = stringValue(data, 'childAgentRunId');
    if (roleSlotId) return `${kind} / ${roleSlotId}`;
    if (childAgentRunId) return `${kind} / ${shortValue(childAgentRunId)}`;
    return kind;
  }
  return entry.label.length > 32 ? `${entry.label.slice(0, 29)}...` : entry.label;
}

function uniqueStringValues(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))]
    .slice(0, 3);
}

function toolEvidenceTools(data: Record<string, unknown>[]): string[] {
  return [...new Set(data.flatMap((item) => {
    const evidence = item['toolEvidence'];
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return [];
    const successful = (evidence as Record<string, unknown>)['successfulToolNames'];
    return Array.isArray(successful) ? successful.filter((value): value is string => typeof value === 'string') : [];
  }))].slice(0, 4);
}

function architectureLifecycleSummary(data: Record<string, unknown>[]): string | null {
  const counts = new Map<string, number>();
  for (const item of data) {
    const eventType = item['eventType'];
    if (typeof eventType !== 'string' || eventType.length === 0) continue;
    counts.set(eventType, (counts.get(eventType) ?? 0) + 1);
  }
  const labels = [
    'node_started',
    'agent_started',
    'router_output',
    'final_artifact',
    'node_completed',
  ].filter((eventType) => counts.has(eventType));
  if (labels.length === 0) return null;
  return labels.map((eventType) => `${eventType}:${counts.get(eventType)}`).join(' / ');
}

export function laneSummary(laneId: TruthLaneId, laneEntries: AuditLogEntry[]): string {
  if (laneEntries.length === 0) return 'no events';
  const data = laneEntries.map(auditData);

  if (laneId === 'llm') {
    const exactUsageData = data.filter((item) => {
      const usage = item['usage'];
      return usage && typeof usage === 'object' && !Array.isArray(usage);
    });
    const usageData = exactUsageData.length > 0 ? exactUsageData : data;
    const totals = usageData
      .map(tokenUsageFromData)
      .filter((usage): usage is { in: number; out: number; total: number } => usage !== null)
      .reduce((sum, usage) => ({
        in: sum.in + usage.in,
        out: sum.out + usage.out,
        total: sum.total + usage.total,
      }), { in: 0, out: 0, total: 0 });
    return [
      formatLatestEntry(laneEntries.at(-1) ?? laneEntries[0]),
      totals.total ? formatTokenUsage(totals) : null,
    ].filter(Boolean).join(' / ');
  }

  if (laneId === 'architecture') {
    const runs = uniqueStringValues(data.map((item) => item['runId'] ?? item['architectureRunId']))
      .map(shortValue);
    const copied = data.reduce((count, item) => count + (typeof item['copiedCount'] === 'number' ? item['copiedCount'] : 0), 0);
    const skipped = data.reduce((count, item) => count + (typeof item['skippedCount'] === 'number' ? item['skippedCount'] : 0), 0);
    const branches = data.reduce((count, item) => (
      count + Object.keys((item['branchSessionIds'] as Record<string, unknown> | undefined) ?? {}).length
    ), 0);
    const eventCount = data.reduce((count, item) => count + (typeof item['eventCount'] === 'number' ? item['eventCount'] : 0), 0);
    const runtimeEventRows = laneEntries.filter((entry) => auditKind(entry) === 'architecture_event').length;
    const fileToolEvents = laneEntries.filter(isFileToolEntry).length;
    const childRuns = uniqueStringValues(data.map((item) => item['childAgentRunId']));
    const lifecycle = architectureLifecycleSummary(data);
    const proofTools = toolEvidenceTools(data);
    return [
      runs.length ? `runs ${runs.join(', ')}` : null,
      copied ? `${copied} hydrated file${copied === 1 ? '' : 's'}` : null,
      skipped ? `${skipped} skipped` : null,
      branches ? `${branches} branches` : null,
      proofTools.length ? `proof ${proofTools.join(', ')}` : null,
      lifecycle,
      runtimeEventRows ? `${runtimeEventRows} event row${runtimeEventRows === 1 ? '' : 's'}` : null,
      eventCount ? `${eventCount} runtime events` : null,
      fileToolEvents ? `${fileToolEvents} file tool events` : null,
      childRuns.length ? `${childRuns.length} child run${childRuns.length === 1 ? '' : 's'}` : null,
    ]
      .filter(Boolean)
      .join(' / ') || 'runtime events';
  }

  if (laneId === 'subagents') {
    const subagents = data.map((item) => item['subagent'] as Record<string, unknown> | undefined);
    const children = uniqueStringValues(data.map((item, index) => (
      item['childSessionId'] ?? subagents[index]?.['childSessionId']
    ))).map(shortValue);
    const modes = uniqueStringValues(subagents.map((item) => item?.['vfsMode']));
    return [
      children.length ? `${children.length} child session${children.length === 1 ? '' : 's'} / ${children.join(', ')}` : 'child activity',
      modes.length ? `VFS ${modes.join(', ')}` : null,
    ].filter(Boolean).join(' / ');
  }

  if (laneId === 'tools') {
    const omitted = data.reduce((count, item) => {
      const value = item['omitted'];
      return count + (typeof value === 'number' ? value : 0);
    }, 0);
    const vfsCount = laneEntries.filter(isFileToolEntry).length;
    const fileCounts = data
      .map((item) => (item['fileTool'] as Record<string, unknown> | undefined)?.['fileCount'])
      .filter((value): value is number => typeof value === 'number');
    const touchedFiles = fileCounts.reduce((sum, value) => sum + value, 0);
    return [
      vfsCount ? `${vfsCount} VFS/file events` : null,
      touchedFiles ? `${touchedFiles} files listed` : null,
      `${laneEntries.length} calls/results`,
      omitted > 0 ? `${omitted} omitted paths` : null,
    ].filter(Boolean).join(' / ');
  }

  return formatLatestEntry(laneEntries.at(-1) ?? laneEntries[0]);
}

export function laneStatus(laneId: TruthLaneId, count: number): { label: string; className: string } {
  if (laneId === 'errors') {
    return count > 0
      ? { label: 'attention', className: 'bg-error/15 text-error border-error/30' }
      : { label: 'clear', className: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/25' };
  }
  if (count === 0) {
    return { label: 'quiet', className: 'bg-base-300/45 text-base-content/65 border-base-300' };
  }
  return { label: 'active', className: 'bg-sky-400/10 text-sky-300 border-sky-400/25' };
}


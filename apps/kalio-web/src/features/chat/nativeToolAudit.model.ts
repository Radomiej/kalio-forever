import type { AuditLogEntry } from '@kalio/types';

export function projectNativeToolAudit(entries: AuditLogEntry[], sessionId: string, turnId: string) {
  const scoped = entries.filter((entry) => entry.sessionId === sessionId && entry.data?.['turnId'] === turnId);
  const sorted = [...scoped].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const approvals = new Map<string, AuditLogEntry>();
  for (const entry of sorted) {
    if (entry.label !== 'devin-cli-acp.native_approval') continue;
    const key = callKey(entry);
    if (key) approvals.set(key, entry);
  }
  const rows = [...approvals].map(([key, approval]) => {
    const data = approval.data!;
    let status = permissionStatus(data);
    if (status === 'approved') {
      const activity = sorted.filter((entry) => entry.label === 'devin-cli-acp.tool'
        && callKey(entry) === key && entry.createdAt >= approval.createdAt).at(-1);
      const toolStatus = activity?.data?.['toolStatus'];
      if (toolStatus === 'completed' || toolStatus === 'failed') status = toolStatus;
      else if (toolStatus === 'in_progress' || toolStatus === 'pending') status = 'running';
    }
    return {
      key,
      callId: data['toolCallId'] as string,
      name: typeof data['toolCallName'] === 'string' ? data['toolCallName'] : 'Native tool',
      status,
      createdAt: approval.createdAt,
    };
  });
  const activityOnly = new Map<string, { key: string; callId: string; name: string; status: string; createdAt: number }>();
  for (const entry of sorted) {
    if (entry.label !== 'devin-cli-acp.tool') continue;
    const key = callKey(entry);
    if (!key || approvals.has(key)) continue;
    const data = entry.data!;
    const existing = activityOnly.get(key);
    const title = typeof data['title'] === 'string' ? data['title'] : '';
    if (!existing && (data['name'] === 'mcp_call_tool' || /^Calling .* from /.test(title)
      || !['read', 'edit', 'delete', 'move', 'execute', 'fetch', 'search'].includes(String(data['kind'])))) continue;
    const status = data['toolStatus'];
    activityOnly.set(key, {
      key, callId: data['toolCallId'] as string,
      name: existing?.name ?? (typeof data['name'] === 'string' ? data['name'] : title || 'Native tool'),
      status: status === 'completed' || status === 'failed' ? status : existing?.status ?? 'running',
      createdAt: existing?.createdAt ?? entry.createdAt,
    });
  }
  return [...rows, ...activityOnly.values()].sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key));
}

function callKey(entry: AuditLogEntry): string | null {
  const callId = entry.data?.['toolCallId'];
  const epoch = entry.data?.['processEpoch'];
  return typeof callId === 'string' && callId.length > 0 && typeof epoch === 'string' && epoch.length > 0
    ? JSON.stringify([epoch, callId]) : null;
}

function permissionStatus(data: Record<string, unknown>): string {
  if (data['decision'] === 'accept') return 'approved';
  if (data['decision'] === 'cancel') return 'cancelled';
  if (data['decision'] === 'decline') {
    if (data['decisionSource'] === 'policy') return 'blocked_by_policy';
    if (data['decisionSource'] === 'approval_request') return 'approval_declined';
    return 'declined_unknown_source';
  }
  return 'unknown';
}

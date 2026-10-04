import { describe, expect, it } from 'vitest';
import type { AuditLogEntry } from '@kalio/types';
import { projectNativeToolAudit } from './nativeToolAudit.model';

function entry(label: string, data: Record<string, unknown>, createdAt = 1): AuditLogEntry {
  return { id: `${label}-${createdAt}`, sessionId: 'session', type: 'runtime_event', label, data, createdAt, durationMs: null, chunkCount: null };
}
const scope = { turnId: 'turn', processEpoch: 'epoch', toolCallId: 'call' };

describe('native tool audit projection', () => {
  it('leaves contradictory terminal statuses at the same instant unresolved', () => {
    const rows = [entry('devin-cli-acp.tool', { ...scope, kind: 'execute', toolStatus: 'completed' }, 2),
      entry('devin-cli-acp.tool', { ...scope, toolStatus: 'failed' }, 2)];
    expect(projectNativeToolAudit(rows, 'session', 'turn')[0].status).toBe('unknown');
  });
  it.each([false, true])('keeps terminal status when metadata and failure share a timestamp, approved=%s', (approved) => {
    const failure = { ...entry('devin-cli-acp.tool', { ...scope, toolStatus: 'failed' }, 2), id: 'a-failure' };
    const metadata = { ...entry('devin-cli-acp.tool', { ...scope, kind: 'execute', title: 'Ran node' }, 2), id: 'z-metadata' };
    const approvals = approved ? [entry('devin-cli-acp.native_approval', { ...scope, decision: 'accept' })] : [];
    for (const events of [[failure, metadata], [metadata, failure]]) {
      expect(projectNativeToolAudit([...approvals, ...events], 'session', 'turn')[0].status).toBe('failed');
    }
  });
  it('shows activity-only native reads without inventing an approval or policy reason', () => {
    const rows = [entry('devin-cli-acp.tool', { ...scope, kind: 'read', title: 'Read file' }),
      entry('devin-cli-acp.tool', { ...scope, toolStatus: 'failed' }, 2)];
    expect(projectNativeToolAudit(rows, 'session', 'turn')).toEqual([
      expect.objectContaining({ name: 'Read file', status: 'failed', callId: 'call' }),
    ]);
  });

  it('does not label MCP wrapper activity as native', () => {
    expect(projectNativeToolAudit([entry('devin-cli-acp.tool', { ...scope, kind: 'read', name: 'mcp_call_tool', title: 'Calling fs_read from kalio-runtime' })], 'session', 'turn')).toEqual([]);
  });
  it('does not mistake permission acceptance for tool completion', () => {
    const rows = [entry('devin-cli-acp.native_approval', { ...scope, decision: 'accept' })];
    expect(projectNativeToolAudit(rows, 'session', 'turn')[0].status).toBe('approved');
  });

  it('distinguishes policy block from an unknown legacy decline', () => {
    expect(projectNativeToolAudit([entry('devin-cli-acp.native_approval', { ...scope, decision: 'decline', decisionSource: 'policy' })], 'session', 'turn')[0].status).toBe('blocked_by_policy');
    expect(projectNativeToolAudit([entry('devin-cli-acp.native_approval', { ...scope, decision: 'decline' })], 'session', 'turn')[0].status).toBe('declined_unknown_source');
  });

  it('correlates actual completion by session, turn, epoch and call, not chronology', () => {
    const rows = [
      entry('devin-cli-acp.native_approval', { ...scope, decision: 'accept' }),
      entry('devin-cli-acp.tool', { ...scope, toolStatus: 'completed' }, 2),
      entry('devin-cli-acp.tool', { ...scope, processEpoch: 'other', toolStatus: 'failed' }, 3),
      entry('devin-cli-acp.native_approval', { ...scope, turnId: undefined, decision: 'decline' }, 4),
      { ...entry('devin-cli-acp.native_approval', { ...scope, decision: 'decline' }, 5), sessionId: 'other' },
    ];
    expect(projectNativeToolAudit(rows, 'session', 'turn')).toHaveLength(1);
    expect(projectNativeToolAudit(rows, 'session', 'turn')[0].status).toBe('completed');
  });

  it('never promotes a policy-blocked call to completed from contradictory activity', () => {
    const rows = [entry('devin-cli-acp.native_approval', { ...scope, decision: 'decline', decisionSource: 'policy' }), entry('devin-cli-acp.tool', { ...scope, toolStatus: 'completed' }, 2)];
    expect(projectNativeToolAudit(rows, 'session', 'turn')[0].status).toBe('blocked_by_policy');
  });
});

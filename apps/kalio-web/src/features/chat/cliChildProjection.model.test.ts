import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSession } from '@kalio/types';
import {
  isCliChildDelegationTool,
  projectionFromSession,
  projectionFromToolResult,
  rebuildCLIChildProjectionsFromMessages,
  resolveCLIChildProjectionStatus,
  selectCLIChildProjectionFromSources,
} from './cliChildProjection.model';

describe('cliChildProjection.model', () => {
  it('detects CLI delegation tools', () => {
    expect(isCliChildDelegationTool('run_cli_agent')).toBe(true);
    expect(isCliChildDelegationTool('spawn_cli_agent')).toBe(true);
    expect(isCliChildDelegationTool('vfs_read')).toBe(false);
  });

  it('builds projection from cli-agent session', () => {
    const session: ChatSession = {
      id: 'cli-child-1',
      personaId: 'default',
      title: 'codex CLI: inspect repo',
      kind: 'cli-agent',
      parentSessionId: 'parent-1',
      parentToolCallId: 'call-1',
      createdAt: 1,
      updatedAt: 1,
    };
    expect(projectionFromSession(session)).toMatchObject({
      childSessionId: 'cli-child-1',
      parentSessionId: 'parent-1',
      parentCallId: 'call-1',
      status: 'running',
    });
  });

  it('builds projection from durable CLI snapshot tool result', () => {
    const projection = projectionFromToolResult('spawn_cli_agent', 'call-1', 'parent-1', {
      childSessionId: 'cli-child-1',
      parentSessionId: 'parent-1',
      agentId: 'codex',
      status: 'running',
      lastOutput: 'partial',
    });
    expect(projection).toMatchObject({
      childSessionId: 'cli-child-1',
      status: 'running',
      lastOutput: 'partial',
    });
  });

  it('keeps a running durable snapshot as running while the child is still live', () => {
    const projection = projectionFromToolResult(
      'spawn_cli_agent',
      'call-1',
      'parent-1',
      {
        childSessionId: 'cli-child-1',
        parentSessionId: 'parent-1',
        agentId: 'codex',
        status: 'running',
        lastOutput: 'partial',
      },
      'success',
    );

    expect(projection).toMatchObject({
      childSessionId: 'cli-child-1',
      status: 'running',
      lastOutput: 'partial',
    });
  });

  it('lets terminal tool status override a stale running snapshot', () => {
    const cancelledProjection = projectionFromToolResult(
      'spawn_cli_agent',
      'call-1',
      'parent-1',
      {
        childSessionId: 'cli-child-1',
        parentSessionId: 'parent-1',
        agentId: 'codex',
        status: 'running',
        lastOutput: 'CLI agent stopped.',
      },
      'cancelled',
    );
    const failedProjection = projectionFromToolResult(
      'spawn_cli_agent',
      'call-1',
      'parent-1',
      {
        childSessionId: 'cli-child-1',
        parentSessionId: 'parent-1',
        agentId: 'codex',
        status: 'running',
        lastOutput: 'CLI exited with code 1.',
      },
      'error',
    );

    expect(cancelledProjection).toMatchObject({
      childSessionId: 'cli-child-1',
      status: 'stopped',
      lastOutput: 'CLI agent stopped.',
    });
    expect(failedProjection).toMatchObject({
      childSessionId: 'cli-child-1',
      status: 'failed',
      lastOutput: 'CLI exited with code 1.',
    });
  });

  it('rebuilds projections from parent history messages', () => {
    const messages: ChatMessage[] = [
      {
        id: 'tr-1',
        sessionId: 'parent-1',
        role: 'tool_result',
        content: JSON.stringify({
          childSessionId: 'cli-child-1',
          parentSessionId: 'parent-1',
          agentId: 'codex',
          status: 'completed',
          lastOutput: 'done',
        }),
        toolCallId: 'call-1',
        createdAt: 1,
      },
    ];
    const projections = rebuildCLIChildProjectionsFromMessages(
      'parent-1',
      messages,
      { 'call-1': 'spawn_cli_agent' },
    );
    expect(projections).toHaveLength(1);
    expect(projections[0]).toMatchObject({
      childSessionId: 'cli-child-1',
      status: 'completed',
    });
  });

  it('keeps CLI child status running while the embedded snapshot is still running', () => {
    expect(resolveCLIChildProjectionStatus({
      snapshotStatus: 'running',
      resultStatus: 'success',
    })).toBe('running');
  });

  it('prefers a terminal live projection over a stale embedded running snapshot', () => {
    expect(resolveCLIChildProjectionStatus({
      snapshotStatus: 'running',
      liveProjectionStatus: 'failed',
      resultStatus: 'success',
    })).toBe('failed');
  });

  it('rebuilds a cancelled CLI child projection from persisted tool-result status metadata', () => {
    const messages: ChatMessage[] = [
      {
        id: 'tr-1',
        sessionId: 'parent-1',
        role: 'tool_result',
        content: JSON.stringify({
          childSessionId: 'cli-child-1',
          parentSessionId: 'parent-1',
          agentId: 'codex',
          status: 'running',
          toolResultStatus: 'cancelled',
          lastOutput: 'CLI agent stopped.',
        }),
        toolCallId: 'call-1',
        createdAt: 1,
      },
    ];

    const projections = rebuildCLIChildProjectionsFromMessages(
      'parent-1',
      messages,
      { 'call-1': 'spawn_cli_agent' },
    );

    expect(projections[0]).toMatchObject({
      childSessionId: 'cli-child-1',
      status: 'stopped',
      lastOutput: 'CLI agent stopped.',
    });
  });

  it('prefers runtime child execution status while preserving stored metadata fallbacks', () => {
    const projection = selectCLIChildProjectionFromSources({
      runtimeActivitySnapshots: {
        'parent-1': {
          sessionId: 'parent-1',
          active: true,
          queueLength: 0,
          pendingConfirmations: [],
          pendingBudgetApprovals: [],
          toolActivities: [],
          childExecutions: [{
            id: 'child-exec-1',
            kind: 'cli_agent',
            parentSessionId: 'parent-1',
            childSessionId: 'cli-child-1',
            parentToolCallId: 'call-1',
            label: 'copilot',
            status: 'running',
            lastOutput: 'runtime tail',
            updatedAt: 1,
          }],
          updatedAt: 1,
        },
      },
      cliChildProjections: {
        'cli-child-1': {
          childSessionId: 'cli-child-1',
          parentSessionId: 'parent-1',
          parentCallId: 'call-1',
          agentId: 'codex',
          status: 'failed',
          lastOutput: 'stored tail',
          childTitle: 'codex CLI',
          toolName: 'spawn_cli_agent',
        },
      },
      parentCallId: 'call-1',
    });

    expect(projection).toMatchObject({
      childSessionId: 'cli-child-1',
      agentId: 'codex',
      status: 'running',
      lastOutput: 'runtime tail',
      childTitle: 'codex CLI',
      toolName: 'spawn_cli_agent',
    });
  });
});

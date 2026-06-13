import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSession } from '@kalio/types';
import {
  isCliChildDelegationTool,
  projectionFromSession,
  projectionFromToolResult,
  rebuildCLIChildProjectionsFromMessages,
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
});

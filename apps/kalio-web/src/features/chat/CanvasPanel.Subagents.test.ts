import { describe, expect, it } from 'vitest';
import type { ChatSession } from '@kalio/types';
import type { ToolActivity } from '../../store/agentStore';
import { buildSubagentPreviews } from './CanvasPanel.Subagents';

describe('buildSubagentPreviews', () => {
  it('keeps failed sub-agent conversations visible with an error status', () => {
    const sessions: ChatSession[] = [
      {
        id: 'sub-failed',
        personaId: 'default',
        title: 'Sub-agent: failed reviewer',
        kind: 'subagent',
        parentSessionId: 'session-1',
        createdAt: 1,
        updatedAt: 3,
      },
    ];
    const toolActivities: ToolActivity[] = [
      {
        callId: 'call-failed-subagent',
        toolName: 'run_subagent',
        args: {},
        status: 'error',
        startedAt: 1,
        finishedAt: 3,
        result: {
          callId: 'call-failed-subagent',
          status: 'error',
          data: {
            childSessionId: 'sub-failed',
          },
          errorMessage: 'Sub-agent branch failed before producing a final answer.',
        },
      },
    ];

    expect(buildSubagentPreviews([], toolActivities, sessions)).toEqual([
      expect.objectContaining({
        sessionId: 'sub-failed',
        title: 'Sub-agent: failed reviewer',
        status: 'error',
        summary: 'Sub-agent branch failed before producing a final answer.',
      }),
    ]);
  });

  it('ignores projected sub-agent results when no real child session exists', () => {
    const toolActivities: ToolActivity[] = [
      {
        callId: 'call-missing-subagent',
        toolName: 'run_subagent',
        args: {},
        status: 'success',
        startedAt: 1,
        finishedAt: 2,
        result: {
          callId: 'call-missing-subagent',
          status: 'success',
          data: {
            childSessionId: 'sub-missing',
            result: 'draft output',
            taskId: 'task-1',
            parentSessionId: 'session-1',
            copiedFiles: [],
          },
        },
      },
    ];

    expect(buildSubagentPreviews([], toolActivities, [])).toEqual([]);
  });

  it('prefers runtime child execution status over stale durable tool state', () => {
    const sessions: ChatSession[] = [
      {
        id: 'sub-runtime',
        personaId: 'default',
        title: 'Sub-agent: runtime reviewer',
        kind: 'subagent',
        parentSessionId: 'session-1',
        createdAt: 1,
        updatedAt: 3,
      },
    ];

    const previews = buildSubagentPreviews(
      [],
      [],
      sessions,
      [{
        id: 'child-exec-1',
        kind: 'subagent',
        parentSessionId: 'session-1',
        childSessionId: 'sub-runtime',
        parentToolCallId: 'call-1',
        label: 'Runtime reviewer',
        status: 'completed',
        updatedAt: 3,
      }],
    );

    expect(previews).toEqual([
      expect.objectContaining({
        sessionId: 'sub-runtime',
        label: 'Runtime reviewer',
        status: 'success',
      }),
    ]);
  });

  it('shows runtime-only sub-agent previews even before durable tool results land', () => {
    const sessions: ChatSession[] = [
      {
        id: 'sub-runtime-only',
        personaId: 'default',
        title: 'Sub-agent: runtime only',
        kind: 'subagent',
        parentSessionId: 'session-1',
        createdAt: 1,
        updatedAt: 4,
      },
    ];

    const previews = buildSubagentPreviews(
      [],
      [],
      sessions,
      [{
        id: 'child-exec-2',
        kind: 'subagent',
        parentSessionId: 'session-1',
        childSessionId: 'sub-runtime-only',
        parentToolCallId: 'call-2',
        label: 'Runtime only',
        status: 'running',
        updatedAt: 4,
      }],
    );

    expect(previews).toEqual([
      expect.objectContaining({
        sessionId: 'sub-runtime-only',
        label: 'Runtime only',
        status: 'running',
        summary: null,
      }),
    ]);
  });

  it('rebuilds a waiting child preview from durable session ownership after restart', () => {
    const sessions: ChatSession[] = [{
      id: 'sub-waiting',
      personaId: 'default',
      title: 'Sub-agent: waiting reviewer',
      kind: 'subagent',
      parentSessionId: 'session-1',
      createdAt: 1,
      updatedAt: 5,
    }];

    expect(buildSubagentPreviews(
      [],
      [],
      sessions,
      [],
      new Set(['sub-waiting']),
      'session-1',
    )).toEqual([
      expect.objectContaining({
        sessionId: 'sub-waiting',
        status: 'waiting',
      }),
    ]);
  });
});

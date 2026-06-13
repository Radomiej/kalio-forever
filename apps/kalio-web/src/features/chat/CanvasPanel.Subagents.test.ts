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

    expect(buildSubagentPreviews([], toolActivities, {}, sessions)).toEqual([
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

    expect(buildSubagentPreviews([], toolActivities, {}, [])).toEqual([]);
  });
});

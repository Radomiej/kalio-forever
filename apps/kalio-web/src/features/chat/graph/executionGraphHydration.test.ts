import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@kalio/types';
import { extractExecutionGraphHydrationStatus } from './executionGraphHydration';

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    sessionId: 'parent',
    role: 'assistant',
    content: '',
    createdAt: 1,
    ...overrides,
  } as ChatMessage;
}

describe('extractExecutionGraphHydrationStatus', () => {
  it('reports successful VFS reads across architecture branch sessions', () => {
    const parentMessages = [
      message({
        id: 'result-1',
        role: 'tool_result',
        toolCallId: 'architecture:run-1:event-1',
        content: JSON.stringify({
          architectureRunId: 'run-1',
          childSessionId: 'branch-1',
        }),
      }),
    ];

    const status = extractExecutionGraphHydrationStatus(parentMessages, {
      'branch-1': [
        message({
          id: 'a1',
          sessionId: 'branch-1',
          role: 'assistant',
          toolCalls: [{ id: 'read-1', name: 'vfs_read', args: { path: 'project/README.md' } }],
        }),
        message({
          id: 'r1',
          sessionId: 'branch-1',
          role: 'tool_result',
          toolCallId: 'read-1',
          content: '# README',
        }),
      ],
    });

    expect(status).toMatchObject({
      label: 'VFS 1/1 ok',
      tone: 'success',
      readFailures: 0,
      readSuccesses: 1,
      totalBranches: 1,
    });
  });

  it('shows muted hydration when branch transcripts are loaded but the VFS read has not returned yet', () => {
    const parentMessages = [
      message({
        id: 'result-1',
        role: 'tool_result',
        toolCallId: 'architecture:run-1:event-1',
        content: JSON.stringify({
          architectureRunId: 'run-1',
          childSessionId: 'branch-1',
        }),
      }),
    ];

    const status = extractExecutionGraphHydrationStatus(parentMessages, {
      'branch-1': [
        message({
          id: 'a1',
          sessionId: 'branch-1',
          role: 'assistant',
          toolCalls: [{ id: 'read-1', name: 'vfs_read', args: { path: 'project/README.md' } }],
        }),
      ],
    });

    expect(status).toMatchObject({
      label: 'VFS 0/1 seen',
      tone: 'muted',
      detail: '1 branch transcript(s) have no vfs_read result yet',
      readFailures: 0,
      readSuccesses: 0,
      totalBranches: 1,
    });
  });

  it('warns when an architecture branch read failed', () => {
    const parentMessages = [
      message({
        id: 'result-1',
        role: 'tool_result',
        toolCallId: 'architecture:run-1:event-1',
        content: JSON.stringify({
          architectureRunId: 'run-1',
          childSessionId: 'branch-1',
        }),
      }),
    ];

    const status = extractExecutionGraphHydrationStatus(parentMessages, {
      'branch-1': [
        message({
          id: 'a1',
          sessionId: 'branch-1',
          role: 'assistant',
          toolCalls: [{ id: 'read-1', name: 'vfs_read', args: { path: 'project/README.md' } }],
        }),
        message({
          id: 'r1',
          sessionId: 'branch-1',
          role: 'tool_result',
          toolCallId: 'read-1',
          content: "ENOENT: no such file or directory, open 'project/README.md'",
        }),
      ],
    });

    expect(status).toMatchObject({
      label: 'VFS 1 missing',
      tone: 'warning',
      readFailures: 1,
    });
  });

  it('accepts persisted architecture results with typed architecture run metadata', () => {
    const parentMessages = [
      message({
        id: 'result-1',
        role: 'tool_result',
        toolCallId: 'architecture:run-1:event-1',
        content: JSON.stringify({
          architectureRunId: 'run-1',
          childSessionId: 'branch-1',
        }),
      }),
    ];

    const status = extractExecutionGraphHydrationStatus(parentMessages, {
      'branch-1': [
        message({
          id: 'a1',
          sessionId: 'branch-1',
          role: 'assistant',
          toolCalls: [{ id: 'read-1', name: 'vfs_read', args: { path: 'project/README.md' } }],
        }),
        message({
          id: 'r1',
          sessionId: 'branch-1',
          role: 'tool_result',
          toolCallId: 'read-1',
          content: '# README',
        }),
      ],
    });

    expect(status?.label).toBe('VFS 1/1 ok');
  });
});

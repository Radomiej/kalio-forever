import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditLogEntry } from '@kalio/types';
import { ObservabilityPage } from './ObservabilityPage';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('../../store/sessionStore', () => ({
  useSessionStore: (selector: (state: { sessions: Array<{ id: string; title: string }> }) => unknown) => selector({
    sessions: [{ id: 'session-1', title: 'Workflow run' }],
  }),
}));

describe('ObservabilityPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      return Promise.resolve({
        ok: true,
        json: async () => (url.includes('/retention') ? makeRetentionStatus() : makeEntries()),
      });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('defaults to workflow rows and lets tools be inspected separately', async () => {
    render(<ObservabilityPage />);

    await waitFor(() => expect(screen.getByTestId('architecture-run-group')).toBeTruthy());

    expect(screen.getByTestId('audit-retention-strip')).toHaveTextContent('visible 3/50k');
    expect(screen.getByTestId('audit-retention-strip')).toHaveTextContent('retention 30d');
    expect(screen.getByTestId('audit-retention-strip')).toHaveTextContent('archived 2');
    expect(screen.getByText('Architecture run run-1')).toBeTruthy();
    expect(screen.getAllByText('5 events').length).toBeGreaterThan(0);
    expect(screen.getAllByText('tok 120 (100 in / 20 out)').length).toBeGreaterThan(0);
    expect(screen.queryByText(/tok 170/)).toBeNull();
    expect(screen.queryByText('architecture_event')).toBeNull();
    expect(screen.queryByText('architecture vfs')).toBeNull();

    fireEvent.click(screen.getByTestId('architecture-run-group').querySelector('button')!);
    expect(screen.getByText('LLM response')).toBeTruthy();
    expect(screen.getAllByText('architecture_event').length).toBeGreaterThan(0);
    expect(screen.getByText('architecture vfs')).toBeTruthy();
    expect(screen.getByText('vfs_write, vfs_read (2)')).toBeTruthy();

    fireEvent.click(screen.getByTestId('audit-view-tools'));
    expect(screen.getByText('vfs_read')).toBeTruthy();
    expect(screen.getByText('architecture vfs')).toBeTruthy();
    expect(screen.queryByText('architecture_event')).toBeNull();

    fireEvent.click(screen.getByTestId('audit-view-all'));
    expect(screen.getByText('vfs_read')).toBeTruthy();
    expect(screen.getByText('architecture vfs')).toBeTruthy();
    expect(screen.getAllByText('architecture_event').length).toBeGreaterThan(0);

    const toolRow = screen.getByTestId('audit-entry-row:tool-1');
    const firstArchitectureRow = screen.getByTestId('audit-entry-row:architecture-3');
    const llmRow = screen.getByTestId('audit-entry-row:llm-1');
    expect(toolRow.compareDocumentPosition(firstArchitectureRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(firstArchitectureRow.compareDocumentPosition(llmRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

function makeEntries(): AuditLogEntry[] {
  return [
    {
      id: 'llm-1',
      sessionId: 'session-1',
      type: 'llm_response',
      label: 'LLM response',
      data: {
        architectureRunId: 'run-1',
        estimatedInputTokens: 50,
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      },
      durationMs: 1000,
      chunkCount: null,
      createdAt: 1_000,
    },
    {
      id: 'architecture-1',
      sessionId: 'session-1',
      type: 'tool_result',
      label: 'architecture_event',
      data: {
        kind: 'architecture_event',
        runId: 'run-1',
        eventType: 'node_started',
        nodeId: 'planner',
      },
      durationMs: null,
      chunkCount: null,
      createdAt: 2_000,
    },
    {
      id: 'architecture-tool-1',
      sessionId: 'session-1',
      type: 'tool_result',
      label: 'architecture vfs',
      data: {
        kind: 'file_tool_result',
        domain: 'architecture',
        architectureRunId: 'run-1',
        fileTool: { toolName: 'vfs_read', path: 'project/AGENTS.md' },
      },
      durationMs: null,
      chunkCount: null,
      createdAt: 2_500,
    },
    {
      id: 'architecture-2',
      sessionId: 'session-1',
      type: 'tool_result',
      label: 'architecture_final',
        data: {
          kind: 'architecture_event',
          runId: 'run-1',
          eventType: 'final_artifact',
          nodeId: 'final-artifact',
          toolEvidence: {
            toolResultCount: 2,
            successfulToolNames: ['vfs_write', 'vfs_read'],
          },
        },
      durationMs: null,
      chunkCount: null,
      createdAt: 2_750,
    },
    {
      id: 'architecture-3',
      sessionId: 'session-1',
      type: 'architecture_event',
      label: 'architecture_event:router_decision:goal-master',
      data: {
        kind: 'architecture_event',
        runId: 'run-1',
        eventType: 'router_decision',
        nodeId: 'goal-master',
        incompleteReason: 'Subagent exhausted its tool loop without producing a final answer.',
      },
      durationMs: null,
      chunkCount: null,
      createdAt: 2_800,
    },
    {
      id: 'tool-1',
      sessionId: 'session-1',
      type: 'tool_call',
      label: 'vfs_read',
      data: {
        kind: 'file_tool_call',
        domain: 'vfs',
        fileTool: { toolName: 'vfs_read', path: 'project/README.md' },
      },
      durationMs: null,
      chunkCount: null,
      createdAt: 3_000,
    },
  ];
}

function makeRetentionStatus() {
  return {
    hotRows: 3,
    archivedRows: 2,
    maxHotRows: 50_000,
    maxArchivedRows: 250_000,
    retentionDays: 30,
    archiveRetentionDays: 30,
    pruneEveryWrites: 100,
    pruneIntervalHours: 24,
    lastRetentionRunAt: null,
    nextRetentionRunAt: null,
    oldestHotEntryAt: 1_000,
    newestHotEntryAt: 3_000,
    oldestArchiveEntryAt: 500,
    newestArchiveEntryAt: 2_000,
    coldStorageEnabled: true,
    coldStorageMode: 'sqlite_table',
  };
}

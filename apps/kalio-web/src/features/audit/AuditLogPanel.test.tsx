import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditLogEntry } from '@kalio/types';
import { AuditLogPanel } from './AuditLogPanel';

const entries: AuditLogEntry[] = [
  {
    id: 'audit-1',
    sessionId: 'session-1',
    type: 'tool_call',
    label: 'run_sub_agentflow',
    createdAt: new Date('2026-06-01T08:00:00Z').getTime(),
    durationMs: 450,
    chunkCount: 1,
    data: {
      flowId: 'goal_guard_delivery_loop',
      status: 'running',
    },
  },
  {
    id: 'audit-2',
    sessionId: 'session-1',
    type: 'error',
    label: 'Materializer missing evidence',
    createdAt: new Date('2026-06-01T08:00:01Z').getTime(),
    durationMs: 1250,
    chunkCount: 1,
    data: null,
  },
];

describe('AuditLogPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('loads audit events, expands structured data, and can disable auto refresh', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/api/audit-log?limit=200&source=all');
      return {
        ok: true,
        json: async () => entries,
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AuditLogPanel />);

    expect(await screen.findByText('run_sub_agentflow')).toBeInTheDocument();
    expect(screen.getByText('Materializer missing evidence')).toBeInTheDocument();
    expect(screen.getByText('450ms')).toBeInTheDocument();
    expect(screen.getByText('1.3s')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Toggle data' }));
    expect(screen.getByText(/goal_guard_delivery_loop/)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /auto/i }));
    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /auto/i })).not.toBeChecked();
    });
  });
});

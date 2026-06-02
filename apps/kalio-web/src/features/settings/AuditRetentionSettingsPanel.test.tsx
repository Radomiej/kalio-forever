import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditRetentionStatus } from '@kalio/types';
import { AuditRetentionSettingsPanel } from './AuditRetentionSettingsPanel';

const fetchMock = vi.hoisted(() => vi.fn());

describe('AuditRetentionSettingsPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/audit-log/retention' && init?.method === 'PUT') {
        return okJson({
          retentionDays: 21,
          archiveRetentionDays: 30,
          pruneEveryWrites: 100,
          pruneIntervalHours: 24,
          maxHotRows: 50_000,
          maxArchivedRows: 250_000,
        });
      }
      if (url === '/api/audit-log/retention/run?confirm=true') {
        return okJson(makeStatus({ hotRows: 3, archivedRows: 12, lastRetentionRunAt: 1_779_000_000_000 }));
      }
      if (url === '/api/audit-log/retention') {
        return okJson(makeStatus());
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('loads the 30-day default, saves edits, and can run retention manually', async () => {
    render(<AuditRetentionSettingsPanel />);

    const hotRetention = await screen.findByLabelText('Hot delete after days');
    expect(hotRetention).toHaveValue(30);
    expect(screen.getByText(/every 100 writes \/ 24h/i)).toBeTruthy();
    expect(screen.getByText(/Hot delete after:/)).toBeTruthy();
    expect(screen.getByText(/Cold delete after:/)).toBeTruthy();

    fireEvent.change(hotRetention, { target: { value: '21' } });
    fireEvent.click(screen.getByRole('button', { name: /save policy/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/audit-log/retention', expect.objectContaining({
      method: 'PUT',
      body: expect.stringContaining('"retentionDays":21'),
    })));
    expect(await screen.findByText('Audit retention policy updated.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /run retention now/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/audit-log/retention/run?confirm=true', expect.objectContaining({
      method: 'POST',
    })));
    expect(await screen.findByText(/Cold rows:/)).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
  });
});

function okJson(data: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    json: async () => data,
  } as Response);
}

function makeStatus(overrides: Partial<AuditRetentionStatus> = {}) {
  return {
    ...makeBaseStatus(),
    ...overrides,
  };
}

function makeBaseStatus(): AuditRetentionStatus {
  return {
    hotRows: 7,
    archivedRows: 4,
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
    coldStorageMode: 'sqlite_table' as const,
  };
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MCPExternalImportModal } from './MCPExternalImportModal';

describe('MCPExternalImportModal', () => {
  const baseEntries = [
    {
      id: 'cursor:/home/user/.config/Cursor/mcp.json:github',
      source: 'cursor' as const,
      configPath: '/home/user/.config/Cursor/mcp.json',
      sourceKey: 'github',
      dto: {
        name: 'github',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
      },
      details: { envKeys: [], headerKeys: [] },
      equivalentToExisting: false,
    },
    {
      id: 'cursor:/home/user/.config/Cursor/mcp.json:filesystem',
      source: 'cursor' as const,
      configPath: '/home/user/.config/Cursor/mcp.json',
      sourceKey: 'filesystem',
      serverKey: 'sqlite::filesystem',
      dto: {
        name: 'filesystem',
        transport: 'http',
        url: 'https://example.com/mcp',
      },
      details: { envKeys: ['TOKEN'], headerKeys: ['X-Source'] },
      effectiveState: 'active',
      originSource: 'cursor',
      equivalentToExisting: false,
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders sourceKey fallback when serverKey is missing', async () => {
    const fetchMock = vi.spyOn(window, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('/api/mcp/servers/import/external/discover')) {
        return new Response(JSON.stringify(baseEntries), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }
      return new Response('Unexpected endpoint', { status: 500 });
    });
    const onClose = vi.fn();
    const onImported = vi.fn();

    render(
      <MCPExternalImportModal
        isOpen
        onClose={onClose}
        onImported={onImported}
      />,
    );

    await screen.findByText(/Import Existing MCP Configs/);
    expect(fetchMock).toHaveBeenCalled();
    expect(screen.getByText('sourceKey: github')).toBeTruthy();
    expect(screen.getByText('serverKey: sqlite::filesystem | sourceKey: filesystem | state: active | origin: cursor')).toBeTruthy();
  });

  it('sends selected entry ids to apply endpoint and closes on success', async () => {
    const fetchMock = vi.spyOn(window, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).endsWith('/api/mcp/servers/import/external/discover')) {
        return new Response(JSON.stringify(baseEntries), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }
      if (String(url).endsWith('/api/mcp/servers/import/external/apply')) {
        const body = init ? JSON.parse(String(init.body)) : { entryIds: [] };
        return new Response(
          JSON.stringify({
            imported: body.entryIds.map((entryId: string) => ({ id: entryId, name: entryId })),
            skipped: [],
            failed: [],
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        );
      }
      return new Response('Unexpected endpoint', { status: 500 });
    });
    const onClose = vi.fn();
    const onImported = vi.fn();
    const user = userEvent.setup();

    render(
      <MCPExternalImportModal
        isOpen
        onClose={onClose}
        onImported={onImported}
      />,
    );

    await screen.findByText('Import Existing MCP Configs');
    await user.click(screen.getByTestId('mcp-external-check-0'));
    await user.click(screen.getByTestId('mcp-external-apply-btn'));

    await screen.findByTestId('mcp-external-result');
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/mcp/servers/import/external/apply',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ entryIds: [baseEntries[0].id] }),
      }),
    );
  });
});

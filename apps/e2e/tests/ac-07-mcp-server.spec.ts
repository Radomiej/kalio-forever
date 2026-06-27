import { test, expect, type Page } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

function toSettingsRowSuffix(serverKey: string): string {
  return `${serverKey.replace(/[^a-zA-Z0-9_-]+/g, '-')}-sqlite`;
}

async function openMCPPanel(page: Page) {
  await page.goto('/');
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-modal')).toBeVisible();
  await page.getByTestId('settings-tab-mcp').click();
  await expect(page.getByTestId('mcp-panel')).toBeVisible();
}

async function deleteMCPServer(page: Page, serverKey: string) {
  await page.request.delete(`${API_BASE}/mcp/servers/${encodeURIComponent(serverKey)}`);
}

function expectServerKey(entry: { serverKey?: string; id: string; name: string }): string {
  expect(entry.serverKey, `serverKey should be present for MCP server ${entry.name} (${entry.id})`).toBeTruthy();
  return entry.serverKey!;
}

test.describe('AC-07: MCP server management', () => {
  test('MCP panel is visible when settings modal is opened', async ({ page }) => {
    await openMCPPanel(page);
    await expect(page.getByTestId('mcp-panel')).toBeVisible();
  });

  test('can add an HTTP MCP server via form', async ({ page }) => {
    await openMCPPanel(page);
    await page.getByTestId('mcp-add-toggle').click();
    await expect(page.getByTestId('mcp-add-form')).toBeVisible();

    await page.getByTestId('mcp-form-name').fill('E2E Test Server');
    await page.getByTestId('mcp-form-url').fill('http://localhost:19999/mcp');
    await page.getByTestId('mcp-form-submit').click();

    // Server should appear in the list (even if connection fails, it's created)
    await expect(page.getByText('E2E Test Server')).toBeVisible({ timeout: 8000 });

    // Cleanup: find created server by serverKey/serverId and delete
    const servers = await page.request.get(`${API_BASE}/mcp/servers`);
    const list = await servers.json() as { id: string; serverKey?: string; name: string }[];
    const created = list.find((s) => s.name === 'E2E Test Server');
    if (created) {
      await deleteMCPServer(page, expectServerKey(created));
    }
  });

  test('added server appears in the list and can be removed', async ({ page }) => {
    const res = await page.request.post(`${API_BASE}/mcp/servers`, {
      data: { name: 'E2E Remove Test', transport: 'http', url: 'http://localhost:19999/mcp' },
    });
    const server = await res.json() as { id: string; serverKey?: string };
    const serverKey = expectServerKey(server);
    const rowSuffix = toSettingsRowSuffix(serverKey);

    await openMCPPanel(page);
    await expect(page.getByTestId(`mcp-server-${rowSuffix}`)).toBeVisible({ timeout: 5000 });

    // Remove with confirm
    await page.getByTestId(`mcp-remove-${rowSuffix}`).click();
    await page.getByTestId(`mcp-remove-confirm-${rowSuffix}`).click();
    await expect(page.getByTestId(`mcp-server-${rowSuffix}`)).not.toBeVisible({ timeout: 5000 });
  });

  test('open MCP panel picks up server list changes through polling', async ({ page }) => {
    let serverListCalls = 0;
    await page.route('**/api/mcp/servers', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }

      serverListCalls += 1;
      const list = serverListCalls < 2
        ? []
        : [{
            serverKey: 'sqlite::polling-hot-reload',
            id: 'polling-hot-reload',
            name: 'Polling Hot Reload',
            transport: 'http',
            url: 'http://localhost:19999/mcp',
            status: 'connected',
            toolCount: 3,
            createdAt: Date.now(),
          }];

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(list),
      });
    });

    await openMCPPanel(page);
    await expect(page.getByTestId(`mcp-server-${toSettingsRowSuffix('sqlite::polling-hot-reload')}`)).toBeVisible({ timeout: 10_000 });
    expect(serverListCalls).toBeGreaterThanOrEqual(2);
  });
});

import { test, expect, type Page } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// ── Helper: open Settings → MCP Servers tab ───────────────────────────────────
async function openMCPPanel(page: Page) {
  await page.goto('/');
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-modal')).toBeVisible();
  await page.getByTestId('settings-tab-mcp').click();
  await expect(page.getByTestId('mcp-panel')).toBeVisible();
}

// ── Helper: delete an MCP server via API ──────────────────────────────────────
async function deleteMCPServer(page: Page, id: string) {
  await page.request.delete(`${API_BASE}/mcp/servers/${id}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
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

    // Cleanup: find created server id and delete
    const servers = await page.request.get(`${API_BASE}/mcp/servers`);
    const list = await servers.json() as { id: string; name: string }[];
    const created = list.find((s) => s.name === 'E2E Test Server');
    if (created) await deleteMCPServer(page, created.id);
  });

  test('added server appears in the list and can be removed', async ({ page }) => {
    // Create server directly via API
    const res = await page.request.post(`${API_BASE}/mcp/servers`, {
      data: { name: 'E2E Remove Test', transport: 'http', url: 'http://localhost:19999/mcp' },
    });
    const server = await res.json() as { id: string };

    await openMCPPanel(page);
    await expect(page.getByTestId(`mcp-server-${server.id}`)).toBeVisible({ timeout: 5000 });

    // Remove with confirm
    await page.getByTestId(`mcp-remove-${server.id}`).click();
    await page.getByTestId(`mcp-remove-confirm-${server.id}`).click();
    await expect(page.getByTestId(`mcp-server-${server.id}`)).not.toBeVisible({ timeout: 5000 });
  });
});


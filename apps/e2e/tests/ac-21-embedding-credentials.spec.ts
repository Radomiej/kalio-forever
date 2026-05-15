import { test, expect, type Page } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

const APP_URL = 'http://localhost:5188';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function openEmbeddingsPanel(page: Page) {
  await page.goto(APP_URL);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-modal')).toBeVisible();
  await page.getByTestId('settings-tab-embeddings').click();
  await expect(page.getByTestId('embeddings-panel')).toBeVisible();
}

/** Clean up all embedding credentials via API */
async function cleanupCredentials(page: Page) {
  const res = await page.request.get(`${API_BASE}/memory/embedding-credentials`);
  if (!res.ok()) return;
  const list: Array<{ id: string }> = await res.json();
  for (const c of list) {
    await page.request.delete(`${API_BASE}/memory/embedding-credentials/${c.id}`);
  }
}

/** Create a credential directly via API for test isolation */
async function seedCredential(page: Page, name: string) {
  const res = await page.request.post(`${API_BASE}/memory/embedding-credentials`, {
    data: {
      name,
      provider: 'openai',
      apiKey: 'sk-e2e-test-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { id: string; name: string };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Embedding Credentials UI', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await cleanupCredentials(page);
    await openEmbeddingsPanel(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupCredentials(page);
  });

  // ── Panel renders ─────────────────────────────────────────────────────────

  test('panel is visible when settings tab is opened', async ({ page }) => {
    await expect(page.getByTestId('embeddings-panel')).toBeVisible();
  });

  test('shows mock warning card when no credentials configured', async ({ page }) => {
    await expect(page.getByTestId('embedding-mock-card')).toBeVisible();
  });

  test('"Add Provider" button opens the add form', async ({ page }) => {
    await expect(page.getByTestId('embedding-add-form')).not.toBeVisible();
    await page.getByTestId('add-embedding-provider-btn').click();
    await expect(page.getByTestId('embedding-add-form')).toBeVisible();
  });

  // ── Provider preset buttons ───────────────────────────────────────────────

  test('clicking OpenAI preset fills in default baseUrl and model', async ({ page }) => {
    await page.getByTestId('add-embedding-provider-btn').click();
    await page.getByRole('button', { name: 'OpenAI' }).click();
    await expect(page.getByRole('textbox', { name: /base url/i }))
      .toHaveValue('https://api.openai.com/v1');
    await expect(page.getByRole('textbox', { name: /model/i }))
      .toHaveValue('text-embedding-3-small');
  });

  test('clicking Ollama preset fills localhost:11434 and nomic model', async ({ page }) => {
    await page.getByTestId('add-embedding-provider-btn').click();
    await page.getByRole('button', { name: 'Ollama' }).click();
    await expect(page.getByRole('textbox', { name: /base url/i }))
      .toHaveValue('http://localhost:11434');
    await expect(page.getByRole('textbox', { name: /model/i }))
      .toHaveValue('nomic-embed-text');
  });

  // ── Create credential via UI ──────────────────────────────────────────────

  test('can create a credential via the Add form', async ({ page }) => {
    await page.getByTestId('add-embedding-provider-btn').click();

    // Fill form
    await page.getByRole('button', { name: 'CometAPI' }).click();
    const nameInput = page.getByRole('textbox', { name: /name/i });
    await nameInput.clear();
    await nameInput.fill('My E2E CometAPI');
    await page.getByRole('textbox', { name: /api key/i }).fill('sk-comet-key');

    // Submit
    await page.getByTestId('embedding-add-btn').click();

    // Card appears with correct name
    await expect(
      page.getByTestId('embedding-credential-card').filter({ hasText: 'My E2E CometAPI' }),
    ).toBeVisible({ timeout: 5000 });

    // Mock warning disappears
    await expect(page.getByTestId('embedding-mock-card')).not.toBeVisible();
  });

  // ── Activate credential ──────────────────────────────────────────────────

  test('can activate a credential — card shows "active" badge', async ({ page }) => {
    await seedCredential(page, 'E2E Activatable');
    await page.reload();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-tab-embeddings').click();
    await expect(page.getByTestId('embeddings-panel')).toBeVisible();

    const card = page.getByTestId('embedding-credential-card').filter({ hasText: 'E2E Activatable' });
    await card.getByTestId('embedding-activate-btn').click();

    // Active badge appears on the card
    await expect(card.locator('.badge', { hasText: 'active' })).toBeVisible({ timeout: 5000 });
    // Activate button disappears (already active)
    await expect(card.getByTestId('embedding-activate-btn')).not.toBeVisible();
  });

  // ── Remove credential ─────────────────────────────────────────────────────

  test('can remove a credential via confirmation', async ({ page }) => {
    await seedCredential(page, 'E2E Removable');
    await page.reload();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-tab-embeddings').click();
    await expect(page.getByTestId('embeddings-panel')).toBeVisible();

    const card = page.getByTestId('embedding-credential-card').filter({ hasText: 'E2E Removable' });
    await card.getByTestId('embedding-remove-btn').click();
    // Confirmation appears — click Yes
    await card.getByRole('button', { name: 'Yes' }).click();

    // Card disappears
    await expect(card).not.toBeVisible({ timeout: 5000 });
  });

  // ── Activate multiple, switch ─────────────────────────────────────────────

  test('switching active between two credentials updates active badge', async ({ page }) => {
    const a = await seedCredential(page, 'Provider Alpha');
    const b = await seedCredential(page, 'Provider Beta');
    await page.reload();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-tab-embeddings').click();
    await expect(page.getByTestId('embeddings-panel')).toBeVisible();

    const cardA = page.getByTestId('embedding-credential-card').filter({ hasText: 'Provider Alpha' });
    const cardB = page.getByTestId('embedding-credential-card').filter({ hasText: 'Provider Beta' });

    // Activate A
    await cardA.getByTestId('embedding-activate-btn').click();
    await expect(cardA.locator('.badge', { hasText: 'active' })).toBeVisible({ timeout: 5000 });

    // Switch to B
    await cardB.getByTestId('embedding-activate-btn').click();
    await expect(cardB.locator('.badge', { hasText: 'active' })).toBeVisible({ timeout: 5000 });

    // A should no longer show active badge
    await expect(cardA.locator('.badge', { hasText: 'active' })).not.toBeVisible();

    // Cleanup via API
    await page.request.delete(`${API_BASE}/memory/embedding-credentials/${a.id}`);
    await page.request.delete(`${API_BASE}/memory/embedding-credentials/${b.id}`);
  });

  // ── API: status reflects DB source ───────────────────────────────────────

  test('GET /memory/status/embedding returns db source after activation', async ({ page }) => {
    const c = await seedCredential(page, 'Status Check');
    await page.request.put(`${API_BASE}/memory/embedding-credentials/active/${c.id}`);
    const status = await page.request.get(`${API_BASE}/memory/status/embedding`);
    const json = await status.json() as { source: string; configured: boolean; activeCredentialId: string };
    expect(json.source).toBe('db');
    expect(json.configured).toBe(true);
    expect(json.activeCredentialId).toBe(c.id);
  });

  test('GET /memory/status/embedding returns mock when no credential active', async ({ page }) => {
    const status = await page.request.get(`${API_BASE}/memory/status/embedding`);
    const json = await status.json() as { source: string; configured: boolean };
    expect(json.source).toBe('mock');
    expect(json.configured).toBe(false);
  });

  // ── API: CRUD ─────────────────────────────────────────────────────────────

  test('GET /memory/embedding-credentials returns list without apiKey', async ({ page }) => {
    await seedCredential(page, 'CRUD Test');
    const res = await page.request.get(`${API_BASE}/memory/embedding-credentials`);
    const list = await res.json() as Array<Record<string, unknown>>;
    expect(list.length).toBeGreaterThanOrEqual(1);
    for (const c of list) {
      expect(c['apiKey']).toBeUndefined();
    }
  });

  test('DELETE /memory/embedding-credentials/active clears active', async ({ page }) => {
    const c = await seedCredential(page, 'To Deactivate');
    await page.request.put(`${API_BASE}/memory/embedding-credentials/active/${c.id}`);
    const delRes = await page.request.delete(`${API_BASE}/memory/embedding-credentials/active`);
    const status = await delRes.json() as { source: string };
    expect(status.source).toBe('mock');
  });

  test('POST /memory/embedding-credentials/:id/test returns {ok, error} shape', async ({ page }) => {
    const c = await seedCredential(page, 'Test Connection');
    const res = await page.request.post(`${API_BASE}/memory/embedding-credentials/${c.id}/test`);
    expect(res.ok()).toBeTruthy();
    const json = await res.json() as { ok: boolean; error?: string };
    expect(typeof json.ok).toBe('boolean');
  });
});

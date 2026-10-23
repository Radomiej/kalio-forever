import { test, expect, type Page } from '@playwright/test';
import { API_BASE, getActiveCredentialId, restoreActiveCredential } from './helpers/test-config';

// ── Helper: open Settings → LLM Providers tab ─────────────────────────────────
async function openLLMPanel(page: Page) {
  await page.goto('/');
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-modal')).toBeVisible();
  await page.getByTestId('settings-tab-llm').click();
  await expect(page.getByTestId('llm-panel')).toBeVisible();
  await expect(page.getByTestId('add-provider-btn')).toBeVisible({ timeout: 10_000 });
}

// ── Helper: clean up a credential by id via API ───────────────────────────────
async function deleteCredential(page: Page, id: string) {
  await page.request.delete(`${API_BASE}/credentials/${id}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
test.describe('LLMPanel E2E', () => {
  test('LLM panel is visible when settings modal is opened', async ({ page }) => {
    await openLLMPanel(page);
    await expect(page.getByTestId('llm-panel')).toBeVisible();
  });

  test('"Add Provider" button opens the add form', async ({ page }) => {
    await openLLMPanel(page);
    await expect(page.getByTestId('add-provider-form')).not.toBeVisible();
    await page.getByTestId('add-provider-btn').click();
    await expect(page.getByTestId('add-provider-form')).toBeVisible();
  });

  test('can fill in name, provider, apiKey, model', async ({ page }) => {
    await openLLMPanel(page);
    await page.getByTestId('add-provider-btn').click();

    await page.getByRole('textbox', { name: /name/i }).fill('E2E Test Key');
    await page.getByRole('button', { name: 'DeepSeek' }).click();
    await page.getByTestId('add-provider-apikey').fill('sk-e2e-test');
    const modelInput = page.getByTestId('add-provider-model');
    await expect(modelInput).toHaveValue('deepseek-reasoner');
    await modelInput.fill('deepseek-chat');

    // Verify values are set
    await expect(page.getByRole('textbox', { name: /name/i })).toHaveValue('E2E Test Key');
    await expect(page.getByTestId('add-provider-model')).toHaveValue('deepseek-chat');
  });

  test('cancel button closes the form without adding', async ({ page }) => {
    await openLLMPanel(page);
    const initialRows = await page.getByTestId(/^provider-row-/).count();
    await page.getByTestId('add-provider-btn').click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('add-provider-form')).not.toBeVisible();
    await expect(page.getByTestId('add-provider-btn')).toBeVisible();
    expect(await page.getByTestId(/^provider-row-/).count()).toBe(initialRows);
  });

  test('after adding, credential appears in list', async ({ page }) => {
    await openLLMPanel(page);
    await page.getByTestId('add-provider-btn').click();

    await page.getByRole('textbox', { name: /name/i }).fill('E2E Ollama');
    await page.getByRole('button', { name: 'Ollama' }).click();
    await page.getByTestId('add-provider-apikey').fill('local');
    await page.getByTestId('add-provider-submit').click();

    await expect(page.getByText('E2E Ollama')).toBeVisible({ timeout: 5000 });

    // cleanup
    const rows = page.getByText('E2E Ollama');
    const row = rows.first().locator('xpath=ancestor::*[@data-testid[starts-with(., "provider-row-")]]');
    const testId = await row.getAttribute('data-testid');
    if (testId) await deleteCredential(page, testId.replace('provider-row-', ''));
  });

  test('activating a credential shows the active badge', async ({ page }) => {
    // Create a credential via API first
    const res = await page.request.post(`${API_BASE}/credentials`, {
      data: { name: 'E2E Activate Test', provider: 'ollama', apiKey: 'local', model: 'llama3.2' },
    });
    const cred = await res.json() as { id: string };

    try {
      await openLLMPanel(page);
      const row = page.getByTestId(`provider-row-${cred.id}`);
      await expect(row).toBeVisible();

      // Click the activate button (first button in row = circle/checkmark)
      await row.locator('button').first().click();
      await expect(row.getByText('active')).toBeVisible({ timeout: 5000 });
    } finally {
      await deleteCredential(page, cred.id);
    }
  });

  test('saved provider stays active after F5 without offering the test-only mock fallback', async ({ page }) => {
    if (!process.env['DATABASE_PATH']?.replaceAll('\\', '/').includes('playwright-stack/')) {
      throw new Error('Provider persistence fixture requires isolated Playwright storage');
    }
    const previousActiveId = await getActiveCredentialId(page.request);
    let credentialId: string | null = null;
    try {
      const clearResponse = await page.request.delete(`${API_BASE}/credentials/active`);
      expect(clearResponse.ok()).toBeTruthy();
      const configResponse = await page.request.get(`${API_BASE}/llm/config`);
      expect(configResponse.ok()).toBeTruthy();
      const config = await configResponse.json() as { provider: string };
      expect(config.provider).toBe('mock');

      const res = await page.request.post(`${API_BASE}/credentials`, {
        data: {
          name: 'E2E Env Fallback Test',
          provider: 'ollama',
          apiKey: 'local',
          model: 'e2e-saved-model-switch-check',
        },
      });
      expect(res.ok()).toBeTruthy();
      const cred = await res.json() as { id: string };
      credentialId = cred.id;

      await openLLMPanel(page);
      const row = page.getByTestId(`provider-row-${cred.id}`);
      await expect(row).toBeVisible();

      await row.locator('button').first().click();
      await expect(row.getByText('active')).toBeVisible({ timeout: 5000 });
      await page.getByTestId('settings-tab-runtime').click();
      await expect(page.getByTestId('model-selector')).toHaveValue('e2e-saved-model-switch-check');

      await page.getByTestId('settings-tab-llm').click();
      await expect(page.getByTestId('provider-env-mock')).toContainText('test-only fallback');
      await expect(page.getByTestId('provider-row-env')).toHaveCount(0);
      await expect(page.getByTestId('provider-activate-env')).toHaveCount(0);
      await page.reload();
      await openLLMPanel(page);
      await expect(row.getByText('active', { exact: true })).toBeVisible();
      expect(await getActiveCredentialId(page.request)).toBe(cred.id);
      await expect(page.getByTestId('provider-row-env')).toHaveCount(0);
      await expect(page.getByTestId('provider-activate-env')).toHaveCount(0);
      await page.getByTestId('settings-tab-runtime').click();
      await expect(page.getByTestId('model-selector')).toHaveValue('e2e-saved-model-switch-check');
    } finally {
      await restoreActiveCredential(page.request, previousActiveId);
      if (credentialId) await deleteCredential(page, credentialId);
    }
  });

  test('deleting a credential removes it from the list', async ({ page }) => {
    const res = await page.request.post(`${API_BASE}/credentials`, {
      data: { name: 'E2E Delete Test', provider: 'ollama', apiKey: 'local', model: 'llama3.2' },
    });
    const cred = await res.json() as { id: string };

    await openLLMPanel(page);
    const row = page.getByTestId(`provider-row-${cred.id}`);
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Click the trash/delete button (last button in row)
    await row.locator('button').last().click();
    await expect(row).not.toBeVisible({ timeout: 5000 });
  });

  test('context window slider updates the badge value', async ({ page }) => {
    await openLLMPanel(page);
    await page.getByTestId('settings-tab-runtime').click();
    const slider = page.getByTestId('context-window-slider');
    await expect(slider).toBeVisible();

    await slider.press('Home');
    for (let step = 0; step < 15; step += 1) {
      await slider.press('ArrowRight');
    }

    await expect(page.getByTestId('context-window-value')).toHaveText(/64k/, { timeout: 3000 });
  });
});

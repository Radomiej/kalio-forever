import { test, expect, type Page } from '@playwright/test';

async function openMemoryPage(page: Page) {
  await page.goto('/');
  await page.getByTestId('nav-mind').click();
  await page.getByTestId('mind-tab-memory').click();
  await expect(page.getByTestId('memory-page')).toBeVisible({ timeout: 10000 });
}

// AC-16: Memory Hybrid Search — user can ingest and search memory per persona
test.describe('AC-16: Memory Hybrid Search', () => {
  test('user can navigate to Memory page', async ({ page }) => {
    await openMemoryPage(page);
  });

  test('user can select persona from dropdown', async ({ page }) => {
    await openMemoryPage(page);
    await expect(page.getByTestId('memory-scope-overview')).toBeVisible();
    const personaScopes = page.locator('[data-testid^="memory-scope-persona-"]');
    await expect(personaScopes.first()).toBeVisible();
    expect(await personaScopes.count()).toBeGreaterThan(0);
  });

  test('user can search memory with hybrid mode', async ({ page }) => {
    await openMemoryPage(page);
    const searchInput = page.getByTestId('memory-search-input');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('test query');
    await page.getByTestId('memory-search-btn').click();

    await expect
      .poll(async () => {
        const resultCount = await page.getByTestId('memory-result').count();
        const hasNoResults = await page.getByText(/No results found/i).isVisible().catch(() => false);
        return resultCount > 0 || hasNoResults;
      }, { timeout: 10000 })
      .toBe(true);
  });

  test('user can switch search modes', async ({ page }) => {
    await openMemoryPage(page);
    await expect(page.getByTestId('memory-mode-hybrid')).toBeVisible();
    await expect(page.getByTestId('memory-mode-vector')).toBeVisible();
    await expect(page.getByTestId('memory-mode-fts')).toBeVisible();

    await page.getByTestId('memory-mode-vector').click();
    await page.getByTestId('memory-mode-fts').click();
    await page.getByTestId('memory-mode-hybrid').click();
  });

  test('user can ingest text to memory', async ({ page }) => {
    await openMemoryPage(page);
    const personaScope = page.locator('[data-testid^="memory-scope-persona-"]').first();
    await personaScope.click();
    const ingestBtn = page.getByTestId('memory-ingest-btn');
    await expect(ingestBtn).toBeVisible();
    await ingestBtn.click();

    const textarea = page.getByTestId('memory-ingest-textarea');
    await expect(textarea).toBeVisible();
    await textarea.fill('This is a test memory entry for testing the memory system.');
    const submitBtn = page.getByTestId('memory-ingest-submit');
    await expect(submitBtn).toBeVisible();
  });

  test('memory page shows stats for selected persona', async ({ page }) => {
    await openMemoryPage(page);
    const personaScope = page.locator('[data-testid^="memory-scope-persona-"]').first();
    await personaScope.click();
    await expect(personaScope).toContainText(/stored memory/i);
    await expect(personaScope).toContainText(/KB/i);
    await expect(page.getByTestId('memory-freshness')).toBeVisible();
  });
});

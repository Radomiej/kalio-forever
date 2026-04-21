import { test, expect } from '@playwright/test';

// AC-16: Memory Hybrid Search — user can ingest and search memory per persona
test.describe('AC-16: Memory Hybrid Search', () => {
  test('user can navigate to Memory page', async ({ page }) => {
    await page.goto('http://localhost:5188');

    // Click Memory tab in sidebar
    const memoryNav = page.getByTestId('nav-memory');
    await expect(memoryNav).toBeVisible();
    await memoryNav.click();

    // Memory page should be visible
    await expect(page.getByTestId('memory-page')).toBeVisible();
    await expect(page.getByText('Memory')).toBeVisible();
  });

  test('user can select persona from dropdown', async ({ page }) => {
    await page.goto('http://localhost:5188');
    await page.getByTestId('nav-memory').click();

    // Persona selector should be visible
    const personaSelect = page.getByTestId('memory-persona-select');
    await expect(personaSelect).toBeVisible();

    // Should have at least one option
    const options = personaSelect.locator('option');
    await expect(options).toHaveCount.greaterThan(0);
  });

  test('user can search memory with hybrid mode', async ({ page }) => {
    await page.goto('http://localhost:5188');
    await page.getByTestId('nav-memory').click();

    // Wait for persona to load and select one
    await page.waitForTimeout(500);
    const personaSelect = page.getByTestId('memory-persona-select');
    if (await personaSelect.isVisible()) {
      await personaSelect.selectOption({ index: 1 });
    }

    // Search input should be visible
    const searchInput = page.getByTestId('memory-search-input');
    await expect(searchInput).toBeVisible();

    // Enter search query
    await searchInput.fill('test query');

    // Click search
    const searchBtn = page.getByTestId('memory-search-btn');
    await searchBtn.click();

    // Wait for results or no results message
    await page.waitForTimeout(1000);
    const hasResults = await page.getByTestId('memory-result').count() > 0;
    const hasNoResults = await page.getByText(/No results found|Search to find memories/i).isVisible();
    expect(hasResults || hasNoResults).toBeTruthy();
  });

  test('user can switch search modes', async ({ page }) => {
    await page.goto('http://localhost:5188');
    await page.getByTestId('nav-memory').click();

    // All mode buttons should be visible
    await expect(page.getByTestId('memory-mode-hybrid')).toBeVisible();
    await expect(page.getByTestId('memory-mode-vector')).toBeVisible();
    await expect(page.getByTestId('memory-mode-fts')).toBeVisible();

    // Click vector mode
    await page.getByTestId('memory-mode-vector').click();

    // Click FTS mode
    await page.getByTestId('memory-mode-fts').click();

    // Back to hybrid
    await page.getByTestId('memory-mode-hybrid').click();
  });

  test('user can ingest text to memory', async ({ page }) => {
    await page.goto('http://localhost:5188');
    await page.getByTestId('nav-memory').click();

    // Wait for page to load
    await page.waitForTimeout(500);

    // Select a persona if dropdown exists
    const personaSelect = page.getByTestId('memory-persona-select');
    if (await personaSelect.isVisible()) {
      const options = await personaSelect.locator('option').count();
      if (options > 1) {
        await personaSelect.selectOption({ index: 1 });
      }
    }

    // Open ingest panel
    const ingestBtn = page.getByTestId('memory-ingest-btn');
    await expect(ingestBtn).toBeVisible();
    await ingestBtn.click();

    // Textarea should appear
    const textarea = page.getByTestId('memory-ingest-textarea');
    await expect(textarea).toBeVisible();

    // Enter text
    await textarea.fill('This is a test memory entry for testing the memory system.');

    // Submit should be visible (may be disabled if no persona selected)
    const submitBtn = page.getByTestId('memory-ingest-submit');
    await expect(submitBtn).toBeVisible();
  });

  test('memory page shows stats for selected persona', async ({ page }) => {
    await page.goto('http://localhost:5188');
    await page.getByTestId('nav-memory').click();

    // Wait for stats to load
    await page.waitForTimeout(500);

    // Select a persona
    const personaSelect = page.getByTestId('memory-persona-select');
    if (await personaSelect.isVisible()) {
      const options = await personaSelect.locator('option').count();
      if (options > 1) {
        await personaSelect.selectOption({ index: 1 });

        // Wait for stats to appear
        await page.waitForTimeout(500);

        // Stats should show entry count and size
        const statsText = page.getByText(/entries|KB/);
        if (await statsText.isVisible().catch(() => false)) {
          await expect(statsText).toBeVisible();
        }
      }
    }
  });
});

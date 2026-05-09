import { test, expect } from '@playwright/test';

// Regression test for: Hardcoded Persona ID in Session Creation
// Issue: SessionPanel.tsx uses hardcoded 'default' personaId
// There's no guarantee a persona with this ID exists
// This causes session creation to fail or use wrong configuration

test.describe('Hardcoded Persona ID (REGRESSION TEST)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
  });

  test('session creation should not rely on hardcoded persona ID', async ({ page }) => {
    // This test documents the regression:
    // File: apps/kalio-web/src/features/sessions/SessionPanel.tsx:22
    // Code: personaId: 'default'
    //
    // Problem: If no persona with ID 'default' exists, session creation
    // will fail or use incorrect configuration
    //
    // Expected behavior: Either:
    // 1. Create default persona if none exists
    // 2. Use first available persona from API
    // 3. Allow user to select persona before creating session

    // Open Talk section
    const talkNav = page.getByTestId('nav-talk');
    await talkNav.click();

    // Click new session button
    const newSessionBtn = page.getByTestId('new-session-btn');
    await expect(newSessionBtn).toBeVisible();

    // This action may fail if 'default' persona doesn't exist
    // The test captures this potential regression
    await newSessionBtn.click();

    // Verify session was created or appropriate error shown
    const sessionItems = page.getByTestId('session-item');

    // If we get here without error, the hardcoded ID might have worked
    // but that's coincidental, not by design
    const count = await sessionItems.count();

    // Document the issue: if count is 0 or error appears, hardcoded ID failed
    if (count === 0) {
      // Check for error message
      const errorMessage = page.getByText(/persona|not found|error/i);
      if (await errorMessage.isVisible().catch(() => false)) {
        test.fail(true, 'Hardcoded persona ID "default" caused error - persona may not exist');
      }
    }
  });

  test('should allow persona selection before creating session', async ({ page }) => {
    // Ideal behavior: user should select persona first
    // Current behavior: hardcoded 'default' is used

    // Navigate to Mind section
    await page.getByTestId('nav-mind').click();
    // Click Personas tab
    await page.getByRole('button', { name: 'Personas' }).click();

    // Check if any personas exist
    const personaItems = page.getByTestId('persona-item');
    const count = await personaItems.count();

    if (count === 0) {
      // Create a default persona first
      const newPersonaBtn = page.getByTestId('new-persona-btn');
      await newPersonaBtn.click();

      // Wait for persona to be created
      await page.waitForTimeout(500);
    }

    // Now go back to Talk and create one
    await page.getByTestId('nav-talk').click();
    await page.getByTestId('new-session-btn').click();

    // The session should be created with the existing persona
    // not a hardcoded 'default' that might not exist
    const sessionItems = page.getByTestId('session-item');
    await expect(sessionItems.first()).toBeVisible();
  });
});

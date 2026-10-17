import { expect, test } from '@playwright/test';
import { createExistingMockConversation } from './helpers/existing-mock-conversation';
import { deleteSessionIfExists, selectSession } from './helpers/test-config';

test.describe('Talk graph entry', () => {
  test('graph view is reachable from an active Talk conversation', async ({ page, request }) => {
    const title = `Graph entry ${Date.now()}`;
    const session = await createExistingMockConversation(request, title);
    try {
    await page.addInitScript(() => {
      window.sessionStorage.clear();
    });

    await page.goto('/');
    await page.getByTestId('nav-talk').click();

    await page.getByTestId('new-session-btn').click();
    await expect(page.getByTestId('welcome-screen')).toBeVisible();
    await selectSession(page, session.id, title);
    await expect(page.getByTestId('talk-conversation-switcher')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('talk-graph-switcher').click();

    await expect(page.getByTestId('execution-graph-view')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('heading', { name: 'Execution Graph' })).toBeVisible({ timeout: 5000 });
    } finally {
      await deleteSessionIfExists(request, session.id);
    }
  });
});

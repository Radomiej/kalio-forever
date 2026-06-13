import { expect, test } from '@playwright/test';
import { API_BASE, deleteSessionIfExists, selectSession } from './helpers/test-config';

test.describe('Agent budget HITL replay', () => {
  test('replays the extra-tool-budget approval banner for an active recovered turn', async ({ page, request }, testInfo) => {
    const suffix = Date.now();
    const title = `Budget Replay ${suffix}`;
    const requestId = `budget-replay-${suffix}`;
    const turnId = `budget-turn-${suffix}`;

    const sessionResponse = await request.post(`${API_BASE}/sessions`, {
      data: {
        personaId: 'default',
        title,
      },
    });
    expect(sessionResponse.ok()).toBeTruthy();
    const session = await sessionResponse.json() as { id: string };

    try {
      const seedResponse = await request.post(`${API_BASE}/test-support/agent-budget/seed-replay`, {
        data: {
          sessionId: session.id,
          requestId,
          promptMessage: 'Continue until you need more tool calls.',
          currentLimit: 60,
          usedIterations: 60,
          turnId,
          requestedBy: 'chat-agent',
        },
      });
      expect(seedResponse.ok()).toBeTruthy();

      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);

      await expect(page.getByTestId('message-list')).toContainText('Continue until you need more tool calls.', { timeout: 10_000 });
      await expect(page.getByTestId('agent-turn-bubble')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('turn-loading-indicator')).toBeVisible({ timeout: 10_000 });

      const approval = page.getByTestId('turn-budget-approval');
      await expect(approval).toContainText('Agent reached tool loop limit 60/60');
      await expect(approval.getByRole('button', { name: 'Block' })).toBeVisible();
      await expect(approval.getByRole('button', { name: '+1', exact: true })).toBeVisible();
      await expect(approval.getByRole('button', { name: '+10', exact: true })).toBeVisible();
      await expect(approval.getByRole('button', { name: 'Unlimited' })).toBeVisible();

      const screenshotPath = testInfo.outputPath('budget-hitl-replay-proof.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });

      const plusTen = approval.getByRole('button', { name: '+10', exact: true });
      await plusTen.click();
      await expect(page.getByTestId('turn-budget-approval')).toHaveCount(0);
      await expect(page.getByTestId('turn-loading-indicator')).toBeVisible();
    } finally {
      await request.post(`${API_BASE}/test-support/agent-budget/drop`, {
        data: {
          requestId,
          sessionId: session.id,
        },
      }).catch(() => undefined);
      await deleteSessionIfExists(request, session.id);
    }
  });
});

import { expect, test, type Page } from '@playwright/test';
import {
  deleteSessionIfExists,
  selectArchitectureInComposer,
  selectSession,
  sendMessageFromComposer,
} from './helpers/test-config';

async function clickByTestId(page: Page, testId: string) {
  await page.evaluate((value) => {
    const target = document.querySelector<HTMLElement>(`[data-testid="${value}"]`);
    if (!target) {
      throw new Error(`Missing target for data-testid="${value}"`);
    }
    target.click();
  }, testId);
}

function normalizeFinalAnswerText(content: string | null): string {
  return (content ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^Final answer\s*/i, '')
    .replace(/^Finalizer\s*/i, '')
    .trim();
}

test.describe('Architecture workflow follow-up stability', () => {
  test('keeps the earlier workflow bubble stable, exposes only real branch sessions, and rehydrates after reload', async ({ page, request }) => {
    test.setTimeout(300_000);
    let hostSessionId: string | null = null;

    try {
      await page.addInitScript(() => {
        window.sessionStorage.setItem('kalio:app-view-state', JSON.stringify({
          activeSection: 'talk',
          talkTab: 'conversations',
          talkView: 'conversation',
          toolsTab: 'native',
          mindTab: 'memory',
          selectedSkillId: null,
        }));
      });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      const newSessionButton = page.getByTestId('new-session-btn');
      await expect(newSessionButton).toBeVisible({ timeout: 30_000 });
      await clickByTestId(page, 'new-session-btn');
      await expect(page.getByTestId('chat-session-title')).toHaveText('New Chat', { timeout: 30_000 });
      await expect
        .poll(
          () => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')),
          { timeout: 15_000 },
        )
        .not.toBeNull();
      hostSessionId = await page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id'));
      const sessionId = hostSessionId;
      if (!sessionId) {
        throw new Error('Missing active host session id after creating a new chat.');
      }

      await selectArchitectureInComposer(page, 'strategic-decision-council');
      await sendMessageFromComposer(page, 'Assess what this workflow can do in two short bullets.');

      await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(1, { timeout: 120_000 });
      const firstBubble = page.getByTestId('agent-turn-bubble').first();
      await expect(firstBubble.locator('[data-testid="architecture-run-timeline"]')).toBeVisible({ timeout: 120_000 });

      await expect(firstBubble).toContainText('Finalizer', { timeout: 120_000 });
      await expect(firstBubble.locator('[data-testid="architecture-run-timeline"]')).toContainText('completed /', { timeout: 30_000 });
      await expect(firstBubble.locator('[data-testid="architecture-route-agent"]')).toHaveCount(5, { timeout: 30_000 });
      const firstBubbleFinalAnswer = normalizeFinalAnswerText(
        await firstBubble.locator('[data-testid="architecture-final-answer"]').textContent(),
      );
      expect(firstBubbleFinalAnswer.length).toBeGreaterThan(24);

      await selectSession(page, sessionId, 'workflow host');
      const hostTitle = (await page.getByTestId('chat-session-title').textContent())?.trim() ?? 'workflow host';
      await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(1, { timeout: 30_000 });

      await sendMessageFromComposer(page, 'Repeat the previous conclusion in one short sentence.');

      await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(2, { timeout: 30_000 });
      const secondBubble = page.getByTestId('agent-turn-bubble').nth(1);
      await expect(secondBubble.locator('[data-testid="architecture-run-timeline"]')).toBeVisible({ timeout: 30_000 });
      await expect(firstBubble.locator('[data-testid="architecture-final-answer"]')).toContainText(
        firstBubbleFinalAnswer.slice(0, Math.min(firstBubbleFinalAnswer.length, 48)),
      );

      await page.reload({ waitUntil: 'domcontentloaded' });
      await selectSession(page, sessionId, hostTitle);
      await expect(page.getByTestId('chat-session-title')).not.toHaveText('', { timeout: 30_000 });
      await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(2, { timeout: 60_000 });
      const rehydratedFirstAnswer = normalizeFinalAnswerText(
        await page.getByTestId('agent-turn-bubble').first().locator('[data-testid="architecture-final-answer"]').textContent(),
      );
      expect(rehydratedFirstAnswer).toContain(firstBubbleFinalAnswer.slice(0, Math.min(firstBubbleFinalAnswer.length, 48)));
    } finally {
      if (hostSessionId) {
        await deleteSessionIfExists(request, hostSessionId);
      }
    }
  });
});

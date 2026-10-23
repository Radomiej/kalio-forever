import { test, expect } from '@playwright/test';
import { deleteSessionIfExists, selectSession, sendMessageFromComposer } from './helpers/test-config';
import { createExistingMockConversation } from './helpers/existing-mock-conversation';

test('chat controls remain reachable on narrow phones and desktop', async ({ page, request }) => {
  const title = `Responsive chat ${Date.now()}`;
  const session = await createExistingMockConversation(request, title);
  try {
    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, session.id, title);
    await sendMessageFromComposer(page, 'Mobile layout regression');
    await expect(page.getByTestId('agent-turn-bubble').first()).toBeVisible();
    await expect(page.getByTestId('chat-stop-btn')).toBeHidden();

    for (const width of [390, 320, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByTestId('chat-input').fill('Polski: zażółć gęślą jaźń');
      const controls = [
        page.getByTestId('chat-input'),
        page.getByTestId('chat-send-btn'),
        page.getByTestId('chat-architecture-select'),
        page.getByTestId('talk-conversation-switcher'),
        page.getByTestId('talk-graph-switcher'),
        page.getByRole('button', { name: 'Copy chat to clipboard' }),
        page.getByTestId('chat-runtime-label'),
      ];
      for (const control of controls) {
        await expect(control).toBeInViewport({ ratio: 1 });
      }
      const header = page.getByTestId('chat-session-header');
      expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('chat-send-btn').click();
    await expect(page.getByTestId('agent-turn-bubble').filter({ hasText: 'Polski: zażółć gęślą jaźń' })).toBeVisible();
  } finally {
    await deleteSessionIfExists(request, session.id);
  }
});

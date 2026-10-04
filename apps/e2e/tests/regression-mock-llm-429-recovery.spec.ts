import { test, expect } from '@playwright/test';
import {
  deleteSessionIfExists,
  expectComposerEnabled,
  selectSession,
  sendMessageFromComposer,
} from './helpers/test-config';
import { createExistingMockConversation } from './helpers/existing-mock-conversation';

function uniqueSessionTitle(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

test.describe('REGRESSION: mock LLM 429 recovery', () => {
  test('UI recovers cleanly after a deterministic mock-provider 429 error', async ({ page, request }) => {
    const title = uniqueSessionTitle('Mock 429 Recovery');
    const session = await createExistingMockConversation(request, title);

    try {
      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);

      await expectComposerEnabled(page, 5000);
      await sendMessageFromComposer(page, 'Please fail with a deterministic mock provider 429 [[mock:error:429]]');

      await expect(page.getByTestId('chat-error')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('chat-error')).toContainText(/429|Too Many Requests|quota exhausted/i);
      await expectComposerEnabled(page, 10_000);
      await expect(page.getByTestId('active-tab-pending-dot')).toHaveCount(0);

      await page.getByTestId('talk-tab-agents').click();
      await expect(page.getByText('No active agent runs.')).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteSessionIfExists(request, session.id);
    }
  });
});

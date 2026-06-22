import { expect, test } from '@playwright/test';
import { API_BASE, deleteSessionIfExists, selectSession } from './helpers/test-config';

test.describe('chat reconnect hydration on built QA', () => {
  test('reconnect clears a stale pending confirmation without reloading the page', async ({ page, request }) => {
    const suffix = Date.now();
    const title = `Reconnect Hydration ${suffix}`;
    const requestId = `req-reconnect-${suffix}`;
    const toolCallId = `call-reconnect-${suffix}`;

    const sessionResponse = await request.post(`${API_BASE}/sessions`, {
      data: {
        personaId: 'default',
        title,
      },
    });
    expect(sessionResponse.ok()).toBeTruthy();
    const session = await sessionResponse.json() as { id: string };

    try {
      const seedResponse = await request.post(`${API_BASE}/test-support/tool-confirmations/seed-replay`, {
        data: {
          sessionId: session.id,
          requestId,
          toolCallId,
          toolName: 'image_generate',
          args: {
            prompt: 'Generate a reconnect proof poster',
          },
          promptMessage: 'Please generate a reconnect proof poster.',
          assistantMessage: 'I need confirmation before running image generation.',
        },
      });
      expect(seedResponse.ok()).toBeTruthy();

      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);

      const confirmButton = page.getByTestId('confirmation-confirm-btn');
      await expect(confirmButton).toBeVisible({ timeout: 10_000 });

      await page.context().setOffline(true);

      await expect
        .poll(async () => {
          const banner = page.getByTestId('chat-connection-status');
          if (await banner.count()) {
            return (await banner.first().textContent())?.trim() ?? '';
          }
          const recovery = page.getByTestId('chat-recovery-notice');
          if (await recovery.count()) {
            return (await recovery.first().textContent())?.trim() ?? '';
          }
          return '';
        }, {
          timeout: 20_000,
          message: 'Expected a visible reconnect or offline indicator after forcing the browser offline.',
        })
        .toMatch(/Connecting to backend|Reconnecting\. Current session will be resynced\.|Backend connection is offline|Connection dropped\. Reconnecting and preserving this session\./);

      const dropResponse = await request.post(`${API_BASE}/test-support/tool-confirmations/drop`, {
        data: {
          requestId,
          sessionId: session.id,
        },
      });
      expect(dropResponse.ok()).toBeTruthy();

      await page.context().setOffline(false);

      await expect
        .poll(async () => page.getByTestId('chat-connection-status').count(), {
          timeout: 20_000,
          message: 'Expected reconnect banner to disappear after the socket recovered.',
        })
        .toBe(0);

      await expect(confirmButton).toHaveCount(0, { timeout: 20_000 });
      await expect(page.getByTestId('message-list')).toBeVisible();
      await expect(page.getByText('I need confirmation before running image generation.')).toBeVisible();
    } finally {
      await page.context().setOffline(false).catch(() => undefined);
      await deleteSessionIfExists(request, session.id);
    }
  });
});

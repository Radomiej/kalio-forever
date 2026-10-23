import { test, expect, type Page } from '@playwright/test';
import { io } from 'socket.io-client';
import {
  API_BASE,
  deleteSessionIfExists,
  expectComposerEnabled,
  getComposerSendButton,
  selectSession,
} from './helpers/test-config';

const STOPPABLE_STREAM_PROMPT = [
  'Start a controlled stoppable mock stream.',
  '[[mock:script]]',
  'hold(8000) return("controlled stop stream finished")',
  '[[/mock:script]]',
].join('\n');

async function clickStopButton(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const stopBtn = page.getByTestId('chat-stop-btn');
      if (!await stopBtn.isVisible().catch(() => false)) {
        return 'missing';
      }
      try {
        await stopBtn.click({ force: true, timeout: 1_000 });
        return 'clicked';
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/detached|not attached|Timeout .*chat-stop-btn|waiting for getByTestId\('chat-stop-btn'\)/i.test(message)) {
          return 'retry';
        }
        throw error;
      }
    }, { timeout: 10_000 })
    .toBe('clicked');
}

test.describe('REGRESSION: stop and follow-up runtime flow', () => {
  test('stop drains the active turn so a follow-up starts fresh instead of queueing', async ({ page, request }) => {
    test.setTimeout(60_000);

    if (!process.env['DATABASE_PATH']?.replaceAll('\\', '/').includes('playwright-stack/')) {
      throw new Error('Stop fixture requires the isolated Playwright database');
    }

    const title = `Stop follow-up ${Date.now()}`;

    // Stop/follow-up tests an existing conversation, not the live-provider wizard.
    // Seed an explicit test-only profile; never make mock a production UI choice.
    const profileResponse = await request.post(`${API_BASE}/runtime/profiles`, {
      data: { name: `Stop mock fixture ${title}`, kind: 'direct-llm', provider: 'mock', model: 'mock' },
    });
    expect(profileResponse.ok()).toBeTruthy();
    const profile = await profileResponse.json() as { id: string };
    const res = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId: 'default', executionProfileId: profile.id },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json() as { id: string };

    try {
    const socket = io(API_BASE.replace(/\/api$/, ''), {
      transports: ['websocket'], query: { sessionId: session.id }, autoConnect: false,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Stop mock fixture did not complete')), 10_000);
        const finish = (error?: Error) => {
          clearTimeout(timer);
          if (error) reject(error); else resolve();
        };
        socket.once('connect_error', finish);
        socket.once('chat:error', (error: { message?: string }) => finish(new Error(error.message ?? 'Fixture failed')));
        socket.once('chat:complete', () => finish());
        socket.once('connect', () => socket.emit('chat:send', {
          sessionId: session.id, personaId: 'default', executionProfileId: profile.id,
          content: 'Initialize the explicit mock-only Stop fixture.',
        }));
        socket.connect();
      });
    } finally { socket.disconnect(); }

    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, session.id, title);
    const userMessages = page.locator('[data-testid="message-bubble"][data-role="user"]');
    const baselineUsers = await userMessages.count();

    const chatInput = await expectComposerEnabled(page, 5_000);
    const sendBtn = await getComposerSendButton(page);

    await chatInput.fill(STOPPABLE_STREAM_PROMPT);
    await sendBtn.click();

    const stopBtn = page.getByTestId('chat-stop-btn');
    await expect(stopBtn).toBeVisible({ timeout: 5_000 });
    await clickStopButton(page);
    await expect(stopBtn).toBeHidden({ timeout: 10_000 });

    const followUpInput = await expectComposerEnabled(page, 5_000);
    const followUpSendBtn = await getComposerSendButton(page);

    await followUpInput.fill(`${STOPPABLE_STREAM_PROMPT}\nafter stop`);
    await followUpSendBtn.click();

    await expect(stopBtn).toBeVisible({ timeout: 5_000 });
    await expect(userMessages).toHaveCount(baselineUsers + 2, { timeout: 10_000 });
    await expect(page.getByTestId('chat-queued-badge')).toHaveCount(0);

    } finally {
      await deleteSessionIfExists(request, session.id);
    }
  });
});

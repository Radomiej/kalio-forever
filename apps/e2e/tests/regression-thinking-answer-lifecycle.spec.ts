import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { io } from 'socket.io-client';
import { API_BASE, deleteSessionIfExists, selectSession, sendMessageFromComposer } from './helpers/test-config';

test('thinking stops when the same turn starts answering and stays stopped after F5', async ({ page, request }) => {
  test.setTimeout(60_000);
  if (!process.env['DATABASE_PATH']?.replaceAll('\\', '/').includes('playwright-stack/')) {
    throw new Error('Thinking fixture requires the isolated Playwright database');
  }
  const stamp = Date.now();
  const reportRun = process.env['KALIO_THINKING_REPORT_RUN'] ?? '251';
  if (!/^[1-9]\d*$/.test(reportRun)) throw new Error('Numeric report run required');
  const heading = `THINKING_TRANSITION_${stamp}`;
  const profileResponse = await request.post(`${API_BASE}/runtime/profiles`, {
    data: { name: `Thinking fixture ${stamp}`, kind: 'direct-llm', provider: 'mock', model: 'mock' },
  });
  expect(profileResponse.ok()).toBe(true);
  const profile = await profileResponse.json() as { id: string };
  const response = await request.post(`${API_BASE}/sessions`, {
    data: { title: heading, personaId: 'default', executionProfileId: profile.id },
  });
  expect(response.ok()).toBe(true);
  const session = await response.json() as { id: string };
  try {
    const socket = io(API_BASE.replace(/\/api$/, ''), {
      transports: ['websocket'], query: { sessionId: session.id }, autoConnect: false,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Thinking fixture initialization timed out')), 10_000);
        const finish = (error?: Error) => {
          clearTimeout(timer);
          if (error) reject(error); else resolve();
        };
        socket.once('connect_error', finish);
        socket.once('chat:error', (error: { message?: string }) => finish(new Error(error.message ?? 'Fixture failed')));
        socket.once('chat:complete', () => finish());
        socket.once('connect', () => socket.emit('chat:send', {
          sessionId: session.id, personaId: 'default', executionProfileId: profile.id,
          content: '[[mock:script]] return("Initialized fixture") [[/mock:script]]',
        }));
        socket.connect();
      });
    } finally { socket.disconnect(); }
    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, session.id, heading);
    // Diagnostic holds make phases observable; they are not runtime stabilization.
    await sendMessageFromComposer(page, `[[mock:script]] think("Controlled reasoning"); hold(6000); return("## ${heading}\nAnswer started"); hold(6000); return("\nAnswer finished") [[/mock:script]]`);
    const thinking = page.getByRole('button', { name: 'Thinking', exact: true });
    await expect(thinking).toHaveCount(1);
    await expect(thinking.locator('.loading')).toHaveCount(1);
    await expect(page.getByTestId('pending-agent-bubble')).toHaveCount(0);
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/active-thinking.png`) });

    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(thinking).toHaveCount(1);
    await expect(thinking.locator('.loading, .animate-pulse')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toBeVisible();
    await expect(page.getByTestId('pending-agent-bubble')).toHaveCount(0);
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/answer-streaming.png`) });

    const bubble = page.getByTestId('agent-turn-bubble').filter({
      has: page.getByRole('heading', { name: heading, exact: true }),
    });
    await expect(bubble).toContainText('Answer finished', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
    await expect.poll(async () => (await request.get(`${API_BASE}/sessions/${session.id}/runs/current`)).text()).toBe('');
    await page.reload();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(thinking).toHaveCount(1);
    await expect(thinking.locator('.loading, .animate-pulse')).toHaveCount(0);
    await expect(page.getByTestId('pending-agent-bubble')).toHaveCount(0);
    await expect(page.getByTestId('chat-connection-status')).toHaveCount(0);
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/final-after-f5.png`) });
  } finally {
    await deleteSessionIfExists(request, session.id);
  }
});

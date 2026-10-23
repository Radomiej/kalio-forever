import { test, expect, type Page } from '@playwright/test';
import {
  deleteSessionIfExists,
  API_BASE,
  expectComposerEnabled,
  selectArchitectureInComposer,
} from './helpers/test-config';
import { createLocalTitleProvider } from './helpers/local-title-provider';

const STOPPABLE_WORKFLOW_PROMPT = [
  'Evaluate the project architecture and keep the workflow running long enough for a stop request.',
].join('\n');

async function clickStopButton(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const stopBtn = page.getByTestId('chat-stop-btn');
      if (!await stopBtn.isVisible().catch(() => false)) {
        return 'missing';
      }
      try {
        await stopBtn.click({ timeout: 1_000 });
        return 'clicked';
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/detached|not attached|Timeout .*chat-stop-btn|waiting for getByTestId\('chat-stop-btn'\)/i.test(message)) {
          return 'retry';
        }
        throw error;
      }
    }, { timeout: 20_000 })
    .toBe('clicked');
}

test.describe('workflow stop on built QA', () => {
  for (const transport of ['socket', 'delete'] as const) {
  test(`workflow ${transport} drains active role requests after a workflow launch`, async ({ page, request }) => {
    test.setTimeout(60_000);

    let createdSessionId: string | null = null;
    const provider = await createLocalTitleProvider(request, 8000);
    const stopFrames: string[] = [];
    page.on('websocket', socket => socket.on('framesent', frame => {
      const payload = String(frame.payload);
      if (payload.includes('"chat:stop"')) stopFrames.push(payload);
    }));

    try {
      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await page.getByTestId('new-session-btn').click();
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 });

      await selectArchitectureInComposer(page, 'strategic-decision-council');
      await page.getByRole('combobox', { name: 'Provider and model', exact: true }).fill(provider.model);
      await page.getByRole('option').filter({ hasText: provider.model }).click();
      await page.getByTestId('welcome-prompt-input').fill(STOPPABLE_WORKFLOW_PROMPT);
      const launched = page.waitForResponse(response =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/architecture-runs/async');
      await page.getByTestId('welcome-run-prompt').click();
      const launchResponse = await launched;
      expect(launchResponse.ok()).toBeTruthy();
      const workflow = await launchResponse.json() as { id: string; status: string; rootSessionId?: string; context?: unknown };
      console.log(JSON.stringify({ workflow }));

      createdSessionId = await page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id'));

      await expect(page.getByTestId('architecture-run-timeline')).toBeVisible({ timeout: 20_000 });
      const stopBtn = page.getByTestId('chat-stop-btn');
      await expect(stopBtn).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => provider.pendingStreams).toBeGreaterThan(0);

      if (transport === 'delete') {
        expect(createdSessionId).not.toBeNull();
        const deletedId = createdSessionId;
        const response = await request.delete(`${API_BASE}/sessions/${deletedId}`, { timeout: 5000 });
        expect(response.ok()).toBeTruthy();
        await expect.poll(() => provider.pendingStreams, { timeout: 2000 }).toBe(0);
        expect((await request.get(`${API_BASE}/sessions/${deletedId}`)).status()).toBe(404);
        createdSessionId = null;
        await page.reload();
        await expect(page.getByTestId('chat-stop-btn')).toBeHidden();
        await expect(page.getByTestId('pending-agent-bubble')).toHaveCount(0);
        await page.screenshot({ path: test.info().outputPath('deleted-workflow-after-reload.png'), fullPage: true });
        return;
      }

      await clickStopButton(page);
      expect(stopFrames).toHaveLength(1);
      console.log(JSON.stringify({ createdSessionId, stopFrames }));

      await expect(stopBtn).toBeHidden({ timeout: 20_000 });
      await expectComposerEnabled(page, 20_000);
      await expect(page.getByTestId('chat-queued-badge')).toHaveCount(0);
      await expect(page.getByTestId('pending-agent-bubble')).toHaveCount(0);
      const stoppedRunResponse = await request.get(`${API_BASE}/architecture-runs/${workflow.id}`);
      expect(stoppedRunResponse.ok()).toBeTruthy();
      const stoppedRun = await stoppedRunResponse.json() as { status: string; reasonCode?: string };
      console.log(JSON.stringify({ stoppedRun }));
      expect(stoppedRun.status).toBe('cancelled');
      expect(stoppedRun.reasonCode).toBe('user_stop');
      await expect.poll(() => provider.pendingStreams, { timeout: 20_000 }).toBe(0);
      await page.reload();
      await expectComposerEnabled(page, 20_000);
      await expect(page.getByTestId('chat-stop-btn')).toBeHidden();
      await expect(page.getByTestId('chat-queued-badge')).toHaveCount(0);
      await expect(page.getByTestId('pending-agent-bubble')).toHaveCount(0);
      expect(provider.pendingStreams).toBe(0);
      await page.screenshot({ path: test.info().outputPath('stopped-workflow-after-reload.png'), fullPage: true });
    } finally {
      try {
        if (createdSessionId) await deleteSessionIfExists(request, createdSessionId);
      } finally {
        await provider.close();
      }
    }
  });
  }
});

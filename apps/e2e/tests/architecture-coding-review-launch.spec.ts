import { expect, test } from '@playwright/test';
import { activeSessionAfterSubmit, installMockLaunchProfile, selectMockLaunchProfile } from './helpers/mock-launch-profile';
import { API_BASE, deleteSessionIfExists, selectArchitectureInComposer, selectSession, sendMessageFromComposer } from './helpers/test-config';

const answerText = (text: string) => text.replace(/^final answer\s*/i, '').replace(/\s+/g, ' ').trim();

test('Coding Review restores both completed tool-backed runs after a follow-up and reload', async ({ page, request, browser }) => {
  test.setTimeout(120_000);
  let sessionId: string | null = null;
  await installMockLaunchProfile(page, request);
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('nav-talk').click();
    await page.getByTestId('new-session-btn').click();
    await expect(page.getByTestId('welcome-screen')).toBeVisible();
    await selectMockLaunchProfile(page);
    await selectArchitectureInComposer(page, 'coding_review');
    await sendMessageFromComposer(page, '[[mock:architecture:evidence]] Review a static React light and dark theme. Exercise isolated VFS evidence only; do not edit host files.');
    sessionId = await activeSessionAfterSubmit(page);
    const bubble = page.getByTestId('agent-turn-bubble').first();
    await expect(bubble.getByTestId('architecture-run-timeline')).toBeVisible({ timeout: 60_000 });
    await expect(bubble.getByTestId('architecture-run-timeline')).toHaveAttribute('data-status', /^(completed|failed|cancelled)$/, { timeout: 60_000 });
    await expect(bubble.getByTestId('architecture-run-timeline')).toHaveAttribute('data-status', 'completed');
    await expect(bubble.getByTestId('architecture-final-answer')).not.toBeEmpty();
    const answer = answerText(await bubble.getByTestId('architecture-final-answer').innerText());
    await sendMessageFromComposer(page, '[[mock:architecture:evidence]] Apply one scoped QA correction using isolated VFS evidence only. Keep the same workflow.');
    await expect(page.getByTestId('architecture-run-timeline')).toHaveCount(2, { timeout: 60_000 });
    const second = page.getByTestId('architecture-run-timeline').nth(1);
    await expect(second).toHaveAttribute('data-status', 'completed', { timeout: 60_000 });
    const secondAnswer = answerText(await page.getByTestId('architecture-final-answer').nth(1).innerText());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await selectSession(page, sessionId, 'Coding Review host');
    await expect(page.getByTestId('architecture-run-timeline')).toHaveCount(2, { timeout: 15_000 });
    await expect.poll(async () => answerText(await page.getByTestId('architecture-final-answer').first().innerText())).toBe(answer);
    await expect.poll(async () => answerText(await page.getByTestId('architecture-final-answer').nth(1).innerText())).toBe(secondAnswer);
    await expect(page.getByTestId('message-list')).not.toContainText('result unavailable');
    const coldContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const coldPage = await coldContext.newPage();
      await coldPage.goto('/');
      await coldPage.getByTestId('nav-talk').click();
      await selectSession(coldPage, sessionId, 'Coding Review host');
      await expect(coldPage.getByTestId('architecture-run-timeline')).toHaveCount(2, { timeout: 15_000 });
      await expect.poll(async () => answerText(await coldPage.getByTestId('architecture-final-answer').first().innerText())).toBe(answer);
      await expect.poll(async () => answerText(await coldPage.getByTestId('architecture-final-answer').nth(1).innerText())).toBe(secondAnswer);
      await expect(coldPage.getByTestId('message-list')).not.toContainText('result unavailable');
    } finally {
      await coldContext.close();
    }
  } catch (error) {
    if (sessionId) {
      const children = await request.get(`${API_BASE}/sessions/${sessionId}/children`);
      await test.info().attach('mock-architecture-children', { body: await children.body(), contentType: 'application/json' });
      const childRows = await children.json() as { id: string; runtimeContext?: { architectureContext?: { architectureRunId?: string } } }[];
      for (const child of childRows.slice(0, 10)) {
        const audit = await request.get(`${API_BASE}/audit-log?sessionId=${encodeURIComponent(child.id)}&type=error,architecture_event&limit=50`);
        await test.info().attach(`mock-audit-${child.id}`, { body: await audit.body(), contentType: 'application/json' });
        const runId = child.runtimeContext?.architectureContext?.architectureRunId;
        if (runId) {
          const events = await request.get(`${API_BASE}/architecture-runs/${encodeURIComponent(runId)}/events`);
          await test.info().attach('mock-architecture-events', { body: await events.body(), contentType: 'application/json' });
        }
      }
    }
    throw error;
  } finally {
    if (sessionId) await deleteSessionIfExists(request, sessionId);
  }
});

import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { selectSession } from './helpers/test-config';

const authorized = process.env['KALIO_DEVIN_MARKDOWN_QA88'] === '1';
test.skip(!authorized, 'Opt-in real SWE-2 read-only canary against the approved HomeSite session.');

test('real Devin final Markdown remains a heading after tools and F5', async ({ page }) => {
  test.setTimeout(180000);
  const api = 'http://127.0.0.1:3316/api';
  const sessionId = 'W4fggLSunrJB41C24MV7C';
  const screenshot = (name: string) => resolve(__dirname, `../../../docs/raports/qa-run-88/assets/${name}.png`);
  const sessionResponse = await page.request.get(`${api}/sessions/${sessionId}`);
  expect(sessionResponse.ok()).toBe(true);
  const session = await sessionResponse.json();
  expect(session.executionProfileId).toBe('devin-local-441b1fa56f117064487b71b4eb1cf33e');

  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, sessionId, 'New Chat');
  await expect(page.getByText('Devin CLI · swe-2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  console.log((await page.locator('body').ariaSnapshot()).slice(-8000));
  await page.screenshot({ path: screenshot('before-read-only-turn') });
  await page.getByRole('textbox', { name: 'Chat message', exact: true }).fill(
    'QA88 test formatowania. Model dokładnie swe-2. Przed narzędziem napisz krótki akapit QA88_PRE_TOOL. ' +
    'Następnie wykonaj dokładnie jeden Kalio fs_read z path E:/Projekty/home-site/package.json. ' +
    'Bez native tools, poleceń, zmian plików, builda, commitów i deployu. ' +
    'Po wyniku narzędzia napisz końcową odpowiedź Markdown z nagłówkiem drugiego poziomu ## QA88_RESULT ' +
    'oraz nazwą projektu odczytaną z package.json. Zakończ tę turę.'
  );
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  // Wait for the result, not absence of Stop before the turn has actually started.
  await expect(page.getByRole('heading', { name: 'QA88_RESULT', exact: true })).toBeVisible({ timeout: 90000 });
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0, { timeout: 90000 });
  await expect(page.getByText('Kalio is responding.', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: screenshot('completed-before-f5') });

  const historyResponse = await page.request.get(`${api}/sessions/${sessionId}/messages`);
  expect(historyResponse.ok()).toBe(true);
  const messages = await historyResponse.json() as Array<{ role: string; content: string }>;
  const final = messages.filter((message) => message.role === 'assistant' && message.content.includes('QA88_RESULT')).at(-1);
  expect(final?.content).toMatch(/QA88_PRE_TOOL[\s\S]*\n\n## QA88_RESULT/);
  expect(final?.content).toContain('nexora-home-site');

  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'QA88_RESULT', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
    await expect(page.getByText('Kalio is responding.', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: screenshot(`hydrated-${width}`) });
  }
});

test('existing real Devin conversation exposes its execution graph after reload', async ({ page }) => {
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, 'W4fggLSunrJB41C24MV7C', 'New Chat');
  console.log((await page.locator('body').ariaSnapshot()).slice(0, 4500));
  await page.getByRole('button', { name: 'Graf', exact: true }).click();
  await expect(page.getByTestId('execution-graph-view')).toBeVisible();
  console.log((await page.getByTestId('execution-graph-view').ariaSnapshot()).slice(-5500));
  await page.screenshot({ path: resolve(__dirname, '../../../docs/raports/qa-run-88/assets/real-execution-graph.png') });
});

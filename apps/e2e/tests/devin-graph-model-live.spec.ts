import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { selectSession } from './helpers/test-config';

test.skip(process.env['KALIO_DEVIN_GRAPH_QA89'] !== '1', 'Read-only opt-in inspection of the approved real Devin QA session.');
test('real Devin graph shows recorded SWE-2 model after F5', async ({ page }) => {
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, 'W4fggLSunrJB41C24MV7C', 'New Chat');
  console.log((await page.locator('body').ariaSnapshot()).slice(0, 3500));
  await page.getByRole('button', { name: 'Graf', exact: true }).click();
  const graph = page.getByTestId('execution-graph-view');
  await expect(graph).toBeVisible();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await expect(graph.getByText('Devin SWE-2 QA - swe-2', { exact: true }).first()).toBeVisible();
    await expect(graph.getByText('Devin SWE-2 QA - swe-2-medium', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-89/assets/recorded-model-${width}.png`) });
  }
});

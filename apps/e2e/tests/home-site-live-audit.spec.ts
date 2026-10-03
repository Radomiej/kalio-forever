import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const preview = process.env['KALIO_HOME_SITE_PREVIEW_URL'];
const reportRun = process.env['KALIO_HOME_SITE_REPORT_RUN'] ?? '61';
if (!/^\d+$/.test(reportRun)) throw new Error('Report run must be a numeric QA run');
test.skip(!preview, 'Requires an explicitly approved Home Site preview started through Kalio HITL.');

test('actual Home Site preview supports responsive keyboard and demo-form flows', async ({ page }) => {
  const url = new URL(preview!);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Only the approved local preview is allowed');
  await page.goto(url.href);
  await expect(page).toHaveTitle('NEXORA — Nowoczesne rozwiązania IT');
  await expect(page.locator('script[src*="index-DsbKbAs0.js"]')).toHaveCount(1);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 768) await expect(page.locator('#menu-glowne')).not.toBeInViewport();
    expect(await page.evaluate(() => innerWidth)).toBe(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/home-site-${width}.png`), fullPage: true, animations: 'disabled' });
    await page.screenshot({ path: resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/home-site-hero-${width}.png`), animations: 'disabled' });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole('button', { name: 'Otwórz menu', exact: true });
  await menu.click();
  await expect(page.getByRole('button', { name: 'Zamknij menu', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#menu-glowne').getByRole('link', { name: 'Usługi', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#menu-glowne').getByRole('link', { name: 'Bezpłatna wycena', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();

  await menu.click();
  await page.getByRole('button', { name: 'Zamknij menu', exact: true }).click();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  await page.locator('#menu-glowne').getByRole('link', { name: 'Usługi', exact: true }).click();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page).toHaveURL(/#uslugi$/);

  await page.getByRole('button', { name: 'Wyślij wiadomość (demo)', exact: true }).click();
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(3);
  const name = page.getByRole('textbox', { name: 'Imię i nazwisko', exact: true });
  await expect(name).toBeFocused();
  await name.fill('QA Demo');
  await page.getByRole('textbox', { name: 'Adres e-mail', exact: true }).fill('qa@example.com');
  await page.getByRole('textbox', { name: 'Wiadomość', exact: true }).fill('Lokalny test demonstracyjnego formularza.');
  await page.getByRole('button', { name: 'Wyślij wiadomość (demo)', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Wypełnij ponownie', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Wypełnij ponownie', exact: true }).click();
  await expect(name).toHaveValue('');
  await expect(name).toBeFocused();
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
  await menu.click();
  const transition = await page.locator('#menu-glowne').evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(transition.split(',').every((duration) => parseFloat(duration) <= 0.01)).toBe(true);
  await page.keyboard.press('Escape');
});

test('actual Home Site keeps the hero long word intact at 320px', async ({ page }) => {
  const url = new URL(preview!);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Only the approved local preview is allowed');
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(url.href);
  const fragments = await page.getByRole('heading', { level: 1 }).evaluate((heading) => {
    const word = 'oprogramowanie';
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const offset = node.textContent?.indexOf(word) ?? -1;
      if (offset >= 0) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + word.length);
        return [...range.getClientRects()].filter((rect) => rect.width > 0).length;
      }
      node = walker.nextNode();
    }
    throw new Error('Expected hero word missing');
  });
  expect(fragments).toBe(1);
});

import { expect, test, type Page } from '@playwright/test';

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth)).toBe(true);
}

for (const width of [320, 390, 1440]) {
  test.describe(`${width}px Home and Settings dialogs`, () => {
    test.use({ viewport: { width, height: 960 } });

    test('Home keeps primary actions visible and puts the execution profile behind a keyboard accessible gear', async ({ page }, testInfo) => {
      await page.goto('/');
      await page.getByTestId('nav-home').click();
      const home = page.getByTestId('landing-page');
      const gear = home.getByRole('button', { name: 'Home app settings', exact: true });
      const profile = page.getByRole('combobox', { name: 'App execution profile', exact: true });
      const dialog = page.getByRole('dialog', { name: 'Home app settings', exact: true });
      const quickChat = home.getByTestId('quick-chat-widget');
      const firstApp = home.locator('[data-testid^="app-tile-"]').first();
      await expect(quickChat).toBeVisible();
      await expect(quickChat.getByRole('textbox', { name: 'Quick chat message', exact: true })).toBeVisible();
      await expect(firstApp).toBeVisible();
      await expect(profile).toHaveCount(0);
      await expect(gear).toHaveAttribute('aria-expanded', 'false');
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`home-${width}-closed.png`) });

      // The rail's last control precedes the Home gear in the real Tab order.
      await page.getByTestId('nav-settings').focus();
      await page.keyboard.press('Tab');
      await expect(gear).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeVisible();
      await expect(gear).toHaveAttribute('aria-expanded', 'true');
      const close = dialog.getByRole('button', { name: 'Close Home app settings', exact: true });
      await expect(close).toBeFocused();
      await expect(profile).toBeEnabled();
      const initialProfile = await profile.inputValue();
      await page.keyboard.press('Tab');
      await expect(profile).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(close).toBeFocused();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`home-${width}-settings-open.png`) });
      await page.keyboard.press('Space');
      await expect(dialog).toHaveCount(0);
      await expect(gear).toBeFocused();

      await page.keyboard.press('Space');
      await expect(dialog).toBeVisible();
      await expect(profile).toHaveValue(initialProfile);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(gear).toHaveAttribute('aria-expanded', 'false');
      await expect(gear).toBeFocused();
      await expect(quickChat).toBeVisible();
      await expect(firstApp).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    for (const dismissal of ['Escape', 'Close'] as const) {
      test(`App Settings ${dismissal} returns focus to its mounted navigation opener`, async ({ page }) => {
        await page.goto('/');
        const opener = page.getByTestId('nav-settings');
        await opener.click();
        const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
        const close = dialog.getByRole('button', { name: 'Close settings', exact: true });
        await expect(dialog).toBeVisible();
        await expect(opener).toBeAttached();
        await expect(close).toBeFocused();
        await expect(dialog.getByTestId('add-provider-btn')).toBeVisible();
        await page.keyboard.press('Shift+Tab');
        await expect(dialog.getByTestId('add-provider-btn')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(close).toBeFocused();
        await expectNoHorizontalOverflow(page);
        if (dismissal === 'Escape') await page.keyboard.press('Escape');
        else await close.click();
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeVisible();
        await expect(opener).toBeFocused();
        await expectNoHorizontalOverflow(page);
      });
    }
  });
}

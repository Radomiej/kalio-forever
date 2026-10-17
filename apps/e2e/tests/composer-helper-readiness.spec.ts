import { expect, test } from '@playwright/test';
import { sendMessageFromComposer } from './helpers/test-config';

for (const surface of ['welcome', 'chat'] as const) {
  test(`composer helper waits for the ${surface} surface to mount`, async ({ page }) => {
    await page.setContent('<main></main>');
    await page.evaluate((mode) => {
      setTimeout(() => {
        const inputId = mode === 'welcome' ? 'welcome-prompt-input' : 'chat-input';
        const buttonId = mode === 'welcome' ? 'welcome-run-prompt' : 'chat-send-btn';
        const main = document.querySelector('main')!;
        main.innerHTML = `<textarea data-testid="${inputId}"></textarea><button data-testid="${buttonId}">Send</button><output></output>`;
        main.querySelector('button')!.addEventListener('click', () => {
          main.querySelector('output')!.textContent = main.querySelector('textarea')!.value;
        });
      }, 100);
    }, surface);

    await sendMessageFromComposer(page, 'Send after mount');
    await expect(page.locator('output')).toHaveText('Send after mount');
  });
}

import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

test('image provider capabilities and native integration survive save and reload', async ({ page, request }, testInfo) => {
  const created = await request.post(`${API_BASE}/runtime/profiles`, { data: {
    name: `Image QA ${Date.now()}`, kind: 'codex-app-server', model: 'gpt-5.4', authProfileId: 'image-qa-fixture', enabled: true,
  } });
  expect(created.ok()).toBeTruthy();
  const profile = await created.json() as { id: string; name: string };
  await page.goto('/');
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-tab-image').click();
  await expect(page.getByRole('heading', { name: 'Image Generation' })).toBeVisible();
  expect(await page.getByTestId('settings-modal').innerText()).not.toMatch(/recommended/i);
  await page.getByRole('combobox', { name: 'Provider' }).selectOption('chatgpt');
  await page.getByRole('combobox', { name: 'ChatGPT / Codex integration' }).selectOption(profile.id);
  await expect(page.getByPlaceholder('Enter API key…')).toHaveCount(0);
  await expect(page.getByText(/Editing: supported/)).toBeVisible();
  await page.getByRole('button', { name: /^Save$/ }).click();
  await expect(page.getByText('Config saved')).toBeVisible();
  const cfg = await request.get(`${API_BASE}/image/config`);
  expect(await cfg.json()).toMatchObject({ provider: 'chatgpt', executionProfileId: profile.id });
  await page.screenshot({ path: testInfo.outputPath('image-native-desktop.png') });
  await page.reload();
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-tab-image').click();
  await expect(page.getByRole('combobox', { name: 'Provider' })).toHaveValue('chatgpt');
  await expect(page.getByRole('combobox', { name: 'ChatGPT / Codex integration' })).toHaveValue(profile.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('image-native-mobile.png') });
  await page.getByRole('combobox', { name: 'Provider' }).selectOption('replicate');
  await expect(page.getByText(/Editing: not supported/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Editing model' })).toHaveCount(0);
});

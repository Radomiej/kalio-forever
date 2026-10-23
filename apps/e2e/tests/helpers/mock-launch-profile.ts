import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { ExecutionProfile } from '@kalio/types';
import { API_BASE } from './test-config';

/** Test-only picker presentation; the persisted profile and execution stay mock. */
export async function installMockLaunchProfile(page: Page, request: APIRequestContext): Promise<ExecutionProfile> {
  if (!process.env['DATABASE_PATH']?.replaceAll('\\', '/').includes('playwright-stack/')) {
    throw new Error('Launch fixture requires isolated Playwright storage');
  }
  const response = await request.post(`${API_BASE}/runtime/profiles`, {
    data: { name: 'E2E launch fixture', kind: 'direct-llm', provider: 'mock', model: 'mock' },
  });
  expect(response.ok()).toBe(true);
  const profile = await response.json() as ExecutionProfile;
  // The application forbids PATCHing a normal chat into mock execution. Bind
  // only this isolated fixture at creation, keeping that production guard intact.
  await page.route('**/api/sessions', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    await route.continue({ postData: JSON.stringify({
      ...route.request().postDataJSON(), executionProfileId: profile.id,
    }) });
  });
  await page.route('**/api/runtime/profiles', async route => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    const upstream = await route.fetch();
    const profiles = await upstream.json() as ExecutionProfile[];
    await route.fulfill({ response: upstream, json: profiles.map(item => (
      item.id === profile.id ? { ...item, provider: 'openai' } : item
    )) });
  });
  return profile;
}

export async function selectMockLaunchProfile(page: Page): Promise<void> {
  await page.getByRole('combobox', { name: 'Provider and model', exact: true }).fill('openai · mock');
  await page.getByRole('option', { name: 'openai · mock', exact: true }).click();
}

export async function activeSessionAfterSubmit(page: Page): Promise<string> {
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('kalio:last-active-session-id'))).not.toBeNull();
  const id = await page.evaluate(() => sessionStorage.getItem('kalio:last-active-session-id'));
  if (!id) throw new Error('First submit did not activate a durable session');
  return id;
}

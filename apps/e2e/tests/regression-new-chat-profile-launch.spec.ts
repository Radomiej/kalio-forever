import { expect, test } from '@playwright/test';
import type { AuditLogEntry, ChatMessage, ChatSession, ExecutionProfile } from '@kalio/types';
import { API_BASE, APP_BASE, isMockLlm } from './helpers/test-config';

test('new chat launches a prebound mock fixture and hydrates its completed turn', async ({ page, request }) => {
  for (const url of [API_BASE, APP_BASE]) {
    expect(['3016', '5188', '3316', '5288']).not.toContain(new URL(url).port);
  }
  expect(await isMockLlm(request)).toBe(true);
  const response = await request.post(`${API_BASE}/runtime/profiles`, {
    data: { name: 'Launch gate fixture', kind: 'direct-llm', provider: 'mock', model: 'mock' },
  });
  expect(response.ok()).toBe(true);
  const profile = await response.json() as ExecutionProfile;
  // Backend deliberately forbids changing user chats to mock. Seed the new test
  // session at creation, as other mock fixtures do; never waive that PATCH guard.
  await page.route('**/api/sessions', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    await route.continue({ postData: JSON.stringify({ ...route.request().postDataJSON(), executionProfileId: profile.id }) });
  });
  // Mock is intentionally not a user-facing provider. Expose this one fixture only
  // in the picker; durable backend identity and execution remain real mock.
  await page.route('**/api/runtime/profiles', async route => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    const upstream = await route.fetch();
    const profiles = await upstream.json() as ExecutionProfile[];
    await route.fulfill({ response: upstream, json: profiles.map(item => item.id === profile.id ? { ...item, provider: 'openai' } : item) });
  });
  await page.goto('/');
  await page.getByTestId('nav-talk').click();
  await expect(page.getByTestId('welcome-screen')).toBeVisible();
  const model = page.getByRole('combobox', { name: 'Provider and model', exact: true });
  await model.fill('openai · mock');
  await page.getByRole('option', { name: /openai · mock Launch gate fixture/ }).click();
  await page.getByTestId('welcome-prompt-input').fill('Hello from the explicit launch gate.');
  const created = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/sessions');
  await page.getByTestId('welcome-run-prompt').click();
  const session = await (await created).json() as ChatSession;
  let messages: ChatMessage[] = [];
  await expect.poll(async () => {
    const result = await request.get(`${API_BASE}/sessions/${session.id}/messages`);
    expect(result.ok()).toBe(true);
    messages = await result.json() as ChatMessage[];
    return messages.some(message => message.role === 'assistant' && message.content.length > 0);
  }, { timeout: 30000 }).toBe(true);
  const saved = await request.get(`${API_BASE}/sessions/${session.id}`);
  expect(await saved.json()).toMatchObject({ executionProfileId: profile.id });
  const prompt = messages.find(message => message.role === 'user' && message.content === 'Hello from the explicit launch gate.');
  expect(prompt?.turnId).toBeTruthy();
  await expect.poll(async () => {
    const result = await request.get(`${API_BASE}/audit-log?sessionId=${session.id}&turnId=${prompt!.turnId}&source=all&limit=2000`);
    expect(result.ok()).toBe(true);
    const audit = await result.json() as AuditLogEntry[];
    return audit.filter(entry => entry.label === 'llm.turn.completed').length;
  }).toBe(1);
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  const answer = messages.find(message => message.role === 'assistant' && message.content.length > 0)!;
  await page.reload();
  await expect(page.getByTestId('message-list')).toContainText(answer.content);
  await expect(page.getByRole('button', { name: 'Stop agent', exact: true })).toHaveCount(0);
  await expect(page.getByText('Kalio is responding.', { exact: true })).toHaveCount(0);
});

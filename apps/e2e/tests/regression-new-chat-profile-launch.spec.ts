import { expect, test } from '@playwright/test';
import type { AuditLogEntry, ChatMessage, ChatSession } from '@kalio/types';
import { API_BASE, APP_BASE, isMockLlm } from './helpers/test-config';
import { installMockLaunchProfile, selectMockLaunchProfile } from './helpers/mock-launch-profile';

test('new chat launches a prebound mock fixture and hydrates its completed turn', async ({ page, request }) => {
  for (const url of [API_BASE, APP_BASE]) {
    expect(['3016', '5188', '3316', '5288']).not.toContain(new URL(url).port);
  }
  expect(await isMockLlm(request)).toBe(true);
  const profile = await installMockLaunchProfile(page, request);
  await page.goto('/');
  await page.getByTestId('nav-talk').click();
  await expect(page.getByTestId('welcome-screen')).toBeVisible();
  await selectMockLaunchProfile(page);
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

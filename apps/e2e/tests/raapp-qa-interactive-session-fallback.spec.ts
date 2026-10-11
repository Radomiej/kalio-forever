import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createExistingMockConversation } from './helpers/existing-mock-conversation';
import { API_BASE, APP_BASE, deleteSessionIfExists, isMockLlm, selectSession } from './helpers/test-config';

type StoredMessage = {
  role: string;
  content: string;
  toolCalls?: Array<{ name: string; args: { id?: string } }>;
};
type StoredSession = {
  id: string;
  executionProfileId: string;
  runtimeContext?: { architectureContext?: { raAppLaunchInputs?: string } };
};
const question = 'Which RA-App regression boundary should we verify?';
const options = ['Session fallback', 'Explicit profile'];
const answer = `I choose: ${options[0]}`;

async function messages(request: APIRequestContext, sessionId: string): Promise<StoredMessage[]> {
  const response = await request.get(`${API_BASE}/sessions/${sessionId}/messages`);
  expect(response.ok()).toBeTruthy();
  return await response.json() as StoredMessage[];
}

function invocationCount(history: StoredMessage[]): number {
  return history.flatMap((message) => message.toolCalls ?? [])
    .filter((call) => call.name === 'run_raapp' && call.args.id === 'qa-interactive').length;
}

async function idle(request: APIRequestContext, sessionId: string): Promise<void> {
  await expect.poll(async () => {
    const response = await request.get(`${API_BASE}/sessions/${sessionId}/runs/current`);
    expect(response.ok()).toBeTruthy();
    return response.text();
  }).toBe('');
}

async function launch(page: Page, inputs: string, executionProfileId = ''): Promise<StoredSession> {
  await page.getByTestId('nav-tools').click();
  await page.getByTestId('tools-tab-raapps').click();
  await page.getByRole('button', { name: /Catalog\s+\d+/ }).click();
  await page.getByRole('combobox', { name: 'App execution profile' }).selectOption(executionProfileId);
  await page.getByTestId('raapp-run-inputs').fill(inputs);
  const created = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/sessions');
  await page.getByTestId('raapp-catalog-run-qa-interactive').click();
  const response = await created;
  expect(response.ok()).toBeTruthy();
  const body = response.request().postDataJSON() as {
    executionProfileId: string;
    runtimeContext: { architectureContext: { raAppLaunchId: string } };
  };
  expect(body.runtimeContext.architectureContext.raAppLaunchId).toBe('qa-interactive');
  const session = await response.json() as StoredSession;
  expect(session.executionProfileId).toBe(body.executionProfileId);
  if (inputs) {
    const serialized = session.runtimeContext?.architectureContext?.raAppLaunchInputs;
    expect(serialized, 'Create-session response must preserve launch inputs, not only the LLM prompt').toBe(inputs);
  } else {
    expect(session.runtimeContext?.architectureContext?.raAppLaunchInputs).toBeUndefined();
  }
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('kalio:last-active-session-id')))
    .toBe(session.id);
  await expect(page.getByTestId('chat-interface')).toBeVisible();
  return session;
}

test.describe('shipped Interactive Q&A: real UI, transport and durable history', () => {
  test.setTimeout(60_000);
  let ownedSessions: string[];

  test.beforeEach(async ({ request }) => {
    ownedSessions = [];
    // Fail closed before any write: never run this fixture on manual DEV, fixed QA or HomeSite.
    expect(process.env['DATABASE_PATH']?.replaceAll('\\', '/')).toContain('playwright-stack/');
    for (const address of [APP_BASE, API_BASE]) {
      const url = new URL(address);
      expect(['127.0.0.1', 'localhost']).toContain(url.hostname);
      expect(url.port).not.toBe('');
      expect(['3016', '5188', '3316', '5288', '4016', '6188', '57868']).not.toContain(url.port);
    }
    expect(await isMockLlm(request), 'Only the env mock LLM is permitted').toBe(true);
  });

  test.afterEach(async ({ request }) => {
    for (const id of ownedSessions) await deleteSessionIfExists(request, id);
  });

  for (const mode of ['session fallback', 'explicit profile'] as const) {
    test(`${mode}: visible options answer the app conversation once and survive F5`, async ({ page, request }) => {
      const title = `RA-App ${mode} ${test.info().testId}`;
      const source = await createExistingMockConversation(request, title);
      ownedSessions.push(source.id);
      const sourceResponse = await request.get(`${API_BASE}/sessions/${source.id}`);
      expect(sourceResponse.ok()).toBeTruthy();
      const sourceSession = await sourceResponse.json() as StoredSession;
      let expectedProfile = sourceSession.executionProfileId;
      if (mode === 'explicit profile') {
        const response = await request.post(`${API_BASE}/runtime/profiles`, {
          data: { name: `RA-App selected ${test.info().testId}`, kind: 'direct-llm', provider: 'mock', model: 'mock' },
        });
        expect(response.ok()).toBeTruthy();
        expectedProfile = (await response.json() as { id: string }).id;
        expect(expectedProfile).not.toBe(sourceSession.executionProfileId);
      }
      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await selectSession(page, source.id, title);
      const appSession = await launch(page, JSON.stringify({ question, options }),
        mode === 'explicit profile' ? expectedProfile : '');
      ownedSessions.push(appSession.id);
      expect(appSession.executionProfileId).toBe(expectedProfile);
      const gui = page.getByTestId('gui-dsl-renderer');
      await expect(gui).toBeVisible();
      await expect(gui.getByText(question, { exact: true })).toBeVisible();
      for (const option of options) await expect(gui.getByRole('button', { name: option, exact: true })).toBeEnabled();
      await idle(request, appSession.id);
      const toolResults = (await messages(request, appSession.id))
        .filter((message) => message.role === 'tool_result')
        .map((message) => JSON.parse(message.content) as { status: string; mode?: string });
      expect(toolResults).toContainEqual(expect.objectContaining({ status: 'ready', mode: 'interactive' }));
      await page.screenshot({ path: test.info().outputPath('question-visible.png'), fullPage: true });
      await gui.getByRole('button', { name: options[0], exact: true }).click();
      await expect.poll(async () => (await messages(request, appSession.id))
        .filter((message) => message.role === 'user' && message.content === answer).length).toBe(1);
      const userAnswer = page.locator('[data-testid="message-bubble"][data-role="user"]')
        .filter({ hasText: answer });
      await expect(userAnswer).toBeVisible();
      await idle(request, appSession.id);
      expect(invocationCount(await messages(request, appSession.id))).toBe(1);
      expect((await messages(request, source.id)).some((message) => message.content === answer)).toBe(false);
      await page.reload();
      await expect.poll(() => page.evaluate(() => sessionStorage.getItem('kalio:last-active-session-id')))
        .toBe(appSession.id);
      await expect(page.getByText('Interactive app — answer submitted', { exact: true })).toBeVisible();
      await expect(userAnswer).toBeVisible();
      await expect(page.getByRole('button', { name: options[0], exact: true })).toHaveCount(0);
      await idle(request, appSession.id);
      const persisted = await request.get(`${API_BASE}/sessions/${appSession.id}`);
      expect(persisted.ok()).toBeTruthy();
      expect((await persisted.json() as StoredSession).executionProfileId).toBe(expectedProfile);
      const history = await messages(request, appSession.id);
      expect(history.filter((message) => message.role === 'user' && message.content === answer)).toHaveLength(1);
      expect(invocationCount(history)).toBe(1);
      await page.screenshot({ path: test.info().outputPath('answer-after-f5.png'), fullPage: true });
    });
  }

  test('missing inputs produce an explicit durable error, never a blank ready Q&A', async ({ page, request }) => {
    const title = `RA-App missing inputs ${test.info().testId}`;
    const source = await createExistingMockConversation(request, title);
    ownedSessions.push(source.id);
    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, source.id, title);
    const session = await launch(page, '');
    ownedSessions.push(session.id);
    const error = /Interactive Q&A requires a non-empty question/;
    await expect(page.getByText(error).first()).toBeVisible();
    await idle(request, session.id);
    await expect(page.getByTestId('gui-dsl-renderer')).toHaveCount(0);
    const results = (await messages(request, session.id)).filter((message) => message.role === 'tool_result')
      .map((message) => JSON.parse(message.content) as { status: string; message?: string });
    expect(results.some((result) => result.status === 'error' && error.test(result.message ?? ''))).toBe(true);
    expect(results.some((result) => result.status === 'ready')).toBe(false);
    await page.reload();
    await expect(page.getByText(error).first()).toBeVisible();
    await expect(page.getByTestId('gui-dsl-renderer')).toHaveCount(0);
    expect(invocationCount(await messages(request, session.id))).toBe(1);
    await page.screenshot({ path: test.info().outputPath('missing-input-after-f5.png'), fullPage: true });
  });
});

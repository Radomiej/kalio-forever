import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

const PROCESS_ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

function requireEnv(name: 'PLAYWRIGHT_BASE_URL' | 'TEST_API_URL'): string {
	const value = PROCESS_ENV?.[name];
	if (!value) {
		throw new Error(`${name} must be set by the Playwright config or E2E stack runner.`);
	}

	return value;
}

export const APP_BASE = requireEnv('PLAYWRIGHT_BASE_URL');
export const API_BASE = requireEnv('TEST_API_URL');

interface LLMConfigResponse {
	provider: string;
	source: 'db' | 'env';
}

export async function isMockLlm(request: APIRequestContext): Promise<boolean> {
	const response = await request.get(`${API_BASE}/llm/config`);
	if (!response.ok()) {
		throw new Error(`Failed to read LLM config: ${response.status()} ${response.statusText()}`);
	}

	const config = await response.json() as LLMConfigResponse;
	return config.source === 'env' && config.provider === 'mock';
}

export async function getActiveCredentialId(request: APIRequestContext): Promise<string | null> {
	const response = await request.get(`${API_BASE}/credentials/active`);
	if (!response.ok()) {
		throw new Error(`Failed to read active credential: ${response.status()} ${response.statusText()}`);
	}

	const payload = await response.json() as { credentialId?: string | null };
	return payload.credentialId ?? null;
}

export async function restoreActiveCredential(
	request: APIRequestContext,
	credentialId: string | null,
): Promise<void> {
	if (credentialId) {
		const response = await request.put(`${API_BASE}/credentials/active/${credentialId}`);
		expect(response.ok()).toBeTruthy();
		return;
	}

	const response = await request.delete(`${API_BASE}/credentials/active`);
	expect(response.ok()).toBeTruthy();
}

export async function ensureEnvMockProvider(request: APIRequestContext): Promise<void> {
	const response = await request.delete(`${API_BASE}/credentials/active`);
	expect(response.ok()).toBeTruthy();
	await expect.poll(async () => isMockLlm(request), {
		timeout: 10_000,
		message: 'Expected Playwright stack to fall back to env mock provider',
	}).toBe(true);
}

export async function selectSession(page: Page, sessionId: string, title: string): Promise<void> {
	await expect(page.getByTestId('session-panel')).toBeVisible({ timeout: 15_000 });

	for (let attempt = 0; attempt < 3; attempt += 1) {
		await expect
			.poll(
				async () => page.getByText('Connecting to backend...').count(),
				{ timeout: 15_000 },
			)
			.toBe(0);

		const sessionItem = page.locator(`[data-testid="session-item"][data-session-id="${sessionId}"]`);
		if (await sessionItem.isVisible().catch(() => false)) {
			await sessionItem.evaluate((node) => {
				if (!(node instanceof HTMLElement)) {
					throw new Error('Session item is not clickable');
				}

				node.click();
			});
			await expect
				.poll(
					() => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')),
					{ timeout: 5000 },
				)
				.toBe(sessionId);
			return;
		}

		await page.waitForTimeout(1_000);
		if (await sessionItem.isVisible().catch(() => false)) {
			continue;
		}

		if (attempt < 2) {
			await page.reload();
			const talkNav = page.getByTestId('nav-talk');
			if (await talkNav.isVisible().catch(() => false)) {
				await talkNav.click({ force: true });
			}
		}
	}

	throw new Error(`Session ${sessionId} (${title}) did not appear in the Talk sidebar.`);
}

export async function sendMessageFromComposer(page: Page, message: string): Promise<void> {
	const input = await expectComposerEnabled(page, 10_000);
	await input.fill(message);
	const sendButton = await getComposerSendButton(page);
	await sendButton.click();
}

export async function expectComposerEnabled(page: Page, timeoutMs = 10_000): Promise<Locator> {
	const welcomeInput = page.getByTestId('welcome-prompt-input');
	if (await welcomeInput.isVisible().catch(() => false)) {
		await expect(welcomeInput).toBeEnabled({ timeout: timeoutMs });
		return welcomeInput;
	}

	const chatInput = page.getByTestId('chat-input');
	await expect(chatInput).toBeEnabled({ timeout: timeoutMs });
	return chatInput;
}

export async function getComposerSendButton(page: Page): Promise<Locator> {
	const welcomeButton = page.getByTestId('welcome-run-prompt');
	if (await welcomeButton.isVisible().catch(() => false)) {
		return welcomeButton;
	}

	return page.getByTestId('chat-send-btn');
}

export async function selectArchitectureInComposer(page: Page, architectureId: string): Promise<void> {
	const welcomeSelect = page.getByTestId('welcome-architecture-select');
	if (await welcomeSelect.isVisible().catch(() => false)) {
		await welcomeSelect.selectOption(architectureId);
		return;
	}

	const workflowModeButton = page.getByTestId('welcome-mode-workflow');
	if (await workflowModeButton.isVisible().catch(() => false)) {
		await workflowModeButton.click();
		await expect(welcomeSelect).toBeVisible({ timeout: 5000 });
		await welcomeSelect.selectOption(architectureId);
		return;
	}

	await page.getByTestId('chat-architecture-select').selectOption(architectureId);
}

export async function selectSessionOriginFilter(
	page: Page,
	filterId: 'all' | 'user' | 'agent' | 'archived',
): Promise<void> {
	await page.getByTestId('session-origin-filter-trigger').click();
	await page.getByTestId(`session-origin-filter-${filterId}`).click();
}

export async function deleteSessionIfExists(request: APIRequestContext, sessionId: string): Promise<void> {
	await request.delete(`${API_BASE}/sessions/${sessionId}`, { timeout: 5000 }).catch(() => undefined);
}

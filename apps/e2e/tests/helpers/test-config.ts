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

type E2EProject = {
	id: string;
	path: string | null;
};

function comparableProjectPath(path: string): string {
	return path.trim().replace(/[\\/]+$/, '').replaceAll('\\', '/').toLocaleLowerCase();
}

export async function ensureProjectForPath(
	request: APIRequestContext,
	projectPath: string,
): Promise<E2EProject> {
	const projectsResponse = await request.get(`${API_BASE}/projects`);
	expect(projectsResponse.ok()).toBeTruthy();
	const projects = await projectsResponse.json() as E2EProject[];
	let project = projects.find((candidate) => (
		typeof candidate.path === 'string'
		&& comparableProjectPath(candidate.path) === comparableProjectPath(projectPath)
	));

	if (!project) {
		const createResponse = await request.post(`${API_BASE}/projects`, {
			data: { name: 'E2E Architecture Project', path: projectPath },
		});
		expect(createResponse.ok()).toBeTruthy();
		project = await createResponse.json() as E2EProject;
	}
	return project;
}

export async function selectProjectInWelcome(page: Page, projectPath: string): Promise<void> {
	await page.getByTestId('welcome-project-picker-trigger').click();
	const projectOption = page
		.getByTestId('welcome-project-picker')
		.getByRole('option')
		.filter({ hasText: projectPath.replaceAll('\\', '/') });
	await expect(projectOption).toHaveCount(1);
	await projectOption.click();
}

export function isRetryableApiTransportError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /ECONNRESET|ECONNREFUSED|socket hang up|ERR_CONNECTION_RESET|Timeout \d+ms exceeded/i.test(message);
}

async function delay(ms: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

export async function getJsonWithTransportRetry<T>(
	request: APIRequestContext,
	url: string,
): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			const response = await request.get(url, { timeout: 15_000 });
			expect(response.ok()).toBeTruthy();
			return await response.json() as T;
		} catch (error) {
			lastError = error;
			if (!isRetryableApiTransportError(error) || attempt === 2) {
				throw error;
			}
			await delay(250 * (attempt + 1));
		}
	}

	throw lastError;
}

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
		await expectChatTransportReady(page);
		for (let groupAttempt = 0; groupAttempt < 10; groupAttempt += 1) {
			const collapsedGroup = page.locator('[data-testid^="project-group-"][aria-expanded="false"]').first();
			if (!(await collapsedGroup.isVisible().catch(() => false))) {
				break;
			}
			await collapsedGroup.click();
		}

		const sessionItem = page.locator(`[data-testid="session-item"][data-session-id="${sessionId}"]`);
		if (await sessionItem.isVisible().catch(() => false)) {
			await sessionItem.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
			await sessionItem.click({ force: true, timeout: 5_000 }).catch(async () => {
				await expectChatTransportReady(page);
				await sessionItem.click({ force: true, timeout: 5_000 });
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

	const visibleSessionCount = await page.getByTestId('session-item').count().catch(() => 0);
	const transportMessages = await transportStatusMessages(page);
	throw new Error(
		`Session ${sessionId} (${title}) did not appear in the Talk sidebar. `
		+ `visibleSessions=${visibleSessionCount}; transport=${transportMessages || 'ready'}`,
	);
}

async function expectChatTransportReady(page: Page): Promise<void> {
	await expect
		.poll(
			async () => activeTransportStatusMessages(page),
			{
				timeout: 30_000,
				message: 'Expected chat transport to be connected before selecting a session',
			},
		)
		.toBe('');
}

async function activeTransportStatusMessages(page: Page): Promise<string> {
	const messages = await page
		.getByTestId('chat-connection-status')
		.allTextContents()
		.catch(() => []);
	return messages.map((message) => message.trim()).filter(Boolean).join(' | ');
}

async function transportStatusMessages(page: Page): Promise<string> {
	const activeMessages = await page
		.getByTestId('chat-connection-status')
		.allTextContents()
		.catch(() => []);
	const recoveryMessages = await page
		.getByTestId('chat-recovery-notice')
		.allTextContents()
		.catch(() => []);
	return [...activeMessages, ...recoveryMessages]
		.map((message) => message.trim())
		.filter(Boolean)
		.join(' | ');
}

export async function sendMessageFromComposer(page: Page, message: string): Promise<void> {
	const input = await expectComposerEnabled(page, 10_000);
	await input.fill(message);
	await expect(input).toHaveValue(message, { timeout: 10_000 });
	const sendButton = await getComposerSendButton(page);
	await expect(sendButton).toBeEnabled({ timeout: 10_000 });
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

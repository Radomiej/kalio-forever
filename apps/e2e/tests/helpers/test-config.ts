import { expect, type APIRequestContext, type Page } from '@playwright/test';

const PROCESS_ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

export const APP_BASE = PROCESS_ENV?.PLAYWRIGHT_BASE_URL || 'http://localhost:5288';
export const API_BASE = PROCESS_ENV?.TEST_API_URL || 'http://localhost:3316/api';

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

export async function selectSession(page: Page, sessionId: string, title: string): Promise<void> {
	const sessionItem = page.locator(`[data-testid="session-item"][data-session-id="${sessionId}"]`);
	await expect(sessionItem).toBeVisible({ timeout: 5000 });
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
}

export async function deleteSessionIfExists(request: APIRequestContext, sessionId: string): Promise<void> {
	await request.delete(`${API_BASE}/sessions/${sessionId}`, { timeout: 5000 }).catch(() => undefined);
}

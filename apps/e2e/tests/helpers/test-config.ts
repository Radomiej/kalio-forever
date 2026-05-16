import type { APIRequestContext } from '@playwright/test';

const PROCESS_ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

export const API_BASE = PROCESS_ENV?.TEST_API_URL || 'http://localhost:3016/api';

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

import { expect, type APIRequestContext } from '@playwright/test';
import { APP_BASE } from './test-config';

/** Real same-origin cookie bootstrap, including after an isolated backend restart. */
export async function hitlFixtureRequest(request: APIRequestContext, method: 'GET' | 'PUT', data?: unknown) {
  if (!process.env['DATABASE_PATH']?.replaceAll('\\', '/').includes('playwright-stack/')) {
    throw new Error('HITL fixture requires isolated Playwright storage');
  }
  const headers = { origin: new URL(APP_BASE).origin };
  const auth = await request.post(`${APP_BASE}/api/decision/auth`, { headers, data: {} });
  expect(auth.status(), 'Same-origin decision cookie bootstrap').toBe(204);
  const response = await request.fetch(`${APP_BASE}/api/hitl/config`, { method, headers, data });
  expect(response.ok(), `Authenticated HITL ${method} returned ${response.status()}`).toBe(true);
  return response;
}

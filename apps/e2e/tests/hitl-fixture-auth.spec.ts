import { expect, test } from '@playwright/test';
import { API_BASE } from './helpers/test-config';
import { hitlFixtureRequest } from './helpers/hitl-fixture-auth';

test('HITL fixture reports its unauthenticated boundary', async ({ request }) => {
  const response = await request.get(`${API_BASE}/hitl/config`);
  const body = await response.json() as { code?: string; message?: { code?: string } };
  console.log('HITL fixture diagnostic', { status: response.status(), code: body.code ?? body.message?.code });
  expect(response.status()).toBe(403);
  expect(body.code ?? body.message?.code).toBe('DECISION_ORIGIN_DENIED');
  const authorized = await hitlFixtureRequest(request, 'GET');
  const config = await authorized.json() as { mode: string };
  expect(['manual', 'auto', 'bypass']).toContain(config.mode);
  await hitlFixtureRequest(request, 'PUT', config);
});

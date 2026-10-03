import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const fixedQa = process.env['KALIO_FIXED_QA_READONLY_AUDIT_URL'];
test.skip(!fixedQa, 'Requires explicit fixed-QA coexistence audit.');

test('isolated preview and fixed QA serve independent runtime origins without shared artifact mutation', async ({ request }) => {
  const fixed = new URL(fixedQa!);
  if (fixed.href !== 'http://localhost:5288/') throw new Error('Only approved fixed local QA is supported');
  const isolated = new URL(process.env['PLAYWRIGHT_BASE_URL']!);
  const api = new URL(process.env['PLAYWRIGHT_API_ORIGIN']!);
  if (isolated.hostname !== '127.0.0.1' || api.hostname !== '127.0.0.1' || api.port === '3316') {
    throw new Error('Requires an isolated loopback test stack');
  }

  const isolatedResponse = await request.get(new URL('runtime-config.js', isolated).href);
  const fixedResponse = await request.get(new URL('runtime-config.js', fixed).href);
  expect(isolatedResponse.ok()).toBe(true);
  expect(fixedResponse.ok()).toBe(true);
  const isolatedConfig = await isolatedResponse.text();
  const fixedConfig = await fixedResponse.text();
  expect(isolatedConfig).toContain(`"apiUrl":"${api.origin}"`);
  expect(isolatedConfig).toContain(`"wsUrl":"${api.origin}"`);
  expect(fixedConfig).toContain('"apiUrl":"http://127.0.0.1:3316"');
  expect(fixedConfig).not.toContain(api.origin);

  const sharedConfig = await readFile(resolve(__dirname, '../../kalio-web/dist/runtime-config.js'), 'utf8');
  expect(sharedConfig).toContain('"apiUrl":"http://127.0.0.1:3316"');
  expect(sharedConfig).not.toContain(api.origin);
});

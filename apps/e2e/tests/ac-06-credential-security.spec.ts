import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-06: Credentials — API keys stored encrypted, never exposed in API responses
test.describe('AC-06: Credential security', () => {
  test('creating a credential returns record without apiKey field', async ({ request }) => {
    const res = await request.post(`${API_BASE}/credentials`, {
      data: {
        name: 'AC06 Test Key',
        provider: 'openai',
        apiKey: 'sk-test-secret-key-should-never-be-returned',
        model: 'gpt-4o',
      },
    });
    expect(res.ok()).toBeTruthy();
    const cred = await res.json();
    expect(cred.id).toBeDefined();
    expect(cred.name).toBe('AC06 Test Key');
    // apiKey must NOT be in the response
    expect('apiKey' in cred).toBeFalsy();
    expect(cred.apiKey).toBeUndefined();

    await request.delete(`${API_BASE}/credentials/${cred.id}`);
  });

  test('listing credentials does not include apiKey values', async ({ request }) => {
    const createRes = await request.post(`${API_BASE}/credentials`, {
      data: { name: 'AC06 List Key', provider: 'openrouter', apiKey: 'secret-list-test', model: 'llama-3' },
    });
    const cred = await createRes.json();

    const listRes = await request.get(`${API_BASE}/credentials`);
    expect(listRes.ok()).toBeTruthy();
    const creds: Array<Record<string, unknown>> = await listRes.json();
    for (const c of creds) {
      expect('apiKey' in c).toBeFalsy();
      expect(c.apiKey).toBeUndefined();
    }

    await request.delete(`${API_BASE}/credentials/${cred.id}`);
  });

  test('credential can be deleted', async ({ request }) => {
    const createRes = await request.post(`${API_BASE}/credentials`, {
      data: { name: 'AC06 Delete Key', provider: 'ollama', apiKey: 'local', model: 'qwen3:8b' },
    });
    const cred = await createRes.json();

    const delRes = await request.delete(`${API_BASE}/credentials/${cred.id}`);
    expect(delRes.status()).toBe(204);

    const listRes = await request.get(`${API_BASE}/credentials`);
    const creds: Array<{ id: string }> = await listRes.json();
    expect(creds.some((c) => c.id === cred.id)).toBeFalsy();
  });
});

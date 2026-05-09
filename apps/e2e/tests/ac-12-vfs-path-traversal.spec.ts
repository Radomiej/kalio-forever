import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-12: VFS read is restricted to session-scoped workspace (path traversal guard)
test.describe('AC-12: VFS path traversal guard', () => {
  let sessionId: string;

  test.beforeEach(async ({ request }) => {
    const res = await request.post(`${API_BASE}/sessions`, { data: {} });
    const session = await res.json();
    sessionId = session.id;
  });

  test.afterEach(async ({ request }) => {
    if (sessionId) await request.delete(`${API_BASE}/sessions/${sessionId}`);
  });

  test('reading ../../../etc/passwd is rejected', async ({ request }) => {
    const res = await request.get(
      `${API_BASE}/sessions/${sessionId}/vfs/read?path=../../../etc/passwd`,
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain('PATH_TRAVERSAL_DENIED');
  });

  test('writing outside workspace root is rejected', async ({ request }) => {
    const res = await request.post(`${API_BASE}/sessions/${sessionId}/vfs`, {
      data: { filePath: '../../etc/evil.sh', content: 'evil' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain('PATH_TRAVERSAL_DENIED');
  });

  test('valid in-scope paths succeed', async ({ request }) => {
    const writeRes = await request.post(`${API_BASE}/sessions/${sessionId}/vfs`, {
      data: { filePath: 'hello.txt', content: 'Hello, VFS!' },
    });
    expect(writeRes.ok()).toBeTruthy();

    const readRes = await request.get(
      `${API_BASE}/sessions/${sessionId}/vfs/read?path=hello.txt`,
    );
    expect(readRes.ok()).toBeTruthy();
    const result = await readRes.json();
    expect(result.content).toBe('Hello, VFS!');
  });
});

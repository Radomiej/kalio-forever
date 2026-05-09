import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-03: VFS write tool writes file into session-scoped workspace
test.describe('AC-03: VFS write', () => {
  let sessionId: string;

  test.beforeEach(async ({ request }) => {
    const res = await request.post(`${API_BASE}/sessions`, { data: {} });
    const session = await res.json();
    sessionId = session.id;
  });

  test.afterEach(async ({ request }) => {
    if (sessionId) await request.delete(`${API_BASE}/sessions/${sessionId}`);
  });

  test('vfs_write creates file in session workspace', async ({ request }) => {
    const res = await request.post(`${API_BASE}/sessions/${sessionId}/vfs`, {
      data: { filePath: 'output.txt', content: 'Generated content' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('written file appears in VFS explorer', async ({ request }) => {
    await request.post(`${API_BASE}/sessions/${sessionId}/vfs`, {
      data: { filePath: 'notes.md', content: '# Notes\n\nSome notes' },
    });

    const listRes = await request.get(`${API_BASE}/sessions/${sessionId}/vfs`);
    expect(listRes.ok()).toBeTruthy();
    const result = await listRes.json();
    expect(result.files.some((f: { path: string }) => f.path === 'notes.md')).toBeTruthy();
  });

  test('path traversal attempt is rejected with error', async ({ request }) => {
    const res = await request.post(`${API_BASE}/sessions/${sessionId}/vfs`, {
      data: { filePath: '../../../tmp/evil.sh', content: 'evil' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain('PATH_TRAVERSAL_DENIED');
  });
});

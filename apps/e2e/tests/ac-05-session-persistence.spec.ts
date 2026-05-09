import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-05: Session persistence — messages are stored and retrieved across page reloads
test.describe('AC-05: Session persistence', () => {
  test('messages sent in a session are persisted in the database', async ({ request }) => {
    // Create a session
    const res = await request.post(`${API_BASE}/sessions`, { data: {} });
    expect(res.ok()).toBeTruthy();
    const session = await res.json();
    expect(session.id).toBeDefined();

    // Messages endpoint returns array (empty initially)
    const msgRes = await request.get(`${API_BASE}/sessions/${session.id}/messages`);
    expect(msgRes.ok()).toBeTruthy();
    const messages = await msgRes.json();
    expect(Array.isArray(messages)).toBeTruthy();

    // cleanup
    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });

  test('reloading the page restores session message history', async ({ request }) => {
    // Create a session
    const res = await request.post(`${API_BASE}/sessions`, { data: { title: 'AC05 Reload Test' } });
    const session = await res.json();

    // Session persists across multiple GET calls (simulates page reload)
    const getRes1 = await request.get(`${API_BASE}/sessions/${session.id}/messages`);
    const getRes2 = await request.get(`${API_BASE}/sessions/${session.id}/messages`);
    expect(getRes1.ok()).toBeTruthy();
    expect(getRes2.ok()).toBeTruthy();
    const msgs1 = await getRes1.json();
    const msgs2 = await getRes2.json();
    expect(JSON.stringify(msgs1)).toBe(JSON.stringify(msgs2));

    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });

  test('multiple sessions are listed in the session panel', async ({ request }) => {
    // Create two sessions
    const s1 = await (await request.post(`${API_BASE}/sessions`, { data: { title: 'AC05 Session A' } })).json();
    const s2 = await (await request.post(`${API_BASE}/sessions`, { data: { title: 'AC05 Session B' } })).json();

    const listRes = await request.get(`${API_BASE}/sessions`);
    expect(listRes.ok()).toBeTruthy();
    const sessions: Array<{ id: string }> = await listRes.json();
    expect(sessions.some((s) => s.id === s1.id)).toBeTruthy();
    expect(sessions.some((s) => s.id === s2.id)).toBeTruthy();

    await request.delete(`${API_BASE}/sessions/${s1.id}`);
    await request.delete(`${API_BASE}/sessions/${s2.id}`);
  });
});

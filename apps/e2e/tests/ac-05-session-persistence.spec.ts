import { test, expect, type APIRequestContext } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

async function createSession(request: APIRequestContext, title: string) {
  const response = await request.post(`${API_BASE}/sessions`, { data: { title, personaId: 'default' } });
  expect(response.ok()).toBe(true);
  return await response.json() as { id: string; title: string };
}

async function seedMessages(
  request: APIRequestContext,
  sessionId: string,
): Promise<void> {
  const response = await request.post(`${API_BASE}/test-support/tool-confirmations/seed-replay`, {
    data: {
      sessionId,
      requestId: `req-${sessionId}`,
      toolCallId: `tool-${sessionId}`,
      toolName: 'vfs_write',
      args: { path: 'note.txt', content: 'hello' },
      promptMessage: 'Persist this message',
      assistantMessage: 'I need approval before writing.',
    },
  });
  expect(response.ok()).toBe(true);
}

// AC-05: Session persistence — sessions and stored messages survive repeat reads
test.describe('AC-05: Session persistence', () => {
  test('seeded messages are persisted and returned in chronological order', async ({ request }) => {
    const session = await createSession(request, 'AC05 Messages Test');
    await seedMessages(request, session.id);

    const msgRes = await request.get(`${API_BASE}/sessions/${session.id}/messages`);
    expect(msgRes.ok()).toBe(true);
    const messages = await msgRes.json();
    expect(messages).toMatchObject([
      { sessionId: session.id, role: 'user', content: 'Persist this message' },
      { sessionId: session.id, role: 'assistant', content: 'I need approval before writing.' },
    ]);

    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });

  test('message history is stable across repeat reads', async ({ request }) => {
    const session = await createSession(request, 'AC05 Repeat Read Test');
    await seedMessages(request, session.id);

    const getRes1 = await request.get(`${API_BASE}/sessions/${session.id}/messages`);
    const getRes2 = await request.get(`${API_BASE}/sessions/${session.id}/messages`);
    expect(getRes1.ok()).toBe(true);
    expect(getRes2.ok()).toBe(true);
    const msgs1 = await getRes1.json();
    const msgs2 = await getRes2.json();
    expect(msgs2).toEqual(msgs1);

    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });

  test('created sessions are returned by the session list endpoint', async ({ request }) => {
    const s1 = await createSession(request, 'AC05 Session A');
    const s2 = await createSession(request, 'AC05 Session B');

    const listRes = await request.get(`${API_BASE}/sessions`);
    expect(listRes.ok()).toBe(true);
    const sessions: Array<{ id: string }> = await listRes.json();
    expect(sessions.map((s) => s.id)).toEqual(expect.arrayContaining([s1.id, s2.id]));

    await request.delete(`${API_BASE}/sessions/${s1.id}`);
    await request.delete(`${API_BASE}/sessions/${s2.id}`);
  });
});

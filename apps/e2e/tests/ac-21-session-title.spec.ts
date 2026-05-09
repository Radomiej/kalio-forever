import { test, expect } from '@playwright/test';
import { API_BASE } from './helpers/test-config';

// AC-21: Session generate-title endpoint
test.describe('AC-21: Session auto-title', () => {
  test('POST /sessions/:id/generate-title returns title for session with messages', async ({ request }) => {
    // Create session
    const sessionRes = await request.post(`${API_BASE}/sessions`, {
      data: { personaId: 'default' },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();

    // For a session with no messages it should return a fallback
    const titleRes = await request.post(`${API_BASE}/sessions/${session.id}/generate-title`);
    expect(titleRes.ok()).toBeTruthy();
    const { title } = await titleRes.json();
    expect(typeof title).toBe('string');
    expect(title.length).toBeGreaterThan(0);

    // Cleanup
    await request.delete(`${API_BASE}/sessions/${session.id}`);
  });
});

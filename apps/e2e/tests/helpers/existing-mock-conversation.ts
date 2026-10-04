import { expect, type APIRequestContext } from '@playwright/test';
import { io } from 'socket.io-client';
import { API_BASE, deleteSessionIfExists } from './test-config';

/** Prepare an existing conversation; mock remains absent from the production picker. */
export async function createExistingMockConversation(
  request: APIRequestContext,
  title: string,
): Promise<{ id: string }> {
  if (!process.env['DATABASE_PATH']?.replaceAll('\\', '/').includes('playwright-stack/')) {
    throw new Error('Mock conversation fixture requires the isolated Playwright database');
  }
  const profileResponse = await request.post(`${API_BASE}/runtime/profiles`, {
    data: { name: `Mock fixture ${title}`, kind: 'direct-llm', provider: 'mock', model: 'mock' },
  });
  expect(profileResponse.ok()).toBeTruthy();
  const profile = await profileResponse.json() as { id: string };
  const response = await request.post(`${API_BASE}/sessions`, {
    data: { title, personaId: 'default', executionProfileId: profile.id },
  });
  expect(response.ok()).toBeTruthy();
  const session = await response.json() as { id: string };
  const socket = io(API_BASE.replace(/\/api$/, ''), {
    transports: ['websocket'], query: { sessionId: session.id }, autoConnect: false,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Mock fixture initialization timed out')), 10_000);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      socket.once('connect_error', finish);
      socket.once('chat:error', (error: { message?: string }) => finish(new Error(error.message ?? 'Fixture failed')));
      socket.once('chat:complete', () => finish());
      socket.once('connect', () => socket.emit('chat:send', {
        sessionId: session.id, personaId: 'default', executionProfileId: profile.id,
        content: '[[mock:script]] return("Initialized existing conversation fixture") [[/mock:script]]',
      }));
      socket.connect();
    });
    return session;
  } catch (error) {
    await deleteSessionIfExists(request, session.id);
    throw error;
  } finally {
    socket.disconnect();
  }
}

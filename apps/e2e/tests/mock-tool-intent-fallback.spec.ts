import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { io, Socket } from 'socket.io-client';
import { API_BASE, selectSession, deleteSessionIfExists } from './helpers/test-config';

const WS_BASE = API_BASE.replace('/api', '');
const MOCK_TRIGGER = '[[mock:tool:raapp_create:no-arg-progress]]';

type TimedEvent<T> = { at: number; data: T };

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function connectSocket(sessionId: string): Socket {
  return io(WS_BASE, {
    transports: ['websocket'],
    query: { sessionId },
  });
}

async function waitFor<T>(producer: () => T | undefined, timeoutMs: number, label: string): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = producer();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timeout waiting for ${label}`);
}

async function getActiveCredentialId(request: APIRequestContext): Promise<string | null> {
  const response = await request.get(`${API_BASE}/credentials/active`);
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { credentialId?: string | null };
  return payload.credentialId ?? null;
}

async function restoreActiveCredential(request: APIRequestContext, credentialId: string | null): Promise<void> {
  if (credentialId) {
    await request.put(`${API_BASE}/credentials/active/${credentialId}`);
    return;
  }
  await request.delete(`${API_BASE}/credentials/active`);
}

async function runMockFallbackFlow(page: Page, request: APIRequestContext): Promise<{
  confirmations: Array<TimedEvent<{ toolName: string }>>;
  progressEvents: Array<TimedEvent<{ toolName: string; totalChars: number; charsPerSec: number }>>;
  chatErrors: Array<TimedEvent<unknown>>;
  seenIndicatorText: string;
}> {
  const previousActiveCredentialId = await getActiveCredentialId(request);
  const sessionTitle = uniqueName('Mock Tool Intent');
  let createdCredentialId: string | null = null;
  let sessionId: string | null = null;
  let socket: Socket | null = null;

  const confirmations: Array<TimedEvent<{ toolName: string }>> = [];
  const progressEvents: Array<TimedEvent<{ toolName: string; totalChars: number; charsPerSec: number }>> = [];
  const chatErrors: Array<TimedEvent<unknown>> = [];

  try {
    const createCredential = await request.post(`${API_BASE}/credentials`, {
      data: {
        name: uniqueName('Mock fallback'),
        provider: 'mock',
        apiKey: 'mock',
        model: 'mock',
        baseUrl: 'mock',
      },
    });
    expect(createCredential.ok()).toBeTruthy();
    const createdCredential = await createCredential.json() as { id: string };
    createdCredentialId = createdCredential.id;

    const activateCredential = await request.put(`${API_BASE}/credentials/active/${createdCredentialId}`);
    expect(activateCredential.ok()).toBeTruthy();

    const llmConfigResponse = await request.get(`${API_BASE}/llm/config`);
    expect(llmConfigResponse.ok()).toBeTruthy();
    const llmConfig = await llmConfigResponse.json() as { provider?: string; model?: string; source?: string };
    expect(llmConfig.provider).toBe('mock');
    expect(llmConfig.model).toBe('mock');
    expect(llmConfig.source).toBe('db');

    const createSession = await request.post(`${API_BASE}/sessions`, {
      data: { title: sessionTitle, personaId: 'designer' },
    });
    expect(createSession.ok()).toBeTruthy();
    const session = await createSession.json() as { id: string };
    sessionId = session.id;

    socket = connectSocket(sessionId);
    socket.on('tool:confirmation_required', (data) => confirmations.push({ at: Date.now(), data: data as { toolName: string } }));
    socket.on('tool:arg_progress', (data) => progressEvents.push({ at: Date.now(), data: data as { toolName: string; totalChars: number; charsPerSec: number } }));
    socket.on('chat:error', (data) => chatErrors.push({ at: Date.now(), data }));

    await waitFor(() => (socket?.connected ? true : undefined), 10_000, 'socket connect');
    socket.emit('session:identify', { sessionId });

    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, sessionId, sessionTitle);

    const chatInput = page.getByTestId('chat-input');
    await expect(chatInput).toBeEnabled({ timeout: 10_000 });
    await chatInput.fill(`${MOCK_TRIGGER} Użyj dokładnie narzędzia raapp_create i niczego więcej.`);
    await page.getByTestId('chat-send-btn').click();

    const agentBubble = page.getByTestId('agent-turn-bubble').first();
    await expect(agentBubble).toBeVisible({ timeout: 10_000 });

    const progressIndicator = agentBubble.getByTestId('tool-arg-progress-indicator');
    await expect(progressIndicator).toHaveText(/Preparing\s+raapp_create/i, { timeout: 10_000 });
    await expect(agentBubble.getByTestId('confirmation-confirm-btn')).toBeVisible({ timeout: 10_000 });
    await waitFor(
      () => confirmations.find((event) => event.data.toolName === 'raapp_create'),
      10_000,
      'mock confirmation_required event',
    );

    return {
      confirmations,
      progressEvents,
      chatErrors,
      seenIndicatorText: (await progressIndicator.textContent())?.trim() ?? '',
    };
  } finally {
    socket?.disconnect();
    if (sessionId) {
      await deleteSessionIfExists(request, sessionId).catch(() => undefined);
    }
    await restoreActiveCredential(request, previousActiveCredentialId).catch(() => undefined);
    if (createdCredentialId) {
      await request.delete(`${API_BASE}/credentials/${createdCredentialId}`).catch(() => undefined);
    }
  }
}

test.describe('Mock tool intent fallback', () => {
  test('shows synthetic Preparing raapp_create without tool:arg_progress chunks', async ({ page, request }) => {
    const { confirmations, progressEvents, chatErrors, seenIndicatorText } = await runMockFallbackFlow(page, request);

    expect(chatErrors).toEqual([]);
    expect(confirmations.some((event) => event.data.toolName === 'raapp_create')).toBe(true);
    expect(progressEvents.some((event) => event.data.toolName === 'raapp_create')).toBe(false);
    expect(seenIndicatorText).toMatch(/Preparing\s+raapp_create/i);
  });
});
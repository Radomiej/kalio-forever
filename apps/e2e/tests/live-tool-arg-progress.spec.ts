import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { io, Socket } from 'socket.io-client';
import { API_BASE, selectSession, deleteSessionIfExists } from './helpers/test-config';

const WS_BASE = API_BASE.replace('/api', '');
const LIVE_PROVIDER = process.env['KALIO_LIVE_LLM_PROVIDER'] ?? 'xiaomimimo';
const LIVE_MODEL = process.env['KALIO_LIVE_LLM_MODEL'] ?? 'mimo-v2-omni';
const LIVE_BASE_URL = process.env['KALIO_LIVE_LLM_BASE_URL'] ?? 'https://token-plan-ams.xiaomimimo.com/v1';
const LIVE_API_KEY = process.env['KALIO_LIVE_LLM_API_KEY'];

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

async function runLiveRaappFlow(page: Page, request: APIRequestContext): Promise<{
  progressEvents: Array<TimedEvent<{ toolName: string; totalChars: number; charsPerSec: number }>>;
  toolStarts: Array<TimedEvent<{ toolName: string }>>;
  confirmations: Array<TimedEvent<{ toolName: string }>>;
  chatErrors: Array<TimedEvent<unknown>>;
  seenIndicatorTexts: string[];
}> {
  const previousActiveCredentialId = await getActiveCredentialId(request);
  const sessionTitle = uniqueName('Live Tool Progress');
  let createdCredentialId: string | null = null;
  let sessionId: string | null = null;
  let socket: Socket | null = null;

  const progressEvents: Array<TimedEvent<{ toolName: string; totalChars: number; charsPerSec: number }>> = [];
  const toolStarts: Array<TimedEvent<{ toolName: string }>> = [];
  const confirmations: Array<TimedEvent<{ toolName: string }>> = [];
  const chatErrors: Array<TimedEvent<unknown>> = [];
  const seenIndicatorTexts: string[] = [];

  try {
    const createCredential = await request.post(`${API_BASE}/credentials`, {
      data: {
        name: uniqueName(`Live ${LIVE_PROVIDER}`),
        provider: LIVE_PROVIDER,
        apiKey: LIVE_API_KEY,
        model: LIVE_MODEL,
        baseUrl: LIVE_BASE_URL,
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
    expect(llmConfig.provider).toBe(LIVE_PROVIDER);
    expect(llmConfig.model).toBe(LIVE_MODEL);
    expect(llmConfig.source).toBe('db');

    const createSession = await request.post(`${API_BASE}/sessions`, {
      data: { title: sessionTitle, personaId: 'designer' },
    });
    expect(createSession.ok()).toBeTruthy();
    const session = await createSession.json() as { id: string };
    sessionId = session.id;

    socket = connectSocket(sessionId);
    socket.on('tool:arg_progress', (data) => progressEvents.push({ at: Date.now(), data }));
    socket.on('tool:start', (data) => toolStarts.push({ at: Date.now(), data: data as { toolName: string } }));
    socket.on('tool:confirmation_required', (data) => confirmations.push({ at: Date.now(), data: data as { toolName: string } }));
    socket.on('chat:error', (data) => chatErrors.push({ at: Date.now(), data }));

    await waitFor(() => (socket?.connected ? true : undefined), 10_000, 'socket connect');
    socket.emit('session:identify', { sessionId });

    await page.goto('/');
    await page.getByTestId('nav-talk').click();
    await selectSession(page, sessionId, sessionTitle);

    const chatInput = page.getByTestId('chat-input');
    await expect(chatInput).toBeEnabled({ timeout: 10_000 });
    await chatInput.fill(
      'Opublikuj to bezpośrednio jako RA-App HTML używając dokładnie narzędzia raapp_create. Nie używaj VFS ani design_preview. Stwórz dużą interaktywną aplikację "Task Planner Pro" jako pojedynczy dokument HTML z rozbudowanym CSS i JavaScript, tabelą zadań, filtrowaniem, formularzem, panelem statystyk i lokalnym stanem. Wygeneruj dużo kodu i nie odpowiadaj zwykłym tekstem.',
    );
    await page.getByTestId('chat-send-btn').click();

    const agentBubble = page.getByTestId('agent-turn-bubble').first();
    await expect(agentBubble).toBeVisible({ timeout: 20_000 });

    const progressIndicators = agentBubble.locator('[data-testid="turn-loading-indicator"], [data-testid="tool-arg-progress-indicator"]');
    await expect(progressIndicators.first()).toBeVisible({ timeout: 30_000 });

    const loopDeadline = Date.now() + 60_000;
    let raappStartSeenAt: number | null = null;
    while (Date.now() < loopDeadline) {
      if (chatErrors.length > 0) {
        break;
      }

      try {
        const texts = (await progressIndicators.allTextContents())
          .map((text) => text.trim())
          .filter((text) => text.length > 0);
        seenIndicatorTexts.push(...texts);
      } catch {
        // indicator may disappear once tool:start fires
      }

      const sawRaappProgress = progressEvents.some((event) => event.data.toolName === 'raapp_create');
      const sawRaappStart = toolStarts.some((event) => event.data.toolName === 'raapp_create')
        || confirmations.some((event) => event.data.toolName === 'raapp_create');
      if (sawRaappStart && raappStartSeenAt === null) {
        raappStartSeenAt = Date.now();
      }
      if (sawRaappProgress && sawRaappStart) {
        break;
      }
      if (raappStartSeenAt !== null && Date.now() - raappStartSeenAt >= 2000) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    return { progressEvents, toolStarts, confirmations, chatErrors, seenIndicatorTexts };
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

test.describe('Live tool arg progress', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test.skip(!LIVE_API_KEY, 'Set KALIO_LIVE_LLM_API_KEY to run live provider tests.');

  test('live provider credential test endpoint accepts the configured live key', async ({ request }) => {
    const response = await request.post(`${API_BASE}/credentials/test`, {
      data: {
        provider: LIVE_PROVIDER,
        apiKey: LIVE_API_KEY,
        model: LIVE_MODEL,
        baseUrl: LIVE_BASE_URL,
      },
    });

    expect(response.ok()).toBeTruthy();
    const payload = await response.json() as { ok: boolean; latencyMs: number; error?: string };
    expect(payload.ok, payload.error ?? 'provider test failed').toBe(true);
  });

  test('socket emits tool:arg_progress before tool:start with the live provider', async ({ page, request }) => {
    const { progressEvents, toolStarts, confirmations, chatErrors } = await runLiveRaappFlow(page, request);

    const firstProgress = progressEvents.find((event) => event.data.toolName === 'raapp_create');
    const firstToolStart = toolStarts.find((event) => event.data.toolName === 'raapp_create')
      ?? confirmations.find((event) => event.data.toolName === 'raapp_create');

    expect(chatErrors).toEqual([]);
    expect(firstProgress).toBeDefined();
    expect(firstToolStart).toBeDefined();
    expect(progressEvents.some((event) => event.data.toolName === 'raapp_create' && event.data.totalChars === 0)).toBe(true);
    expect(firstProgress!.at).toBeLessThan(firstToolStart!.at);
  });

  test('web chat renders tool intent or progress text before tool:start with the live provider', async ({ page, request }) => {
    const { seenIndicatorTexts, chatErrors } = await runLiveRaappFlow(page, request);

    expect(chatErrors).toEqual([]);
    expect(seenIndicatorTexts.join(' | ')).toMatch(/(Preparing|Writing)\s+raapp_create/i);
  });
});
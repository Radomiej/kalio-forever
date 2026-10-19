import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaseOpenAICompatibleProvider } from './base-openai-compatible.provider';

const provider = () => new BaseOpenAICompatibleProvider('test', '', 'local', 'http://local.test/v1');
const options = () => ({ sessionId: 's', messageId: 'm', onChunk: vi.fn() });

afterEach(() => vi.unstubAllGlobals());

describe('provider request timeout', () => {
  it('aborts each stalled attempt at the configured deadline and reports LLM_TIMEOUT', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      attempts++;
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    }));
    await expect(provider().streamChat([], [], { ...options(), requestTimeoutMs: 15 }))
      .rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
    expect(attempts).toBe(3);
  }, 2000);

  it('allows a slow response within the configured deadline', async () => {
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response('data: [DONE]\n\n')), 30);
      init.signal!.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal!.reason); }, { once: true });
    }));
    await expect(provider().streamChat([], [], { ...options(), requestTimeoutMs: 100 })).resolves.toEqual([]);
  });

  it('reports a timeout during the response stream without replaying partial output', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      attempts++;
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
          init.signal!.addEventListener('abort', () => controller.error(init.signal!.reason), { once: true });
        },
      })));
    });
    await expect(provider().streamChat([], [], { ...options(), requestTimeoutMs: 15 }))
      .rejects.toMatchObject({ code: 'LLM_TIMEOUT' });
    expect(attempts).toBe(1);
  }, 2000);

  it('keeps user cancellation immediate and does not retry it', async () => {
    const controller = new AbortController();
    let attempts = 0;
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      attempts++;
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      controller.abort();
    }));
    await expect(provider().streamChat([], [], { ...options(), requestTimeoutMs: 100, abortSignal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(attempts).toBe(1);
  });
});

import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaGuardianFetchTransport, MAX_GUARDIAN_RESPONSE_BYTES } from './ollama-guardian.transport';
import { OllamaLocalGuardian } from './ollama-local-guardian';

const input = { requestId: 'r', policy: { id: 'p', instructions: 'Read-only operations only.' }, context: { operation: 'read' } };
const servers: Server[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

describe('bounded Ollama HTTP transport', () => {
  it('uses real loopback HTTP, schema request and parses a complete advisory response', async () => {
    let captured = '';
    const server = createServer(async (request, response) => {
      expect(request.method).toBe('POST');
      expect(request.url).toBe('/api/chat');
      expect(request.headers.authorization).toBeUndefined();
      for await (const chunk of request) captured += String(chunk);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ model: 'test:dev', done: true, done_reason: 'stop',
        message: { role: 'assistant', content: '{"verdict":"deny","reason":"Policy violation."}' } }));
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address.');
    const guardian = new OllamaLocalGuardian({
      endpoint: `http://127.0.0.1:${address.port}/api/chat`, model: 'test:dev',
    }, new OllamaGuardianFetchTransport());
    expect(await guardian.evaluate(input)).toMatchObject({ status: 'evaluated', verdict: 'deny' });
    expect(JSON.parse(captured)).toMatchObject({ stream: false, format: { additionalProperties: false } });
  });

  it.each([
    () => new Response('private-error', { status: 500 }),
    () => new Response('not JSON'),
    () => new Response('x'.repeat(MAX_GUARDIAN_RESPONSE_BYTES + 1)),
    () => new Response(new Uint8Array([0xff])),
    () => new Response(null, { status: 204 }),
  ])('fails closed on HTTP, encoding, JSON, size or missing-body failures', async response => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
    const transport = new OllamaGuardianFetchTransport(fetcher);
    const guardian = new OllamaLocalGuardian({ endpoint: 'http://localhost/api/chat', model: 'test:dev' }, transport);
    expect(await guardian.evaluate(input)).toMatchObject({ status: 'fallback', verdict: 'ask_user', reason: 'provider_error' });
    expect(fetcher).toHaveBeenCalledWith('http://localhost/api/chat', expect.objectContaining({
      method: 'POST', redirect: 'error', credentials: 'omit', signal: expect.any(AbortSignal),
    }));
  });

  it('counts UTF-8 bytes rather than characters across streaming chunks', async () => {
    const cancel = vi.fn();
    const bytes = new TextEncoder().encode('界'.repeat(6000));
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(bytes.slice(0, 10_000)); controller.enqueue(bytes.slice(10_000));
    }, cancel });
    const transport = new OllamaGuardianFetchTransport(vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)));
    await expect(transport.post('http://localhost/api/chat', '{}', new AbortController().signal)).rejects.toThrow('too large');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels a stalled response reader on deadline and releases its lock', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{'));
    }, cancel });
    const transport = new OllamaGuardianFetchTransport(vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)));
    const guardian = new OllamaLocalGuardian({ endpoint: 'http://localhost/api/chat', model: 'test:dev', timeoutMs: 10 }, transport);
    const pending = guardian.evaluate(input);
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toMatchObject({ verdict: 'ask_user', reason: 'timeout' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });
});

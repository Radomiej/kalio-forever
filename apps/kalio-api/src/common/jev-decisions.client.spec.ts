import { afterEach, describe, expect, it, vi } from 'vitest';
import { JevDecisionsClient } from './jev-decisions.client';

describe('JevDecisionsClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('submits a pinned Jev decision and returns a validated noul probability', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      answers: { approval: { noul: 0.93, type: 'noul' } },
      model: 'typesafe/jev-1.13-20260917',
      usage: { input_tokens: 12, output_tokens: 3 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new JevDecisionsClient().decideNoul({
      apiKey: 'management-secret',
      questionId: 'approval',
      instructions: 'Should this operation be allowed?',
      state: { operation: 'read file' },
    });

    expect(fetchMock).toHaveBeenCalledWith('https://openrouter.ai/api/alpha/decisions', expect.objectContaining({
      method: 'POST',
      headers: {
        Authorization: 'Bearer management-secret',
        'Content-Type': 'application/json',
      },
    }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(expect.objectContaining({
      model: 'typesafe/jev-1.13',
      questions: expect.objectContaining({ approval: expect.objectContaining({ type: 'noul' }) }),
    }));
    expect(result.probability).toBe(0.93);
    expect(result.model).toBe('typesafe/jev-1.13-20260917');
  });

  it('returns a selected choice and confidence only when they are in range', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      answers: { route: { choice: 'edge-agent', confidence: 0.88, type: 'choice' } },
      model: 'typesafe/jev-1.13',
    }), { status: 200 })));

    await expect(new JevDecisionsClient().decideChoice({
      apiKey: 'management-secret',
      questionId: 'route',
      instructions: 'Choose the next edge.',
      criteria: { 'edge-agent': 'Route to agent', 'edge-default': 'Use fallback' },
      state: { prompt: 'Implement feature' },
    })).resolves.toEqual({ choice: 'edge-agent', confidence: 0.88, model: 'typesafe/jev-1.13' });
  });

  it('rejects malformed decisions and does not expose provider response bodies in errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      answers: { approval: { noul: 2, type: 'noul' } },
    }), { status: 200 })));

    await expect(new JevDecisionsClient().decideNoul({
      apiKey: 'management-secret',
      questionId: 'approval',
      instructions: 'Should this operation be allowed?',
      state: {},
    })).rejects.toThrow('invalid probability');
  });

  it('rejects answers with a missing or mismatched decision type', async () => {
    const client = new JevDecisionsClient();
    const approvalInput = {
      apiKey: 'management-secret',
      questionId: 'approval',
      instructions: 'Should this operation be allowed?',
      state: {},
    };
    const routeInput = {
      apiKey: 'management-secret',
      questionId: 'route',
      instructions: 'Choose the next edge.',
      criteria: { 'edge-agent': 'Route to agent' },
      state: {},
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      answers: { approval: { noul: 0.99 } },
    }))));
    await expect(client.decideNoul(approvalInput)).rejects.toThrow('decision type');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      answers: { approval: { noul: 0.99, type: 'choice' } },
    }))));
    await expect(client.decideNoul(approvalInput)).rejects.toThrow('decision type');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      answers: { route: { choice: 'edge-agent', confidence: 0.99 } },
    }))));
    await expect(client.decideChoice(routeInput)).rejects.toThrow('decision type');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      answers: { route: { choice: 'edge-agent', confidence: 0.99, type: 'noul' } },
    }))));
    await expect(client.decideChoice(routeInput)).rejects.toThrow('decision type');
  });

  it('rejects HTTP errors, malformed JSON, missing answers, unknown choices, and invalid confidence', async () => {
    const input = {
      apiKey: 'management-secret',
      questionId: 'route',
      instructions: 'Choose the next edge.',
      criteria: { 'edge-agent': 'Route to agent' },
      state: {},
    };
    const client = new JevDecisionsClient();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('management-secret', { status: 403 })));
    await expect(client.decideChoice(input)).rejects.toThrow('HTTP status 403');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('management-secret')));
    await expect(client.decideChoice(input)).rejects.toThrow('invalid JSON');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ answers: {} }))));
    await expect(client.decideChoice(input)).rejects.toThrow('missing the requested answer');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      answers: { route: { choice: 'unoffered-edge', confidence: 0.99, type: 'choice' } },
    }))));
    await expect(client.decideChoice(input)).rejects.toThrow('invalid choice');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      answers: { route: { choice: 'edge-agent', confidence: 1.1, type: 'choice' } },
    }))));
    await expect(client.decideChoice(input)).rejects.toThrow('invalid probability or confidence');
  });

  it('aborts a request after the fixed timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const pending = new JevDecisionsClient().decideNoul({
        apiKey: 'management-secret',
        questionId: 'approval',
        instructions: 'Should this operation be allowed?',
        state: {},
      });
      const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(8_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors caller cancellation', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = new JevDecisionsClient().decideNoul({
      apiKey: 'management-secret',
      questionId: 'approval',
      instructions: 'Should this operation be allowed?',
      state: {},
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

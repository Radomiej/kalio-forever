import { afterEach, describe, expect, it, vi } from 'vitest';
import { JevDecisionsClient } from './jev-decisions.client';

const connection = { endpoint: 'https://openrouter.ai/api/alpha/decisions', model: 'typesafe/jev-1.13' };
const batch = {
  ...connection, apiKey: 'management-secret', state: { evidence: 'shared snapshot' },
  questions: [
    { questionId: 'tests', instructions: 'Are tests proven?', criteria: { true: 'Tests pass', false: 'Tests fail or lack evidence' } },
    { questionId: 'hydration', instructions: 'Is reload proven?', criteria: { true: 'Reload restores state', false: 'Reload loses state or lacks evidence' } },
  ],
};

describe('JevDecisionsClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('submits independent caller-defined noul questions in exactly one request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: 'dated-model', answers: {
      tests: { type: 'noul', noul: 0 }, hydration: { type: 'noul', noul: 1 },
    } })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new JevDecisionsClient().decideNoulBatch(batch)).resolves.toEqual({
      answers: { tests: { probability: 0 }, hydration: { probability: 1 } }, model: 'dated-model',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(connection.endpoint, expect.objectContaining({
      method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer management-secret', 'Content-Type': 'application/json' },
    }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ model: batch.model, state: batch.state,
      questions: Object.fromEntries(batch.questions.map(({ questionId, ...question }) => [questionId, { type: 'noul', ...question }])),
    });
  });

  it.each([
    {}, { tests: { type: 'noul', noul: 0.8 } },
    { tests: { type: 'noul', noul: 0.8 }, hydration: { type: 'choice', noul: 0.8 } },
    { tests: { type: 'noul', noul: 0.8 }, hydration: { noul: 0.8 } },
    { tests: { type: 'noul', noul: 0.8 }, hydration: { type: 'noul', noul: null } },
    { tests: { type: 'noul', noul: 0.8 }, hydration: { type: 'noul', noul: '0.8' } },
    { tests: { type: 'noul', noul: 0.8 }, hydration: { type: 'noul', noul: -0.1 } },
    { tests: { type: 'noul', noul: 0.8 }, hydration: { type: 'noul', noul: 1.1 } },
    { tests: { type: 'noul', noul: 0.8 }, hydration: { type: 'noul', noul: 0.8 }, extra: { type: 'noul', noul: 0.8 } },
    [], null,
  ].map((answers) => ({ answers })))('rejects the entire batch for non-exact or malformed answers: %j', async ({ answers }) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ answers })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new JevDecisionsClient().decideNoulBatch(batch)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [], Array.from({ length: 33 }, (_, index) => ({ ...batch.questions[0]!, questionId: `q${index}` })),
    [batch.questions[0]!, batch.questions[0]!],
    [{ ...batch.questions[0]!, questionId: '__proto__' }],
    [{ ...batch.questions[0]!, questionId: 'q'.repeat(65) }],
    [{ ...batch.questions[0]!, instructions: '' }],
    [{ ...batch.questions[0]!, instructions: 'x'.repeat(4097) }],
    [{ ...batch.questions[0]!, criteria: { true: '', false: 'No' } }],
    [{ ...batch.questions[0]!, criteria: { true: 'Yes', false: 'x'.repeat(4097) } }],
  ].map((questions) => ({ questions })))('rejects invalid or excessive questions before fetch: %j', async ({ questions }) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new JevDecisionsClient().decideNoulBatch({ ...batch, questions })).rejects.toThrow('batch');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects excessive encoded state without transmitting or leaking it', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new JevDecisionsClient().decideNoulBatch({ ...batch, state: { secret: 'management-secret'.repeat(5000) } }))
      .rejects.toThrow('batch request exceeds');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts 32 questions and maximum-length text without dropping criteria', async () => {
    const questions = Array.from({ length: 32 }, (_, index) => ({ ...batch.questions[0]!, questionId: `q${index}` }));
    questions[0] = { questionId: 'q'.repeat(64), instructions: 'i'.repeat(4096), criteria: { true: 't'.repeat(4096), false: 'f'.repeat(4096) } };
    const answers = Object.fromEntries(questions.map((question) => [question.questionId, { type: 'noul', noul: 0.5 }]));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ answers })));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new JevDecisionsClient().decideNoulBatch({ ...batch, questions });
    expect(Object.keys(result.answers)).toHaveLength(32);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).questions[questions[0].questionId].criteria).toEqual(questions[0].criteria);
  });

  it.each(['1e999', '-1e999'])('rejects nonfinite JSON probabilities (%s) for the whole batch', async (number) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`{"answers":{"tests":{"type":"noul","noul":0.8},"hydration":{"type":"noul","noul":${number}}}}`)));
    await expect(new JevDecisionsClient().decideNoulBatch(batch)).rejects.toThrow('invalid probability');
  });

  it('bounds UTF-8 bytes, not characters, and sanitizes nonserializable state', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new JevDecisionsClient();
    await expect(client.decideNoulBatch({ ...batch, state: { evidence: '界'.repeat(22_000) } })).rejects.toThrow('batch request exceeds');
    const circular: Record<string, unknown> = {};
    circular['management-secret'] = circular;
    await expect(client.decideNoulBatch({ ...batch, state: circular })).rejects.toThrow(/^Jev Decisions API request is not JSON serializable\.$/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fetch for an already-aborted caller and hides its reason', async () => {
    const controller = new AbortController();
    controller.abort(new Error('management-secret'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new JevDecisionsClient().decideNoulBatch({ ...batch, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError', message: 'Jev request aborted.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sanitizes network and provider failures without exposing secrets', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('management-secret shared snapshot'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new JevDecisionsClient().decideNoulBatch(batch)).rejects.toThrow(/^Jev Decisions API request failed\.$/);
    fetchMock.mockResolvedValue(new Response('management-secret', { status: 401 }));
    await expect(new JevDecisionsClient().decideNoulBatch(batch)).rejects.toThrow(/^Jev Decisions API returned HTTP status 401\.$/);
    fetchMock.mockResolvedValue(new Response('management-secret'.repeat(5000)));
    await expect(new JevDecisionsClient().decideNoulBatch(batch)).rejects.toThrow(/^Jev Decisions API returned invalid JSON\.$/);
  });

  it.each(['caller', 'timeout'] as const)('cancels stalled response bodies and cleans up on %s abort', async (source) => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const pending = new JevDecisionsClient().decideNoulBatch({ ...batch, signal: controller.signal });
      const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError', message: 'Jev request aborted.' });
      await Promise.resolve();
      await Promise.resolve();
      if (source === 'caller') controller.abort(new Error('management-secret'));
      else await vi.advanceTimersByTimeAsync(8000);
      await rejection;
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(stream.locked).toBe(false);
      expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
      expect(vi.getTimerCount()).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('calls a local Decisions endpoint with its model without an Authorization header or redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ answers: { approval: { type: 'noul', noul: 0.95 } } })));
    vi.stubGlobal('fetch', fetchMock);
    await new JevDecisionsClient().decideNoul({ ...connection, apiKey: '', endpoint: 'http://127.0.0.1:9090/decide', model: 'local-decision', questionId: 'approval', instructions: 'Allow?', state: {} });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9090/decide', expect.objectContaining({ redirect: 'error', headers: { 'Content-Type': 'application/json' } }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ model: 'local-decision' });
  });

  it('submits a pinned Jev decision and returns a validated noul probability', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      answers: { approval: { noul: 0.93, type: 'noul' } },
      model: 'typesafe/jev-1.13-20260917',
      usage: { input_tokens: 12, output_tokens: 3 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new JevDecisionsClient().decideNoul({ ...connection,
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

    await expect(new JevDecisionsClient().decideChoice({ ...connection,
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

    await expect(new JevDecisionsClient().decideNoul({ ...connection,
      apiKey: 'management-secret',
      questionId: 'approval',
      instructions: 'Should this operation be allowed?',
      state: {},
    })).rejects.toThrow('invalid probability');
  });

  it('rejects answers with a missing or mismatched decision type', async () => {
    const client = new JevDecisionsClient();
    const approvalInput = { ...connection,
      apiKey: 'management-secret',
      questionId: 'approval',
      instructions: 'Should this operation be allowed?',
      state: {},
    };
    const routeInput = { ...connection,
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
    const input = { ...connection,
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

  it('rejects oversized provider bodies without exposing them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret'.repeat(12_000))));
    await expect(new JevDecisionsClient().decideNoul({ ...connection, apiKey: 'key', questionId: 'approval', instructions: 'Allow?', state: {} })).rejects.toThrow('invalid JSON');
  });

  it('aborts a request after the fixed timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const pending = new JevDecisionsClient().decideNoul({ ...connection,
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

    const pending = new JevDecisionsClient().decideNoul({ ...connection,
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

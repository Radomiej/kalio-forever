import { describe, expect, it, vi } from 'vitest';
import { createSpeechApi, getLaunchSpeechScope, type SpeechScope } from './voiceApi';

const status = { status: 'ready', installed: true, model: 'parakeet-tdt-v3-int8', backend: 'sherpa-onnx-cpu',
  downloadedBytes: 100, totalBytes: 100, phase: null, errorCode: null, maxDurationSeconds: 60 };
const response = (value: unknown, code = 200) => new Response(JSON.stringify(value), { status: code });

describe('speech transport', () => {
  it('persists a real launch draft ID without inventing a session', () => {
    localStorage.removeItem('kalio.voice.launchDraftId.v1');
    const first = getLaunchSpeechScope();
    expect(first).toEqual({ draftId: expect.stringMatching(/^[A-Za-z0-9_-]{1,80}$/) });
    expect(getLaunchSpeechScope()).toEqual(first);
    expect(first).not.toHaveProperty('sessionId');
  });
  it('uploads exactly one draft scope and rejects a mixed-scope echo', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response({ requestId: 'req', draftId: 'launch', text: 'Hello', durationMs: 100 }));
    const api = createSpeechApi(fetcher);
    expect(await api.transcribe('req', { draftId: 'launch' }, new Blob(), new AbortController().signal)).toBe('Hello');
    const form = fetcher.mock.calls[0][1]!.body as FormData;
    expect(form.get('draftId')).toBe('launch'); expect(form.has('sessionId')).toBe(false);
    fetcher.mockImplementation(async () => response({ requestId: 'req', sessionId: 's1', draftId: 'launch', text: 'bad', durationMs: 100 }));
    await expect(api.transcribe('req', { draftId: 'launch' }, new Blob(), new AbortController().signal)).rejects.toThrow();
    await expect(api.transcribe('req', { sessionId: 's1', draftId: 'launch' } as unknown as SpeechScope, new Blob(), new AbortController().signal)).rejects.toThrow();
  });
  it('bootstraps only through the real auth endpoint after explicit 401', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(response(status));
    expect(await createSpeechApi(fetcher).status()).toMatchObject({ status: 'ready' });
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/decision/auth', expect.objectContaining({ method: 'POST', body: '{}', credentials: 'same-origin' }));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('never invents readiness for a missing endpoint or malformed response', async () => {
    await expect(createSpeechApi(vi.fn().mockResolvedValue(response({}, 404))).status()).rejects.toThrow();
    await expect(createSpeechApi(vi.fn().mockResolvedValue(response({ status: 'ready' }))).status()).rejects.toThrow();
  });
  it('sends multipart audio without a JSON Content-Type and validates request/session identity', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ requestId: 'req', sessionId: 's1', text: 'Hello', durationMs: 100 }));
    const api = createSpeechApi(fetcher);
    expect(await api.transcribe('req', { sessionId: 's1' }, new Blob(['wav']), new AbortController().signal)).toBe('Hello');
    const init = fetcher.mock.calls[0][1]!;
    expect(init.method).toBe('PUT'); expect(init.headers).toBeUndefined();
    expect((init.body as FormData).get('sessionId')).toBe('s1');
    expect((init.body as FormData).get('audio')).toBeInstanceOf(Blob);
    fetcher.mockResolvedValue(response({ requestId: 'wrong', sessionId: 's1', text: 'late', durationMs: 100 }));
    await expect(api.transcribe('req', { sessionId: 's1' }, new Blob(), new AbortController().signal)).rejects.toThrow();
  });
  it('uses the agreed install and cancellation PUT routes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response(status));
    const api = createSpeechApi(fetcher);
    await api.install(); await api.cancelInstall(); await api.cancel('req');
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/api/speech/install', '/api/speech/install/cancel', '/api/speech/transcriptions/req/cancel']);
    fetcher.mock.calls.forEach(([, options]) => expect(options).toMatchObject({ method: 'PUT', body: '{}', credentials: 'same-origin' }));
  });
});

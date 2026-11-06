import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DecisionAuthService } from '../../common/decision-auth.service';
import { DecisionAuthController } from '../../common/decision-auth.controller';
import { SpeechAuthGuard } from './speech-auth.guard';
import { SpeechController } from './speech.controller';
import { SpeechInferenceService } from './speech-inference.service';
import { SpeechInstallService } from './speech-install.service';
import { SPEECH_MAX_BYTES } from './speech-audio';

function wav(): Buffer {
  const bytes = Buffer.alloc(32044);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(32000, 40);
  return bytes;
}

describe('speech protected HTTP contract (fixture inference)', () => {
  let app: INestApplication;
  let origin: string;
  let cookie: string;
  const scopes = new Map<string, AbortController>();
  const inference = { transcribe: vi.fn(async () => 'fixture transcript'),
    reserve: vi.fn((id: string) => { const controller = new AbortController(); scopes.set(id, controller); return controller.signal; }),
    release: vi.fn((id: string) => { scopes.delete(id); }),
    cancel: vi.fn((id: string) => { scopes.get(id)?.abort(); return scopes.has(id); }) };
  const install = { status: vi.fn(async () => ({ status: 'missing', totalBytes: 679385601 })),
    installedRoot: vi.fn(async (): Promise<string | null> => '/fixture'), install: vi.fn(), cancel: vi.fn() };
  const headers = (extra: Record<string, string> = {}) => ({ origin, host: new URL(origin).host, cookie, ...extra });
  async function upload(id: string, bytes: Buffer = wav(), sessionId = 'session-A') {
    const form = new FormData(); form.set('sessionId', sessionId);
    form.set('audio', new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }), 'draft.wav');
    return fetch(`${origin}/api/speech/transcriptions/${id}`, { method: 'PUT', headers: headers(), body: form });
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [DecisionAuthController, SpeechController], providers: [
      { provide: DecisionAuthService, useFactory: () => new DecisionAuthService({
        PORT: '3016', KALIO_DECISION_FRONTEND_ORIGINS: origin,
      }) }, SpeechAuthGuard,
      { provide: SpeechInstallService, useValue: install }, { provide: SpeechInferenceService, useValue: inference },
    ] }).compile();
    // Auth origins are configured after reserving an ephemeral port, before app init.
    app = module.createNestApplication(); app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1'); origin = await app.getUrl();
    const auth = new DecisionAuthService({ PORT: '3016', KALIO_DECISION_FRONTEND_ORIGINS: origin });
    Object.assign(module.get(DecisionAuthService), auth);
    const response = await fetch(`${origin}/api/decision/auth`, { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: '{}' });
    expect(response.status).toBe(204);
    cookie = response.headers.get('set-cookie')!.split(';')[0];
  });
  afterAll(async () => { await app?.close(); });

  it('rejects missing capability and cross-origin callers before inference/install', async () => {
    const unauth = await fetch(`${origin}/api/speech/status`, { headers: headers({ cookie: '' }) });
    expect(unauth.status).toBe(401);
    const foreign = await fetch(`${origin}/api/speech/install`, { method: 'PUT', headers: headers({ origin: 'https://evil.invalid', 'content-type': 'application/json' }), body: '{}' });
    expect(foreign.status).toBe(403); expect(install.install).not.toHaveBeenCalled();
  });
  it('rejects wrong content type, unknown field, malformed audio, oversized upload', async () => {
    const json = await fetch(`${origin}/api/speech/transcriptions/json`, { method: 'PUT', headers: headers({ 'content-type': 'application/json' }), body: '{}' });
    expect(json.status).toBe(415);
    expect((await upload('malformed', Buffer.from('invalid'))).status).toBe(400);
    expect((await upload('oversized', Buffer.alloc(SPEECH_MAX_BYTES + 1))).status).toBe(413);
    expect((await upload('bad-session', wav(), '../outside')).status).toBe(400);
  });
  it('returns request/session binding and permits retries of the preserved original WAV', async () => {
    const original = wav();
    expect(await (await upload('attempt-1', original)).json()).toEqual({ requestId: 'attempt-1', sessionId: 'session-A', text: 'fixture transcript', durationMs: 1000 });
    expect(await (await upload('attempt-2', original, 'session-B')).json()).toMatchObject({ requestId: 'attempt-2', sessionId: 'session-B' });
    expect(original.equals(wav())).toBe(true);
    const passed = inference.transcribe.mock.calls.at(-1) as unknown as [string, string, Buffer];
    expect(passed[2].every((byte) => byte === 0)).toBe(true);
  });
  it('missing model returns recoverable error and leaves caller audio reusable', async () => {
    install.installedRoot.mockResolvedValueOnce(null);
    const original = wav();
    const response = await upload('missing-model', original);
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: 'SPEECH_NOT_INSTALLED' });
    expect(original.equals(wav())).toBe(true);
    expect((await upload('retry-ready', original)).status).toBe(200);
  });
  it('blocks concurrent uploads before buffering and scopes cancellation to request id', async () => {
    let finish!: (text: string) => void;
    inference.transcribe.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const first = upload('pending');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect((await upload('second')).status).toBe(409);
    const response = await fetch(`${origin}/api/speech/transcriptions/pending/cancel`, { method: 'PUT', headers: headers({ 'content-type': 'application/json' }), body: '{}' });
    expect(await response.json()).toEqual({ cancelled: true }); expect(inference.cancel).toHaveBeenCalledWith('pending');
    finish('fixture completed'); expect((await first).status).toBe(400);
  });
  it('cancels a request while root availability is pending and never starts inference', async () => {
    let finishRoot!: (root: string) => void;
    install.installedRoot.mockImplementationOnce(() => new Promise<string>((resolve) => { finishRoot = resolve; }));
    const count = inference.transcribe.mock.calls.length;
    const pending = upload('before-spawn');
    await vi.waitFor(() => expect(finishRoot).toBeTypeOf('function'));
    const response = await fetch(`${origin}/api/speech/transcriptions/before-spawn/cancel`, { method: 'PUT', headers: headers({ 'content-type': 'application/json' }), body: '{}' });
    expect(await response.json()).toEqual({ cancelled: true });
    finishRoot('/fixture');
    expect((await pending).status).toBe(400);
    expect(inference.transcribe.mock.calls.length).toBe(count);
    expect(scopes.has('before-spawn')).toBe(false);
    expect((await upload('retry-after-cancel')).status).toBe(200);
  });
  it('accepts a local launch draft without session creation and rejects ambiguous/absent/invalid scope', async () => {
    async function draftRequest(id: string, fields: Record<string, string>) {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      form.set('audio', new Blob([new Uint8Array(wav())], { type: 'audio/wav' }), 'draft.wav');
      return fetch(`${origin}/api/speech/transcriptions/${id}`, { method: 'PUT', headers: headers(), body: form });
    }
    const response = await draftRequest('local-attempt', { draftId: 'local-launch-123' });
    expect(await response.json()).toEqual({ requestId: 'local-attempt', draftId: 'local-launch-123', text: 'fixture transcript', durationMs: 1000 });
    expect((await draftRequest('both-scopes', { draftId: 'draft', sessionId: 'session' })).status).toBe(400);
    expect((await draftRequest('missing-scope', {})).status).toBe(400);
    expect((await draftRequest('invalid-scope', { draftId: '../outside' })).status).toBe(400);
    expect((await draftRequest('unknown-scope', { projectId: 'unknown' })).status).toBe(400);
  });
  it('disconnect while root availability is pending cancels and drains without spawning', async () => {
    let finishRoot!: (root: string) => void;
    install.installedRoot.mockImplementationOnce(() => new Promise<string>((resolve) => { finishRoot = resolve; }));
    const original = wav(); const form = new FormData(); form.set('draftId', 'durable-local');
    form.set('audio', new Blob([new Uint8Array(original)], { type: 'audio/wav' }), 'draft.wav');
    const abort = new AbortController(); const calls = inference.transcribe.mock.calls.length;
    const pending = fetch(`${origin}/api/speech/transcriptions/disconnect`, { method: 'PUT', headers: headers(), body: form, signal: abort.signal });
    await vi.waitFor(() => expect(finishRoot).toBeTypeOf('function'));
    abort.abort(); await expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(scopes.get('disconnect')?.signal.aborted).toBe(true));
    finishRoot('/fixture');
    await vi.waitFor(() => expect(scopes.has('disconnect')).toBe(false));
    expect(inference.transcribe.mock.calls.length).toBe(calls);
    expect(original.equals(wav())).toBe(true);
  });
});

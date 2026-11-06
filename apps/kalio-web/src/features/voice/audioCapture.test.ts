import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeSpeechWav, measureSpeechLevel, startSpeechCapture } from './audioCapture';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('speech WAV', () => {
  it('bounds a never-resolving permission request and cleans up a later grant', async () => {
    vi.useFakeTimers();
    let grant!: (stream: MediaStream) => void;
    const stop = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(() => new Promise<MediaStream>((resolve) => { grant = resolve; })) } });
    const promise = startSpeechCapture(new AbortController().signal, vi.fn());
    const failed = expect(promise).rejects.toThrow(/permissions|microphone|Chrome/);
    await vi.advanceTimersByTimeAsync(15000);
    await failed;
    grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
  });
  it('explains denied permission instead of leaving startup pending', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')) } });
    await expect(startSpeechCapture(new AbortController().signal, vi.fn())).rejects.toThrow(/Chrome|Allow/);
  });
  it('explains missing hardware and unavailable browser capture', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('Missing', 'NotFoundError')) } });
    await expect(startSpeechCapture(new AbortController().signal, vi.fn())).rejects.toThrow(/Connect/);
    vi.stubGlobal('navigator', {});
    await expect(startSpeechCapture(new AbortController().signal, vi.fn())).rejects.toThrow(/Chrome|HTTPS/);
  });
  it('distinguishes PCM silence from real RMS/peak signal', () => {
    expect(measureSpeechLevel(new Float32Array(128))).toEqual({ rms: 0, peak: 0, signal: false });
    expect(measureSpeechLevel(new Float32Array(128).fill(0.1))).toMatchObject({ signal: true });
    expect(measureSpeechLevel(new Float32Array(128).fill(0.001))).toMatchObject({ signal: false });
  });
  it('resamples actual 48kHz to a canonical 44-byte-header PCM16 mono WAV', async () => {
    // Node Blob supplies arrayBuffer in jsdom.
    const { Blob } = await import('node:buffer');
    vi.stubGlobal('Blob', Blob);
    const wav = encodeSpeechWav([new Float32Array(48000).fill(0.5)], 48000);
    const bytes = await wav.arrayBuffer();
    const view = new DataView(bytes);
    expect(bytes.byteLength).toBe(32044);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(bytes.slice(8, 16))).toBe('WAVEfmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(32000);
    expect(view.getInt16(44, true)).toBe(16384);
  });
  it('bounds the maximum payload and rejects oversized/empty recordings', () => {
    expect(encodeSpeechWav([new Float32Array(16000 * 60)], 16000).size).toBe(1920044);
    expect(() => encodeSpeechWav([], 48000)).toThrow();
    expect(() => encodeSpeechWav([new Float32Array(16000 * 60 + 1)], 16000)).toThrow();
  });
  it('stops a late granted microphone after cancellation without opening audio context', async () => {
    const stop = vi.fn();
    let grant!: (value: MediaStream) => void;
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => { grant = resolve; }));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const context = vi.fn(); vi.stubGlobal('AudioContext', context);
    const controller = new AbortController();
    const promise = startSpeechCapture(controller.signal, vi.fn());
    const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce(); expect(context).not.toHaveBeenCalled();
  });
  it('explains an embedded Permissions Policy block without requesting capture', async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('document', { permissionsPolicy: { allowsFeature: () => false } });
    await expect(startSpeechCapture(new AbortController().signal, vi.fn())).rejects.toThrow(/Chrome|Edge/);
    expect(getUserMedia).not.toHaveBeenCalled();
  });
  it('releases tracks and context on stop and cancellation', async () => {
    const stop = vi.fn(); const close = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn(); const port = { onmessage: null, close: vi.fn() };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) } });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:capture'), revokeObjectURL: vi.fn() });
    vi.stubGlobal('AudioContext', class {
      sampleRate = 48000; state = 'running'; destination = {};
      audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
      createMediaStreamSource() { return { connect: vi.fn(), disconnect }; }
      resume = vi.fn().mockResolvedValue(undefined); close = close;
    });
    vi.stubGlobal('AudioWorkletNode', class { port = port; connect = vi.fn(); disconnect = disconnect; });
    const controller = new AbortController();
    const capture = await startSpeechCapture(controller.signal, vi.fn());
    const receive = port.onmessage as unknown as (event: { data: Float32Array }) => void;
    receive({ data: new Float32Array(4800) });
    expect((await capture.stop()).size).toBe(3244);
    controller.abort(); await capture.dispose();
    expect(stop).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
    expect(port.close).toHaveBeenCalledOnce(); expect(port.onmessage).toBeNull();
  });
});

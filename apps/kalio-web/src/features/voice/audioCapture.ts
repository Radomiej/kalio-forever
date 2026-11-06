const RATE = 16000;
const MAX_SECONDS = 60;
const PERMISSION_WAIT_MS = 15000;

function permissionMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotFoundError') return 'No microphone found. Connect one and try again.';
  if (name === 'NotReadableError') return 'Microphone busy. Close other apps and try again.';
  return 'Allow microphone access in browser and Windows settings. Try Chrome or Edge.';
}

function requestMicrophone(signal: AbortSignal): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const policy = (document as Document & { permissionsPolicy?: { allowsFeature: (feature: string) => boolean } }).permissionsPolicy;
    if (!navigator.mediaDevices?.getUserMedia || globalThis.isSecureContext === false || policy?.allowsFeature('microphone') === false) {
      reject(new Error('Microphone unavailable. Open Kalio in Chrome or Edge on localhost or HTTPS.')); return;
    }
    let finished = false;
    const finish = (error?: Error, stream?: MediaStream) => {
      if (finished) { stream?.getTracks().forEach((track) => track.stop()); return; }
      finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (error) reject(error); else if (stream) resolve(stream);
    };
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Microphone timed out. Check permissions or try Chrome or Edge.')), PERMISSION_WAIT_MS);
    signal.addEventListener('abort', abort, { once: true });
    // This request must execute in the click stack, before database/network awaits.
    try { navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => finish(undefined, stream), (error: unknown) => finish(new Error(permissionMessage(error)))); }
    catch (error) { finish(new Error(permissionMessage(error))); }
  });
}

function waitForAudioSetup(promise: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (error?: Error) => {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => done(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => done(new Error('Audio setup failed. Try Chrome or Edge.')), PERMISSION_WAIT_MS);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    promise.then(() => done(), () => done(new Error('Audio blocked. Check site permissions and try again.')));
  });
}

export function encodeSpeechWav(chunks: Float32Array[], inputRate: number): Blob {
  if (!Number.isFinite(inputRate) || inputRate < RATE) throw new Error('Unsupported microphone sample rate.');
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (!length || length > inputRate * MAX_SECONDS) throw new Error('Audio must be between 0 and 60 seconds.');
  const input = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length; }
  const count = Math.floor(length * RATE / inputRate);
  if (!count) throw new Error('Recording is too short.');
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, count * 2, true);
  // Integrate each output interval instead of trusting getUserMedia's sample-rate constraint.
  const ratio = inputRate / RATE;
  for (let i = 0; i < count; i++) {
    const start = i * ratio;
    const end = (i + 1) * ratio;
    let sum = 0;
    for (let j = Math.floor(start); j < Math.ceil(end); j++) {
      sum += (input[j] ?? 0) * (Math.min(end, j + 1) - Math.max(start, j));
    }
    const sample = Math.max(-1, Math.min(1, sum / ratio));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  input.fill(0);
  return new Blob([buffer], { type: 'audio/wav' });
}

const WORKLET = `class SpeechCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0];
    if (channels && channels.length) {
      const mono = new Float32Array(channels[0].length);
      for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
      this.port.postMessage(mono, [mono.buffer]);
    }
    return true;
  }
}
registerProcessor('kalio-speech-capture', SpeechCapture);`;

export interface SpeechCapture {
  stop: () => Promise<Blob>;
  dispose: () => Promise<void>;
}

export function measureSpeechLevel(pcm: Float32Array) {
  let sum = 0; let peak = 0;
  for (const value of pcm) { sum += value * value; peak = Math.max(peak, Math.abs(value)); }
  const rms = pcm.length ? Math.sqrt(sum / pcm.length) : 0;
  return { rms, peak, signal: rms >= 0.01 || peak >= 0.05 };
}

export async function startSpeechCapture(signal: AbortSignal, onLimit: () => void,
  onPcm?: (pcm: Float32Array, sampleRate: number) => void, onError?: (message: string) => void): Promise<SpeechCapture> {
  const stream = await requestMicrophone(signal);
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let samples = 0;
  let disposed = false;
  let chunks: Float32Array[] = [];
  const ended = () => { if (!disposed) onError?.('Microphone disconnected.'); };
  stream.getTracks().forEach((track) => track.addEventListener?.('ended', ended));
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    stream.getTracks().forEach((track) => { track.removeEventListener?.('ended', ended); track.stop(); });
    if (node) { node.port.onmessage = null; node.port.close(); node.disconnect(); }
    source?.disconnect();
    chunks.forEach((chunk) => chunk.fill(0)); chunks = [];
    signal.removeEventListener('abort', abort);
    if (context && context.state !== 'closed') await context.close();
  };
  const abort = () => { void dispose().catch(() => { console.warn('Speech microphone context close failed during cancellation.'); }); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    context = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    try { await waitForAudioSetup(context.audioWorklet.addModule(url), signal); } finally { URL.revokeObjectURL(url); }
    if (signal.aborted || disposed) throw new DOMException('Cancelled', 'AbortError');
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, 'kalio-speech-capture');
    const rate = context.sampleRate;
    node.port.onmessage = (event: MessageEvent<unknown>) => {
      if (disposed || !(event.data instanceof Float32Array)) return;
      const remaining = rate * MAX_SECONDS - samples;
      if (remaining <= 0) return;
      const chunk = event.data.slice(0, remaining);
      chunks.push(chunk); samples += chunk.length;
      onPcm?.(chunk, rate);
      if (samples >= rate * MAX_SECONDS) onLimit();
    };
    source.connect(node); node.connect(context.destination);
    await waitForAudioSetup(context.resume(), signal);
    if (signal.aborted || disposed) throw new DOMException('Cancelled', 'AbortError');
    timer = setTimeout(onLimit, MAX_SECONDS * 1000);
    return {
      dispose,
      stop: async () => {
        try { return encodeSpeechWav(chunks, rate); } finally { await dispose(); }
      },
    };
  } catch (error) { await dispose(); throw error; }
}

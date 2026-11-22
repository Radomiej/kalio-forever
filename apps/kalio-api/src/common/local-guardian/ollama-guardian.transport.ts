import type { LocalGuardianTransport } from './local-guardian.types';

export const MAX_GUARDIAN_RESPONSE_BYTES = 16_384;

/** Also bounds transports/readers that do not implement AbortSignal themselves. */
export async function guardianAbortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('Local guardian request aborted.'));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try { return await Promise.race([pending, aborted]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

export class OllamaGuardianFetchTransport implements LocalGuardianTransport {
  constructor(private readonly fetcher: typeof fetch = globalThis.fetch) {}

  async post(endpoint: string, body: string, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const response = await this.fetcher(endpoint, {
      method: 'POST', redirect: 'error', credentials: 'omit',
      headers: { 'Content-Type': 'application/json' }, body, signal,
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error('Local guardian transport failed.');
    }
    const reader = response.body.getReader();
    let complete = false;
    try {
      let bytes = 0;
      let text = '';
      const decoder = new TextDecoder('utf-8', { fatal: true });
      while (true) {
        const chunk = await guardianAbortable(reader.read(), signal);
        if (chunk.done) { complete = true; break; }
        bytes += chunk.value.byteLength;
        if (bytes > MAX_GUARDIAN_RESPONSE_BYTES) throw new Error('Local guardian response too large.');
        text += decoder.decode(chunk.value, { stream: true });
      }
      return JSON.parse(text + decoder.decode()) as unknown;
    } finally {
      try { if (!complete) await reader.cancel(); }
      finally { reader.releaseLock(); }
    }
  }
}

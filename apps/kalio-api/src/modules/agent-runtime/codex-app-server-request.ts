import type { CodexAppServerProtocolRouter } from './codex-app-server.host';

/** Own one local request's pending entry and cancellation subscription. */
export function sendCodexAppServerRequest(
  router: Pick<CodexAppServerProtocolRouter, 'registerPending' | 'removePending'>,
  id: string,
  method: string,
  params: unknown,
  write: (message: string, callback: (error?: Error | null) => void) => unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): boolean => {
      if (settled) return false;
      settled = true;
      router.removePending(id);
      signal?.removeEventListener('abort', onAbort);
      return true;
    };
    const fail = (error: unknown): void => {
      if (cleanup()) reject(error);
    };
    const onAbort = (): void => fail(signal?.reason);
    router.registerPending(id, {
      resolve: (value) => { if (cleanup()) resolve(value); },
      reject: fail,
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (error) fail(error);
      });
    } catch (error: unknown) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

import { KalioSDK } from '@kalio/sdk';
import { resolvePairedBackendOrigin } from './backendOrigin';
import { readRuntimeConfig } from './runtimeConfig';

function resolveWsUrl(): string {
  const pairedBackendOrigin = resolvePairedBackendOrigin(globalThis.location);
  if (pairedBackendOrigin) {
    return pairedBackendOrigin;
  }

  const runtimeWsUrl = readRuntimeConfig()?.wsUrl;
  if (runtimeWsUrl) {
    return runtimeWsUrl;
  }

  const configured = import.meta.env['VITE_WS_URL'] as string | undefined;
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim();
  }

  if (typeof globalThis !== 'undefined' && globalThis.location) {
    return globalThis.location.origin;
  }

  return 'http://localhost:3016';
}

const wsUrl = resolveWsUrl();

export const eventBus = new KalioSDK({ wsUrl });

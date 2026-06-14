import { KalioSDK } from '@kalio/sdk';

const FRONTEND_BACKEND_PORT_PAIRS = new Map<string, string>([
  ['5188', '3016'],
  ['5288', '3316'],
  ['6188', '4016'],
]);

function resolveWsUrl(): string {
  const configured = import.meta.env['VITE_WS_URL'] as string | undefined;
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim();
  }

  if (typeof globalThis !== 'undefined' && globalThis.location) {
    const { hostname, origin, port, protocol } = globalThis.location;
    const backendPort = FRONTEND_BACKEND_PORT_PAIRS.get(port);
    if (backendPort) {
      return `${protocol}//${hostname}:${backendPort}`;
    }
    return origin;
  }

  return 'http://localhost:3016';
}

const wsUrl = resolveWsUrl();

export const eventBus = new KalioSDK({ wsUrl });

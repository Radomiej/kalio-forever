import { KalioSDK } from '@kalio/sdk';

const wsUrl = import.meta.env['VITE_WS_URL'] as string ?? 'http://localhost:3016';

export const eventBus = new KalioSDK({ wsUrl });

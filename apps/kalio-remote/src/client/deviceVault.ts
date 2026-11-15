import { Capacitor, registerPlugin } from '@capacitor/core';
import { isRecord } from '../protocol';
import { relayOrigin, type PairReply } from './RelayClient';

export type SavedHost = { relayUrl: string; pair: PairReply; name?: string; alias?: string };

const vault = registerPlugin<{
  read(): Promise<{ value: string }>;
  write(input: { value: string }): Promise<void>;
}>('RemoteVault');

export const canSaveHosts = Capacitor.getPlatform() === 'android';

export async function readSavedHosts(): Promise<SavedHost[]> {
  if (!canSaveHosts) return [];
  const { value } = await vault.read();
  const raw: unknown = JSON.parse(value);
  if (!Array.isArray(raw) || raw.length > 64) throw new Error('Invalid host vault');
  return raw.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.relayUrl !== 'string' || !isRecord(entry.pair)) throw new Error('Invalid host entry');
    const { v, instanceId, deviceId, token } = entry.pair;
    if (v !== 1 || typeof instanceId !== 'string' || typeof deviceId !== 'string' || typeof token !== 'string' || !token) throw new Error('Invalid host credential');
    return {
      relayUrl: relayOrigin(entry.relayUrl), pair: { v, instanceId, deviceId, token },
      name: typeof entry.name === 'string' ? entry.name : undefined,
      alias: typeof entry.alias === 'string' ? entry.alias : undefined,
    };
  });
}

export async function saveHosts(hosts: readonly SavedHost[]): Promise<void> {
  if (canSaveHosts) await vault.write({ value: JSON.stringify(hosts) });
}

import type {
  MCPServer,
  MCPServerEffectiveState,
  MCPServerOriginSource,
  MCPServerStore,
} from '@kalio/types';

type LegacyManagedBy = 'toml';

export type SettingsMCPServer = Omit<MCPServer, 'serverKey' | 'store' | 'originSource' | 'effectiveState' | 'conflictGroup'> & {
  serverKey: MCPServer['serverKey'];
  store?: MCPServer['store'];
  originSource?: MCPServer['originSource'];
  effectiveState?: MCPServer['effectiveState'];
  conflictGroup?: MCPServer['conflictGroup'] | null;
  managedBy?: LegacyManagedBy;
};

export interface SettingsMCPServerRow extends Omit<MCPServer, 'conflictGroup'> {
  serverKey: string;
  store: MCPServerStore;
  originSource: MCPServerOriginSource;
  effectiveState: MCPServerEffectiveState;
  conflictGroup: string | null;
  rowKey: string;
  testIdSuffix: string;
  readonly: boolean;
}

function normalizeStore(server: SettingsMCPServer): MCPServerStore {
  if (server.store === 'toml' || server.store === 'sqlite') {
    return server.store;
  }
  return server.managedBy === 'toml' ? 'toml' : 'sqlite';
}

function normalizeOriginSource(server: SettingsMCPServer, store: MCPServerStore): MCPServerOriginSource {
  if (server.originSource) {
    return server.originSource;
  }
  return store === 'toml' ? 'toml' : 'manual';
}

function normalizeEffectiveState(
  server: SettingsMCPServer,
  _store: MCPServerStore,
): MCPServerEffectiveState {
  if (server.effectiveState) {
    return server.effectiveState;
  }
  return 'active';
}

function normalizeConflictGroup(server: SettingsMCPServer, serverKey: string): string | null {
  if (typeof server.conflictGroup === 'string' && server.conflictGroup.trim().length > 0) {
    return server.conflictGroup.trim();
  }
  void serverKey;
  return null;
}

function sanitizeForTestId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

export function normalizeSettingsServer(server: SettingsMCPServer): SettingsMCPServerRow {
  const store = normalizeStore(server);
  const serverKey = server.serverKey.trim();
  const originSource = normalizeOriginSource(server, store);
  const effectiveState = normalizeEffectiveState(server, store);
  const conflictGroup = normalizeConflictGroup(server, serverKey);
  const testIdSuffix = sanitizeForTestId(`${serverKey}-${store}`);

  return {
    ...server,
    serverKey,
    store,
    originSource,
    effectiveState,
    conflictGroup,
    rowKey: `${serverKey}:${store}:${server.id}`,
    testIdSuffix,
    readonly: store === 'toml',
  };
}

export function normalizeSettingsServers(servers: SettingsMCPServer[]): SettingsMCPServerRow[] {
  return [...servers]
    .map(normalizeSettingsServer)
    .sort((left, right) => {
      const leftGroup = left.conflictGroup ?? left.serverKey;
      const rightGroup = right.conflictGroup ?? right.serverKey;
      const groupCompare = leftGroup.localeCompare(rightGroup);
      if (groupCompare !== 0) {
        return groupCompare;
      }

      if (left.serverKey !== right.serverKey) {
        return left.serverKey.localeCompare(right.serverKey);
      }

      if (left.store !== right.store) {
        const storeOrder = (value: MCPServerStore): number => {
          if (value === 'toml') return 0;
          if (value === 'sqlite') return 1;
          return 2;
        };
        return storeOrder(left.store) - storeOrder(right.store) || left.store.localeCompare(right.store);
      }

      if (left.name !== right.name) {
        return left.name.localeCompare(right.name);
      }

      return left.id.localeCompare(right.id);
    });
}

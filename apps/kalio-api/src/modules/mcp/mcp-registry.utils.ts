import { createHash } from 'node:crypto';
import type {
  CreateMCPServerDto,
  MCPServer,
  MCPServerEffectiveState,
  MCPServerOriginSource,
  MCPServerStore,
} from '@kalio/types';

export interface MCPRegistryComparableConfig {
  transport: 'stdio' | 'http';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface MCPRegistryEntryMeta extends MCPRegistryComparableConfig {
  id: string;
  serverKey: string;
  name: string;
  store: MCPServerStore;
  originSource: MCPServerOriginSource;
  createdAt: number;
}

export interface MCPResolvedRegistryEntry extends MCPRegistryEntryMeta {
  effectiveState: MCPServerEffectiveState;
  conflictGroup?: string;
  signature: string;
}

const STORE_PRIORITY: Record<MCPServerStore, number> = {
  toml: 0,
  sqlite: 1,
};

export function buildServerKey(store: MCPServerStore, id: string): string {
  return `${store}::${id}`;
}

export function parseServerKey(serverKey: string): { store: MCPServerStore; id: string } | null {
  if (serverKey.startsWith('toml::')) {
    return { store: 'toml', id: serverKey.slice('toml::'.length) };
  }
  if (serverKey.startsWith('sqlite::')) {
    return { store: 'sqlite', id: serverKey.slice('sqlite::'.length) };
  }
  return null;
}

export function makeMcpServerId(dto: CreateMCPServerDto): string {
  const normalized = {
    name: dto.name.trim(),
    transport: dto.transport ?? 'http',
    url: dto.url?.trim() ?? null,
    command: dto.command?.trim() ?? null,
    args: (dto.args ?? []).map((arg) => arg.trim()),
    env: sortDictionary(dto.env),
    headers: sortDictionary(dto.headers),
    originSource: dto.originSource ?? 'manual',
  };

  const name = dto.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  const suffix = createHash('sha256').update(JSON.stringify(normalized)).digest('base64url').slice(0, 10);
  return `${name || 'mcp-server'}-${suffix}`;
}

export function buildMcpSignature(config: MCPRegistryComparableConfig): string {
  const context = `env:${stableRecordSignature(config.env)}:headers:${stableRecordSignature(config.headers)}`;
  if (config.transport === 'http') {
    return `http:${config.url ?? ''}:${context}`;
  }
  return `stdio:${config.command ?? ''}:${(config.args ?? []).join('\u0000')}:${context}`;
}

export function buildMcpSignatureFromServer(
  server: Pick<MCPServer, 'transport' | 'url' | 'command' | 'args'> & Partial<Pick<CreateMCPServerDto, 'env' | 'headers'>>,
): string {
  return buildMcpSignature(server);
}

export function buildMcpSignatureFromDto(dto: Pick<CreateMCPServerDto, 'transport' | 'url' | 'command' | 'args' | 'env' | 'headers'>): string {
  return buildMcpSignature(dto);
}

function stableRecordSignature(record: Record<string, string> | undefined): string {
  if (!record || Object.keys(record).length === 0) {
    return '';
  }
  return JSON.stringify(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function sortDictionary(input?: Record<string, string>): Record<string, string> | null {
  if (!input || Object.keys(input).length === 0) {
    return null;
  }
  return Object.keys(input)
    .sort()
    .reduce((acc, key) => {
      acc[key] = input[key];
      return acc;
    }, {} as Record<string, string>);
}

export function resolveRegistryEntries(entries: MCPRegistryEntryMeta[]): MCPResolvedRegistryEntry[] {
  const bySignature = new Map<string, MCPRegistryEntryMeta[]>();
  for (const entry of entries) {
    const signature = buildMcpSignature(entry);
    const current = bySignature.get(signature) ?? [];
    current.push(entry);
    bySignature.set(signature, current);
  }

  const resolved: MCPResolvedRegistryEntry[] = [];
  for (const [signature, group] of bySignature) {
    const sorted = [...group].sort((left, right) => {
      const storeCmp = STORE_PRIORITY[left.store] - STORE_PRIORITY[right.store];
      if (storeCmp !== 0) return storeCmp;
      const createdCmp = left.createdAt - right.createdAt;
      if (createdCmp !== 0) return createdCmp;
      return left.serverKey.localeCompare(right.serverKey);
    });
    const conflictGroup = sorted.length > 1 ? signature : undefined;
    for (const [index, entry] of sorted.entries()) {
      resolved.push({
        ...entry,
        signature,
        conflictGroup,
        effectiveState: index === 0 ? 'active' : 'shadowed',
      });
    }
  }

  return resolved.sort((left, right) => {
    if (left.effectiveState !== right.effectiveState) {
      return left.effectiveState === 'active' ? -1 : 1;
    }
    const storeCmp = STORE_PRIORITY[left.store] - STORE_PRIORITY[right.store];
    if (storeCmp !== 0) return storeCmp;
    return left.name.localeCompare(right.name) || left.serverKey.localeCompare(right.serverKey);
  });
}

import { describe, expect, it } from 'vitest';
import {
  buildMcpSignature,
  resolveRegistryEntries,
  type MCPRegistryEntryMeta,
} from './mcp-registry.utils';

function registryEntry(entry: Partial<MCPRegistryEntryMeta> & Pick<MCPRegistryEntryMeta, 'serverKey'>): MCPRegistryEntryMeta {
  return {
    id: entry.serverKey,
    serverKey: entry.serverKey,
    name: entry.serverKey,
    store: entry.store ?? 'sqlite',
    originSource: entry.originSource ?? 'manual',
    createdAt: entry.createdAt ?? 1,
    transport: entry.transport ?? 'http',
    url: entry.url ?? 'https://mcp.example.com',
    command: entry.command,
    args: entry.args,
    env: entry.env,
    headers: entry.headers,
  };
}

describe('mcp-registry.utils', () => {
  it('keeps same-endpoint HTTP servers active when headers differ', () => {
    const resolved = resolveRegistryEntries([
      registryEntry({
        serverKey: 'toml::docs',
        store: 'toml',
        originSource: 'toml',
        headers: { Authorization: 'Bearer a' },
      }),
      registryEntry({
        serverKey: 'sqlite::docs',
        store: 'sqlite',
        headers: { Authorization: 'Bearer b' },
      }),
    ]);

    expect(resolved.map((entry) => [entry.serverKey, entry.effectiveState])).toEqual([
      ['toml::docs', 'active'],
      ['sqlite::docs', 'active'],
    ]);
    expect(new Set(resolved.map((entry) => entry.signature)).size).toBe(2);
  });

  it('keeps same-command stdio servers active when env differs', () => {
    const resolved = resolveRegistryEntries([
      registryEntry({
        serverKey: 'toml::local',
        store: 'toml',
        originSource: 'toml',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { TOKEN: 'a' },
      }),
      registryEntry({
        serverKey: 'sqlite::local',
        store: 'sqlite',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { TOKEN: 'b' },
      }),
    ]);

    expect(resolved.map((entry) => [entry.serverKey, entry.effectiveState])).toEqual([
      ['toml::local', 'active'],
      ['sqlite::local', 'active'],
    ]);
  });

  it('shadows duplicate servers only when endpoint and auth context match', () => {
    const resolved = resolveRegistryEntries([
      registryEntry({
        serverKey: 'toml::docs',
        store: 'toml',
        originSource: 'toml',
        headers: { Authorization: 'Bearer same' },
      }),
      registryEntry({
        serverKey: 'sqlite::docs',
        store: 'sqlite',
        headers: { Authorization: 'Bearer same' },
      }),
    ]);

    expect(resolved.map((entry) => [entry.serverKey, entry.effectiveState])).toEqual([
      ['toml::docs', 'active'],
      ['sqlite::docs', 'shadowed'],
    ]);
    expect(resolved[0]?.conflictGroup).toBe(resolved[1]?.conflictGroup);
  });

  it('normalizes header and env key order in signatures', () => {
    const left = buildMcpSignature({
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { B: 'two', A: 'one' },
      headers: { Z: 'last', A: 'first' },
    });
    const right = buildMcpSignature({
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { A: 'one', B: 'two' },
      headers: { A: 'first', Z: 'last' },
    });

    expect(left).toBe(right);
  });
});

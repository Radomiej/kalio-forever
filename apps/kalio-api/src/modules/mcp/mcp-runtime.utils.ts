import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type {
  MCPServerOriginSource,
  MCPServerStore,
  MCPTool,
} from '@kalio/types';
import type { KalioMcpServerConfig } from '../../config/kalio-config.types';
import { mcpServers } from '../../database/schema';
import {
  buildMcpSignature,
  buildServerKey,
} from './mcp-registry.utils';

type MCPServerRow = typeof mcpServers.$inferSelect;

export interface ServerHandle {
  serverKey: string;
  id: string;
  name: string;
  store: MCPServerStore;
  originSource: MCPServerOriginSource;
  transport: 'stdio' | 'http';
  url?: string;
  command?: string;
  args?: string[];
  envVars?: Record<string, string>;
  headers?: Record<string, string>;
  client: Client;
  rawTransport: Transport | null;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  tools: MCPTool[];
  restartCount: number;
  createdAt: number;
  enabled: boolean;
  lastError?: string;
  permanentError?: boolean;
  managed?: boolean;
  signature: string;
}

export function configToMcpHandle(
  id: string,
  server: KalioMcpServerConfig,
): ServerHandle {
  const serverKey = buildServerKey('toml', id);
  const envVars = resolveEnv(server);
  const headers = resolveHeaders(server);
  return {
    id,
    serverKey,
    name: id,
    store: 'toml',
    originSource: 'toml',
    transport: server.url ? 'http' : 'stdio',
    url: server.url,
    command: server.command,
    args: server.args,
    envVars,
    headers,
    client: null as unknown as Client,
    rawTransport: null,
    status: 'disconnected',
    tools: [],
    restartCount: 0,
    createdAt: 0,
    enabled: server.enabled !== false,
    managed: true,
    signature: buildMcpSignature({
      transport: server.url ? 'http' : 'stdio',
      url: server.url,
      command: server.command,
      args: server.args,
      env: envVars,
      headers,
    }),
  };
}

export function createMcpTransport(handle: ServerHandle): Transport {
  if (handle.transport === 'stdio') {
    if (!handle.command) throw new Error('stdio transport requires command');
    return new StdioClientTransport({
      command: handle.command,
      args: handle.args ?? [],
      env: { ...process.env, ...(handle.envVars ?? {}) } as Record<string, string>,
    });
  }
  if (!handle.url) throw new Error('http transport requires url');
  return new StreamableHTTPClientTransport(new URL(handle.url), {
    requestInit: { headers: handle.headers ?? {} },
  });
}

export function rowToMcpHandle(row: MCPServerRow): ServerHandle {
  const transport = (row.transport as 'stdio' | 'http') ?? 'http';
  const url = row.url ?? undefined;
  const command = row.command ?? undefined;
  const args = row.args ?? undefined;
  const envVars = row.envVars ?? undefined;
  const headers = row.headers ?? undefined;
  return {
    id: row.id,
    serverKey: buildServerKey('sqlite', row.id),
    name: row.name,
    store: 'sqlite',
    originSource: row.originSource ?? 'manual',
    transport,
    url,
    command,
    args,
    envVars,
    headers,
    client: null as unknown as Client,
    rawTransport: null,
    status: 'disconnected',
    tools: [],
    restartCount: 0,
    createdAt: row.createdAt instanceof Date
      ? row.createdAt.getTime()
      : (row.createdAt as number),
    enabled: row.enabled ?? true,
    signature: buildMcpSignature({
      transport,
      url,
      command,
      args,
      env: envVars,
      headers,
    }),
  };
}

function resolveEnv(
  server: KalioMcpServerConfig,
): Record<string, string> | undefined {
  const env: Record<string, string> = { ...(server.env ?? {}) };
  for (const entry of server.env_vars ?? []) {
    const name = typeof entry === 'string' ? entry : entry.name;
    const source = typeof entry === 'string' ? 'local' : entry.source;
    if (source !== 'local') continue;
    const value = process.env[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

function resolveHeaders(
  server: KalioMcpServerConfig,
): Record<string, string> | undefined {
  const headers: Record<string, string> = { ...(server.http_headers ?? {}) };
  for (const [header, envName] of Object.entries(server.env_http_headers ?? {})) {
    const value = process.env[envName];
    if (value !== undefined) {
      headers[header] = value;
    }
  }
  if (server.bearer_token_env_var) {
    const token = process.env[server.bearer_token_env_var];
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

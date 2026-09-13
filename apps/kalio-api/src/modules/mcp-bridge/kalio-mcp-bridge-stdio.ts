import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:3016/api/mcp/bridge';

async function main(): Promise<void> {
  const token = requiredEnv('KALIO_MCP_BRIDGE_TOKEN');
  const bridgeUrl = process.env['KALIO_MCP_BRIDGE_URL']?.trim() || DEFAULT_BRIDGE_URL;
  const remoteTransport = new StreamableHTTPClientTransport(new URL(bridgeUrl), {
    requestInit: { headers: buildHeaders(token) },
  });
  const remote = new Client({ name: 'kalio-devin-stdio-proxy', version: '1.0.0' });
  await remote.connect(remoteTransport);

  const server = new Server(
    { name: 'kalio-devin-stdio-proxy', version: '1.0.0' },
    { capabilities: { tools: { listChanged: false } }, instructions: 'Kalio tools remain scoped and authorized by the Kalio bridge.' },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const result = await remote.listTools();
    return { tools: result.tools as Tool[] };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await remote.callTool(request.params);
    return result as CallToolResult;
  });

  const stdio = new StdioServerTransport();
  await server.connect(stdio);
  await new Promise<void>((resolve) => {
    process.stdin.once('end', resolve);
    process.stdin.once('close', resolve);
  });
  await remoteTransport.close();
}

function buildHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'x-kalio-session-id': requiredEnv('KALIO_MCP_BRIDGE_SESSION_ID'),
  };
  addHeader(headers, 'x-kalio-vfs-session-id', process.env['KALIO_MCP_BRIDGE_VFS_SESSION_ID']);
  addHeader(headers, 'x-kalio-tool-names', process.env['KALIO_MCP_BRIDGE_TOOL_NAMES']);
  addHeader(headers, 'x-kalio-bridge-client', process.env['KALIO_MCP_BRIDGE_CLIENT']);
  return headers;
}

function addHeader(headers: Record<string, string>, name: string, value: string | undefined): void {
  if (value?.trim()) headers[name] = value.trim();
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

void main().catch((error: unknown) => {
  process.stderr.write(`Kalio MCP stdio proxy failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

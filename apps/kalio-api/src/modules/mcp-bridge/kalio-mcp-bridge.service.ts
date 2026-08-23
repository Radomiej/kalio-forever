import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolMeta, ToolResult } from '@kalio/types';
import { ToolDispatchService } from '../chat/tool-dispatch.service';
import { TurnState } from '../chat/turn-state';
import type { StreamContext } from '../chat/interfaces/stream-context.interface';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isKalioMcpBridgeEnabled } from '../../common/kalio-mcp-bridge-config';

const BLOCKED_CHILD_TOOL_NAMES = new Set([
  'run_cli_agent',
  'spawn_cli_agent',
  'message_cli_agent',
  'get_cli_agent_status',
  'stop_cli_agent',
  'run_subagent',
  'spawn_subagent',
  'message_subagent',
  'run_sub_agentflow',
]);

interface BridgeContext {
  sessionId: string;
  vfsSessionId?: string;
  turnId?: string;
  promptMessageId?: string;
  allowedToolNames?: ReadonlySet<string>;
}

interface BridgeConnection {
  id: string;
  context: BridgeContext;
  server: Server;
  transport: StreamableHTTPServerTransport;
  sessionId?: string;
  connected: boolean;
}

export class KalioMcpBridgeHttpError extends Error {
  constructor(
    readonly statusCode: 401 | 403 | 404 | 503,
    message: string,
  ) {
    super(message);
    this.name = 'KalioMcpBridgeHttpError';
  }
}

/**
 * Exposes Kalio's existing native tool dispatcher through MCP Streamable HTTP.
 * This is deliberately separate from MCPService: MCPService is the client for
 * external servers, while this service is the server-facing interoperability boundary.
 */
@Injectable()
export class KalioMcpBridgeService {
  private readonly connections = new Map<string, BridgeConnection>();
  private readonly token = process.env['KALIO_MCP_BRIDGE_TOKEN']?.trim();

  constructor(private readonly toolDispatch: ToolDispatchService) {}

  async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    parsedBody?: unknown,
  ): Promise<void> {
    this.authorize(request.headers);

    const requestedSessionId = headerValue(request.headers, 'mcp-session-id');
    let connection = requestedSessionId ? this.connections.get(requestedSessionId) : undefined;
    if (requestedSessionId && !connection) {
      throw new KalioMcpBridgeHttpError(404, 'Unknown MCP bridge session.');
    }

    if (!connection) {
      connection = this.createConnection(request.headers);
    }

    if (!connection.connected) {
      connection.connected = true;
      try {
        await connection.server.connect(connection.transport);
      } catch (error) {
        connection.connected = false;
        throw error;
      }
    }

    await connection.transport.handleRequest(request, response, parsedBody);
  }

  authorize(headers: IncomingHttpHeaders): void {
    if (!this.token || !isKalioMcpBridgeEnabled()) {
      throw new KalioMcpBridgeHttpError(
        503,
        'Kalio MCP bridge is disabled. Configure KALIO_MCP_BRIDGE_TOKEN.',
      );
    }

    const authorization = headerValue(headers, 'authorization');
    if (authorization !== `Bearer ${this.token}`) {
      throw new KalioMcpBridgeHttpError(401, 'Unauthorized.');
    }

    const origin = headerValue(headers, 'origin');
    if (origin && !isLoopbackOrigin(origin)) {
      throw new KalioMcpBridgeHttpError(403, 'Only loopback MCP bridge origins are allowed.');
    }
  }

  async close(): Promise<void> {
    const connections = [...this.connections.values()];
    this.connections.clear();
    await Promise.allSettled(connections.map(async (connection) => {
      await connection.server.close();
      await connection.transport.close();
    }));
  }

  private createConnection(headers: IncomingHttpHeaders): BridgeConnection {
    const id = randomUUID();
    const toolNamesHeader = headerValue(headers, 'x-kalio-tool-names');
    const context: BridgeContext = {
      sessionId: headerValue(headers, 'x-kalio-session-id') ?? `mcp-bridge:${id}`,
      vfsSessionId: headerValue(headers, 'x-kalio-vfs-session-id'),
      turnId: headerValue(headers, 'x-kalio-turn-id'),
      promptMessageId: headerValue(headers, 'x-kalio-prompt-message-id'),
      allowedToolNames: hasHeader(headers, 'x-kalio-tool-names')
        ? parseToolAllowList(toolNamesHeader)
        : undefined,
    };

    const connection = {} as BridgeConnection;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        connection.sessionId = sessionId;
        this.connections.set(sessionId, connection);
      },
      onsessionclosed: (sessionId) => {
        this.connections.delete(sessionId);
      },
    });
    const server = this.createServer(connection);
    Object.assign(connection, { id, context, server, transport, connected: false });
    transport.onclose = () => {
      if (connection.sessionId) this.connections.delete(connection.sessionId);
    };
    return connection;
  }

  private createServer(connection: BridgeConnection): Server {
    const server = new Server(
      { name: 'kalio-mcp-bridge', version: '0.1.0' },
      {
        capabilities: { tools: { listChanged: false } },
        instructions: 'Kalio native tools. Tool policy and HITL remain owned by Kalio.',
      },
    );

    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: this.visibleTools(connection).map(toMcpTool),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const toolName = request.params.name;
      const visible = this.visibleTools(connection);
      if (!visible.some((tool) => tool.name === toolName)) {
        return toolError(`Tool ${toolName} is not available in this Kalio bridge scope.`);
      }

      const callId = `mcp-${connection.sessionId ?? connection.id}-${String(extra.requestId)}`;
      const args = isRecord(request.params.arguments) ? request.params.arguments : {};
      const streamContext: StreamContext = {
        sessionId: connection.context.sessionId,
        turnId: connection.context.turnId,
        promptMessageId: connection.context.promptMessageId,
        vfsSessionId: connection.context.vfsSessionId,
        messageId: callId,
        abortSignal: extra.signal,
        state: new TurnState(),
        emit: (() => undefined) as StreamContext['emit'],
        runtimeKind: 'chat',
      };

      const result = await this.toolDispatch.dispatch(callId, toolName, args, streamContext, visible);
      return toMcpResult(result);
    });

    return server;
  }

  private visibleTools(connection: BridgeConnection): ToolMeta[] {
    const allowList = connection.context.allowedToolNames;
    return this.toolDispatch
      .getToolMetas()
      .filter((tool) => tool.domain !== 'mcp')
      .filter((tool) => !BLOCKED_CHILD_TOOL_NAMES.has(tool.name))
      // A caller must opt into confirmation-gated tools explicitly. Native
      // read-only tools remain convenient for first-party MCP clients.
      .filter((tool) => Boolean(allowList) || !tool.requiresConfirmation)
      .filter((tool) => !allowList || allowList.has(tool.name));
  }
}

function toMcpTool(meta: ToolMeta): McpTool {
  const inputSchema = isRecord(meta.parameters) && meta.parameters.type === 'object'
    ? meta.parameters
    : { type: 'object', properties: {} };
  return {
    name: meta.name,
    description: meta.description,
    inputSchema: inputSchema as McpTool['inputSchema'],
    ...(meta.requiresConfirmation ? { annotations: { destructiveHint: true } } : {}),
  };
}

function toMcpResult(result: ToolResult): { content: [{ type: 'text'; text: string }]; isError?: boolean } {
  if (result.status === 'success') {
    return { content: [{ type: 'text', text: JSON.stringify(result.data ?? null) }] };
  }
  return {
    content: [{ type: 'text', text: result.errorMessage ?? result.errorCode ?? 'Kalio tool failed.' }],
    isError: true,
  };
}

function toolError(message: string): { content: [{ type: 'text'; text: string }]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) return value[0]?.trim() || undefined;
  return value?.trim() || undefined;
}

function parseToolAllowList(value: string | undefined): ReadonlySet<string> | undefined {
  if (!value) return new Set();
  return new Set(value.split(',').map((name) => name.trim()).filter(Boolean));
}

function hasHeader(headers: IncomingHttpHeaders, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
}

function isLoopbackOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

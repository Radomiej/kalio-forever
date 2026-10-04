import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolMeta, ToolResult } from '@kalio/types';
import { ToolDispatchService } from '../chat/tool-dispatch.service';
import { ChatGateway } from '../chat/chat.gateway';
import { TurnState } from '../chat/turn-state';
import type { StreamContext } from '../chat/interfaces/stream-context.interface';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isKalioMcpBridgeEnabled } from '../../common/kalio-mcp-bridge-config';
import { KalioMcpBridgeTokenService } from '../../database/kalio-mcp-bridge-token.service';
import { KalioMcpBridgeContextRegistry, type KalioMcpBridgeTurnContext } from '../../common/kalio-mcp-bridge-context';

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
  dynamicContextRequired: boolean;
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
  private readonly logger = new Logger(KalioMcpBridgeService.name);
  private readonly connections = new Map<string, BridgeConnection>();

  constructor(
    private readonly toolDispatch: ToolDispatchService,
    private readonly tokenService: KalioMcpBridgeTokenService,
    private readonly contextRegistry: KalioMcpBridgeContextRegistry,
    private readonly chatGateway: ChatGateway,
  ) {}

  async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    parsedBody?: unknown,
  ): Promise<void> {
    await this.authorize(request.headers);

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

  async authorize(headers: IncomingHttpHeaders): Promise<void> {
    const token = await this.tokenService.getToken();
    if (!token || !isKalioMcpBridgeEnabled(token)) {
      throw new KalioMcpBridgeHttpError(
        503,
        'Kalio MCP bridge is disabled. Configure a token in Settings or KALIO_MCP_BRIDGE_TOKEN.',
      );
    }

    const authorization = headerValue(headers, 'authorization');
    if (authorization !== `Bearer ${token}`) {
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
      dynamicContextRequired: headerValue(headers, 'x-kalio-bridge-client') === 'devin-acp',
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

      const dynamicContext = this.contextRegistry.get(connection.context.sessionId);
      if (connection.context.dynamicContextRequired && !dynamicContext) {
        return toolError('No active Kalio turn context is available for this native runtime.');
      }
      if (connection.context.dynamicContextRequired && !dynamicContext?.dispatchNativeTool) {
        return toolError('No durable Kalio tool execution port is available for this native runtime.');
      }
      const callId = `mcp-${connection.sessionId ?? connection.id}-${String(extra.requestId)}`;
      const args = isRecord(request.params.arguments) ? request.params.arguments : {};
      const context = this.activeContext(connection);
      const progressToken = request.params._meta?.progressToken;
      const progressAbort = new AbortController();
      const abortSignal = AbortSignal.any([extra.signal, progressAbort.signal]);
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let progress = 0;
      let notifications = Promise.resolve();
      const stopHeartbeat = () => { clearInterval(heartbeat); heartbeat = undefined; };
      const sendProgress = (message: string) => {
        if (progressToken === undefined || abortSignal.aborted) return;
        const nextProgress = ++progress;
        notifications = notifications.then(() => extra.sendNotification({
          method: 'notifications/progress',
          params: { progressToken, progress: nextProgress, message },
        })).catch((error: unknown) => {
          this.logger.warn(`MCP approval progress failed for session ${context.sessionId}`);
          progressAbort.abort(error);
        });
      };
      abortSignal.addEventListener('abort', stopHeartbeat, { once: true });
      const onApprovalProgress = (state: 'waiting' | 'resolved') => {
        if (state === 'waiting' && progressToken !== undefined && !abortSignal.aborted) {
          stopHeartbeat();
          sendProgress('Awaiting human approval in Kalio');
          // Protocol liveness only while the dispatcher is actually waiting for a decision.
          heartbeat = setInterval(() => sendProgress('Awaiting human approval in Kalio'), 20_000);
          heartbeat.unref();
        } else if (state === 'resolved') {
          stopHeartbeat();
          sendProgress('Kalio approval resolved');
        }
      };
      if (connection.context.dynamicContextRequired && dynamicContext?.dispatchNativeTool) {
        try {
          const result = await dynamicContext.dispatchNativeTool({ id: callId, name: toolName, args }, { abortSignal, onApprovalProgress });
          await notifications;
          return toMcpResult(result);
        } finally {
          stopHeartbeat();
          abortSignal.removeEventListener('abort', stopHeartbeat);
        }
      }
      // TODO: legacy fallback — standalone MCP clients have no owning chat runtime.
      const emit: StreamContext['emit'] = (event, data) => {
        this.chatGateway.emitSessionEvent(context.sessionId, event, data);
        if (event === 'tool:confirmation_required') onApprovalProgress('waiting');
        else if (event === 'tool:confirmation_invalidated') onApprovalProgress('resolved');
      };
      const streamContext: StreamContext = {
        sessionId: context.sessionId,
        turnId: context.turnId,
        promptMessageId: context.promptMessageId,
        vfsSessionId: context.vfsSessionId,
        messageId: callId,
        abortSignal,
        state: new TurnState(),
        emit,
        runtimeKind: 'chat',
      };

      emit('tool:start', {
        callId,
        toolName,
        args,
        sessionId: context.sessionId,
        turnId: context.turnId,
      });
      try {
        const result = await this.toolDispatch.dispatch(callId, toolName, args, streamContext, visible);
        emit('tool:result', { ...result, sessionId: context.sessionId, toolName });
        await notifications;
        return toMcpResult(result);
      } finally {
        stopHeartbeat();
        abortSignal.removeEventListener('abort', stopHeartbeat);
      }
    });

    return server;
  }

  private visibleTools(connection: BridgeConnection): ToolMeta[] {
    const allowList = this.activeContext(connection).allowedToolNames;
    return this.toolDispatch
      .getToolMetas()
      .filter((tool) => tool.domain !== 'mcp')
      .filter((tool) => !BLOCKED_CHILD_TOOL_NAMES.has(tool.name))
      // A caller must opt into confirmation-gated tools explicitly. Native
      // read-only tools remain convenient for first-party MCP clients.
      .filter((tool) => Boolean(allowList) || !tool.requiresConfirmation)
      .filter((tool) => !allowList || allowList.has(tool.name));
  }

  private activeContext(connection: BridgeConnection): BridgeContext {
    const dynamic = this.contextRegistry.get(connection.context.sessionId);
    return dynamic ? mergeContext(connection.context, dynamic) : connection.context;
  }
}

function mergeContext(base: BridgeContext, dynamic: KalioMcpBridgeTurnContext): BridgeContext {
  return {
    ...base,
    ...dynamic,
  };
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
  if (result.status === 'cancelled') {
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
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

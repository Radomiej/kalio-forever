import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { MCPServer, MCPTool, CreateMCPServerDto } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { mcpServers } from '../../database/schema';

const HEALTH_CHECK_MS = 30_000;
const BASE_RESTART_MS = 2_000;
const MAX_RESTART_MS = 60_000;

interface ServerHandle {
  id: string;
  name: string;
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
  lastError?: string;
  permanentError?: boolean;
}

@Injectable()
export class MCPService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MCPService.name);
  private handles = new Map<string, ServerHandle>();
  private toolNameMap = new Map<string, { serverId: string; originalName: string }>();
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private gatewayRef?: { emitToAll(event: string, data: unknown): void };

  constructor(private readonly drizzle: DrizzleService) {}

  setGateway(gw: { emitToAll(event: string, data: unknown): void }): void {
    this.gatewayRef = gw;
  }

  async onModuleInit(): Promise<void> {
    const rows = await this.drizzle.db.select().from(mcpServers).where(eq(mcpServers.enabled, true));
    if (rows.length === 0) return;
    this.logger.log(`[MCP] Scheduling background connect for ${rows.length} server(s)…`);
    // Fire-and-forget — do NOT await so NestJS finishes startup and health endpoint
    // responds immediately; MCP servers connect in the background.
    void Promise.allSettled(rows.map((r) => this.connectHandle(this.rowToHandle(r)))).then(() => {
      const connected = [...this.handles.values()].filter((h) => h.status === 'connected').length;
      this.logger.log(`[MCP] Background connect done: ${connected}/${rows.length} connected`);
    });
    this.healthTimer = setInterval(() => void this.healthCheckAll(), HEALTH_CHECK_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.healthTimer) clearInterval(this.healthTimer);
    await Promise.allSettled([...this.handles.keys()].map((id) => this.disconnectHandle(id)));
    this.handles.clear();
  }

  async findAll(): Promise<MCPServer[]> {
    const rows = await this.drizzle.db.select().from(mcpServers);
    return rows.map((r) => this.toMCPServer(r));
  }

  getAllTools(): MCPTool[] {
    return [...this.handles.values()].filter((h) => h.status === 'connected').flatMap((h) => h.tools);
  }

  getToolByName(toolName: string): MCPTool | undefined {
    const ref = this.toolNameMap.get(toolName);
    if (!ref) return undefined;
    return this.handles.get(ref.serverId)?.tools.find((t) => t.name === toolName);
  }

  getToolsForServer(serverId: string): MCPTool[] {
    return this.handles.get(serverId)?.tools ?? [];
  }

  resolveToolName(prefixed: string): { serverId: string; originalName: string } | null {
    return this.toolNameMap.get(prefixed) ?? null;
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const handle = this.handles.get(serverId);
    if (!handle || handle.status !== 'connected') throw new Error(`MCP server ${serverId} not connected`);
    return handle.client.callTool({ name: toolName, arguments: args });
  }

  async addServer(dto: CreateMCPServerDto): Promise<MCPServer> {
    const id = nanoid();
    const now = new Date();
    await this.drizzle.db.insert(mcpServers).values({
      id,
      name: dto.name,
      transport: dto.transport ?? 'http',
      url: dto.url ?? null,
      command: dto.command ?? null,
      args: dto.args ?? null,
      envVars: dto.env ?? null,
      headers: dto.headers ?? null,
      enabled: true,
      status: 'connecting',
      createdAt: now,
    });
    const [row] = await this.drizzle.db.select().from(mcpServers).where(eq(mcpServers.id, id));
    await this.connectHandle(this.rowToHandle(row!));
    if (!this.healthTimer) this.healthTimer = setInterval(() => void this.healthCheckAll(), HEALTH_CHECK_MS);
    return this.toMCPServer(row!);
  }

  async removeServer(id: string): Promise<void> {
    await this.disconnectHandle(id);
    this.handles.delete(id);
    for (const [name, info] of this.toolNameMap) {
      if (info.serverId === id) this.toolNameMap.delete(name);
    }
    await this.drizzle.db.delete(mcpServers).where(eq(mcpServers.id, id));
  }

  async restartServer(id: string): Promise<void> {
    const handle = this.handles.get(id);
    if (!handle) throw new Error(`MCP server not found: ${id}`);
    await this.disconnectHandle(id);
    handle.restartCount = 0;
    handle.permanentError = false;
    await this.connectHandle(handle);
  }

  private async connectHandle(handle: ServerHandle): Promise<void> {
    this.handles.set(handle.id, handle);
    handle.status = 'connecting';
    this.emitStatus(handle);

    let transport: Transport;
    try {
      transport = this.createTransport(handle);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[MCP] Transport error for ${handle.id}: ${msg}`);
      handle.status = 'error';
      handle.lastError = msg;
      handle.permanentError = true;
      await this.persistStatus(handle);
      this.emitStatus(handle);
      return;
    }

    const client = new Client({ name: 'kalio-api', version: '2.0.0' });
    handle.client = client;
    handle.rawTransport = transport;

    try {
      await client.connect(transport);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[MCP] Connect failed for ${handle.id}: ${msg}`);
      handle.status = 'error';
      handle.lastError = msg;
      await this.persistStatus(handle);
      this.emitStatus(handle);
      return;
    }

    try {
      handle.tools = await this.discoverTools(handle.id, client);
    } catch (err) {
      this.logger.warn(`[MCP] Tool discovery failed for ${handle.id}: ${err}`);
      handle.tools = [];
    }

    transport.onclose = () => {
      if (handle.status === 'connected') {
        this.logger.warn(`[MCP] Server ${handle.id} disconnected unexpectedly`);
        handle.status = 'error';
        handle.lastError = 'Connection closed unexpectedly';
        void this.persistStatus(handle);
        this.emitStatus(handle);
        if (!handle.permanentError) void this.attemptRestart(handle.id);
      }
    };

    handle.status = 'connected';
    handle.lastError = undefined;
    handle.restartCount = 0;
    await this.persistStatus(handle);
    this.emitStatus(handle);
    this.logger.log(`[MCP] Connected ${handle.name}: ${handle.tools.length} tool(s)`);
  }

  private async disconnectHandle(id: string): Promise<void> {
    const handle = this.handles.get(id);
    if (!handle) return;
    try { await handle.client?.close(); } catch (err) { this.logger.warn(`[MCP] Error closing client for ${handle.id}`, err instanceof Error ? err.stack : String(err)); }
    try { await handle.rawTransport?.close(); } catch (err) { this.logger.warn(`[MCP] Error closing transport for ${handle.id}`, err instanceof Error ? err.stack : String(err)); }
    handle.status = 'disconnected';
    handle.tools = [];
    this.emitStatus(handle);
  }

  private createTransport(handle: ServerHandle): Transport {
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

  private async discoverTools(serverId: string, client: Client): Promise<MCPTool[]> {
    const tools: MCPTool[] = [];
    let cursor: string | undefined;
    let iterations = 0;
    const MAX_ITERATIONS = 100;
    do {
      const result = await client.listTools(cursor ? { cursor } : undefined);
      for (const t of result.tools) {
        const prefixed = `mcp_${serverId}_${t.name}`;
        this.toolNameMap.set(prefixed, { serverId, originalName: t.name });
        tools.push({
          name: prefixed,
          description: t.description ?? '',
          parameters: (t.inputSchema ?? {}) as Record<string, unknown>,
          requiresConfirmation: false,
          serverId,
        } satisfies MCPTool);
      }
      cursor = result.nextCursor;
      iterations++;
      if (iterations >= MAX_ITERATIONS) {
        this.logger.warn(`[MCP] Tool discovery hit ${MAX_ITERATIONS}-iteration limit for ${serverId}, stopping pagination`);
        break;
      }
    } while (cursor);
    return tools;
  }

  private async healthCheckAll(): Promise<void> {
    for (const handle of this.handles.values()) {
      if (handle.status !== 'connected' || handle.permanentError) continue;
      try {
        await handle.client.listTools();
      } catch (err) {
        this.logger.warn(`[MCP] Health check failed for ${handle.id}`, err instanceof Error ? err.stack : String(err));
        handle.status = 'error';
        handle.lastError = 'Health check failed';
        void this.persistStatus(handle);
        this.emitStatus(handle);
        void this.attemptRestart(handle.id);
      }
    }
  }

  private async attemptRestart(id: string): Promise<void> {
    const handle = this.handles.get(id);
    if (!handle || handle.permanentError) return;
    handle.restartCount++;
    const delay = Math.min(BASE_RESTART_MS * 2 ** (handle.restartCount - 1), MAX_RESTART_MS);
    this.logger.log(`[MCP] Restarting ${id} in ${delay}ms (attempt ${handle.restartCount})`);
    await new Promise((r) => setTimeout(r, delay));
    if (!this.handles.get(id)) return;
    await this.connectHandle(this.handles.get(id)!);
  }

  private emitStatus(handle: ServerHandle): void {
    this.gatewayRef?.emitToAll('mcp:server:status', {
      serverId: handle.id,
      serverName: handle.name,
      status: handle.status,
      toolCount: handle.tools.length,
      lastError: handle.lastError,
    });
  }

  private async persistStatus(handle: ServerHandle): Promise<void> {
    await this.drizzle.db
      .update(mcpServers)
      .set({ status: handle.status, toolCount: handle.tools.length, lastError: handle.lastError ?? null })
      .where(eq(mcpServers.id, handle.id));
  }

  private rowToHandle(row: typeof mcpServers.$inferSelect): ServerHandle {
    return {
      id: row.id,
      name: row.name,
      transport: (row.transport as 'stdio' | 'http') ?? 'http',
      url: row.url ?? undefined,
      command: row.command ?? undefined,
      args: row.args ?? undefined,
      envVars: row.envVars ?? undefined,
      headers: row.headers ?? undefined,
      client: null as unknown as Client,
      rawTransport: null,
      status: 'disconnected',
      tools: [],
      restartCount: 0,
    };
  }

  private toMCPServer(row: typeof mcpServers.$inferSelect): MCPServer {
    const handle = this.handles.get(row.id);
    return {
      id: row.id,
      name: row.name,
      transport: (row.transport as 'stdio' | 'http') ?? 'http',
      url: row.url ?? undefined,
      command: row.command ?? undefined,
      status: (handle?.status ?? row.status ?? 'disconnected') as MCPServer['status'],
      toolCount: handle?.tools.length ?? (row.toolCount ?? 0),
      lastError: handle?.lastError ?? row.lastError ?? undefined,
      createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : (row.createdAt as number),
    };
  }

}

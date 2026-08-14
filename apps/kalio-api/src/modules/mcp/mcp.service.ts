import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type {
  CreateMCPServerDto,
  MCPServer,
  MCPTool,
} from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { mcpServers } from '../../database/schema';
import { KalioConfigService } from '../../config/kalio-config.service';
import {
  buildServerKey,
  makeMcpServerId,
  parseServerKey,
  resolveRegistryEntries,
  type MCPResolvedRegistryEntry,
} from './mcp-registry.utils';
import {
  buildMcpServerStatusPayload,
  buildMcpToolName,
  buildMcpToolPayload,
} from './mcp-projections';
import {
  configToMcpHandle,
  createMcpTransport,
  rowToMcpHandle,
  type ServerHandle,
} from './mcp-runtime.utils';
import { rebuildMcpToolNameMap } from './mcp-tool-name-map.utils';

const HEALTH_CHECK_MS = 30_000;
const BASE_RESTART_MS = 2_000;
const MAX_RESTART_MS = 60_000;

type MCPServerRow = typeof mcpServers.$inferSelect;

@Injectable()
export class MCPService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MCPService.name);
  private handles = new Map<string, ServerHandle>();
  private toolNameMap = new Map<string, { serverKey: string; originalName: string }>();
  private ambiguousToolNames = new Set<string>();
  private toolOriginalNames = new WeakMap<MCPTool, string>();
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private gatewayRef?: { emitToAll(event: string, data: unknown): void };

  constructor(
    private readonly drizzle: DrizzleService,
    @Optional() private readonly kalioConfig?: KalioConfigService,
  ) {}

  setGateway(gw: { emitToAll(event: string, data: unknown): void }): void {
    this.gatewayRef = gw;
  }

  async onModuleInit(): Promise<void> {
    const activeHandles = await this.reconcileRuntime();
    if (activeHandles.length === 0) return;
    this.logger.log(`[MCP] Active registry resolved: ${activeHandles.length} server(s) scheduled`);
  }
  async onModuleDestroy(): Promise<void> {
    if (this.healthTimer) clearInterval(this.healthTimer);
    await Promise.allSettled([...this.handles.keys()].map((serverKey) => this.disconnectHandle(serverKey)));
    this.handles.clear();
  }

  async findAll(): Promise<MCPServer[]> {
    const registry = await this.loadRegistryEntries();
    return registry.resolved.map((entry) => this.toMCPServer(entry, registry.rowsByServerKey.get(entry.serverKey)));
  }

  async findComparableSignatures(): Promise<Set<string>> {
    const registry = await this.loadRegistryEntries();
    return new Set(registry.resolved.map((entry) => entry.signature));
  }

  getAllTools(): MCPTool[] {
    return [...this.handles.values()].filter((h) => h.status === 'connected').flatMap((h) => h.tools);
  }

  getToolByName(toolName: string): MCPTool | undefined {
    const ref = this.toolNameMap.get(toolName);
    if (!ref) return undefined;
    const tools = this.handles.get(ref.serverKey)?.tools ?? [];
    return tools.find((tool) => (
      tool.name === toolName
      || tool.name === buildMcpToolName(ref.serverKey, ref.originalName)
      || tool.aliases?.includes(toolName)
    ));
  }

  getToolsForServer(serverKey: string): MCPTool[] {
    return this.handles.get(serverKey)?.tools ?? [];
  }

  resolveToolName(prefixed: string): { serverKey: string; originalName: string } | null {
    return this.toolNameMap.get(prefixed) ?? null;
  }

  async callTool(serverKey: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const handle = this.handles.get(serverKey);
    if (!handle || handle.status !== 'connected') throw new Error(`MCP server ${serverKey} not connected`);
    return handle.client.callTool({ name: toolName, arguments: args });
  }

  async addServer(dto: CreateMCPServerDto): Promise<MCPServer> {
    const id = makeMcpServerId(dto);
    const existing = (await this.drizzle.db
      .select({ id: mcpServers.id })
      .from(mcpServers)
      .where(eq(mcpServers.id, id))
      .limit(1))[0];

    if (existing) {
      await this.reconcileRuntime();
      return await this.findServerByKey(buildServerKey('sqlite', id));
    }

    const now = new Date();
    await this.drizzle.db.insert(mcpServers).values({
      id,
      name: dto.name,
      transport: dto.transport ?? 'http',
      originSource: dto.originSource ?? 'manual',
      url: dto.url ?? null,
      command: dto.command ?? null,
      args: dto.args ?? null,
      envVars: dto.env ?? null,
      headers: dto.headers ?? null,
      enabled: true,
      status: 'disconnected',
      createdAt: now,
    });
    await this.reconcileRuntime();
    return await this.findServerByKey(buildServerKey('sqlite', id));
  }

  async removeServer(serverKey: string): Promise<void> {
    const resolvedServerKey = await this.resolveServerKey(serverKey);
    if (!resolvedServerKey) {
      throw new Error(`MCP server not found: ${serverKey}`);
    }

    const parsed = parseServerKey(resolvedServerKey);
    if (!parsed) {
      throw new Error(`MCP server not found: ${serverKey}`);
    }
    if (parsed.store === 'toml') {
      throw new Error(`MCP server ${resolvedServerKey} is managed by .kalio/config.toml`);
    }
    await this.disconnectHandle(resolvedServerKey);
    this.handles.delete(resolvedServerKey);
    this.removeToolRefs();
    await this.drizzle.db.delete(mcpServers).where(eq(mcpServers.id, parsed.id));
    await this.reconcileRuntime();
  }

  async reloadManagedServers(): Promise<MCPServer[]> {
    this.kalioConfig?.invalidateCache();
    await this.reconcileRuntime();
    return this.findAll();
  }

  async restartServer(serverKey: string): Promise<void> {
    const resolvedServerKey = await this.resolveServerKey(serverKey);
    if (!resolvedServerKey) {
      throw new Error(`MCP server not found: ${serverKey}`);
    }

    const handle = this.handles.get(resolvedServerKey);
    if (!handle) throw new Error(`MCP server not found: ${serverKey}`);
    await this.disconnectHandle(resolvedServerKey);
    handle.restartCount = 0;
    handle.permanentError = false;
    await this.connectHandle(handle);
  }

  private async resolveServerKey(serverKeyOrLegacyId: string): Promise<string | null> {
    return parseServerKey(serverKeyOrLegacyId) ? serverKeyOrLegacyId : null;
  }

  private async connectHandle(handle: ServerHandle): Promise<void> {
    this.handles.set(handle.serverKey, handle);
    handle.status = 'connecting';
    this.emitStatus(handle);

    let transport: Transport;
    try {
      transport = createMcpTransport(handle);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[MCP] Transport error for ${handle.serverKey}: ${msg}`);
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
      this.logger.error(`[MCP] Connect failed for ${handle.serverKey}: ${msg}`);
      handle.status = 'error';
      handle.lastError = msg;
      await this.persistStatus(handle);
      this.emitStatus(handle);
      return;
    }

    try {
      handle.tools = await this.discoverTools(handle.serverKey, client);
    } catch (err) {
      this.logger.warn(`[MCP] Tool discovery failed for ${handle.serverKey}: ${err}`);
      handle.tools = [];
    }
    this.rebuildToolNameMap();

    transport.onclose = () => {
      if (handle.status === 'connected') {
        this.logger.warn(`[MCP] Server ${handle.serverKey} disconnected unexpectedly`);
        handle.status = 'error';
        handle.lastError = 'Connection closed unexpectedly';
        void this.persistStatus(handle);
        this.emitStatus(handle);
        if (!handle.permanentError) void this.attemptRestart(handle.serverKey);
      }
    };

    handle.status = 'connected';
    handle.lastError = undefined;
    handle.restartCount = 0;
    await this.persistStatus(handle);
    this.emitStatus(handle);
    this.logger.log(`[MCP] Connected ${handle.name}: ${handle.tools.length} tool(s)`);
  }

  private async disconnectHandle(serverKey: string): Promise<void> {
    const handle = this.handles.get(serverKey);
    if (!handle) return;
    try { await handle.client?.close(); } catch (err) { this.logger.warn(`[MCP] Error closing client for ${handle.serverKey}`, err instanceof Error ? err.stack : String(err)); }
    try { await handle.rawTransport?.close(); } catch (err) { this.logger.warn(`[MCP] Error closing transport for ${handle.serverKey}`, err instanceof Error ? err.stack : String(err)); }
    handle.status = 'disconnected';
    handle.tools = [];
    this.rebuildToolNameMap();
    await this.persistStatus(handle);
    this.emitStatus(handle);
  }

  private async discoverTools(serverKey: string, client: Client): Promise<MCPTool[]> {
    const tools: MCPTool[] = [];
    let cursor: string | undefined;
    let iterations = 0;
    const MAX_ITERATIONS = 100;
    do {
      const result = await client.listTools(cursor ? { cursor } : undefined);
      for (const t of result.tools) {
        const tool = buildMcpToolPayload(serverKey, t);
        this.toolOriginalNames.set(tool, t.name);
        const ref = { serverKey, originalName: t.name };
        for (const name of [tool.name, ...(tool.aliases ?? [])]) {
          if (this.ambiguousToolNames.has(name)) {
            continue;
          }
          const existing = this.toolNameMap.get(name);
          if (!existing) {
            this.toolNameMap.set(name, ref);
          } else if (existing.serverKey !== ref.serverKey || existing.originalName !== ref.originalName) {
            this.toolNameMap.delete(name);
            this.ambiguousToolNames.add(name);
          }
        }
        tools.push(tool);
      }
      cursor = result.nextCursor;
      iterations++;
      if (iterations >= MAX_ITERATIONS) {
        this.logger.warn(`[MCP] Tool discovery hit ${MAX_ITERATIONS}-iteration limit for ${serverKey}, stopping pagination`);
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
        this.logger.warn(`[MCP] Health check failed for ${handle.serverKey}`, err instanceof Error ? err.stack : String(err));
        handle.status = 'error';
        handle.lastError = 'Health check failed';
        void this.persistStatus(handle);
        this.emitStatus(handle);
        void this.attemptRestart(handle.serverKey);
      }
    }
  }

  private async attemptRestart(serverKey: string): Promise<void> {
    const handle = this.handles.get(serverKey);
    if (!handle || handle.permanentError) return;
    handle.restartCount++;
    const delay = Math.min(BASE_RESTART_MS * 2 ** (handle.restartCount - 1), MAX_RESTART_MS);
    this.logger.log(`[MCP] Restarting ${serverKey} in ${delay}ms (attempt ${handle.restartCount})`);
    await new Promise((r) => setTimeout(r, delay));
    if (!this.handles.get(serverKey)) return;
    await this.connectHandle(this.handles.get(serverKey)!);
  }

  private emitStatus(handle: ServerHandle): void {
    this.gatewayRef?.emitToAll('mcp:server:status', buildMcpServerStatusPayload(handle));
  }

  private async persistStatus(handle: ServerHandle): Promise<void> {
    if (handle.store !== 'sqlite') return;
    await this.drizzle.db
      .update(mcpServers)
      .set({ status: handle.status, toolCount: handle.tools.length, lastError: handle.lastError ?? null })
      .where(eq(mcpServers.id, handle.id));
  }

  private async loadManagedHandles(): Promise<ServerHandle[]> {
    if (!this.kalioConfig) return [];
    const { config } = await this.kalioConfig.getEffectiveConfig();
    return Object.entries(config.mcp_servers ?? {})
      .filter(([, server]) => server.enabled !== false)
      .map(([id, server]) => configToMcpHandle(id, server));
  }

  private removeToolRefs(): void {
    this.rebuildToolNameMap();
  }

  private rebuildToolNameMap(): void {
    const rebuilt = rebuildMcpToolNameMap(this.handles.values(), this.toolOriginalNames);
    this.toolNameMap.clear();
    for (const [name, ref] of rebuilt.map) this.toolNameMap.set(name, ref);
    this.ambiguousToolNames.clear();
    for (const name of rebuilt.ambiguous) this.ambiguousToolNames.add(name);
  }

  private async loadRegistryEntries(enabledRowsOnly = false): Promise<{
    resolved: MCPResolvedRegistryEntry[];
    rowsByServerKey: Map<string, MCPServerRow>;
    managedByServerKey: Map<string, ServerHandle>;
  }> {
    const rows = enabledRowsOnly
      ? await this.drizzle.db.select().from(mcpServers).where(eq(mcpServers.enabled, true))
      : await this.drizzle.db.select().from(mcpServers);
    const managedHandles = await this.loadManagedHandles();

    const rowsByServerKey = new Map(rows.map((row) => [buildServerKey('sqlite', row.id), row]));
    const managedByServerKey = new Map(managedHandles.map((handle) => [handle.serverKey, handle]));
    const resolved = resolveRegistryEntries([
      ...rows.map((row) => ({
        id: row.id,
        serverKey: buildServerKey('sqlite', row.id),
        name: row.name,
        store: 'sqlite' as const,
        originSource: row.originSource ?? 'manual',
        createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : (row.createdAt as number),
        transport: (row.transport as 'stdio' | 'http') ?? 'http',
        url: row.url ?? undefined,
        command: row.command ?? undefined,
        args: row.args ?? undefined,
        env: row.envVars ?? undefined,
        headers: row.headers ?? undefined,
      })),
      ...managedHandles.map((handle) => ({
        id: handle.id,
        serverKey: handle.serverKey,
        name: handle.name,
        store: handle.store,
        originSource: handle.originSource,
        createdAt: handle.createdAt,
        transport: handle.transport,
        url: handle.url,
        command: handle.command,
        args: handle.args,
        env: handle.envVars,
        headers: handle.headers,
      })),
    ]);

    return {
      resolved,
      rowsByServerKey,
      managedByServerKey,
    };
  }

  private async reconcileRuntime(): Promise<ServerHandle[]> {
    const registry = await this.loadRegistryEntries(true);
    const activeEntries = registry.resolved.filter((entry) => entry.effectiveState === 'active');
    const desiredKeys = new Set(activeEntries.map((entry) => entry.serverKey));

    for (const existingKey of [...this.handles.keys()]) {
      if (desiredKeys.has(existingKey)) {
        continue;
      }
      await this.disconnectHandle(existingKey);
      this.handles.delete(existingKey);
      this.removeToolRefs();
    }

    const scheduled: ServerHandle[] = [];
    for (const entry of activeEntries) {
      const desiredHandle = registry.managedByServerKey.get(entry.serverKey)
        ?? rowToMcpHandle(registry.rowsByServerKey.get(entry.serverKey)!);
      const currentHandle = this.handles.get(entry.serverKey);

      if (currentHandle && this.sameHandleConfig(currentHandle, desiredHandle)) {
        if (currentHandle.status !== 'connected' && currentHandle.status !== 'connecting') {
          await this.connectHandle(currentHandle);
          scheduled.push(currentHandle);
        }
        continue;
      }

      if (currentHandle) {
        await this.disconnectHandle(entry.serverKey);
        this.handles.delete(entry.serverKey);
        this.removeToolRefs();
      }

      await this.connectHandle(desiredHandle);
      scheduled.push(desiredHandle);
    }

    if (this.handles.size > 0 && !this.healthTimer) {
      this.healthTimer = setInterval(() => void this.healthCheckAll(), HEALTH_CHECK_MS);
    }
    if (this.handles.size === 0 && this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    return activeEntries.map((entry) =>
      this.handles.get(entry.serverKey)
      ?? registry.managedByServerKey.get(entry.serverKey)
      ?? rowToMcpHandle(registry.rowsByServerKey.get(entry.serverKey)!));
  }

  private sameHandleConfig(left: ServerHandle, right: ServerHandle): boolean {
    return left.signature === right.signature
      && left.serverKey === right.serverKey
      && JSON.stringify(left.envVars ?? {}) === JSON.stringify(right.envVars ?? {})
      && JSON.stringify(left.headers ?? {}) === JSON.stringify(right.headers ?? {});
  }

  private toMCPServer(entry: MCPResolvedRegistryEntry, row?: MCPServerRow): MCPServer {
    const handle = this.handles.get(entry.serverKey);
    return {
      id: entry.id,
      serverKey: entry.serverKey,
      name: entry.name,
      store: entry.store,
      originSource: entry.originSource,
      effectiveState: entry.effectiveState,
      conflictGroup: entry.conflictGroup,
      transport: entry.transport,
      url: entry.url,
      command: entry.command,
      args: entry.args,
      status: (handle?.status ?? row?.status ?? 'disconnected') as MCPServer['status'],
      toolCount: handle?.tools.length ?? (row?.toolCount ?? 0),
      lastError: handle?.lastError ?? row?.lastError ?? undefined,
      createdAt: entry.createdAt,
    };
  }

  private async findServerByKey(serverKey: string): Promise<MCPServer> {
    const found = (await this.findAll()).find((server) => server.serverKey === serverKey);
    if (!found) {
      throw new Error(`MCP server not found: ${serverKey}`);
    }
    return found;
  }

}

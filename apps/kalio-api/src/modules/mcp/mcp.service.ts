import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { MCPServer, MCPTool } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { mcpServers } from '../../database/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class MCPService implements OnModuleDestroy {
  private readonly logger = new Logger(MCPService.name);
  private readonly dynamicTools = new Map<string, MCPTool[]>();

  constructor(private readonly drizzle: DrizzleService) {}

  async findAll(): Promise<MCPServer[]> {
    const rows = await this.drizzle.db.select().from(mcpServers);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      url: r.url,
      status: r.status as MCPServer['status'],
      createdAt: r.createdAt instanceof Date ? r.createdAt.getTime() : r.createdAt,
    }));
  }

  async addServer(name: string, url: string): Promise<MCPServer> {
    const id = nanoid();
    const now = Date.now();
    await this.drizzle.db.insert(mcpServers).values({ id, name, url, status: 'connecting', createdAt: now });
    this.logger.log(`MCP server added: ${name} @ ${url}`);
    // TODO: connect & discover tools (Phase 8)
    return { id, name, url, status: 'connecting', createdAt: now };
  }

  async removeServer(id: string): Promise<void> {
    await this.drizzle.db.delete(mcpServers).where(eq(mcpServers.id, id));
    this.dynamicTools.delete(id);
  }

  getToolsForServer(serverId: string): MCPTool[] {
    return this.dynamicTools.get(serverId) ?? [];
  }

  getAllTools(): MCPTool[] {
    return Array.from(this.dynamicTools.values()).flat();
  }

  onModuleDestroy(): void {
    // Disconnect all MCP clients (Phase 8)
    this.logger.log('MCPService shutting down');
  }
}

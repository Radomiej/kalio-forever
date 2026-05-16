import { Body, Controller, Get, NotFoundException, OnModuleInit, Optional, Param, Patch } from '@nestjs/common';
import type { ToolMeta } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { toolOverrides } from '../../database/schema';
import { ToolRegistryService } from './tool-registry.service';
import { MCPService } from '../mcp/mcp.service';

@Controller('tools')
export class ToolController implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly drizzle: DrizzleService,
    @Optional() private readonly mcpService: MCPService | null,
  ) {}

  /** Load persisted overrides into the in-memory registry on startup. */
  async onModuleInit(): Promise<void> {
    const rows = await this.drizzle.db.select().from(toolOverrides);
    for (const row of rows) {
      this.registry.setOverride(row.toolName, row.requiresConfirmation);
    }
  }

  @Get()
  findAll(): ToolMeta[] {
    const staticMetas = this.registry.getEntries().map((e) => e.meta);
    const mcpMetas: ToolMeta[] = this.mcpService
      ? this.mcpService.getAllTools().map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          requiresConfirmation: t.requiresConfirmation,
        }))
      : [];
    return [...staticMetas, ...mcpMetas];
  }

  @Patch(':name')
  async updateOverride(
    @Param('name') name: string,
    @Body() body: { requiresConfirmation: boolean },
  ): Promise<ToolMeta> {
    const ok = this.registry.setOverride(name, body.requiresConfirmation);
    if (!ok) throw new NotFoundException(`Tool not found: ${name}`);

    // Persist override in DB (upsert)
    await this.drizzle.db
      .insert(toolOverrides)
      .values({ toolName: name, requiresConfirmation: body.requiresConfirmation, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: toolOverrides.toolName,
        set: { requiresConfirmation: body.requiresConfirmation, updatedAt: new Date() },
      });

    const entry = this.registry.getEntries().find((e) => e.meta.name === name)!;
    return entry.meta;
  }
}

import { Body, Controller, Get, NotFoundException, OnModuleInit, Param, Patch } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { ToolMeta } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { toolOverrides } from '../../database/schema';
import { ToolRegistryService } from './tool-registry.service';

@Controller('tools')
export class ToolController implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly drizzle: DrizzleService,
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
    return this.registry.getEntries().map((e) => e.meta);
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

import { Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ToolMeta } from '@kalio/types';
import { TOOL_METADATA } from '../../common/decorators/tool.decorator';
import { VFSWriteTool } from './tools/vfs-write.tool';

@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly registry = new Map<string, ToolMeta>();

  constructor(
    private readonly reflector: Reflector,
    private readonly vfsWriteTool: VFSWriteTool,
  ) {
    this.registerAll([vfsWriteTool]);
  }

  private registerAll(tools: object[]): void {
    for (const tool of tools) {
      const meta = this.reflector.get<ToolMeta>(TOOL_METADATA, tool.constructor);
      if (meta) {
        this.registry.set(meta.name, meta);
        this.logger.log(`Registered tool: ${meta.name}`);
      }
    }
  }

  getMeta(name: string): ToolMeta | undefined {
    return this.registry.get(name);
  }

  getAllTools(): ToolMeta[] {
    return Array.from(this.registry.values());
  }

  getToolsForSkills(skills: string[]): ToolMeta[] {
    if (skills.length === 0) return [];
    return this.getAllTools().filter((t) => skills.includes(t.name));
  }
}

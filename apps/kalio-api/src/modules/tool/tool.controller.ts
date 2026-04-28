import { Controller, Get } from '@nestjs/common';
import type { ToolMeta } from '@kalio/types';
import { ToolRegistryService } from './tool-registry.service';

@Controller('tools')
export class ToolController {
  constructor(private readonly registry: ToolRegistryService) {}

  @Get()
  findAll(): ToolMeta[] {
    return this.registry.getEntries().map(e => e.meta);
  }
}

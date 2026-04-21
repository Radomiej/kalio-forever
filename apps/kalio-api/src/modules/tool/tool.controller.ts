import { Controller, Get } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import type { ToolMeta } from '@kalio/types';

@Controller('tools')
export class ToolController {
  constructor(private readonly toolRegistry: ToolRegistryService) {}

  @Get()
  findAll(): ToolMeta[] {
    return this.toolRegistry.getAllTools();
  }
}

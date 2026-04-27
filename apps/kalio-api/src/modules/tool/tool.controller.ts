import { Controller, Get } from '@nestjs/common';
import type { ToolMeta } from '@kalio/types';

@Controller('tools')
export class ToolController {
  @Get()
  findAll(): ToolMeta[] {
    throw new Error('Not implemented - tool registry removed during chat core cleanup');
  }
}

import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import type {
  ArchitectureChatProjection,
  ArchitectureExecutionEvent,
  ArchitectureGraphProjection,
  ArchitectureRun,
  CreateArchitectureRunDto,
} from '@kalio/types';
import { ArchitectureRuntimeService } from './architecture-runtime.service';

@Controller('architecture-runs')
export class ArchitectureRunsController {
  constructor(private readonly runtime: ArchitectureRuntimeService) {}

  @Post()
  create(@Body() dto: CreateArchitectureRunDto): Promise<ArchitectureRun> {
    return this.runtime.createRun(dto);
  }

  @Post('async')
  createAsync(@Body() dto: CreateArchitectureRunDto): Promise<ArchitectureRun> {
    return this.runtime.createRunAsync(dto);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ArchitectureRun> {
    const run = await this.runtime.findRunDurable(id);
    if (!run) throw new NotFoundException(`Architecture run ${id} not found`);
    return run;
  }

  @Post(':id/stop')
  stop(@Param('id') id: string): Promise<ArchitectureRun> {
    return this.runtime.stopRun(id);
  }

  @Get(':id/events')
  async events(@Param('id') id: string): Promise<ArchitectureExecutionEvent[]> {
    await this.findOne(id);
    return this.runtime.getEventsDurable(id);
  }

  @Get(':id/graph')
  async graph(@Param('id') id: string): Promise<ArchitectureGraphProjection> {
    const graph = await this.runtime.getGraphDurable(id);
    if (!graph) throw new NotFoundException(`Architecture run ${id} not found`);
    return graph;
  }

  @Get(':id/chat')
  async chat(@Param('id') id: string): Promise<ArchitectureChatProjection> {
    const chat = await this.runtime.getChatDurable(id);
    if (!chat) throw new NotFoundException(`Architecture run ${id} not found`);
    return chat;
  }
}

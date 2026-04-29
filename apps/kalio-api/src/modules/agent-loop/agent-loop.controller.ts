import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { AgentLoop, AgentTask, CreateAgentLoopDto, CreateAgentTaskDto } from '@kalio/types';
import { AgentLoopService } from './agent-loop.service';

@Controller('agent-loops')
export class AgentLoopController {
  constructor(private readonly service: AgentLoopService) {}

  @Post()
  create(@Body() dto: CreateAgentLoopDto): Promise<AgentLoop> {
    return this.service.create(dto);
  }

  @Get()
  findAll(): Promise<AgentLoop[]> {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<AgentLoop> {
    return this.service.findOne(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string): Promise<void> {
    await this.service.delete(id);
  }

  @Post(':id/tasks')
  addTask(
    @Param('id') loopId: string,
    @Body() dto: CreateAgentTaskDto,
  ): Promise<AgentTask> {
    return this.service.addTask(loopId, dto);
  }
}

import { Controller, Get, Post, Delete, Param, Body, Query } from '@nestjs/common';
import { AgentLoopService } from './agent-loop.service';
import { ForeverAgentService } from './forever-agent.service';
import type { CreateAgentLoopDto, CreateAgentTaskDto } from '@kalio/types';

@Controller('agent-loops')
export class AgentLoopController {
  constructor(
    private readonly loopService: AgentLoopService,
    private readonly foreverAgent: ForeverAgentService,
  ) {}

  @Get()
  findAll(@Query('personaId') personaId?: string) {
    return this.loopService.findAllLoops(personaId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.loopService.findLoop(id);
  }

  @Post()
  create(@Body() dto: CreateAgentLoopDto) {
    return this.loopService.createLoop(dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    if (this.foreverAgent.isRunning(id)) this.foreverAgent.stopLoop(id);
    await this.loopService.deleteLoop(id);
    return { success: true };
  }

  @Post(':id/start')
  start(@Param('id') id: string) {
    this.foreverAgent.startLoop(id);
    return { started: true };
  }

  @Post(':id/pause')
  pause(@Param('id') id: string) {
    this.foreverAgent.pauseLoop(id);
    return { paused: true };
  }

  @Post(':id/stop')
  stop(@Param('id') id: string) {
    this.foreverAgent.stopLoop(id);
    return { stopped: true };
  }

  @Get(':id/tasks')
  getTasks(@Param('id') id: string) {
    return this.loopService.findTasks(id);
  }

  @Post(':id/tasks')
  createTask(@Param('id') id: string, @Body() dto: CreateAgentTaskDto) {
    return this.loopService.createTask({ ...dto, loopId: id });
  }

  @Get(':id/iterations')
  getIterations(@Param('id') id: string) {
    return this.loopService.findIterations(id);
  }
}

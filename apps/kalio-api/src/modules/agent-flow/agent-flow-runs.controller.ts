import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import type {
  AgentFlowRunSnapshot,
  CreateAgentFlowRunDto,
  ResumeAgentFlowRunDto,
  RunSubAgentFlowArgs,
} from '@kalio/types';
import { AgentFlowRuntimeService } from './agent-flow-runtime.service';

function toRunArgs(dto: CreateAgentFlowRunDto): RunSubAgentFlowArgs {
  validateCreateDto(dto);
  return {
    flowId: dto.flowId,
    goal: dto.goal,
    parentSessionId: dto.parentSessionId,
    context: dto.context,
    startMode: dto.startMode ?? 'durable',
    vfsMode: dto.vfsMode,
    copyBack: dto.copyBack,
    returnMode: dto.returnMode,
    maxSteps: dto.maxSteps,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateCreateDto(dto: CreateAgentFlowRunDto): void {
  if (!isNonEmptyString(dto.flowId)) {
    throw new BadRequestException('flowId must be a non-empty string');
  }
  if (!isNonEmptyString(dto.goal)) {
    throw new BadRequestException('goal must be a non-empty string');
  }
  if (!isNonEmptyString(dto.parentSessionId)) {
    throw new BadRequestException('parentSessionId must be a non-empty string');
  }
  if (dto.maxSteps !== undefined && (!Number.isInteger(dto.maxSteps) || dto.maxSteps < 1)) {
    throw new BadRequestException('maxSteps must be a positive integer');
  }
}

@Controller('agent-flows/runs')
export class AgentFlowRunsController {
  constructor(private readonly runtime: AgentFlowRuntimeService) {}

  @Post()
  async create(@Body() dto: CreateAgentFlowRunDto): Promise<AgentFlowRunSnapshot> {
    return this.runtime.start(toRunArgs(dto));
  }

  @Get()
  find(@Query('parentSessionId') parentSessionId?: string): Promise<AgentFlowRunSnapshot[]> {
    if (parentSessionId === undefined) {
      return this.runtime.findAll();
    }
    if (!isNonEmptyString(parentSessionId)) {
      throw new BadRequestException('parentSessionId must be a non-empty string when provided');
    }
    return this.runtime.findByParentSessionId(parentSessionId.trim());
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<AgentFlowRunSnapshot> {
    const snapshot = await this.runtime.getSnapshot(id);
    if (!snapshot) throw new NotFoundException(`AgentFlow run ${id} not found`);
    return snapshot;
  }

  @Get(':id/events')
  async events(@Param('id') id: string): Promise<AgentFlowRunSnapshot['events']> {
    return (await this.findOne(id)).events;
  }

  @Post(':id/resume')
  resume(@Param('id') id: string, @Body() dto: ResumeAgentFlowRunDto): Promise<AgentFlowRunSnapshot> {
    return this.runtime.resume(id, dto);
  }

  @Post(':id/stop')
  stop(@Param('id') id: string): Promise<AgentFlowRunSnapshot> {
    return this.runtime.stop(id);
  }
}

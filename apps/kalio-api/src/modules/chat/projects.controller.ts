import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { CreateProjectDto, Project, UpdateProjectDto } from '@kalio/types';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(): Promise<Project[]> {
    return this.projects.list();
  }

  @Post()
  create(@Body() dto: CreateProjectDto): Promise<Project> {
    return this.projects.create(dto);
  }

  @Patch(':id')
  rename(@Param('id') id: string, @Body() dto: UpdateProjectDto): Promise<Project> {
    return this.projects.rename(id, dto);
  }
}

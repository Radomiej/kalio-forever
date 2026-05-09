import { Controller, Get, Post, Put, Delete, Body, Param, NotFoundException } from '@nestjs/common';
import { SkillsService } from './skills.service';
import type { CreateSkillDto, UpdateSkillDto } from '@kalio/types';

@Controller('skills')
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Get()
  findAll() {
    return this.skillsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const skill = await this.skillsService.findOne(id);
    if (!skill) throw new NotFoundException(`Skill ${id} not found`);
    return skill;
  }

  @Post()
  create(@Body() dto: CreateSkillDto) {
    return this.skillsService.create(dto);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateSkillDto) {
    const skill = await this.skillsService.update(id, dto);
    if (!skill) throw new NotFoundException(`Skill ${id} not found`);
    return skill;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.skillsService.remove(id);
    return { success: true };
  }
}

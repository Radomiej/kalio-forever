import { Controller, Get, Post, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { AllowedPathsService } from './allowed-paths.service';
import type { AllowedPath, CreateAllowedPathDto } from '@kalio/types';

@Controller('allowed-paths')
export class AllowedPathsController {
  constructor(private readonly service: AllowedPathsService) {}

  @Get()
  findAll(): Promise<AllowedPath[]> {
    return this.service.findAll();
  }

  @Post()
  create(@Body() dto: CreateAllowedPathDto): Promise<AllowedPath> {
    return this.service.create(dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    return this.service.remove(id);
  }
}

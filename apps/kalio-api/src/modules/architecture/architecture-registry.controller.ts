import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import type { ArchitectureSchema, CreateArchitectureSchemaVariantDto } from '@kalio/types';
import { ArchitectureRegistryService } from './architecture-registry.service';

@Controller('architecture-registry')
export class ArchitectureRegistryController {
  constructor(private readonly registry: ArchitectureRegistryService) {}

  @Get('schemas')
  findAll(): ArchitectureSchema[] {
    return this.registry.findAll();
  }

  @Get('schemas/:id')
  findOne(@Param('id') id: string): ArchitectureSchema {
    const schema = this.registry.findOne(id);
    if (!schema) throw new NotFoundException(`Architecture schema ${id} not found`);
    return schema;
  }

  @Post('schemas/:id/variants')
  async createVariant(
    @Param('id') id: string,
    @Body() dto: CreateArchitectureSchemaVariantDto,
  ): Promise<ArchitectureSchema> {
    const schema = await this.registry.createVariant(id, dto);
    if (!schema) throw new NotFoundException(`Architecture schema ${id} not found`);
    return schema;
  }

  @Delete('schemas/:id')
  @HttpCode(204)
  async removeVariant(@Param('id') id: string): Promise<void> {
    const removed = await this.registry.removeVariant(id);
    if (!removed) throw new NotFoundException(`Architecture schema ${id} not found`);
  }
}

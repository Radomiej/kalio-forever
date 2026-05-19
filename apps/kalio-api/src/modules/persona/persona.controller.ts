import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Persona, CreatePersonaDto, UpdatePersonaDto } from '@kalio/types';
import { PersonaService } from './persona.service';
import type { PersonaGraphValidationResult } from './persona-graph-config';

@Controller('personas')
export class PersonaController {
  constructor(private readonly personaService: PersonaService) {}

  @Get()
  findAll(): Promise<Persona[]> {
    return this.personaService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Persona> {
    return this.personaService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreatePersonaDto): Promise<Persona> {
    return this.personaService.create(dto);
  }

  @Post(':id/graph/validate')
  validateGraph(@Param('id') id: string, @Body() graphConfig: unknown): Promise<PersonaGraphValidationResult> {
    return this.personaService.validateGraphConfig(id, graphConfig);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePersonaDto): Promise<Persona> {
    return this.personaService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    return this.personaService.remove(id);
  }
}

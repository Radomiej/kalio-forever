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
